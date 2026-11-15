// GET /api/player?name=: one player's public numbers (owner: SERVER). Server only.
// Contract: docs/contracts/api.md section 7a. Database: player_stats() in
// supabase/migrations/20261117000000_leaderboard_v2.sql, which never returns a user id or an email.
//
// The database knows which spots a player solved, but only player_spots() says so and only the service
// role may call it (player_stats is callable with the public anon key, so it carries no slugs). This
// file maps the slugs to stages and difficulties with public/fields/index.json (the same list
// readySlugs reads), so a stage's name never leaves the server: the response only says how many
// stages of each difficulty are done. Without the service key the stage fields are left out.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { anonClient, serviceClient } from "@/lib/server/db";
import { BOT_NAME, botScore } from "@/lib/server/bot";
import { ApiFail } from "@/lib/server/http";

export const MAX_NAME_LENGTH = 40;
const TIMEOUT_MS = 5000;

const BOT_ABOUT =
  "An automatic search that shifts and stacks every frame along thousands of possible motions and reports what rises above its noise bar. It plays every stage the same way, so you can try to beat it.";

const UNAVAILABLE = "Player stats are not available right now.";

/** Order the difficulties are listed in. Others (if the index ever has them) follow, alphabetically. */
const DIFFICULTY_ORDER = ["easy", "medium", "hard", "expert", "boss", "tool"];

export type Progress = { done: number; total: number };

export type PlayerAnswer = {
  name: string;
  is_bot: false;
  is_me: boolean;
  country: string | null;
  member_since: string | null;
  last_active: string | null;
  points: number;
  points_week: number;
  rank_all: number | null;
  rank_week: number | null;
  classifications: number;
  correct: number;
  accuracy: number | null;
  /** The three stage fields are absent when the server has no service key (or the call failed). */
  stages_completed?: number;
  stages_total?: number;
  by_difficulty?: Record<string, Progress>;
  first_finds: number;
  patches_solved: number;
  active_days: number;
  /** Seconds played, all time / the last 7 UTC days; null when the database function has no play time yet. */
  seconds_played: number | null;
  seconds_week: number | null;
};

export type BotAnswer = { name: string; is_bot: true; is_me: false; points: number; about: string };

type StatsRow = Record<string, unknown>;

/** Ready spots with their difficulty, from public/fields/index.json. A broken index is a server fault. */
async function readySpots(root: string): Promise<{ slug: string; difficulty: string }[]> {
  const raw: unknown = JSON.parse(await readFile(path.join(root, "public", "fields", "index.json"), "utf8"));
  if (!Array.isArray(raw)) throw new Error("Cannot read the spot list public/fields/index.json.");
  return raw.flatMap((s: { slug?: unknown; difficulty?: unknown }) =>
    s && typeof s.slug === "string" ? [{ slug: s.slug, difficulty: String(s.difficulty ?? "") }] : [],
  );
}

/**
 * Pure: stages completed, total and the per-difficulty progress from the solved slugs.
 * Solved slugs that are not ready spots (the test-only fixture, old stages) are ignored.
 * A difficulty with no stages is left out.
 */
export function progressFrom(
  spots: { slug: string; difficulty: string }[],
  solved: string[],
): { stages_completed: number; stages_total: number; by_difficulty: Record<string, Progress> } {
  const done = new Set(solved);
  const by: Record<string, Progress> = {};
  for (const s of spots) {
    const p = (by[s.difficulty] ??= { done: 0, total: 0 });
    p.total += 1;
    if (done.has(s.slug)) p.done += 1;
  }
  const keys = Object.keys(by).sort((a, b) => {
    const ia = DIFFICULTY_ORDER.indexOf(a);
    const ib = DIFFICULTY_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || (a < b ? -1 : 1);
  });
  const ordered: Record<string, Progress> = {};
  for (const k of keys) ordered[k] = by[k];
  const slugs = new Set(spots.map((s) => s.slug));
  return {
    stages_completed: [...done].filter((s) => slugs.has(s)).length,
    stages_total: spots.length,
    by_difficulty: ordered,
  };
}

const num = (v: unknown): number => Number(v) || 0;
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const isoOrNull = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = new Date(v);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
};

