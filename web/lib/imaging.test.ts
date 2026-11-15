import { describe, expect, it } from "vitest";
import {
  changesRgb,
  colorByTime,
  colorByTimeRgb,
  makeSharedStretch,
  noiseOf,
  onlyChanges,
  paperModeRgb,
  sharedWhite,
  shiftGray,
  shiftOffsets,
} from "./imaging";
import type { RGB } from "./types";

describe("Shift (shift-and-stack)", () => {
  it("lines a mover up on one pixel and leaves edges black", () => {
    // 7 x 1 strip; a mover at x = 1 + 2 * t over t = 0, 1, 2 days.
    const frames = [0, 1, 2].map((t) => {
      const g = new Float32Array(7);
      g[1 + 2 * t] = 1;
      return g;
    });
    const offs = shiftOffsets([10, 11, 12], 10, { vx: 2, vy: 0 });
    expect(offs).toEqual([[0, 0], [2, 0], [4, 0]]);
    const shifted = frames.map((g, i) => shiftGray(g, 7, 1, offs[i][0], offs[i][1]));
    for (const g of shifted) expect(Array.from(g)).toEqual([0, 1, 0, 0, 0, 0, 0]);
    expect(Array.from(shiftGray(Float32Array.from([1, 2, 3]), 3, 1, -1, 0))).toEqual([0, 1, 2]);
  });
});
import ref from "./testdata/imaging_ref.json";

// Reference values come from motion_frames.py itself (testdata/gen_imaging_ref.py).
const toF32 = (a: (number | null)[]) => Float32Array.from(a, (v) => (v === null ? NaN : v));
const frames = ref.frames.map(toF32);
const colors = ref.colors.map((c) => c.map((v) => v * 255)) as RGB[];

function expectClose(got: ArrayLike<number>, want: (number | null)[], tol: number) {
  expect(got.length).toBe(want.length);
  let worst = 0;
  for (let i = 0; i < want.length; i++) {
    const w = want[i];
    if (w === null) {
      expect(Number.isNaN(got[i])).toBe(true);
      continue;
    }
    worst = Math.max(worst, Math.abs(got[i] - w));
  }
  expect(worst).toBeLessThan(tol);
}

describe("imaging vs motion_frames.py", () => {
  it("white points", () => {
    expect(sharedWhite(frames, -1)).toBeCloseTo(ref.white, 4);
    expect(sharedWhite(frames, 1)).toBeCloseTo(ref.white_on, 4);
  });

  it("make_stretch (black -1 and overlay black +1), NaN to 0", () => {
    const st = makeSharedStretch(frames);
    ref.grays.forEach((g, i) => expectClose(st(frames[i]), g, 1e-5));
    const on = makeSharedStretch(frames, { blackSigma: 1 });
    ref.on.forEach((g, i) => expectClose(on(frames[i]), g, 1e-5));
    expect(st(frames[1])[0]).toBe(0);
  });

  it("precomputed white from field.json gives the same stretch", () => {
    const st = makeSharedStretch(frames, { white: ref.white });
    expectClose(st(frames[2]), ref.grays[2], 1e-5);
  });

  it("onion_dark and onion_light", () => {
    const on = ref.on.map(toF32);
    expectClose(colorByTimeRgb(on, colors), ref.onion_dark, 1e-5);
    expectClose(paperModeRgb(on, colors), ref.onion_light, 1e-5);
  });

  it("noise_of, residuals and changes", () => {
    expect(noiseOf(frames[0])).toBeCloseTo(ref.noise_of_frame0, 5);
    onlyChanges(frames).forEach((r, i) => expectClose(r, ref.residuals[i], 1e-4));
    expectClose(changesRgb(frames, colors), ref.changes, 1e-4);
  });

  it("static stars come out white in Color by time", () => {
    const g = Float32Array.from([0.4]);
    const px = colorByTime([g, g, g, g], colors);
    expect(px[0]).toBe(px[1]);
    expect(px[1]).toBe(px[2]);
    expect(px[3]).toBe(255);
  });
});
