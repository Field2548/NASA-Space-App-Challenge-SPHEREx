// Frame picker (BP 8.9): snap target times to the nearest real burst, greedily, no repeats.

import type { FrameMeta } from "./types";

export interface PickOptions {
  count: number;
  spacing: "even" | "growing";
  minGapHours: number;
  /** Index into the time-sorted pool of the first pick (default 0). */
  startIndex?: number;
}

/**
 * Frame numbers (FrameMeta.i) in time order. The first pick is pool[startIndex]; the targets then spread
 * over the pool's remaining span: even is t0 + k*d, growing is t0 + d*(2^k - 1), with d chosen so the last
 * target lands on the last burst. Each target snaps to the nearest burst that is at least minGapHours after
 * the previous pick, so no frame repeats. Returns fewer than `count` frames when the pool runs out.
 */
export function pickFrames(pool: FrameMeta[], o: PickOptions): number[] {
  const sorted = pool.slice().sort((a, b) => a.mjd - b.mjd);
  const start = Math.min(Math.max(o.startIndex ?? 0, 0), sorted.length - 1);
  if (sorted.length === 0 || o.count < 1) return [];
  const t0 = sorted[start].mjd;
  const span = sorted[sorted.length - 1].mjd - t0;
  const steps = o.count - 1;
  const unit =
    steps === 0 ? 0 : o.spacing === "even" ? span / steps : span / (2 ** steps - 1);
  const picked = [start];
  for (let k = 1; k < o.count; k++) {
    const target = t0 + (o.spacing === "even" ? k * unit : unit * (2 ** k - 1));
    const earliest = sorted[picked[picked.length - 1]].mjd + o.minGapHours / 24;
    let best = -1;
    for (let j = picked[picked.length - 1] + 1; j < sorted.length; j++) {
      if (sorted[j].mjd < earliest - 1e-9) continue;
      if (best < 0 || Math.abs(sorted[j].mjd - target) < Math.abs(sorted[best].mjd - target)) best = j;
    }
    if (best < 0) break;
    picked.push(best);
  }
  return picked.map((j) => sorted[j].i);
}

/**
 * Array indices (into `pool`, time order) of `count` frames spread evenly over the pool's time span, always
 * including the first and last burst. count >= pool.length gives every frame. Used by the timeline's
 * "Frames" control; the frames keep their own numbers (FrameMeta.i).
 */
export function visibleFrameIndices(pool: FrameMeta[], count: number): number[] {
  const n = pool.length;
  const all = Array.from({ length: n }, (_, i) => i);
  if (count >= n || n < 3) return all;
  const c = Math.max(2, Math.floor(count));
  const picked = pickFrames(pool, { count: c, spacing: "even", minGapHours: 0 })
    .map((num) => pool.findIndex((f) => f.i === num))
    .filter((j) => j >= 0)
    .sort((a, b) => a - b);
  if (picked.length === c && new Set(picked).size === c) return picked;
  // The greedy picker ran dry (very uneven bursts): fall back to evenly spaced positions.
  return Array.from(new Set(Array.from({ length: c }, (_, k) => Math.round((k * (n - 1)) / (c - 1)))));
}