/** True when a Supabase/PostgREST error means "this function is not installed". */
function isMissingFunction(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    /could not find the function|function .* does not exist/i.test(error.message ?? "")
  );
}

/**
 * The all-time rank as the global board shows it. The board inserts the bot above every human whose
 * score is lower than the bot's (mergeBot), so such a player is one place further down than the
 * database rank. Same rule as mergeBot: +1 when the bot's total is strictly greater than the points.
 * With no rank, or when the bot's score cannot be worked out, the database rank is returned as is.
 */
async function displayedRankAll(rank: number | null, points: number, root: string): Promise<number | null> {
  if (rank === null) return null;
  try {
    const bot = await botScore(undefined, root);
    return bot.score > points ? rank + 1 : rank;
  } catch {
    return rank;
  }
}

/** The slugs of the stages a player solved, read with the service client; null when that is not possible. */
async function solvedSpots(name: string): Promise<string[] | null> {
  const sb = serviceClient();
  if (!sb) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await sb.rpc("player_spots", { p_name: name }).abortSignal(ctl.signal);
    if (res.error || !Array.isArray(res.data)) {
      if (res.error) console.error("[player] player_spots failed:", res.error.message);
      return null;
    }
    return res.data.filter((s: unknown): s is string => typeof s === "string");
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The answer for one display name. Throws ApiFail (400, 404, 503) as the contract says. */
export async function answerPlayer(
  request: Request,
  rawName: string | undefined,
  root: string = process.cwd(),
): Promise<PlayerAnswer | BotAnswer> {
  const name = (rawName ?? "").trim();
  if (name === "" || name.length > MAX_NAME_LENGTH) {
    throw new ApiFail("bad_request", `Give a player name of 1 to ${MAX_NAME_LENGTH} characters (?name=).`);
  }

  // The bot is not in the database: its points come from the answer keys, and nothing per stage is
  // returned (a per-stage result would say which stage has nothing moving).
  if (name.toLowerCase() === BOT_NAME.toLowerCase()) {
    const bot = await botScore(undefined, root);
    return { name: BOT_NAME, is_bot: true, is_me: false, points: bot.score, about: BOT_ABOUT };
  }

  const sb = anonClient(request);
  if (!sb) throw new ApiFail("db_unavailable", UNAVAILABLE);

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let data: unknown;
  try {
    const res = await sb.rpc("player_stats", { p_name: name }).abortSignal(ctl.signal);
    if (res.error) {
      if (!isMissingFunction(res.error)) console.error("[player] player_stats failed:", res.error.message);
      throw new ApiFail("db_unavailable", UNAVAILABLE);
    }
    data = res.data;
  } catch (e) {
    if (e instanceof ApiFail) throw e;
    throw new ApiFail("db_unavailable", UNAVAILABLE);
  } finally {
    clearTimeout(timer);
  }

  const row = (Array.isArray(data) ? data[0] : data) as StatsRow | null | undefined;
  if (!row || typeof row.display_name !== "string") {
    throw new ApiFail("not_found", `No player called "${name}".`);
  }

  // Stage progress needs the service key; without it (or if the call fails) the player is still answered.
  const solved = await solvedSpots(row.display_name);
  const progress = solved === null ? {} : progressFrom(await readySpots(root), solved);
  const points = num(row.points);
  const classifications = num(row.classifications);
  const correct = num(row.correct);
  return {
    name: row.display_name,
    is_bot: false,
    is_me: Boolean(row.is_me),
    country: typeof row.country === "string" ? row.country : null,
    member_since: isoOrNull(row.member_since),
    last_active: isoOrNull(row.last_active),
    points,
    points_week: num(row.points_week),
    rank_all: await displayedRankAll(numOrNull(row.rank_all), points, root),
    rank_week: numOrNull(row.rank_week),
    classifications,
    correct,
    accuracy: classifications > 0 ? Math.round((correct / classifications) * 1000) / 1000 : null,
    ...progress,
    first_finds: num(row.first_finds),
    patches_solved: num(row.patches_solved),
    active_days: num(row.active_days),
    seconds_played: numOrNull(row.seconds_played),
    seconds_week: numOrNull(row.seconds_week),
  };
}
