"use client";

/*
 * WavelengthSwitch: rebuild the frames of a spot from its single exposures, using only some detectors.
 * Contract: docs/contracts/field-schema.md section 7 ("Rebuilding a frame from exposures"),
 * reference: rebuild_frame in pipeline/export_web.py. BUILD_PROMPT 8.17.
 *
 * Hook (for the field viewer):
 *
 *   useWavelengthFrames(field: Field, selection: WavelengthSelection): {
 *     frames: (Float32Array | null)[] | null; // one per field.frames entry, S/N, row-major top-down,
 *                                             // NaN = no data. null entry = no exposure of that frame
 *                                             // uses a selected detector (skip the frame).
 *                                             // The whole value is null while loading, on error or
 *                                             // when unavailable.
 *     planesPerFrame: number[];               // exposures used for each frame (0 for null frames)
 *     fewerThanThree: boolean;                // a kept frame has 1 or 2 planes (show the notice)
 *     loading: boolean;
 *     error: string | null;
 *     available: boolean;                     // false (and nothing fetched) unless field.has?.exposures
 *   }
 *
 * - exposures.json and exposures.u16 are fetched lazily, once per field slug, and cached across
 *   selections. The frames are rebuilt synchronously (about 60 to 90 ms for a 119 px spot with 34 planes, measured in node) whenever
 *   field or selection changes; the result is memoised.
 * - 'all' is rebuilt too (it is NOT the original frames.u16; the caller decides which to show).
 * - The returned frames are already blanked (a pixel NaN in any shown frame is NaN in all of them),
 *   and in S/N units like frames.u16, so the shared stretch of lib/imaging.ts applies directly.
 *
 * Component: <WavelengthSwitch field value onChange fewerThanThree? />. Renders nothing when the
 * field has no exposures. Pass `fewerThanThree` from the hook result to show the notice.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { decodeExposureValue } from "@/lib/spectra";
import type { Field } from "@/lib/types";

// ---------------------------------------------------------------------------------------------
// Selection

export type WavelengthSelection = "all" | "short" | "long" | "longest" | 1 | 2 | 3 | 4 | 5 | 6;

/** Detectors of an option: All = D1-6, Short = D1-3, Long = D4-6, Longest = D5-6. */
export function detectorsFor(selection: WavelengthSelection): number[] {
  switch (selection) {
    case "all":
      return [1, 2, 3, 4, 5, 6];
    case "short":
      return [1, 2, 3];
    case "long":
      return [4, 5, 6];
    case "longest":
      return [5, 6];
    default:
      return [selection];
  }
}

// ---------------------------------------------------------------------------------------------
// exposures.json / exposures.u16

export interface ExposureInfo {
  k: number;
  frame: number; // FrameMeta.i
  mjd: number;
  utc: string;
  detector: number;
  obs_id: string;
  file: string;
  source: string | null;
  soft?: number; // asinh encoding: MJy/sr = soft * sinh((value - 32767) * step)
  step?: number;
  scale?: number; // older linear encoding (used when present): MJy/sr = value * scale + offset
  offset?: number;
  noise: number; // sigma-clipped std of the plane, MJy/sr
  clipped: boolean;
  bandwidth_um: number | null;
  wavelength_um: (number | null)[][];
}

export interface ExposuresJson {
  file: string;
  size: [number, number];
  count: number;
  units: string;
  encoding?: string;
  nodata: number;
  wavelength_grid: number;
  exposures: ExposureInfo[];
}

