// Tone curve: output brightness as a function of the brightness the viewer already shows
// (0..1 after the asinh stretch). Five control points at fixed inputs, only their heights
// move, kept non-decreasing; between them a monotone cubic (Fritsch-Carlson). The default is
// the identity, which leaves the picture untouched (applyCurve returns the same array).

export const CURVE_X = [0, 0.25, 0.5, 0.75, 1] as const;
export type Curve = number[];
export type CurvePreset = "linear" | "asinh" | "log";

export const DEFAULT_CURVE: Curve = [0, 0.25, 0.5, 0.75, 1];

export const isDefaultCurve = (c: Curve) => c.every((y, i) => Math.abs(y - DEFAULT_CURVE[i]) < 1e-9);

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Preset heights. "asinh" is today's look (identity); the others are relative to it. */
export function presetCurve(name: CurvePreset, a = 5): Curve {
  const f: Record<CurvePreset, (y: number) => number> = {
    asinh: (y) => y,
    // undo the asinh: brightness proportional to the signal
    linear: (y) => Math.sinh(y * Math.asinh(a)) / a,
    log: (y) => Math.log1p(9 * y) / Math.log(10),
  };
  return CURVE_X.map((x) => f[name](x));
}

/** Move point i to height y, kept between its neighbours so the curve stays non-decreasing. */
export function movePoint(c: Curve, i: number, y: number): Curve {
  const lo = i > 0 ? c[i - 1] : 0;
  const hi = i < c.length - 1 ? c[i + 1] : 1;
  const out = [...c];
  out[i] = Math.min(hi, Math.max(lo, clamp01(y)));
  return out;
}

/** Monotone cubic Hermite tangents (Fritsch-Carlson). */
function tangents(y: Curve): number[] {
  const n = y.length;
  const h = (i: number) => CURVE_X[i + 1] - CURVE_X[i];
  const d = y.slice(0, -1).map((v, i) => (y[i + 1] - v) / h(i));
  const m = new Array<number>(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const al = m[i] / d[i];
    const be = m[i + 1] / d[i];
    const s = al * al + be * be;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * al * d[i];
      m[i + 1] = t * be * d[i];
    }
  }
  return m;
}

/** Curve height at input x in 0..1. */
export function curveAt(c: Curve, x: number): number {
  const t = clamp01(x);
  let i = 0;
  while (i < CURVE_X.length - 2 && t > CURVE_X[i + 1]) i++;
  const m = tangents(c);
  const h = CURVE_X[i + 1] - CURVE_X[i];
  const s = (t - CURVE_X[i]) / h;
  const s2 = s * s;
  const s3 = s2 * s;
  const v = (2 * s3 - 3 * s2 + 1) * c[i] + (s3 - 2 * s2 + s) * h * m[i] + (-2 * s3 + 3 * s2) * c[i + 1] + (s3 - s2) * h * m[i + 1];
  return clamp01(v);
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
