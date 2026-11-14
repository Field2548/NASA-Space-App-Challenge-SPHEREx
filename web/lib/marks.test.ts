import { describe, expect, it } from "vitest";
import { fitTrack, isStatic, rateArcsecPerHour, validateMarks } from "./marks";
import type { Mark } from "./types";

const mk = (frame: number, x: number, y: number, tDays: number): Mark => ({ frame, x, y, tDays });

describe("fitTrack", () => {
  it("recovers an exact line with x0,y0 at the first mark", () => {
    const t = fitTrack([mk(2, 10, 20, 0.5), mk(3, 12, 19, 1.5), mk(5, 16, 17, 3.5)]);
    expect(t.t0Days).toBe(0.5);
    expect(t.x0).toBeCloseTo(10, 9);
    expect(t.y0).toBeCloseTo(20, 9);
    expect(t.vx).toBeCloseTo(2, 9);
    expect(t.vy).toBeCloseTo(-1, 9);
    expect(t.rms).toBe(0);
  });
  it("noisy line gives a positive rms and near-true velocity", () => {
    const j = [0.3, -0.2, 0.1, -0.3, 0.2];
    const marks = j.map((e, i) => mk(i + 1, 5 + 3 * i + e, 8 + 1 * i - e, i));
    const t = fitTrack(marks);
    expect(t.rms).toBeGreaterThan(0.05);
    expect(t.rms).toBeLessThan(0.5);
    expect(t.vx).toBeCloseTo(3, 0);
    expect(t.vy).toBeCloseTo(1, 0);
  });
  it("two marks: exact through both, rms 0", () => {
    const t = fitTrack([mk(1, 51, 64, 0), mk(3, 55.5, 62.5, 2)]);
    expect(t.vx).toBeCloseTo(2.25, 9);
    expect(t.vy).toBeCloseTo(-0.75, 9);
    expect(t.rms).toBe(0);
  });
  it("needs 2 marks", () => {
    expect(() => fitTrack([mk(1, 0, 0, 0)])).toThrow();
  });
});

describe("isStatic / rate", () => {
  it("sub-pixel jitter star is static", () => {
    const t = fitTrack([mk(1, 30, 30, 0), mk(2, 30.2, 29.9, 1), mk(3, 29.9, 30.1, 2), mk(4, 30.1, 30, 3)]);
    expect(isStatic(t)).toBe(true);
  });
  it("a mover is not static; sub-pixel total motion is", () => {
    expect(isStatic(fitTrack([mk(1, 0, 0, 0), mk(2, 5, 0, 1)]))).toBe(false);
    expect(isStatic(fitTrack([mk(1, 0, 0, 0), mk(2, 0.5, 0, 1)]))).toBe(true);
    expect(isStatic(fitTrack([mk(1, 0, 0, 0), mk(2, 0.5, 0, 1)]), 0.1)).toBe(false);
  });
  it("1 px/day is 0.25625 arcsec/h", () => {
    const t = fitTrack([mk(1, 0, 0, 0), mk(2, 1, 0, 1)]);
    expect(rateArcsecPerHour(t)).toBeCloseTo(0.25625, 9);
    expect(rateArcsecPerHour(t, 10)).toBeCloseTo(10 / 24, 9);
  });
});

describe("validateMarks", () => {
  it("accepts 2 frames", () => expect(validateMarks([mk(1, 0, 0, 0), mk(2, 1, 1, 1)])).toBeNull());
  it("rejects none, one, and one frame twice", () => {
    expect(validateMarks([])).toMatch(/2 different/);
    expect(validateMarks([mk(1, 0, 0, 0)])).toMatch(/2 different/);
    expect(validateMarks([mk(1, 0, 0, 0), mk(1, 1, 1, 0)])).toMatch(/one mark per frame/i);
  });
});
