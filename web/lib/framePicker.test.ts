import { describe, expect, it } from "vitest";
import { pickFrames, visibleFrameIndices } from "./framePicker";
import type { FrameMeta } from "./types";

const pool = (days: number[]): FrameMeta[] =>
  days.map((d, k) => ({ i: k + 1, mjd: 60000 + d, utc: "", hours_since_prev: 0, n_bands: 8, detectors: [1] }));

const gaps = (p: FrameMeta[], ids: number[]) =>
  ids.slice(1).map((id, k) => (p[id - 1].mjd - p[ids[k] - 1].mjd) * 24);

describe("pickFrames", () => {
  const p = pool([0, 0.07, 0.5, 1, 2, 3, 4, 6, 8, 12, 16]);
  it("even spacing snaps to the nearest real bursts", () => {
    // span 16 d, 5 frames: targets 0, 4, 8, 12, 16 hit bursts exactly
    expect(pickFrames(p, { count: 5, spacing: "even", minGapHours: 1 })).toEqual([1, 7, 9, 10, 11]);
    // 4 frames: targets 0, 5.33, 10.67, 16 -> 4 or 6 (tie-free: |4-5.33|=1.33 < |6-5.33|=0.67? no, 6 is closer)
    expect(pickFrames(p, { count: 4, spacing: "even", minGapHours: 1 })).toEqual([1, 8, 10, 11]);
  });
  it("growing spacing has short early gaps and long late gaps", () => {
    const ids = pickFrames(p, { count: 5, spacing: "growing", minGapHours: 1 });
    // unit 16/15: targets 0, 1.07, 3.2, 7.5, 16
    expect(ids).toEqual([1, 4, 6, 9, 11]); // 7.5 d is nearer the 8 d burst (i = 9) than the 6 d one
    const g = gaps(p, ids);
    expect(g[3]).toBeGreaterThan(g[0]);
  });
  it("never repeats and stays in time order, even when targets collide", () => {
    const dense = pool([0, 0.01, 0.02, 0.03, 10]);
    const ids = pickFrames(dense, { count: 4, spacing: "growing", minGapHours: 0 });
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });
  it("respects minGapHours", () => {
    const ids = pickFrames(p, { count: 4, spacing: "even", minGapHours: 20 });
    for (const g of gaps(p, ids)) expect(g).toBeGreaterThanOrEqual(20 - 1e-6);
    // the 0.07 d burst is 1.7 h after the first: never chosen with a 20 h gap
    expect(ids).not.toContain(2);
  });
  it("startIndex starts there and spreads over the rest", () => {
    const ids = pickFrames(p, { count: 3, spacing: "even", minGapHours: 1, startIndex: 4 });
    expect(ids[0]).toBe(5);
    expect(ids).toEqual([5, 9, 11]); // span 14 d from day 2: middle target day 9, nearest burst day 8
  });
  it("returns fewer frames when the gap cannot be met, and handles unsorted pools", () => {
    expect(pickFrames(pool([0, 0.5, 1]), { count: 5, spacing: "even", minGapHours: 12 })).toEqual([1, 2, 3]);
    expect(pickFrames(pool([0, 0.5, 1]), { count: 3, spacing: "even", minGapHours: 24 })).toEqual([1, 3]);
    const shuffled = [p[5], p[0], p[10], p[3]];
    expect(pickFrames(shuffled, { count: 2, spacing: "even", minGapHours: 1 })).toEqual([1, 11]);
  });
  it("count 1 and empty pool", () => {
    expect(pickFrames(p, { count: 1, spacing: "even", minGapHours: 1 })).toEqual([1]);
    expect(pickFrames([], { count: 3, spacing: "even", minGapHours: 1 })).toEqual([]);
  });
});

describe("visibleFrameIndices", () => {
  const p = pool([0, 1, 2, 3, 4, 5]);
  it("gives every frame for the full count and spreads a subset over the whole span", () => {
    expect(visibleFrameIndices(p, 6)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(visibleFrameIndices(p, 9)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(visibleFrameIndices(p, 2)).toEqual([0, 5]);
    const three = visibleFrameIndices(p, 3);
    expect(three[0]).toBe(0);
    expect(three[2]).toBe(5);
  });
  it("always returns the requested number of distinct frames in time order", () => {
    const uneven = pool([0, 0.01, 0.02, 0.03, 10, 10.01]);
    for (let c = 2; c <= 6; c++) {
      const ids = visibleFrameIndices(uneven, c);
      expect(ids).toHaveLength(c);
      expect(ids).toEqual([...ids].sort((a, b) => a - b));
      expect(ids[0]).toBe(0);
    }
  });
});
