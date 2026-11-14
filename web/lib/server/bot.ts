// The "Shift-and-stack bot" scoreboard row (owner: SERVER). Server only: reads answer keys.
// Contract: docs/contracts/api.md section 7; BP 8.11.
// A bot candidate counts when it is above the noise bar and its path passes within 2 px of a
// known object in at least 2 frames (the same rule /api/check uses for `known`).

import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  loadAnswerKey,
  loadFieldForScoring,
  MATCH_RADIUS_PX,
  MIN_MATCHED_FRAMES,
  pointsFor,
  type AnswerKey,
  type FieldForScoring,
} from "@/lib/scoring";

export const BOT_NAME = "Shift-and-stack bot";

export type BotSpot = {
  slug: string;
  score: number;
  /** Candidates above the noise bar. */
  above_bar: number;
  /** Of those, how many matched a known object. */
  matched: number;
  matches: { rank: number; object: string }[];
};

export type BotResult = {
  score: number;
  /** matched / above_bar, or null when no candidate is above the bar. */
  accuracy: number | null;
  above_bar: number;
  matched: number;
  spots: BotSpot[];
};

/** Pure: score the bot on one spot. */
export function botScoreForSpot(
  key: AnswerKey,
  field: Pick<FieldForScoring, "difficulty" | "frames">,
  slug = key.slug,
): BotSpot {
  const mjd = new Map(field.frames.map((f) => [f.i, f.mjd]));
  const spot: BotSpot = { slug, score: 0, above_bar: 0, matched: 0, matches: [] };
  for (const c of key.bot.candidates) {
    if (!c.above_noise_bar) continue;
    spot.above_bar += 1;
    let hit: string | null = null;
    for (const obj of key.objects) {
      let frames = 0;
      for (const p of obj.positions) {
        const t = mjd.get(p.frame);
        if (!p.in_grid || t === undefined) continue;
        const dt = t - key.t_ref_mjd;
        const bx = c.x + c.vx_px_per_day * dt;
        const by = c.y + c.vy_px_per_day * dt;
        if (Math.hypot(bx - p.x, by - p.y) <= MATCH_RADIUS_PX) frames += 1;
      }
      if (frames >= MIN_MATCHED_FRAMES) {
        hit = obj.name;
        break;
      }
    }
    if (hit) {
      spot.matched += 1;
      spot.score += pointsFor("known", field.difficulty, false);
      spot.matches.push({ rank: c.rank, object: hit });
    }
  }
  return spot;
}

/** Slugs of the ready spots, from public/fields/index.json (with their difficulty). */
async function readySpots(root: string): Promise<{ slug: string; difficulty: string }[]> {
  try {
    const raw = JSON.parse(await readFile(path.join(root, "public", "fields", "index.json"), "utf8"));
    return Array.isArray(raw)
      ? raw.filter((s) => s && typeof s.slug === "string").map((s) => ({ slug: s.slug, difficulty: String(s.difficulty) }))
      : [];
  } catch {
    return [];
  }
}

/** Bot score over the ready spots (or only `slugs`). Reads answer keys; no network. */
export async function botScore(slugs?: string[], root: string = process.cwd()): Promise<BotResult> {
  const ready = await readySpots(root);
  const wanted = slugs ? ready.filter((s) => slugs.includes(s.slug)) : ready;
  const spots: BotSpot[] = [];
  for (const s of wanted) {
    const [key, field] = await Promise.all([loadAnswerKey(s.slug, root), loadFieldForScoring(s.slug, root)]);
    if (!key || !field) continue;
    // The index's difficulty is the one the build prompt names; field.json should agree.
    spots.push(botScoreForSpot(key, { ...field, difficulty: s.difficulty || field.difficulty }, s.slug));
  }
  const above = spots.reduce((n, s) => n + s.above_bar, 0);
  const matched = spots.reduce((n, s) => n + s.matched, 0);
  return {
    score: spots.reduce((n, s) => n + s.score, 0),
    accuracy: above > 0 ? matched / above : null,
    above_bar: above,
    matched,
    spots,
  };
}

// ------------------------------------------------------------------ scoreboard rows

export type BoardRow = {
  rank: number;
  name: string;
  score: number;
  accuracy: number | null;
  is_bot: boolean;
  is_me: boolean;
};
export type BoardMe = { rank: number; name: string; score: number; accuracy: number | null };

/**
 * Insert the bot into human rows (already best first) and renumber ranks 1, 2, 3...
 * A human with the same score stays above the bot. `me` (the caller's own row, possibly
 * further down than the shown rows) is re-ranked: its row rank if shown, else its database
 * rank plus one when the bot outscores it.
 */
export function mergeBot(
  humans: { name: string; score: number; accuracy: number | null; is_me: boolean }[],
  bot: { score: number; accuracy: number | null },
  me?: BoardMe,
): { rows: BoardRow[]; me?: BoardMe } {
  const botRow: BoardRow = {
    rank: 0,
    name: BOT_NAME,
    score: bot.score,
    accuracy: bot.accuracy,
    is_bot: true,
    is_me: false,
  };
  const list: BoardRow[] = humans.map((h) => ({
    rank: 0,
    name: h.name,
    score: h.score,
    accuracy: h.accuracy,
    is_bot: false,
    is_me: h.is_me,
  }));
  let at = list.findIndex((r) => r.score < bot.score);
  if (at < 0) at = list.length;
  list.splice(at, 0, botRow);
  list.forEach((r, i) => (r.rank = i + 1));
  if (!me) return { rows: list };
  const shown = list.find((r) => r.is_me);
  return {
    rows: list,
    me: { ...me, rank: shown ? shown.rank : me.rank + (bot.score > me.score ? 1 : 0) },
  };
}
