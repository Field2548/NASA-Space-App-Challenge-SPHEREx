// Morphological transformations on Float32 frames, following OpenCV semantics (no OpenCV
// dependency). Erosion = min over the kernel, dilation = max; the border is ignored (cv2's
// default +inf for erosion and -inf for dilation); non-finite pixels are ignored by the window
// and stay non-finite in the output. Compound operations use the same kernel on each step.

export type MorphOp = "off" | "erode" | "dilate" | "open" | "close" | "gradient" | "tophat" | "blackhat";
export type MorphShape = "rect" | "ellipse" | "cross";
export type MorphSize = 3 | 5 | 7;

export interface MorphSettings {
  op: MorphOp;
  shape: MorphShape;
  size: MorphSize;
  /** Repeats of the whole operation (the control offers it for erosion and dilation). */
  iterations: number;
}

export const DEFAULT_MORPH: MorphSettings = { op: "off", shape: "rect", size: 3, iterations: 1 };

export const isMorphOff = (s: MorphSettings) => s.op === "off";

/** cv2.getStructuringElement mask, rows top-down, 1 = in the kernel (odd sizes). */
export function morphKernel(shape: MorphShape, size: number): number[][] {
  const r = size >> 1;
  const c = size >> 1;
  const out = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  const invR2 = r ? 1 / (r * r) : 0;
  for (let i = 0; i < size; i++) {
    let j1 = 0;
    let j2 = size;
    if (shape === "cross") {
      if (i !== r) {
        j1 = c;
        j2 = c + 1;
      }
    } else if (shape === "ellipse") {
      const dy = i - r;
      if (Math.abs(dy) <= r) {
        const dx = c * Math.sqrt(Math.max((r * r - dy * dy) * invR2, 0));
        j1 = Math.max(Math.round(c - dx), 0);
        j2 = Math.min(Math.round(c + dx + 1), size);
      } else {
        j2 = 0;
      }
    }
    for (let j = j1; j < j2; j++) out[i][j] = 1;
  }
  return out;
}

/** Kernel as (dx, dy) offsets from the anchor (kernel centre). */
export function kernelOffsets(shape: MorphShape, size: number): [number, number][] {
  const r = size >> 1;
  const out: [number, number][] = [];
  morphKernel(shape, size).forEach((row, i) => row.forEach((v, j) => v && out.push([j - r, i - r])));
  return out;
}

function rank(src: Float32Array, w: number, h: number, shape: MorphShape, size: number, isMin: boolean): Float32Array {
  const r = size >> 1;
  const sign = isMin ? 1 : -1; // min of sign * v
  // non-finite pixels become the neutral value, so the window ignores them (and the border)
  const pre = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) pre[i] = Number.isFinite(src[i]) ? sign * src[i] : Infinity;
  // one pass along x (dir 0) or y (dir 1) over the half-width r, borders clamped
  const pass = (a: Float32Array, dir: 0 | 1): Float32Array => {
    const o = new Float32Array(a.length);
    const n = dir === 0 ? w : h;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = dir === 0 ? x : y;
        const lo = Math.max(0, c - r);
        const hi = Math.min(n - 1, c + r);
        let m = Infinity;
        for (let t = lo; t <= hi; t++) {
          const v = dir === 0 ? a[y * w + t] : a[t * w + x];
          if (v < m) m = v;
        }
        o[y * w + x] = m;
      }
    }
    return o;
  };
  let res: Float32Array;
  if (shape === "rect") {
    res = pass(pass(pre, 0), 1);
  } else if (shape === "cross") {
    const hz = pass(pre, 0);
    const vt = pass(pre, 1);
    res = hz;
    for (let i = 0; i < res.length; i++) if (vt[i] < res[i]) res[i] = vt[i];
  } else {
    // ellipse: one contiguous run per kernel row
    const runs = morphKernel("ellipse", size).map((row) => [row.indexOf(1) - r, row.lastIndexOf(1) - r]);
    res = new Float32Array(pre.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let m = Infinity;
        for (let i = 0; i < size; i++) {
          const yy = y + i - r;
          if (yy < 0 || yy >= h || runs[i][0] > runs[i][1]) continue;
          const lo = Math.max(0, x + runs[i][0]);
          const hi = Math.min(w - 1, x + runs[i][1]);
          for (let xx = lo; xx <= hi; xx++) {
            const v = pre[yy * w + xx];
            if (v < m) m = v;
          }
        }
        res[y * w + x] = m;
      }
    }
  }
  const out = new Float32Array(src.length);
  for (let i = 0; i < out.length; i++) out[i] = Number.isFinite(src[i]) ? sign * res[i] : src[i];
  return out;
}

export function erode(src: Float32Array, w: number, h: number, shape: MorphShape, size: number): Float32Array {
  return rank(src, w, h, shape, size, true);
}

export function dilate(src: Float32Array, w: number, h: number, shape: MorphShape, size: number): Float32Array {
  return rank(src, w, h, shape, size, false);
}

function diff(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] - b[i];
  return out;
}

/** One frame through one operation (cv2.morphologyEx semantics). */
export function morphFrame(src: Float32Array, w: number, h: number, s: MorphSettings): Float32Array {
  if (s.op === "off") return src;
  const n = Math.max(1, Math.round(s.iterations));
  const E = (a: Float32Array) => {
    for (let i = 0; i < n; i++) a = erode(a, w, h, s.shape, s.size);
    return a;
  };
  const D = (a: Float32Array) => {
    for (let i = 0; i < n; i++) a = dilate(a, w, h, s.shape, s.size);
    return a;
  };
  switch (s.op) {
    case "erode":
      return E(src);
    case "dilate":
      return D(src);
    case "open":
      return D(E(src));
    case "close":
      return E(D(src));
    case "gradient":
      return diff(D(src), E(src));
    case "tophat":
      return diff(src, D(E(src)));
    case "blackhat":
      return diff(E(D(src)), src);
  }
}

// Results per frame object and settings; frames are immutable once decoded.
const cache = new WeakMap<Float32Array, Map<string, Float32Array>>();

/** Same operation on every frame; cached per (frame, settings). Off returns the input array. */
export function morphFrames(frames: Float32Array[], w: number, h: number, s: MorphSettings): Float32Array[] {
  if (isMorphOff(s)) return frames;
  const key = `${s.op}|${s.shape}|${s.size}|${s.iterations}|${w}x${h}`;
  return frames.map((f) => {
    let m = cache.get(f);
    if (!m) cache.set(f, (m = new Map()));
    let r = m.get(key);
    if (!r) m.set(key, (r = morphFrame(f, w, h, s)));
    return r;
  });
}
