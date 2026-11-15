// GET /api/leaderboard?scope=spot|all&slug=  Contract: docs/contracts/api.md section 7.
// With a database: the `leaderboard` RPC plus the bot row. Without one, or when Supabase
// errors or takes over 5 s: public/leaderboard-snapshot.json, status 200, source "snapshot".

import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { anonClient } from "@/lib/server/db";
import { readySlugs } from "@/lib/scoring";
import { botScore, mergeBot, type BoardMe, type BoardRow } from "@/lib/server/bot";
import { ApiFail, handle, parse, queryObject } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";
import { isUnlocked } from "@/lib/server/unlock";

const Query = z
  .object({
    scope: z.enum(["spot", "all"]).default("all"),
    slug: z.string().regex(/^[a-z0-9-]{1,40}$/).optional(),
  })
  .refine((q) => q.scope === "all" || q.slug !== undefined, {
    message: "slug is required when scope=spot",
    path: ["slug"],
  });

const TIMEOUT_MS = 5000;
const MAX_ROWS = 50;

type Board = {
  scope: "spot" | "all";
  slug: string | null;
  source: "db" | "snapshot";
  updated_at: string;
  rows: BoardRow[];
  me?: BoardMe;
};

type DbRow = { rank: number | string; display_name: string; score: number | string; accuracy: number | string | null; is_me: boolean };

async function fromDb(request: NextRequest, slug: string | null): Promise<{ rows: DbRow[] } | null> {
  const sb = anonClient(request);
  if (!sb) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const { data, error } = await sb
      .rpc("leaderboard", { p_slug: slug, p_limit: MAX_ROWS })
      .abortSignal(ctl.signal);
    if (error || !Array.isArray(data)) return null;
    return { rows: data as DbRow[] };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function snapshot(scope: "spot" | "all", slug: string | null, showBot: boolean): Promise<Board> {
  if (scope === "all") {
    try {
      const raw = await readFile(path.join(process.cwd(), "public", "leaderboard-snapshot.json"), "utf8");
      const file = JSON.parse(raw) as Board;
      if (Array.isArray(file.rows)) return { ...file, scope, slug, source: "snapshot" };
    } catch {
      // fall through: build the same thing from the answer keys
    }
  }
  const bot = showBot ? await botScore(slug ? [slug] : undefined) : null;
  return {
    scope,
    slug,
    source: "snapshot",
    updated_at: new Date().toISOString(),
    rows: mergeBot([], bot).rows,
  };
}

// The body can depend on the caller's unlock cookie (and on who is logged in), so no cache may keep it.
const PRIVATE = { headers: { "Cache-Control": "private, no-store" } };

export async function GET(request: NextRequest): Promise<Response> {
  return handle(async () => {
    rateLimit(request, "leaderboard", 60);
    const q = parse(Query, queryObject(request));
    const slug = q.scope === "spot" ? (q.slug as string) : null;
    // A spot that is not ready (not in public/fields/index.json) is unknown. `fixture` is the test-only spot.
    if (slug !== null && slug !== "fixture" && !(await readySlugs()).includes(slug)) {
      throw new ApiFail("not_found", `No spot called "${slug}".`);
    }

    // The bot's score on one spot tells whether something moves there (0 on the control field), so a
    // per-spot board shows the bot only to a caller whose signed unlock cookie covers that spot.
    const showBot = slug === null || slug === "fixture" || isUnlocked(request, slug);

    const db = await fromDb(request, slug);
    if (!db) return NextResponse.json(await snapshot(q.scope, slug, showBot), PRIVATE);

    const all = db.rows
      .map((r) => ({
        rank: Number(r.rank),
        name: String(r.display_name),
        score: Number(r.score),
        accuracy: r.accuracy === null || r.accuracy === undefined ? null : Number(r.accuracy),
        is_me: Boolean(r.is_me),
      }))
      .sort((a, b) => a.rank - b.rank);
    const mine = all.find((r) => r.is_me);
    const humans = all.filter((r) => r.rank <= MAX_ROWS).slice(0, MAX_ROWS);
    const bot = showBot ? await botScore(slug ? [slug] : undefined) : null;
    const merged = mergeBot(
      humans,
      bot,
      mine ? { rank: mine.rank, name: mine.name, score: mine.score, accuracy: mine.accuracy } : undefined,
    );
    const body: Board = {
      scope: q.scope,
      slug,
      source: "db",
      updated_at: new Date().toISOString(),
      rows: merged.rows,
      ...(merged.me ? { me: merged.me } : {}),
    };
    return NextResponse.json(body, PRIVATE);
  });
}
