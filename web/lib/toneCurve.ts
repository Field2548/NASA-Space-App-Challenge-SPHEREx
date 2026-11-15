// Tone curve: output brightness as a function of the brightness the viewer already shows
// (0..1 after the asinh stretch). One quadratic Bezier from (0,0) to (1,1) with one handle on
// the anti-diagonal x + y = 1. The single parameter `bend` in -1..1 places the handle at
// ((1 - bend)/2, (1 + bend)/2): 0 is the straight line (no change), > 0 lifts faint levels,
// < 0 darkens them. A handle inside the unit square keeps the curve non-decreasing.
//
// The Stretch stops are bend values of this same curve, least-squares fits (201 points on 0..1):
//   asinh  0      the picture as drawn (identity)
//   log    +0.54 fit to log10(1 + 9y), rms 0.012
//   linear -0.44 fit to sinh(y asinh 5)/5 (undoes the asinh), rms 0.004
// The default (bend 0) is the identity: applyCurve returns the same array.

// Ordered by bend (how much each lifts the faint end), so the Stretch slider runs Linear, asinh, Log.
export const CURVE_PRESETS = ["linear", "asinh", "log"] as const;
export type CurvePreset = (typeof CURVE_PRESETS)[number];
export interface Curve {
  bend: number;
}

export const PRESET_BEND: Record<CurvePreset, number> = { linear: -0.44, log: 0.54, asinh: 0 };

export const DEFAULT_CURVE: Curve = { bend: 0 };

const EPS = 1e-9;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const clampBend = (b: number) => Math.min(1, Math.max(-1, Number.isFinite(b) ? b : 0));

export const isDefaultCurve = (c: Curve) => Math.abs(c.bend) < EPS;

/** The curve a Stretch stop sets. */
export function presetCurve(name: CurvePreset): Curve {
  return { bend: PRESET_BEND[name] };
}

/** The stop whose bend this curve has, or null when the handle was moved off every stop. */
export function presetOf(c: Curve): CurvePreset | null {
  return CURVE_PRESETS.find((p) => Math.abs(PRESET_BEND[p] - c.bend) < 1e-6) ?? null;
}

/** Bezier handle position for a bend value. */
export function handleOf(bend: number): { x: number; y: number } {
  const b = clampBend(bend);
  return { x: (1 - b) / 2, y: (1 + b) / 2 };
}

/** Height of the Bezier at input x (solves x(t) = x for t, then returns y(t)). */
export function bezierAt(bend: number, x: number): number {
  const s = clamp01(x);
  const { x: px, y: py } = handleOf(bend);
  const a = 1 - 2 * px; // x(t) = a t^2 + 2 px t
  const t = Math.abs(a) < EPS ? s : (-px + Math.sqrt(Math.max(0, px * px + a * s))) / a;
  const u = clamp01(t);
  return clamp01(2 * u * (1 - u) * py + u * u);
}

/** Curve height at input x in 0..1. */
export function curveAt(c: Curve, x: number): number {
  return bezierAt(c.bend, x);
}

const LUT_SIZE = 1024;

/** Apply the curve to a 0..1 gray frame. The default curve returns the input array itself. */
export function applyCurve(gray: Float32Array, c: Curve): Float32Array {
  if (isDefaultCurve(c)) return gray;
  const lut = new Float32Array(LUT_SIZE + 1);
  for (let i = 0; i <= LUT_SIZE; i++) lut[i] = curveAt(c, i / LUT_SIZE);
  const out = new Float32Array(gray.length);
  for (let k = 0; k < gray.length; k++) {
    const p = clamp01(gray[k]) * LUT_SIZE;
    const i = Math.min(LUT_SIZE - 1, Math.floor(p));
    out[k] = lut[i] + (lut[i + 1] - lut[i]) * (p - i);
  }
  return out;
}
