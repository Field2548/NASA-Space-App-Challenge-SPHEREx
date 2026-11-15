import { describe, expect, it } from "vitest";
import { applyCurve, bezierAt, curveAt, DEFAULT_CURVE, handleOf, isDefaultCurve, presetCurve } from "./toneCurve";

const monotone = (f: (x: number) => number) => {
  let prev = -1;
  for (let i = 0; i <= 200; i++) {
    const y = f(i / 200);
    expect(y).toBeGreaterThanOrEqual(prev - 1e-12);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThanOrEqual(1);
    prev = y;
  }
};

describe("tone curve", () => {
  it("default is the identity and applyCurve returns the same array", () => {
    const g = Float32Array.from([0, 0.1, 0.5, 1]);
    expect(isDefaultCurve(DEFAULT_CURVE)).toBe(true);
    expect(applyCurve(g, DEFAULT_CURVE)).toBe(g);
    expect(presetCurve("asinh")).toEqual(DEFAULT_CURVE);
  });
  it("bend 0 is the straight line; the handle sits on the anti-diagonal", () => {
    for (const x of [0, 0.1, 0.37, 0.5, 0.9, 1]) expect(bezierAt(0, x)).toBeCloseTo(x, 9);
    for (const b of [-1, -0.3, 0, 0.6, 1]) {
      const h = handleOf(b);
      expect(h.x + h.y).toBeCloseTo(1, 12);
      expect(h.y - h.x).toBeCloseTo(b, 12);
    }
  });
  it("matches the quadratic Bezier with that handle, ends at (0,0) and (1,1)", () => {
    const b = 0.6;
    const { x: px, y: py } = handleOf(b);
    for (const t of [0.1, 0.3, 0.5, 0.8]) {
      const x = 2 * t * (1 - t) * px + t * t;
      const y = 2 * t * (1 - t) * py + t * t;
      expect(bezierAt(b, x)).toBeCloseTo(y, 9);
    }
    for (const bb of [-1, 1]) {
      expect(bezierAt(bb, 0)).toBeCloseTo(0, 9);
      expect(bezierAt(bb, 1)).toBeCloseTo(1, 9);
    }
  });
  it("is monotone in 0..1 for any bend and preset; sign of bend sets brighter or darker", () => {
    for (const preset of ["linear", "log", "asinh"] as const)
      for (const bend of [-1, -0.5, 0, 0.5, 1]) monotone((x) => curveAt({ preset, bend }, x));
    expect(bezierAt(0.5, 0.3)).toBeGreaterThan(0.3);
    expect(bezierAt(-0.5, 0.3)).toBeLessThan(0.3);
  });
  it("presets differ from the default: Linear darkens the middle, Log lifts it", () => {
    expect(curveAt(presetCurve("linear"), 0.5)).toBeLessThan(0.5);
    expect(curveAt(presetCurve("log"), 0.5)).toBeGreaterThan(0.5);
    const out = applyCurve(Float32Array.from([0, 0.5, 1]), presetCurve("log"));
    expect(out[0]).toBeCloseTo(0, 6);
    expect(out[2]).toBeCloseTo(1, 6);
    expect(out[1]).toBeGreaterThan(0.5);
  });
});
