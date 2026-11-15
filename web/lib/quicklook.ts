// Quick look: any coordinate, live, from partial downloads (BUILD_PROMPT 8.20).
//
// 1. GET /api/quicklook/list gives every SPHEREx exposure over the position (QuickLookList).
// 2. planQuickLook picks bursts and 3-4 exposures per burst, and says how many bytes that costs.
// 3. runQuickLook (inside workers/quicklook.ts) reads, for each exposure, the FITS headers and only
//    the image rows under our small north-up grid, straight from IRSA's public S3 bucket, maps the
//    grid into the exposure with TAN-SIP, resamples bilinearly, and turns each plane into S/N units.
//    Each burst becomes one frame (3-sigma-clipped mean), like motion_frames.build_frame.
//
// What is NOT done here, on purpose: no bad-pixel masking (FLAGS is not read), no zodiacal light
// model (ZODI is not read; the plane median is subtracted instead). That is why the UI must show
// QUICKLOOK_LABEL. All logic lives here so it can be tested in node; the worker is a thin wrapper.

import { findHdu, isAbortError, readHeaders, readRows, type FetchLike, type FitsHeader, type HduInfo } from "./fits";
import { noiseOf, sharedWhite } from "./imaging";
import { compileSipWcs, sipWorldToPixel } from "./sipwcs";
import type { ExposureMeta, Field, FieldWcs, FrameMeta } from "./types";
import { pixelToSky } from "./wcs";

/** Always visible next to a quick look (BUILD_PROMPT 8.20 "Labels"). */
export const QUICKLOOK_LABEL =
  "Quick look: live and unmasked. Bad pixels and cosmic-ray hits are not removed. Rough numbers only.";

export const PIXEL_ARCSEC = 6.15; // SPHEREx pixel, and our grid's pixel (spectral_bands.PIXEL_SCALE)
export const BURST_GAP_MIN = 15; // motion_frames --gap default
export const DEFAULT_GRID_PX = 41; // 41 x 41 px = 4.2 arcmin
export const MAX_PARALLEL = 4; // BUILD_PROMPT 11: at most 4 files at a time
/** Bytes of the first header read (spectral_bands.scan_one): PRIMARY + IMAGE headers end near 29 KB. */
export const HEADER_READ_BYTES = 49152;
/** SPHEREx L2 images are 2040 x 2040 float32; used when the list does not say. */
export const DEFAULT_NAXIS = 2040;

// ------------------------------------------------------------------------------------------------
// The list (shape of GET /api/quicklook/list)
// ------------------------------------------------------------------------------------------------

/** One exposure in the quick-look list. Extends the shared ExposureMeta (types.ts). */
export interface QuickLookExposure extends ExposureMeta {
  /**
   * URL the browser Range-reads: the public S3 object built from SIA `cloud_access` (CORS allows a
   * cross-origin GET with Range there). Null when IRSA gave no S3 copy: IRSA's own server sends no
   * CORS headers, so such an exposure is not readable in the browser and the planner skips it.
   */
  url: string | null;
  /** IRSA's `access_url` for the same file: provenance, and readable server-side (or via a proxy). */
  access_url: string;
  /** "s3" when `url` is set, "irsa" when only `access_url` exists. */
  source: "s3" | "irsa";
  /**
   * Approximate file size in bytes from SIA `access_estsize` (kB of 1000 bytes, rounded up; checked
   * 65071 kB for a 65,070,720-byte file). A hint only: the FITS reader never needs the file size.
   */
  est_size_bytes: number | null;
  /** IRSA collection, e.g. "spherex_dr1". */
  collection: string;
  /** End of the exposure (SIA t_max), MJD. `mjd` is the start (t_min), as in motion_frames. */
  mjd_end: number | null;
  /** Image size from SIA (s_xel1, s_xel2); null if IRSA did not say. */
  naxis1: number | null;
  naxis2: number | null;
  /** True if the footprint (s_region) contains the whole default quick-look field plus 0.01 deg. */
  covers_field: boolean | null;
  /** Index into QuickLookList.bursts. */
  burst: number;
}

export interface QuickLookBurst {
  /** 0-based index (QuickLookExposure.burst). */
  i: number;
  /** Time of the first exposure (MJD) and the same as ISO UTC text. */
  mjd: number;
  utc: string;
  /** Indices into QuickLookList.exposures, in time order. */
  exposures: number[];
  detectors: number[];
}

