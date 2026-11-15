// Pure image functions on S/N frames (Float32Array, row-major top-down). Each mirrors the
// named function in motion_frames.py; imaging.test.ts checks them against that Python.

import type { RGB } from "./types";

/** numpy.nanpercentile with the default linear interpolation. */
export function nanPercentile(values: ArrayLike<number>, p: number): number {
  const v: number[] = [];
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) v.push(values[i]);
  if (!v.length) return NaN;
  v.sort((a, b) => a - b);
  const pos = (p / 100) * (v.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, v.length - 1);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

function median(sorted: number[]): number {
  const n = sorted.length;
  if (!n) return NaN;
  const m = n >> 1;
  return n % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

/** numpy.nanmedian over the frame axis: one value per pixel. */
export function nanMedianStack(frames: Float32Array[]): Float32Array {
  const out = new Float32Array(frames[0].length);
  const col: number[] = [];
  for (let k = 0; k < out.length; k++) {
    col.length = 0;
    for (const f of frames) if (Number.isFinite(f[k])) col.push(f[k]);
    col.sort((a, b) => a - b);
    out[k] = median(col);
  }
  return out;
}

/** astropy sigma_clipped_stats(x, sigma)[2]: std (ddof 0) after median-centred clipping, 5 rounds. */
export function noiseOf(img: ArrayLike<number>, sigma = 2.5, maxIters = 5): number {
  let v: number[] = [];
  for (let i = 0; i < img.length; i++) if (Number.isFinite(img[i])) v.push(img[i]);
  const std = (a: number[]) => {
    const mean = a.reduce((s, x) => s + x, 0) / a.length;
    return Math.sqrt(a.reduce((s, x) => s + (x - mean) ** 2, 0) / a.length);
  };
  for (let it = 0; it < maxIters; it++) {
    const c = median([...v].sort((a, b) => a - b));
    const s = std(v);
    const kept = v.filter((x) => x >= c - sigma * s && x <= c + sigma * s);
    if (kept.length === v.length) break;
    v = kept;
  }
  return std(v);
}

export interface StretchOptions {
  blackSigma?: number;
  softSigma?: number;
  /** Precomputed white point (field.json stretch.white); otherwise from the frames as in Python. */
  white?: number;
}

/** White point of make_stretch: 99.8th percentile of the median frame, at least black + 10. */
export function sharedWhite(frames: Float32Array[], blackSigma = -1): number {
  return Math.max(nanPercentile(nanMedianStack(frames), 99.8), blackSigma + 10);
}

/** make_stretch: one asinh stretch for every frame, S/N in, 0..1 gray out, NaN to 0. */
export function makeSharedStretch(frames: Float32Array[], o: StretchOptions = {}): (f: Float32Array) => Float32Array {
  const lo = o.blackSigma ?? -1;
  const soft = o.softSigma ?? 2;
  const hi = o.white ?? sharedWhite(frames, lo);
  const a = (hi - lo) / soft;
  const norm = Math.asinh(a);
  return (f) => {
    const out = new Float32Array(f.length);
    for (let k = 0; k < f.length; k++) {
      const v = f[k];
      if (!Number.isFinite(v)) continue; // stays 0
      const x = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
      out[k] = Math.asinh(a * x) / norm;
    }
    return out;
  };
}

function toRgba(rgb: Float32Array): Uint8ClampedArray {
  const n = rgb.length / 3;
  const out = new Uint8ClampedArray(n * 4);
  for (let k = 0; k < n; k++) {
    out[4 * k] = rgb[3 * k] * 255;
    out[4 * k + 1] = rgb[3 * k + 1] * 255;
    out[4 * k + 2] = rgb[3 * k + 2] * 255;
    out[4 * k + 3] = 255;
  }
  return out;
}

/** onion_dark as 0..1 RGB floats (length 3 * pixels). */
export function colorByTimeRgb(grays: Float32Array[], colors: RGB[], gain = 2): Float32Array {
  const sum = [0, 1, 2].map((c) => colors.reduce((s, col) => s + col[c], 0));
  const n = grays[0].length;
  const out = new Float32Array(3 * n);
  grays.forEach((g, i) => {
    const w = [0, 1, 2].map((c) => colors[i][c] / sum[c]);
    for (let k = 0; k < n; k++) for (let c = 0; c < 3; c++) out[3 * k + c] += g[k] * w[c];
  });
  for (let j = 0; j < out.length; j++) out[j] = Math.min(1, Math.max(0, gain * out[j]));
  return out;
}

/** Frame moved by whole pixels: out(x, y) = g(x + dx, y + dy), 0 outside the grid. */
export function shiftGray(g: Float32Array, w: number, h: number, dx: number, dy: number): Float32Array {
  if (dx === 0 && dy === 0) return g;
  const out = new Float32Array(g.length);
  for (let y = 0; y < h; y++) {
    const sy = y + dy;
    if (sy < 0 || sy >= h) continue;
    for (let x = 0; x < w; x++) {
      const sx = x + dx;
      if (sx >= 0 && sx < w) out[y * w + x] = g[sy * w + sx];
    }
  }
  return out;
}

/** Whole-pixel offsets that follow a mover at v (px/day) from the reference time (shift-and-stack). */
export function shiftOffsets(mjds: number[], refMjd: number, v: { vx: number; vy: number }): [number, number][] {
  return mjds.map((m) => [Math.round(v.vx * (m - refMjd)), Math.round(v.vy * (m - refMjd))]);
}

/** Stack (onion_dark): additive mix on black, weights sum to white. RGBA bytes. */
export function colorByTime(grays: Float32Array[], colors: RGB[], gain = 2): Uint8ClampedArray {
  return toRgba(colorByTimeRgb(grays, colors, gain));
}

/** onion_light as 0..1 RGB floats. */
export function paperModeRgb(grays: Float32Array[], colors: RGB[]): Float32Array {
  // colors are 0..255; Python works in 0..1
  const ink = colors.map((col) => col.map((v) => 1 - v / 255));
  const chanSum = [0, 1, 2].map((c) => ink.reduce((s, a) => s + a[c], 0));
  const meanSum = (chanSum[0] + chanSum[1] + chanSum[2]) / 3;
  const scaled = ink.map((a) => a.map((v, c) => Math.min(1, Math.max(0, (v * meanSum) / chanSum[c]))));
  const n = grays[0].length;
  const out = new Float32Array(3 * n).fill(1);
  grays.forEach((g, i) => {
    for (let k = 0; k < n; k++) for (let c = 0; c < 3; c++) out[3 * k + c] *= 1 - g[k] * scaled[i][c];
  });
  return out;
}

/** Paper mode (onion_light): multiply blend on white. RGBA bytes. */
export function paperMode(grays: Float32Array[], colors: RGB[]): Uint8ClampedArray {
  return toRgba(paperModeRgb(grays, colors));
}

/** residuals: each frame minus a leave-one-out median template (star brightness matched), in noise units. */
export function onlyChanges(frames: Float32Array[]): Float32Array[] {
  return frames.map((f, k) => {
    const tmpl = nanMedianStack(frames.filter((_, j) => j !== k));
    const ratios: number[] = [];
    let nBright = 0;
    for (let p = 0; p < f.length; p++) {
      if (Number.isFinite(tmpl[p]) && tmpl[p] > 20) {
        nBright++;
        const r = f[p] / tmpl[p];
        if (Number.isFinite(r)) ratios.push(r);
      }
    }
    const scale = nBright > 5 ? median(ratios.sort((a, b) => a - b)) : 1;
    const r = new Float32Array(f.length);
    for (let p = 0; p < f.length; p++) r[p] = f[p] - scale * tmpl[p];
    const noise = noiseOf(r);
    for (let p = 0; p < r.length; p++) r[p] /= noise;
    return r;
  });
}

/** changes: residuals shown from 3 sigma up, colored by time (RGB floats). */
export function changesRgb(frames: Float32Array[], colors: RGB[]): Float32Array {
  const resid = onlyChanges(frames);
  const all: number[] = [];
  for (const r of resid) for (let p = 0; p < r.length; p++) if (Number.isFinite(r[p])) all.push(r[p]);
  const hi = Math.max(nanPercentile(all, 99.9), 10);
  const norm = Math.asinh(10);
  const grays = resid.map((r) => {
    const g = new Float32Array(r.length);
    for (let p = 0; p < r.length; p++) {
      if (!Number.isFinite(r[p])) continue;
      g[p] = Math.asinh(10 * Math.min(1, Math.max(0, (r[p] - 3) / (hi - 3)))) / norm;
    }
    return g;
  });
  return colorByTimeRgb(grays, colors, frames.length / 2);
}

/** RGBA bytes for a canvas: gray floats 0..1 (one per pixel) or ready RGBA bytes. */
export function toImageData(px: Uint8ClampedArray | Float32Array, w: number, h: number): ImageData {
  if (px instanceof Uint8ClampedArray) return new ImageData(new Uint8ClampedArray(px), w, h);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let k = 0; k < w * h; k++) {
    const v = px[k] * 255;
    out[4 * k] = out[4 * k + 1] = out[4 * k + 2] = v;
    out[4 * k + 3] = 255;
  }
  return new ImageData(out, w, h);
}