/** Decode exposures.u16 into one Float32Array (MJy/sr, NaN = no data) per exposure, index k. */
export function decodeExposures(buffer: ArrayBuffer, info: ExposuresJson): Float32Array[] {
  const [w, h] = info.size;
  const plane = w * h;
  const n = info.exposures.length;
  if (buffer.byteLength !== 2 * n * plane) {
    throw new Error(`exposures.u16 is ${buffer.byteLength} bytes, expected ${2 * n * plane} (${n} x ${h} x ${w})`);
  }
  const view = new DataView(buffer);
  const out: Float32Array[] = new Array<Float32Array>(n);
  for (const e of info.exposures) {
    const f = new Float32Array(plane);
    const base = e.k * plane * 2;
    for (let i = 0; i < plane; i++) {
      const v = view.getUint16(base + 2 * i, true);
      f[i] = v === info.nodata ? NaN : decodeExposureValue(v, e);
    }
    out[e.k] = f;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Statistics (astropy semantics)

const MAD_STD = 1.482602218505602;

/** Median of the first n values of a, sorting them in place (insertion sort: n is small). */
function medianInPlace(a: Float64Array, n: number): number {
  for (let i = 1; i < n; i++) {
    const x = a[i];
    let j = i - 1;
    while (j >= 0 && a[j] > x) {
      a[j + 1] = a[j];
      j--;
    }
    a[j + 1] = x;
  }
  const m = n >> 1;
  return n % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * Per-pixel mean after astropy sigma_clip(sigma=3, cenfunc="median", stdfunc="mad_std"), repeated
 * until nothing more is clipped. NaN inputs are ignored; all-NaN pixels give NaN.
 */
export function sigmaClippedMean(planes: Float32Array[]): Float32Array {
  const n = planes.length;
  const len = n ? planes[0].length : 0;
  const out = new Float32Array(len);
  const vals = new Float64Array(n);
  const sorted = new Float64Array(n);
  const dev = new Float64Array(n);
  for (let p = 0; p < len; p++) {
    let m = 0;
    for (let i = 0; i < n; i++) {
      const v = planes[i][p];
      if (v === v) vals[m++] = v;
    }
    if (m === 0) {
      out[p] = NaN;
      continue;
    }
    for (;;) {
      for (let i = 0; i < m; i++) sorted[i] = vals[i];
      const c = medianInPlace(sorted, m);
      for (let i = 0; i < m; i++) dev[i] = Math.abs(vals[i] - c);
      const std = MAD_STD * medianInPlace(dev, m);
      const lo = c - 3 * std;
      const hi = c + 3 * std;
      let k = 0;
      for (let i = 0; i < m; i++) {
        const v = vals[i];
        if (v >= lo && v <= hi) vals[k++] = v;
      }
      if (k === m || k === 0) break;
      m = k;
    }
    let s = 0;
    for (let i = 0; i < m; i++) s += vals[i];
    out[p] = s / m;
  }
  return out;
}

/** astropy sigma_clipped_stats(img[finite], sigma=2.5)[2]: std of the survivors, 5 rounds, median centre. */
export function noiseOf(plane: Float32Array): number {
  let v = new Float64Array(plane.length);
  let m = 0;
  for (let i = 0; i < plane.length; i++) if (Number.isFinite(plane[i])) v[m++] = plane[i];
  if (m === 0) return NaN;
  v = v.subarray(0, m);
  const tmp = new Float64Array(m);
  const std = (a: Float64Array, n: number) => {
    let mean = 0;
    for (let i = 0; i < n; i++) mean += a[i];
    mean /= n;
    let s = 0;
    for (let i = 0; i < n; i++) s += (a[i] - mean) ** 2;
    return Math.sqrt(s / n);
  };
  // Typed-array sort is O(n log n) and numeric.
  let n = m;
  for (let it = 0; it < 5; it++) {
    tmp.set(v.subarray(0, n));
    const sub = tmp.subarray(0, n);
    sub.sort();
    const c = n % 2 ? sub[n >> 1] : (sub[(n >> 1) - 1] + sub[n >> 1]) / 2;
    const s = std(v, n);
    const lo = c - 2.5 * s;
    const hi = c + 2.5 * s;
    let k = 0;
    for (let i = 0; i < n; i++) {
      const x = v[i];
      if (x >= lo && x <= hi) v[k++] = x;
    }
    if (k === n || k === 0) break;
    n = k;
  }
  return std(v, n);
}

// ---------------------------------------------------------------------------------------------
// Rebuild

/**
 * Recipe steps 2 to 4: planes (MJy/sr) and their noises to one S/N frame.
 *
 * Noise guard: a plane whose given noise is not a finite positive number is skipped (not used, not
 * counted in `planesUsed`); if the rebuilt frame's own noise is not a finite positive number, the
 * frame is returned undivided. So a constant plane never yields Infinity or NaN-filled output.
 * With no usable plane the frame is all NaN and `planesUsed` is 0 (rebuildFrames then treats it as
 * a missing frame).
 */
export function rebuildFrame(planes: Float32Array[], noises: number[]): { frame: Float32Array; planesUsed: number } {
  if (planes.length === 0) throw new Error("rebuildFrame needs at least one plane");
  const len = planes[0].length;
  const sn: Float32Array[] = [];
  planes.forEach((p, i) => {
    const noise = noises[i];
    if (!(Number.isFinite(noise) && noise > 0)) return;
    const f = new Float32Array(len);
    const inv = 1 / noise;
    for (let k = 0; k < len; k++) f[k] = p[k] * inv;
    sn.push(f);
  });
  const n = sn.length;
  if (n === 0) return { frame: new Float32Array(len).fill(NaN), planesUsed: 0 };
  let frame: Float32Array;
  if (n >= 3) {
    frame = sigmaClippedMean(sn);
  } else {
    frame = new Float32Array(len);
    for (let k = 0; k < len; k++) {
      let s = 0;
      let c = 0;
      for (let i = 0; i < n; i++) {
        const v = sn[i][k];
        if (v === v) {
          s += v;
          c++;
        }
      }
      frame[k] = c ? s / c : NaN;
    }
  }
  const noise = noiseOf(frame);
  if (Number.isFinite(noise) && noise > 0) {
    for (let k = 0; k < len; k++) frame[k] /= noise;
  }
  return { frame, planesUsed: n };
}

export interface RebuildResult {
  frames: (Float32Array | null)[];
  planesPerFrame: number[];
  fewerThanThree: boolean;
}

/** Rebuild every frame of the field from the exposures whose detector is selected (recipe steps 1 to 5). */
export function rebuildFrames(
  field: Pick<Field, "frames">,
  planes: Float32Array[],
  info: ExposuresJson,
  selection: WavelengthSelection,
): RebuildResult {
  const dets = new Set(detectorsFor(selection));
  const frames: (Float32Array | null)[] = [];
  const planesPerFrame: number[] = [];
  let fewerThanThree = false;
  for (const fm of field.frames) {
    const chosen = info.exposures.filter((e) => e.frame === fm.i && dets.has(e.detector));
    if (chosen.length === 0) {
      frames.push(null);
      planesPerFrame.push(0);
      continue;
    }
    const { frame, planesUsed } = rebuildFrame(
      chosen.map((e) => planes[e.k]),
      chosen.map((e) => e.noise),
    );
    if (planesUsed === 0) {
      frames.push(null); // no plane had a usable noise: same as a frame with no exposure
      planesPerFrame.push(0);
      continue;
    }
    frames.push(frame);
    planesPerFrame.push(planesUsed);
    if (planesUsed < 3) fewerThanThree = true;
  }
  // Step 5: blank every pixel that is NaN in any shown frame.
  const shown = frames.filter((f): f is Float32Array => f !== null);
  if (shown.length > 1) {
    const len = shown[0].length;
    for (let k = 0; k < len; k++) {
      let bad = false;
      for (const f of shown) {
        if (f[k] !== f[k]) {
          bad = true;
          break;
        }
      }
      if (bad) for (const f of shown) f[k] = NaN;
    }
  }
  return { frames, planesPerFrame, fewerThanThree };
}

// ---------------------------------------------------------------------------------------------
// Hook

export interface WavelengthFrames {
  frames: (Float32Array | null)[] | null;
  planesPerFrame: number[];
  fewerThanThree: boolean;
  loading: boolean;
  error: string | null;
  available: boolean;
}

interface Loaded {
  info: ExposuresJson;
  planes: Float32Array[];
}

const cache = new Map<string, Promise<Loaded>>();

function loadExposures(slug: string): Promise<Loaded> {
  let p = cache.get(slug);
  if (!p) {
    const base = `/fields/${encodeURIComponent(slug)}`;
    p = (async () => {
      const jr = await fetch(`${base}/exposures.json`);
      if (!jr.ok) throw new Error(`GET exposures.json failed: ${jr.status}`);
      const info = (await jr.json()) as ExposuresJson;
      const br = await fetch(`${base}/${info.file}`);
      if (!br.ok) throw new Error(`GET ${info.file} failed: ${br.status}`);
      return { info, planes: decodeExposures(await br.arrayBuffer(), info) };
    })();
    p.catch(() => cache.delete(slug)); // allow a retry
    cache.set(slug, p);
  }
  return p;
}

const EMPTY: number[] = [];

export function useWavelengthFrames(field: Field, selection: WavelengthSelection): WavelengthFrames {
  const available = field.has?.exposures === true;
  const slug = field.slug;
  const [state, setState] = useState<{ slug: string; data: Loaded | null; error: string | null }>({
    slug: "",
    data: null,
    error: null,
  });

  useEffect(() => {
    if (!available) return;
    let live = true;
    loadExposures(slug).then(
      (data) => live && setState({ slug, data, error: null }),
      (e: unknown) => live && setState({ slug, data: null, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [available, slug]);

  const current = state.slug === slug ? state : null;
  const data = available ? (current?.data ?? null) : null;
  const error = available ? (current?.error ?? null) : null;

  const result = useMemo<RebuildResult | null>(() => {
    if (!data) return null;
    try {
      return rebuildFrames(field, data.planes, data.info, selection);
    } catch {
      return null;
    }
    // field identity is per slug; the frame list is what matters
  }, [data, field, selection]);

  return {
    frames: result ? result.frames : null,
    planesPerFrame: result ? result.planesPerFrame : EMPTY,
    fewerThanThree: result ? result.fewerThanThree : false,
    loading: available && !data && !error,
    error,
    available,
  };
}

// ---------------------------------------------------------------------------------------------
// Component

interface Option {
  value: WavelengthSelection;
  label: string;
  detail: string;
}

const OPTIONS: Option[] = [
  { value: "all", label: "All", detail: "D1-6, 0.75-5 um" },
  { value: "short", label: "Short", detail: "D1-3, 0.75-2.4 um" },
  { value: "long", label: "Long", detail: "D4-6, 2.4-5 um" },
  { value: "longest", label: "Longest", detail: "D5-6, 3.8-5 um" },
  { value: 1, label: "D1", detail: "0.75-1.11 um" },
  { value: 2, label: "D2", detail: "1.11-1.64 um" },
  { value: 3, label: "D3", detail: "1.64-2.42 um" },
  { value: 4, label: "D4", detail: "2.42-3.82 um" },
  { value: 5, label: "D5", detail: "3.82-4.42 um" },
  { value: 6, label: "D6", detail: "4.42-5.00 um" },
];

export interface WavelengthSwitchProps {
  field: Field;
  value: WavelengthSelection;
  onChange: (value: WavelengthSelection) => void;
  /** From useWavelengthFrames: shows the cosmic-ray notice. */
  fewerThanThree?: boolean;
}

export default function WavelengthSwitch({ field, value, onChange, fewerThanThree = false }: WavelengthSwitchProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  if (!field.has?.exposures) return null;

  const used = new Set<number>();
  for (const f of field.frames) for (const d of f.detectors) used.add(d);
  const enabled = OPTIONS.map((o) => detectorsFor(o.value).some((d) => used.has(d)));
  const selectedIdx = OPTIONS.findIndex((o) => o.value === value);
  // Roving tabindex: the selected option, or the first enabled one if the selection is not offered.
  const tabIdx = selectedIdx >= 0 && enabled[selectedIdx] ? selectedIdx : enabled.indexOf(true);

  const move = (from: number, step: number) => {
    const n = OPTIONS.length;
    for (let i = 1; i <= n; i++) {
      const j = (from + step * i + n * i) % n;
      if (enabled[j]) {
        onChange(OPTIONS[j].value);
        refs.current[j]?.focus();
        return;
      }
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        move(idx, 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        move(idx, -1);
        break;
      case "Home":
        e.preventDefault();
        move(-1, 1);
        break;
      case "End":
        e.preventDefault();
        move(OPTIONS.length, -1);
        break;
    }
  };

  return (
    <div>
      <div className="label" id="wavelength-label" style={{ color: "var(--text-dim)", fontSize: 12 }}>
        Wavelength
      </div>
      <div
        role="radiogroup"
        aria-labelledby="wavelength-label"
        style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-1)", marginTop: "var(--space-1)" }}
      >
        {OPTIONS.map((o, i) => {
          const checked = o.value === value;
          const ok = enabled[i];
          return (
            <button
              key={String(o.value)}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-disabled={!ok}
              disabled={!ok}
              tabIndex={i === tabIdx ? 0 : -1}
              title={ok ? o.detail : `${o.detail}: no exposure of this spot uses it`}
              onClick={() => onChange(o.value)}
              onKeyDown={(e) => onKeyDown(e, i)}
              style={{
                padding: "var(--space-1) var(--space-2)",
                fontSize: 12,
                color: checked ? "var(--bg-0)" : ok ? "var(--text)" : "var(--text-dim)",
                background: checked ? "var(--cyan)" : "var(--bg-1)",
                borderColor: checked ? "var(--cyan)" : "var(--line)",
                opacity: ok ? 1 : 0.45,
                cursor: ok ? "pointer" : "not-allowed",
              }}
            >
              {o.label}
              {typeof o.value === "string" && o.value !== "all" ? (
                <span style={{ marginLeft: 4, fontSize: 10, textTransform: "none", letterSpacing: 0 }}>
                  {o.detail}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {fewerThanThree ? (
        <p role="status" style={{ color: "var(--amber)", fontSize: 12, margin: "var(--space-2) 0 0" }}>
          Fewer than 3 images: cosmic-ray hits may show.
        </p>
      ) : null}
    </div>
  );
}