export interface QuickLookList {
  ra: number;
  dec: number;
  /** Search radius used with IRSA SIA (degrees). */
  radius_deg: number;
  exposures: QuickLookExposure[];
  bursts: QuickLookBurst[];
  source: { service: "irsa_sia"; collections: string[]; fetched_utc: string };
}

/** MJD -> "YYYY-MM-DDTHH:MM:SS" (UTC), the format of FrameMeta.utc. */
export function mjdToUtc(mjd: number): string {
  const ms = Math.round((mjd - 40587) * 86400000); // MJD 40587 = 1970-01-01
  return new Date(ms).toISOString().slice(0, 19);
}

/** One row of an IRSA SIA answer (only the columns quick look needs). */
export interface SiaRow {
  obs_id: string;
  detector: number;
  collection: string;
  t_min: number;
}

/**
 * spectral_bands.unique_images: one entry per (obs_id, detector). If both DR1 and QR3 have it,
 * keep DR1 (the later, better-calibrated release). Input order is kept for the winners.
 */
export function uniqueImages<T extends SiaRow>(rows: T[]): T[] {
  const best = new Map<string, { rank: number; row: T; order: number }>();
  rows.forEach((row, order) => {
    const key = `${row.obs_id}|${row.detector}`;
    const rank = row.collection.includes("_dr") ? 0 : 1;
    const cur = best.get(key);
    if (!cur || rank < cur.rank) best.set(key, { rank, row, order: cur ? cur.order : order });
  });
  return [...best.values()].sort((a, b) => a.order - b.order).map((v) => v.row);
}

/**
 * motion_frames.group_bursts: sort by time, start a new burst where two neighbours are more than
 * `gapMin` minutes apart. The sort is stable, so equal times keep their input order.
 */
export function groupBursts<T extends { mjd: number }>(items: T[], gapMin = BURST_GAP_MIN): T[][] {
  if (!items.length) return [];
  const sorted = items.map((v, k) => ({ v, k })).sort((a, b) => a.v.mjd - b.v.mjd || a.k - b.k).map((e) => e.v);
  const bursts: T[][] = [];
  let cur: T[] = [sorted[0]];
  for (let k = 1; k < sorted.length; k++) {
    if ((sorted[k].mjd - sorted[k - 1].mjd) * 1440 > gapMin) {
      bursts.push(cur);
      cur = [];
    }
    cur.push(sorted[k]);
  }
  bursts.push(cur);
  return bursts;
}

// ------------------------------------------------------------------------------------------------
// Plan
// ------------------------------------------------------------------------------------------------

export interface PlanOptions {
  /** Field centre (degrees). */
  ra: number;
  dec: number;
  /** Number of frames (bursts) wanted, 2-7 for Color by time (BUILD_PROMPT 8.9). */
  frames: number;
  spacing: "even" | "growing";
  /** Minimum hours between chosen bursts; also the step of the target times. */
  minGapHours: number;
  /** Detectors to use (1-6); empty = all (wavelength switch, 8.17). */
  detectors: number[];
  /** Grid size in pixels (odd), default 41. */
  gridPx?: number;
  /** Exposures per burst, 3 or 4 (default 4). */
  perBurst?: number;
  /** Byte budget: drop to 3 per burst, then drop frames, until the estimate fits. */
  maxBytes?: number;
  /** First burst to consider (index into the filtered bursts), default 0. */
  startIndex?: number;
  /** Also use exposures without an S3 copy (only works through a proxy; browsers cannot read IRSA). */
  includeIrsa?: boolean;
}

export interface QuickLookPlan {
  ra: number;
  dec: number;
  gridPx: number;
  /** Every exposure to download, burst by burst, in time order. */
  exposures: QuickLookExposure[];
  /** One entry per frame: indices into `exposures`. */
  bursts: number[][];
  /**
   * Bytes that will be downloaded, an UPPER BOUND: one 49152-byte header read per exposure plus the
   * rows a gridPx grid can need at the worst rotation (45 degrees: gridPx * sqrt(2) + 3 rows) of a
   * NAXIS1-wide float32 image. A typical run reads 10-30% less. Shown as "about N MB" before starting.
   */
  bytes: number;
  /** Plain-words notes about compromises made (fewer frames than asked, budget, ...). */
  notes: string[];
}

/** Rows of the exposure a gridPx x gridPx grid can touch at most (rotation 45 deg, +2 bilinear, +1 rounding). */
export function maxRowsForGrid(gridPx: number, naxis2: number = DEFAULT_NAXIS): number {
  return Math.min(naxis2, Math.ceil(gridPx * Math.SQRT2) + 3);
}

