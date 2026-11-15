// Server side of GET /api/achievements. Reads the private answer keys only for each spot's kind;
// the response carries per-kind goal counts, never which spot has which kind.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { computeAchievements, type Achievement, type SolvedSpot, type SpotInfo } from "@/lib/achievements";
import { serviceClient } from "@/lib/server/db";

const EXCLUDED = new Set(["fixture", "quicklook"]);
const SOLVED_VERDICTS = new Set(["known", "bot_match", "nothing_correct"]);

let cache: Promise<SpotInfo[]> | null = null;

async function readIndex(): Promise<unknown> {
  return JSON.parse(await readFile(path.join(process.cwd(), "public", "fields", "index.json"), "utf8"));
}

async function readAnswerKey(slug: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(process.cwd(), "data", "answers", `${slug}.json`), "utf8"));
}

/** Every ready spot with its kind (from the answer key) and difficulty (from index.json). Cached. */
export function loadSpotInfos(): Promise<SpotInfo[]> {
  cache ??= (async () => {
    const index = (await readIndex()) as { slug?: unknown; difficulty?: unknown }[];
    const out: SpotInfo[] = [];
    for (const e of index) {
      if (typeof e.slug !== "string" || EXCLUDED.has(e.slug)) continue;
      try {
        const key = (await readAnswerKey(e.slug)) as { reveal?: { kind?: unknown } };
        const kind = key.reveal?.kind;
        if (typeof kind === "string") out.push({ slug: e.slug, kind, difficulty: String(e.difficulty ?? "") });
      } catch {
        // a spot without a readable answer key cannot count
      }
    }
    return out;
  })().catch((e) => {
    cache = null;
    throw e;
  });
  return cache;
}

export type FindRow = { spot_slug: string; verdict: string; points: number | null; created_at: string };

/** Pure: finds rows to solved spots (correct verdicts only) and total points. Wrong answers never count. */
export function summariseFinds(rows: FindRow[], spots: SpotInfo[]): { solved: SolvedSpot[]; points: number } {
  const by = new Map(spots.map((s) => [s.slug, s]));
  const solved: SolvedSpot[] = [];
  let points = 0;
  for (const r of rows) {
    if (EXCLUDED.has(r.spot_slug)) continue;
    points += Number(r.points) || 0;
    const spot = by.get(r.spot_slug);
    if (spot && SOLVED_VERDICTS.has(r.verdict)) solved.push({ ...spot, at: r.created_at });
  }
  return { solved, points };
}

/** The account's achievements, or null when the database is not available. */
export async function accountAchievements(userId: string): Promise<Achievement[] | null> {
  const sb = serviceClient();
  if (!sb) return null;
  const { data, error } = await sb
    .from("finds")
    .select("spot_slug, verdict, points, created_at")
    .eq("user_id", userId)
    .limit(5000);
  if (error || !data) return null;
  const spots = await loadSpotInfos();
  const { solved, points } = summariseFinds(data as FindRow[], spots);
  return computeAchievements(solved, spots, points);
}

/** Guest: slugs the browser says it solved. Unknown slugs are ignored; no times, no points. */
export async function guestAchievements(slugs: string[]): Promise<Achievement[]> {
  const spots = await loadSpotInfos();
  const by = new Map(spots.map((s) => [s.slug, s]));
  const solved: SolvedSpot[] = [];
  for (const slug of new Set(slugs)) {
    const s = by.get(slug);
    if (s) solved.push({ ...s, at: null });
  }
  return computeAchievements(solved, spots, 0);
}
