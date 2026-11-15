// GET /api/leaderboard: the board logic. Server only.
// Contract: docs/contracts/api.md section 7. Database: supabase/migrations/20261118000000_leaderboard_v2.sql.
//
// Boards: period (all time or the last 7 days) x region (global or one country). The default board
// (all time, global) behaves exactly as before: the same spot 404 rule, the same bot unlock rule,
// the same 5 s timeout, the same snapshot file when Supabase is missing or down, and the old
// `leaderboard` function when the new functions are not installed yet. Every other board needs the
// new functions and otherwise answers `available: false` with a reason, never an error.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { after } from "next/server";
import { readySlugs } from "@/lib/scoring";
import { anonClient, bearerToken } from "@/lib/server/db";
import { botScore, mergeBot, type BoardMe, type BoardRow } from "@/lib/server/bot";
import { ApiFail } from "@/lib/server/http";
import { isUnlocked } from "@/lib/server/unlock";

export type Scope = "spot" | "all";
export type Period = "all" | "week";
export type Region = "global" | "local";
export type Reason = "no_database" | "no_country" | "not_installed";

export type BoardQuery = {
  scope: Scope;
  slug?: string;
  period: Period;
  region: Region;
  /** From `?country=`, already validated as two letters, any case. */
  country?: string;
};

/** A row of the response. `finds` is null for the bot and may be absent (old function, snapshot). */
export type RankedRow = BoardRow & { finds?: number | null };
export type RankedMe = BoardMe & { finds?: number | null };

export type Board = {
  scope: Scope;
  slug: string | null;
  source: "db" | "snapshot";
  updated_at: string;
  period: Period;
  region: Region;
  country: string | null;
  detected_country: string | null;
  available: boolean;
  reason?: Reason;
  countries?: { code: string; players: number }[];
  rows: RankedRow[];
  me?: RankedMe;
};

const TIMEOUT_MS = 5000;
const MAX_ROWS = 50;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** Saving the country must never hold anything up: give up quickly. */
const COUNTRY_TIMEOUT_MS = 2000;

// ------------------------------------------------------------------ country

/**
 * The caller's country from the IP-country header (`x-vercel-ip-country` on Vercel), upper case.
 * Only two letters count; "XX" (unknown) and anything else (for example "T1" for Tor) is ignored.
 */
export function detectCountry(request: Request): string | null {
  const raw = (request.headers.get("x-vercel-ip-country") ?? "").trim();
  if (!/^[A-Za-z]{2}$/.test(raw)) return null;
  const code = raw.toUpperCase();
  return code === "XX" ? null : code;
}

/** Requests that already scheduled a country save, so /api/complete (many saves) sends one call. */
const remembered = new WeakSet<Request>();

/**
 * Store the caller's detected country on their profile (set_my_country, with the caller's own
 * token) so they appear on their local board. Fire and forget: it runs after the response where
 * Next.js allows it, gives up after 2 s, and every failure is swallowed. A guest has no token
 * and nothing happens. Only the two-letter code is sent, never the IP address.
 */
export function rememberCountry(request: Request): void {
  try {
    const country = detectCountry(request);
    if (!country || !bearerToken(request) || remembered.has(request)) return;
    const sb = anonClient(request);
    if (!sb) return;
    remembered.add(request);
    const work = async () => {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), COUNTRY_TIMEOUT_MS);
      try {
        await sb.rpc("set_my_country", { p_country: country }).abortSignal(ctl.signal);
      } catch {
        // not installed yet, bad token, network: the player never needs to know
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      after(work);
    } catch {
      // Outside a request scope (tests, scripts): just start it.
      void work();
    }
  } catch {
    // never let this affect a response
  }
}

// ------------------------------------------------------------------ database calls

type DbRow = {
  rank: number | string;
  display_name: string;
  score: number | string;
  accuracy: number | string | null;
  finds?: number | string | null;
  is_me: boolean;
};

type Call = { ok: true; data: unknown[] } | { ok: false; missing: boolean; timedOut: boolean };

/** A function that is not installed: PostgREST says PGRST202, Postgres says 42883 "does not exist". */
function isMissingFunction(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    /could not find the function|function .* does not exist/i.test(error.message ?? "")
  );
}