/** Upper-bound bytes for one exposure: header read + worst-case rows (see QuickLookPlan.bytes). */
export function estimateExposureBytes(e: Pick<QuickLookExposure, "naxis1" | "naxis2">, gridPx = DEFAULT_GRID_PX): number {
  const w = e.naxis1 ?? DEFAULT_NAXIS;
  return HEADER_READ_BYTES + maxRowsForGrid(gridPx, e.naxis2 ?? DEFAULT_NAXIS) * w * 4;
}

/**
 * Pick `count` bursts. Target times: even t0 + k*D, growing t0 + D*(2^k - 1), D = minGapHours. Each
 * target snaps to the nearest real burst after the previous pick that is at least minGapHours later
 * (greedy, like motion_frames.pick_window). Starting bursts are tried from `startIndex` on until a
 * full chain is found; otherwise the longest chain is returned.
 */
export function pickBurstIndices(
  times: number[],
  o: { count: number; spacing: "even" | "growing"; minGapHours: number; startIndex?: number },
): number[] {
  const gap = Math.max(0, o.minGapHours) / 24;
  const count = Math.max(1, Math.floor(o.count));
  let best: number[] = [];
  for (let s = Math.max(0, o.startIndex ?? 0); s < times.length; s++) {
    const sel = [s];
    for (let k = 1; k < count; k++) {
      const target = times[s] + (o.spacing === "growing" ? gap * (2 ** k - 1) : gap * k);
      const prev = sel[sel.length - 1];
      let pick = -1;
      for (let j = prev + 1; j < times.length; j++) {
        if (times[j] - times[prev] < gap) continue;
        if (pick < 0 || Math.abs(times[j] - target) < Math.abs(times[pick] - target)) pick = j;
        if (times[j] > target && pick >= 0) break; // times are sorted: nothing later is closer
      }
      if (pick < 0) break;
      sel.push(pick);
    }
    if (sel.length > best.length) best = sel;
    if (best.length === count) break;
  }
  return best;
}

/** Up to n exposures of one burst: whole-field coverage first, then spread over detectors. */
function chooseInBurst(burst: QuickLookExposure[], n: number): QuickLookExposure[] {
  const rank = (e: QuickLookExposure) => (e.covers_field === true ? 0 : e.covers_field === null ? 1 : 2);
  const sorted = [...burst].sort((a, b) => rank(a) - rank(b) || a.mjd - b.mjd);
  const out: QuickLookExposure[] = [];
  const used = new Set<number>();
  // Round-robin over detectors so a burst gives both a short and a long wavelength when it can.
  while (out.length < n && out.length < sorted.length) {
    const before = out.length;
    const seen = new Set<number>();
    for (let k = 0; k < sorted.length && out.length < n; k++) {
      if (used.has(k) || seen.has(sorted[k].detector)) continue;
      seen.add(sorted[k].detector);
      used.add(k);
      out.push(sorted[k]);
    }
    if (out.length === before) break;
  }
  return out.sort((a, b) => a.mjd - b.mjd);
}

/** Choose bursts and exposures for a quick look, and estimate the download. */
export function planQuickLook(list: QuickLookExposure[], o: PlanOptions): QuickLookPlan {
  const gridPx = Math.max(3, Math.floor(o.gridPx ?? DEFAULT_GRID_PX) | 1); // odd, so the target is the centre pixel
  let perBurst = Math.min(4, Math.max(3, Math.floor(o.perBurst ?? 4)));
  const notes: string[] = [];
  const dets = new Set(o.detectors);
  const usable = list.filter(
    (e) => (dets.size === 0 || dets.has(e.detector)) && (o.includeIrsa || e.url !== null) && e.covers_field !== false,
  );
  const partial = list.filter(
    (e) => (dets.size === 0 || dets.has(e.detector)) && (o.includeIrsa || e.url !== null) && e.covers_field === false,
  );
  let bursts = groupBursts(usable).filter((b) => b.length >= 3);
  if (bursts.length < Math.min(2, o.frames)) {
    // Not enough full bursts: accept small bursts and exposures that only partly cover the field.
    bursts = groupBursts([...usable, ...partial]);
    if (bursts.length) notes.push("Few full bursts here: some frames use fewer than 3 images or only partly cover the field.");
  }
  const times = bursts.map((b) => Math.min(...b.map((e) => e.mjd)));
  let picked = pickBurstIndices(times, { count: o.frames, spacing: o.spacing, minGapHours: o.minGapHours, startIndex: o.startIndex });
  if (picked.length < o.frames && bursts.length) {
    notes.push(`Only ${picked.length} of ${o.frames} frames fit these settings; SPHEREx only looks at a spot at certain times.`);
  }
  const build = () => {
    const exposures: QuickLookExposure[] = [];
    const groups: number[][] = [];
    for (const bi of picked) {
      const chosen = chooseInBurst(bursts[bi], perBurst);
      groups.push(chosen.map((_, k) => exposures.length + k));
      exposures.push(...chosen);
    }
    const bytes = exposures.reduce((s, e) => s + estimateExposureBytes(e, gridPx), 0);
    return { exposures, groups, bytes };
  };
  let res = build();
  if (o.maxBytes !== undefined && res.bytes > o.maxBytes) {
    if (perBurst > 3) {
      perBurst = 3;
      res = build();
    }
    while (res.bytes > o.maxBytes && picked.length > 0) {
      picked = picked.slice(0, -1);
      res = build();
    }
    notes.push(`Trimmed to ${picked.length} frames x up to ${perBurst} images to stay under ${(o.maxBytes / 1e6).toFixed(1)} MB.`);
  }
  return { ra: o.ra, dec: o.dec, gridPx, exposures: res.exposures, bursts: res.groups, bytes: res.bytes, notes };
}

