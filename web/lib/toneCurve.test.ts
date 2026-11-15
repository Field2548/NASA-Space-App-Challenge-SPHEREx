import { describe, expect, it } from "vitest";
import { applyCurve, CURVE_X, curveAt, DEFAULT_CURVE, isDefaultCurve, movePoint, presetCurve } from "./toneCurve";

describe("tone curve", () => {
  it("default is the identity and applyCurve returns the same array", () => {
    const g = Float32Array.from([0, 0.1, 0.5, 1]);
    expect(isDefaultCurve(DEFAULT_CURVE)).toBe(true);
    expect(applyCurve(g, DEFAULT_CURVE)).toBe(g);
    expect(presetCurve("asinh")).toEqual(DEFAULT_CURVE);
  });
  it("interpolation passes through control points, is monotone and stays in 0..1", () => {
    const c = [0, 0.1, 0.7, 0.72, 1];
    CURVE_X.forEach((x, i) => expect(curveAt(c, x)).toBeCloseTo(c[i], 6));
    let prev = -1;
    for (let i = 0; i <= 200; i++) {
      const y = curveAt(c, i / 200);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
      prev = y;
    }
  });
  it("applies a custom curve to every value, keeping 0 and 1", () => {
    const c = presetCurve("log");
    const out = applyCurve(Float32Array.from([0, 0.5, 1]), c);
    expect(out[0]).toBeCloseTo(0, 6);
    expect(out[2]).toBeCloseTo(1, 6);
    expect(out[1]).toBeGreaterThan(0.5);
  });
  it("movePoint keeps the curve monotone and clamped", () => {
    expect(movePoint(DEFAULT_CURVE, 2, 0.9)[2]).toBe(0.75);
    expect(movePoint(DEFAULT_CURVE, 2, 0.1)[2]).toBe(0.25);
    expect(movePoint(DEFAULT_CURVE, 0, -3)[0]).toBe(0);
    expect(movePoint(DEFAULT_CURVE, 2, 0.6)).toEqual([0, 0.25, 0.6, 0.75, 1]);
  });
  it("presets are monotone, end at (0,0) and (1,1), and differ from the default", () => {
    for (const n of ["linear", "log"] as const) {
      const c = presetCurve(n);
      expect(c[0]).toBeCloseTo(0, 9);
      expect(c[4]).toBeCloseTo(1, 9);
      expect([...c]).toEqual([...c].sort((a, b) => a - b));
      expect(isDefaultCurve(c)).toBe(false);
    }
    expect(presetCurve("linear")[2]).toBeLessThan(0.5);
    expect(presetCurve("log")[2]).toBeGreaterThan(0.5);
  });
});