/** One RPC with the 5 s timeout. Any failure is a result, never a throw. */
async function call(
  sb: NonNullable<ReturnType<typeof anonClient>>,
  fn: string,
  args: Record<string, unknown>,
): Promise<Call> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const { data, error } = await sb.rpc(fn, args).abortSignal(ctl.signal);
    if (error) return { ok: false, missing: isMissingFunction(error), timedOut: ctl.signal.aborted };
    if (!Array.isArray(data)) return { ok: false, missing: false, timedOut: false };
    return { ok: true, data };
  } catch {
    return { ok: false, missing: false, timedOut: ctl.signal.aborted };
  } finally {
    clearTimeout(timer);
  }
}

function numOrNull(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

function normalise(rows: DbRow[]) {
  return rows
    .map((r) => ({
      rank: Number(r.rank),
      name: String(r.display_name),
      score: Number(r.score),
      accuracy: numOrNull(r.accuracy),
      finds: r.finds === undefined ? undefined : numOrNull(r.finds),
      is_me: Boolean(r.is_me),
    }))
    .sort((a, b) => a.rank - b.rank);
}

function normaliseCountries(rows: unknown[]): { code: string; players: number }[] {
  return rows
    .flatMap((r) => {
      const o = r as { code?: unknown; players?: unknown };
      return typeof o.code === "string" ? [{ code: o.code.toUpperCase(), players: Number(o.players) }] : [];
    })
    .sort((a, b) => b.players - a.players || (a.code < b.code ? -1 : 1));
}

// ------------------------------------------------------------------ snapshot (no database)

// A snapshot file carries its own scope, slug and source; the response overrides them as before.
async function snapshotBoard(base: Omit<Board, "rows" | "updated_at" | "source">, showBot: boolean): Promise<Board> {
  if (base.scope === "all") {
    try {
      const raw = await readFile(path.join(process.cwd(), "public", "leaderboard-snapshot.json"), "utf8");
      const file = JSON.parse(raw) as { rows?: RankedRow[]; updated_at?: string };
      if (Array.isArray(file.rows)) {
        const updated = typeof file.updated_at === "string" ? file.updated_at : new Date().toISOString();
        return { ...base, source: "snapshot", updated_at: updated, rows: file.rows };
      }
    } catch {
      // fall through: build the same thing from the answer keys
    }
  }
  const bot = showBot ? await botScore(base.slug ? [base.slug] : undefined) : null;
  return { ...base, source: "snapshot", updated_at: new Date().toISOString(), rows: mergeBot([], bot).rows };
}

// ------------------------------------------------------------------ the board

/** Everything the caller needs to know to rank people: the answer for one query. */
export async function answerBoard(request: Request, q: BoardQuery): Promise<Board> {
  const slug = q.scope === "spot" ? (q.slug as string) : null;
  // A spot that is not ready (not in public/fields/index.json) is unknown. `fixture` is the test-only spot.
  if (slug !== null && slug !== "fixture" && !(await readySlugs()).includes(slug)) {
    throw new ApiFail("not_found", `No spot called "${slug}".`);
  }

  const detected = detectCountry(request);
  // A caller who opens a local board has their detected country saved on their profile, so they show
  // up there. Other boards do not write (the page asks for two boards per click).
  if (q.region === "local") rememberCountry(request);

  const isDefault = q.period === "all" && q.region === "global";
  const country = q.region === "local" ? (q.country ? q.country.toUpperCase() : detected) : null;
  const base = {
    scope: q.scope,
    slug,
    period: q.period,
    region: q.region,
    country,
    detected_country: detected,
    available: true,
  };

  // The bot's score on one spot tells whether something moves there, so a
  // per-spot board shows the bot only to a caller whose signed unlock cookie covers that spot.
  // Only the default board merges the bot (weekly and local boards return before it is used).
  const showBot = (slug === null || slug === "fixture" || isUnlocked(request, slug));

  const sb = anonClient(request);
  const unavailable = (reason: Reason, countries?: Board["countries"]): Board => ({
    ...base,
    available: false,
    reason,
    source: sb ? "db" : "snapshot",
    updated_at: new Date().toISOString(),
    ...(q.region === "local" ? { countries: countries ?? [] } : {}),
    rows: [],
  });

  if (!sb) {
    return isDefault ? snapshotBoard(base, showBot) : unavailable("no_database");
  }

  const since = q.period === "week" ? new Date(Date.now() - WEEK_MS).toISOString() : null;
  const args = { p_slug: slug, p_since: since, p_country: country };
  const countriesCall =
    q.region === "local"
      ? call(sb, "leaderboard_countries", { p_slug: slug, p_since: since })
      : Promise.resolve<Call | null>(null);

  // Local board with nobody to look up: still list the countries so the page can offer a choice.
  if (q.region === "local" && country === null) {
    const c = await countriesCall;
    if (c && !c.ok && c.missing) return unavailable("not_installed");
    return unavailable("no_country", c && c.ok ? normaliseCountries(c.data) : []);
  }

  const [v2, countriesRes] = await Promise.all([
    call(sb, "leaderboard_v2", { ...args, p_limit: MAX_ROWS }),
    countriesCall,
  ]);

  if (!v2.ok) {
    // The default board never goes unavailable: any database error except a timeout tries the old
    // `leaderboard` function (a timeout goes straight to the snapshot, so the wait stays one 5 s).
    if (isDefault) return v2.timedOut ? snapshotBoard(base, showBot) : oldBoard(sb, base, slug, showBot);
    return v2.missing ? unavailable("not_installed") : unavailable("no_database");
  }

  const all = normalise(v2.data as DbRow[]);
  const countries = q.region === "local" ? { countries: countriesRes?.ok ? normaliseCountries(countriesRes.data) : [] } : {};
  const mine = all.find((r) => r.is_me);
  const humans = all.filter((r) => r.rank <= MAX_ROWS).slice(0, MAX_ROWS);
  const findsByName = new Map(humans.map((h) => [h.name, h.finds]));

  if (!isDefault) {
    // Weekly and local boards keep the database's ranks (equal scores share a rank) and have no bot.
    return {
      ...base,
      source: "db",
      updated_at: new Date().toISOString(),
      ...countries,
      rows: humans.map((h) => ({
        rank: h.rank,
        name: h.name,
        score: h.score,
        accuracy: h.accuracy,
        finds: h.finds ?? null,
        is_bot: false,
        is_me: h.is_me,
      })),
      ...(mine
        ? { me: { rank: mine.rank, name: mine.name, score: mine.score, accuracy: mine.accuracy, finds: mine.finds ?? null } }
        : {}),
    };
  }

  return defaultBoard(base, humans, mine, findsByName, showBot, slug);
}

/** The all-time global board: humans plus (when allowed) the bot, exactly as the route always built it. */
async function defaultBoard(
  base: Omit<Board, "rows" | "updated_at" | "source">,
  humans: ReturnType<typeof normalise>,
  mine: ReturnType<typeof normalise>[number] | undefined,
  findsByName: Map<string, number | null | undefined>,
  showBot: boolean,
  slug: string | null,
): Promise<Board> {
  const bot = showBot ? await botScore(slug ? [slug] : undefined) : null;
  const merged = mergeBot(
    humans,
    bot,
    mine ? { rank: mine.rank, name: mine.name, score: mine.score, accuracy: mine.accuracy } : undefined,
  );
  const withFinds = (name: string, isBot: boolean): { finds?: number | null } => {
    if (isBot) return { finds: null };
    const f = findsByName.get(name);
    return f === undefined ? {} : { finds: f };
  };
  return {
    ...base,
    source: "db",
    updated_at: new Date().toISOString(),
    rows: merged.rows.map((r) => ({ ...r, ...withFinds(r.name, r.is_bot) })),
    ...(merged.me ? { me: { ...merged.me, ...withFinds(merged.me.name, false) } } : {}),
  };
}

/** v2 failed (not a timeout): answer the default board from the old `leaderboard` function, else the snapshot. */
async function oldBoard(
  sb: NonNullable<ReturnType<typeof anonClient>>,
  base: Omit<Board, "rows" | "updated_at" | "source">,
  slug: string | null,
  showBot: boolean,
): Promise<Board> {
  const old = await call(sb, "leaderboard", { p_slug: slug, p_limit: MAX_ROWS });
  if (!old.ok) return snapshotBoard(base, showBot);
  const all = normalise(old.data as DbRow[]);
  const mine = all.find((r) => r.is_me);
  const humans = all.filter((r) => r.rank <= MAX_ROWS).slice(0, MAX_ROWS);
  // The old function has no finds count: leave `finds` out (the contract allows it).
  return defaultBoard(
    base,
    humans.map((h) => ({ ...h, finds: undefined })),
    mine ? { ...mine, finds: undefined } : undefined,
    new Map(),
    showBot,
    slug,
  );
}