// ------------------------------------------------------------------------------------------------
// Run
// ------------------------------------------------------------------------------------------------

/** Per-exposure result kept in the QuickLookField (for the wavelength switch and provenance). */
export interface QuickLookExposureResult {
  meta: QuickLookExposure;
  /** FrameMeta.i of the frame this exposure went into, or null if it was not used. */
  frame: number | null;
  /** Index into QuickLookField.exposurePlanes, or null if nothing was resampled. */
  plane: number | null;
  /** Median of the resampled plane (MJy/sr), subtracted before dividing by `noise`. */
  median: number | null;
  /** Robust noise of the plane after the median is removed (MJy/sr; sigma-clipped std, 2.5 sigma). */
  noise: number | null;
  /** Fraction of grid pixels with data. Planes under 0.2 are not used (as in build_frame). */
  coverage: number;
  /** Why the exposure was not used, in plain words. */
  skipped?: string;
  /** Header values worth showing (DATE-OBS, MJD-OBS, PSF_FWHM), when read. */
  dateObs?: string;
  mjdObs?: number;
  psfFwhmArcsec?: number;
}

/**
 * A quick look, shaped like a ready spot's Field (field-schema.md 1-3) so the same viewer can show it:
 * same grid convention (0-based, rows top-down, north up, east left, `wcs` like grid_wcs), frames in
 * S/N units. Differences: `kind` is "quicklook"; the frames are in memory (`planes`), so `data.file`
 * is empty and `thumbs` is empty; `difficulty` is a placeholder because quick look is never scored.
 */
export interface QuickLookField extends Field {
  kind: "quicklook";
  /** One S/N plane per frame (frames[k] <-> planes[k]), gridPx * gridPx, row-major top-down, NaN = no data. */
  planes: Float32Array[];
  /** Resampled per-exposure planes in MJy/sr (same grid), median NOT removed. See `exposures[].plane`. */
  exposurePlanes: Float32Array[];
  exposures: QuickLookExposureResult[];
  /** Bytes actually downloaded in this run (cached rows count 0). */
  bytesDownloaded: number;
  label: typeof QUICKLOOK_LABEL;
  notes: string[];
}

export interface QuickLookProgress {
  phase: "download" | "combine" | "done";
  exposuresDone: number;
  exposuresTotal: number;
  bytesDownloaded: number;
  bytesPlanned: number;
}

export interface RunOptions {
  fetch?: FetchLike;
  /** Parallel exposure downloads (default and maximum 4). */
  concurrency?: number;
  /**
   * Turn an exposure's URL (from the list route: S3 when present, else IRSA access_url) into the URL
   * actually Range-read, e.g. a proxy route. Default: read the URL as given.
   */
  rewriteUrl?: (url: string) => string;
}

// ---- in-memory cache of headers and rows (survives between runs in the same worker) ----

const CACHE_LIMIT_BYTES = 96 * 1024 * 1024;
const headerCache = new Map<string, Promise<HduInfo[]>>();
const rowCache = new Map<string, { promise: Promise<Float32Array>; bytes: number }>();
let rowCacheBytes = 0;

export function clearQuickLookCache(): void {
  headerCache.clear();
  rowCache.clear();
  rowCacheBytes = 0;
}

function cachedHeaders(url: string, fetch: FetchLike | undefined, signal: AbortSignal, onBytes: (n: number) => void): Promise<HduInfo[]> {
  let p = headerCache.get(url);
  if (!p) {
    p = readHeaders(url, { fetch, signal, stopAfter: "IMAGE" }).then((r) => {
      onBytes(HEADER_READ_BYTES);
      return r.hdus;
    });
    headerCache.set(url, p);
    // Never cache a failure or a cancel; drop it as soon as its run is cancelled, so a run started
    // in the same tick reads afresh (and a late rejection never removes that run's newer entry).
    const mine = p;
    const drop = () => {
      if (headerCache.get(url) === mine) headerCache.delete(url);
    };
    p.catch(drop);
    signal.addEventListener("abort", drop, { once: true });
    p.then(() => signal.removeEventListener("abort", drop), () => {}); // a finished read stays cached
  }
  return p;
}

function cachedRows(
  url: string,
  hdu: HduInfo,
  y0: number,
  y1: number,
  fetch: FetchLike | undefined,
  signal: AbortSignal,
  onBytes: (n: number) => void,
): Promise<Float32Array> {
  // Reuse a cached read that already contains these rows.
  for (const [key, v] of rowCache) {
    const [u, a, b] = key.split("|");
    if (u === url && Number(a) <= y0 && Number(b) >= y1) {
      const w = hdu.naxis[0];
      return v.promise.then((rows) => rows.subarray((y0 - Number(a)) * w, (y1 - Number(a) + 1) * w));
    }
  }
  const key = `${url}|${y0}|${y1}`;
  const bytes = (y1 - y0 + 1) * hdu.naxis[0] * (Math.abs(hdu.bitpix) / 8);
  const promise = readRows(url, hdu, y0, y1, { fetch, signal }).then((r) => {
    onBytes(bytes);
    return r;
  });
  rowCache.set(key, { promise, bytes });
  rowCacheBytes += bytes;
  const drop = () => {
    if (rowCache.get(key)?.promise === promise) {
      rowCache.delete(key);
      rowCacheBytes -= bytes;
    }
  };
  promise.catch(drop);
  signal.addEventListener("abort", drop, { once: true }); // see cachedHeaders
  promise.then(() => signal.removeEventListener("abort", drop), () => {});
  // Evict the oldest reads beyond the limit (Map keeps insertion order).
  for (const [k, v] of rowCache) {
    if (rowCacheBytes <= CACHE_LIMIT_BYTES || k === key) break;
    rowCache.delete(k);
    rowCacheBytes -= v.bytes;
  }
  return promise;
}

// ---- grid and resampling ----

/** Our north-up TAN grid, exactly spectral_bands.grid_wcs (crpix 1-based, cdelt = -/+ 6.15"). */
export function quickLookWcs(ra: number, dec: number, gridPx: number): FieldWcs {
  const half = (gridPx - 1) / 2;
  return {
    ctype: ["RA---TAN", "DEC--TAN"],
    crval: [ra, dec],
    crpix: [half + 1, half + 1],
    cdelt: [-PIXEL_ARCSEC / 3600, PIXEL_ARCSEC / 3600],
    rows: "top-down",
  };
}

/** Sky position of every grid pixel, row-major top-down. */
function gridSky(wcs: FieldWcs, n: number): { ra: Float64Array; dec: Float64Array } {
  const ra = new Float64Array(n * n);
  const dec = new Float64Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const [r, d] = pixelToSky(wcs, n, x, y);
      ra[y * n + x] = r;
      dec[y * n + x] = d;
    }
  }
  return { ra, dec };
}

/**
 * Bilinear sample of `rows` (rows y0.. of a W-wide image, FITS order) at 0-based (x, y). NaN outside
 * the image (as scipy map_coordinates order=1 with cval=NaN) or next to a NaN pixel.
 */
export function bilinear(rows: Float32Array, w: number, y0: number, nRows: number, x: number, y: number): number {
  const yl = y - y0;
  if (!(x >= 0 && x <= w - 1 && yl >= 0 && yl <= nRows - 1)) return NaN;
  const ix = Math.min(Math.floor(x), w - 2);
  const iy = Math.min(Math.floor(yl), nRows - 2);
  const fx = x - ix;
  const fy = yl - iy;
  if (w === 1 || nRows === 1) return rows[Math.round(yl) * w + Math.round(x)];
  const a = rows[iy * w + ix];
  const b = rows[iy * w + ix + 1];
  const c = rows[(iy + 1) * w + ix];
  const d = rows[(iy + 1) * w + ix + 1];
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}

function nanMedian(a: ArrayLike<number>): number {
  const v: number[] = [];
  for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i])) v.push(a[i]);
  if (!v.length) return NaN;
  v.sort((p, q) => p - q);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

const MAD_TO_STD = 1.482602218505602; // astropy mad_std

/**
 * One frame from a burst's S/N planes (motion_frames.build_frame): with 3 or more planes, a
 * sigma-clipped mean per pixel (astropy sigma_clip sigma=3, cenfunc=median, stdfunc=mad_std,
 * maxiters=5); otherwise a plain mean. NaN pixels are ignored. Then divided by its own noise.
 */
export function combineBurst(planes: Float32Array[]): Float32Array {
  const n = planes[0].length;
  const out = new Float32Array(n);
  const clip = planes.length >= 3;
  const vals: number[] = [];
  for (let k = 0; k < n; k++) {
    vals.length = 0;
    for (const p of planes) if (Number.isFinite(p[k])) vals.push(p[k]);
    if (!vals.length) {
      out[k] = NaN;
      continue;
    }
    let kept = vals;
    if (clip) {
      for (let it = 0; it < 5; it++) {
        const med = nanMedian(kept);
        const std = MAD_TO_STD * nanMedian(kept.map((v) => Math.abs(v - med)));
        const next = kept.filter((v) => v >= med - 3 * std && v <= med + 3 * std);
        if (next.length === kept.length) break;
        kept = next;
        if (!kept.length) break;
      }
    }
    out[k] = kept.length ? kept.reduce((s, v) => s + v, 0) / kept.length : NaN;
  }
  const noise = noiseOf(out);
  if (noise > 0) for (let k = 0; k < n; k++) out[k] /= noise;
  return out;
}

/** Plane in MJy/sr -> S/N plane: minus its median, divided by its robust noise. */
function toSnr(plane: Float32Array, median: number, noise: number): Float32Array {
  const out = new Float32Array(plane.length);
  for (let k = 0; k < plane.length; k++) out[k] = (plane[k] - median) / noise;
  return out;
}

function abortError(): Error {
  return new DOMException("The quick look was cancelled.", "AbortError");
}

function headerNumber(h: FitsHeader, k: string): number | undefined {
  const v = h[k];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Frames from per-exposure results, grouped by burst, keeping only `detectors` (empty = all). */
function buildFrames(
  groups: number[][],
  results: QuickLookExposureResult[],
  exposurePlanes: Float32Array[],
  detectors: number[],
): { planes: Float32Array[]; frames: FrameMeta[]; used: Map<number, number> } {
  const dets = new Set(detectors);
  const planes: Float32Array[] = [];
  const frames: FrameMeta[] = [];
  const used = new Map<number, number>(); // result index -> frame i
  for (const g of groups) {
    const members = g.filter((r) => {
      const res = results[r];
      return res.plane !== null && res.median !== null && res.noise !== null && res.coverage > 0.2 &&
        (dets.size === 0 || dets.has(res.meta.detector));
    });
    if (!members.length) continue;
    const sn = members.map((r) => toSnr(exposurePlanes[results[r].plane as number], results[r].median as number, results[r].noise as number));
    const frame = combineBurst(sn);
    const i = frames.length + 1;
    const mjds = members.map((r) => results[r].mjdObs ?? results[r].meta.mjd);
    const mjd = mjds.reduce((s, v) => s + v, 0) / mjds.length;
    const prev = frames.length ? frames[frames.length - 1].mjd : mjd;
    frames.push({
      i,
      mjd,
      utc: mjdToUtc(mjd),
      hours_since_prev: frames.length ? Math.round((mjd - prev) * 24 * 100) / 100 : 0,
      n_bands: members.length,
      detectors: [...new Set(members.map((r) => results[r].meta.detector))].sort((a, b) => a - b),
    });
    planes.push(frame);
    for (const r of members) used.set(r, i);
  }
  // Only compare where every frame has data, as motion_frames does; otherwise a star missing from
  // one frame's coverage would look like it changed.
  if (planes.length > 1) {
    const n = planes[0].length;
    for (let k = 0; k < n; k++) {
      if (planes.some((p) => !Number.isFinite(p[k]))) for (const p of planes) p[k] = NaN;
    }
  }
  return { planes, frames, used };
}

/**
 * Download and build a quick look. `onProgress(p)` gets 0..1 (and details); cancel with `signal`
 * (rejects with an AbortError, downloads stop). Exposures that fail are skipped and reported in
 * `exposures[].skipped`; the run fails only if no frame can be made.
 */
export async function runQuickLook(
  plan: QuickLookPlan,
  onProgress: (p: number, info: QuickLookProgress) => void,
  signal: AbortSignal,
  o: RunOptions = {},
): Promise<QuickLookField> {
  if (signal.aborted) throw abortError();
  const n = plan.gridPx;
  const wcs = quickLookWcs(plan.ra, plan.dec, n);
  const sky = gridSky(wcs, n);
  const total = plan.exposures.length;
  let done = 0;
  let downloaded = 0;
  const report = (phase: QuickLookProgress["phase"]) => {
    const p = phase === "done" ? 1 : Math.min(0.99, plan.bytes > 0 ? downloaded / plan.bytes : done / Math.max(1, total));
    onProgress(Math.max(p, phase === "combine" ? 0.95 : 0), {
      phase,
      exposuresDone: done,
      exposuresTotal: total,
      bytesDownloaded: downloaded,
      bytesPlanned: plan.bytes,
    });
  };
  const onBytes = (b: number) => {
    downloaded += b;
    report("download");
  };

  const results: QuickLookExposureResult[] = plan.exposures.map((meta) => ({ meta, frame: null, plane: null, median: null, noise: null, coverage: 0 }));
  const exposurePlanes: Float32Array[] = [];

  const work = async (k: number) => {
    const res = results[k];
    // Exposures without an S3 copy only reach this point with includeIrsa, i.e. behind a proxy.
    const base = res.meta.url ?? res.meta.access_url;
    const url = o.rewriteUrl ? o.rewriteUrl(base) : base;
    try {
      const hdus = await cachedHeaders(url, o.fetch, signal, onBytes);
      const img = findHdu(hdus, "IMAGE");
      if (!img) throw new Error("no IMAGE extension");
      if (img.compressed) throw new Error("IMAGE is tile-compressed (ZIMAGE = T); skipped rather than decoded");
      if (img.naxis.length !== 2) throw new Error("IMAGE is not 2-D");
      const h = img.header;
      res.dateObs = typeof h["DATE-OBS"] === "string" ? (h["DATE-OBS"] as string) : undefined;
      res.mjdObs = headerNumber(h, "MJD-OBS");
      res.psfFwhmArcsec = headerNumber(h, "PSF_FWHM");
      const sip = compileSipWcs(h);
      const [w, hgt] = img.naxis;
      // Grid -> exposure pixels (0-based FITS), and the rows that covers.
      const px = new Float64Array(n * n);
      const py = new Float64Array(n * n);
      let yMin = Infinity;
      let yMax = -Infinity;
      let inside = 0;
      for (let q = 0; q < n * n; q++) {
        const p = sipWorldToPixel(sip, sky.ra[q], sky.dec[q]);
        px[q] = p.x;
        py[q] = p.y;
        if (p.x >= 0 && p.x <= w - 1 && p.y >= 0 && p.y <= hgt - 1) {
          inside++;
          yMin = Math.min(yMin, p.y);
          yMax = Math.max(yMax, p.y);
        }
      }
      if (!inside) throw new Error("the field is not on this exposure");
      const y0 = Math.max(0, Math.floor(yMin));
      const y1 = Math.min(hgt - 1, Math.floor(yMax) + 1);
      const rows = await cachedRows(url, img, y0, y1, o.fetch, signal, onBytes);
      const plane = new Float32Array(n * n);
      for (let q = 0; q < n * n; q++) plane[q] = bilinear(rows, w, y0, y1 - y0 + 1, px[q], py[q]);
      let finite = 0;
      for (let q = 0; q < plane.length; q++) if (Number.isFinite(plane[q])) finite++;
      res.coverage = finite / plane.length;
      res.plane = exposurePlanes.length;
      exposurePlanes.push(plane);
      const med = nanMedian(plane);
      const centred = new Float32Array(plane.length);
      for (let q = 0; q < plane.length; q++) centred[q] = plane[q] - med;
      const noise = noiseOf(centred);
      if (Number.isFinite(med) && noise > 0) {
        res.median = med;
        res.noise = noise;
      }
      if (res.coverage <= 0.2) res.skipped = `covers only ${Math.round(res.coverage * 100)}% of the field`;
      else if (res.noise === null) res.skipped = "flat or empty plane (no noise estimate)";
    } catch (e) {
      if (isAbortError(e) || signal.aborted) throw abortError();
      res.skipped = e instanceof Error ? e.message : String(e);
    } finally {
      done++;
      if (!signal.aborted) report("download");
    }
  };

  // At most MAX_PARALLEL exposures in flight; each does its header read, then its row read.
  const limit = Math.max(1, Math.min(MAX_PARALLEL, o.concurrency ?? MAX_PARALLEL));
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, total) }, async () => {
    while (next < total) {
      if (signal.aborted) throw abortError();
      await work(next++);
    }
  });
  await Promise.all(runners);
  if (signal.aborted) throw abortError();

  report("combine");
  const { planes, frames, used } = buildFrames(plan.bursts, results, exposurePlanes, []);
  for (const [r, i] of used) {
    results[r].frame = i;
    results[r].meta = { ...results[r].meta, frame: i };
  }
  if (!frames.length) {
    const why = [...new Set(results.map((r) => r.skipped).filter(Boolean))].slice(0, 3).join("; ");
    throw new Error(`No exposure could be read for this quick look${why ? ` (${why})` : ""}.`);
  }
  const fwhms = results.filter((r) => r.frame !== null && r.psfFwhmArcsec !== undefined).map((r) => r.psfFwhmArcsec as number);
  // Same as motion_frames: PSF in grid pixels, widened by about 1 px by the bilinear resampling.
  // 8.0 arcsec is motion_frames' fallback when PSF_FWHM is missing.
  const psf = Math.hypot((fwhms.length ? nanMedian(fwhms) : 8.0) / PIXEL_ARCSEC, 1.0);
  const notes = [...plan.notes];
  const skipped = results.filter((r) => r.skipped).length;
  if (skipped) notes.push(`${skipped} of ${total} images were skipped (see exposures[].skipped).`);
  const field: QuickLookField = {
    slug: "quicklook",
    title: `Quick look ${plan.ra.toFixed(4)}, ${plan.dec >= 0 ? "+" : ""}${plan.dec.toFixed(4)}`,
    kind: "quicklook",
    difficulty: "control", // placeholder: Field requires one; quick look is never scored (BP 3)
    ra: plan.ra,
    dec: plan.dec,
    fov_deg: (n * PIXEL_ARCSEC) / 3600,
    pixel_arcsec: PIXEL_ARCSEC,
    size: [n, n],
    wcs,
    frames,
    data: { format: "u16", file: "", scale: 1, offset: 0, units: "S/N", precision: "float", nodata: 65535 },
    thumbs: [],
    stretch: { black_sigma: -1, soft_sigma: 2, white: sharedWhite(planes, -1) },
    psf_fwhm_px: Math.round(psf * 100) / 100,
    has: { exposures: true, spectrum: false },
    planes,
    exposurePlanes,
    exposures: results,
    bytesDownloaded: downloaded,
    label: QUICKLOOK_LABEL,
    notes,
  };
  report("done");
  return field;
}

/**
 * Rebuild the frames for a subset of detectors (wavelength switch, BUILD_PROMPT 8.17) from the
 * per-exposure planes, without downloading again. Returns new planes + frame metadata; the stretch
 * should be recomputed by the caller (one shared stretch across frames).
 */
export function rebuildFrames(field: QuickLookField, plan: Pick<QuickLookPlan, "bursts">, detectors: number[]): { planes: Float32Array[]; frames: FrameMeta[] } {
  const { planes, frames } = buildFrames(plan.bursts, field.exposures, field.exposurePlanes, detectors);
  return { planes, frames };
}

/** Buffers to transfer (not copy) when posting a QuickLookField out of the worker. */
export function transferablesOf(field: QuickLookField): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  for (const p of [...field.planes, ...field.exposurePlanes]) out.add(p.buffer as ArrayBuffer);
  return [...out];
}

// ------------------------------------------------------------------------------------------------
// Worker message protocol (workers/quicklook.ts)
// ------------------------------------------------------------------------------------------------

export type QuickLookWorkerRequest =
  /**
   * proxyPrefix: when set, every exposure URL is read as proxyPrefix + encodeURIComponent(url)
   * (functions cannot cross postMessage, so this is the worker's form of RunOptions.rewriteUrl).
   */
  | { type: "start"; id: string; plan: QuickLookPlan; proxyPrefix?: string }
  | { type: "cancel"; id: string };

export type QuickLookWorkerResponse =
  | { type: "progress"; id: string; p: number; info: QuickLookProgress }
  | { type: "done"; id: string; field: QuickLookField }
  | { type: "error"; id: string; message: string; cancelled: boolean };
