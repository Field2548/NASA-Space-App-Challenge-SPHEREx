// Spectrum science for Inspect section C (BUILD_PROMPT 8.16 "C. Spectrum view", 6.6, 9).
// Pure functions plus two small loaders. Inputs follow field-schema.md sections 1 and 7.
//
// Honesty rules (BP 8.16): no temperature for movers, never an age, never an "exact amount".
// Functions return null instead of guessing.

import { FIELDS_BASE } from "./fields";
import type { ExposureMeta, Field, RGB, Spectrum, Track, Vision } from "./types";

// ---------------------------------------------------------------------------------------------
// Physical constants and instrument numbers
// ---------------------------------------------------------------------------------------------

/** SPHEREx grid pixel, arcsec (field-schema.md section 1, field.json `pixel_arcsec`). */
export const PIXEL_ARCSEC = 6.15;
/** Arcseconds per radian: 180 * 3600 / pi. */
const ARCSEC_PER_RAD = 206264.806;
/** Solid angle of one 6.15" pixel in steradians: (6.15 / 206264.806)^2, about 8.89e-10 sr (BP 8.16 C.2). */
export const PIXEL_SR = (PIXEL_ARCSEC / ARCSEC_PER_RAD) ** 2;
/** 1 MJy = 1e9 mJy (1 Jy = 1e3 mJy, 1 MJy = 1e6 Jy). */
const MJY_TO_mJY = 1e9;
/** Planck constant (J s), speed of light (m/s), Boltzmann constant (J/K): CODATA 2018 exact values. */
const H_PLANCK = 6.62607015e-34;
const C_LIGHT = 299792458;
const K_BOLTZ = 1.380649e-23;
/** SPHEREx wavelength range in micron (0.75 to 5.0 um, BP 1). */
export const WL_MIN_UM = 0.75;
export const WL_MAX_UM = 5.0;

/**
 * Brown-dwarf templates (SPIFF, BP 6.6) are NOT shipped: loading the SPIFF pickle was not approved.
 * The UI must say comparisons are blackbody-only while this is false.
 */
export const HAS_BROWN_DWARF_TEMPLATES = false;

// ---------------------------------------------------------------------------------------------
// Rainbow colour for a wavelength
// ---------------------------------------------------------------------------------------------

/** Hue (degrees) at 0.75 um: violet. The ramp runs down through blue 240, cyan 180, green 120, yellow 60, orange 30 to red 0 at 5.0 um. */
const HUE_VIOLET = 275;
/** Gray used for every wavelength in "No color" vision (BP 8.16 C.1). */
export const MONO_GRAY: RGB = [150, 150, 150];

function hslToRgb(hDeg: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((hDeg % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/**
 * Decorative false colour for a wavelength: violet at 0.75 um to red at 5.0 um, hue decreasing
 * linearly (monotonic). Out-of-range wavelengths are clamped. In "mono" vision every dot is gray.
 * The other vision modes get the same ramp: wavelength is already on the x-axis, so colour carries
 * no information a colour-blind player would lose (BP 8.16 C.1).
 */
export function wavelengthColor(um: number, vision: Vision = "normal"): RGB {
  if (vision === "mono") return [...MONO_GRAY] as RGB;
  const t = Number.isFinite(um) ? Math.min(1, Math.max(0, (um - WL_MIN_UM) / (WL_MAX_UM - WL_MIN_UM))) : 0;
  return hslToRgb(HUE_VIOLET * (1 - t), 0.85, 0.55);
}

// ---------------------------------------------------------------------------------------------
// Per-exposure planes (field-schema.md section 7)
// ---------------------------------------------------------------------------------------------

/** One row of exposures.json `exposures[]` (field-schema.md section 7). Extends the shared ExposureMeta loosely. */
export interface ExposureRecord {
  k: number;
  frame: number;
  mjd: number;
  utc: string;
  detector: number;
  obs_id: string;
  file: string;
  source: string | null;
  scale: number;
  offset: number;
  noise: number; // MJy/sr, sigma-clipped std of the plane
  clipped: boolean;
  bandwidth_um: number | null;
  wavelength_um: (number | null)[][]; // 8 x 8, rows top-down
}

/** exposures.json (field-schema.md section 7). */
export interface ExposuresJson {
  file: string;
  size: [number, number];
  count: number;
  units: "MJy/sr";
  nodata: number;
  wavelength_grid: number;
  exposures: ExposureRecord[];
}

/** Decoded per-exposure planes plus their metadata: the input of spectrumAlongPath. */
export interface ExposurePlanes {
  /** [W, H] of the spot. */
  size: [number, number];
  /** MJD of the spot's first frame: Track/Mark `tDays` are days since this time (types.ts). */
  firstFrameMjd: number;
  /** One MJy/sr plane per exposure (row-major top-down, NaN = no data), index = `meta[i].k`. */
  planes: Float32Array[];
  meta: ExposureRecord[];
}

/** Convert one exposure record to the shared ExposureMeta shape (for lists and provenance). */
export function toExposureMeta(e: ExposureRecord): ExposureMeta {
  return { obs_id: e.obs_id, mjd: e.mjd, utc: e.utc, detector: e.detector, frame: e.frame, path: e.source ?? e.file };
}

/** Decode exposures.u16 bytes (K x H x W, little-endian, own scale/offset per plane, 65535 = NaN). */
export function decodeExposures(json: ExposuresJson, bytes: ArrayBuffer, firstFrameMjd: number): ExposurePlanes {
  const [w, h] = json.size;
  const plane = w * h;
  const k = json.exposures.length;
  if (bytes.byteLength !== 2 * k * plane) {
    throw new Error(`exposures.u16 is ${bytes.byteLength} bytes, expected ${2 * k * plane} (${k} x ${h} x ${w})`);
  }
  const view = new DataView(bytes);
  const planes: Float32Array[] = [];
  for (const e of json.exposures) {
    const p = new Float32Array(plane);
    const base = e.k * plane * 2;
    for (let i = 0; i < plane; i++) {
      const v = view.getUint16(base + 2 * i, true);
      p[i] = v === json.nodata ? NaN : v * e.scale + e.offset;
    }
    planes[e.k] = p;
  }
  return { size: [w, h], firstFrameMjd, planes, meta: json.exposures };
}

/** Fetch and decode exposures.json + exposures.u16 for a spot. Null when the spot has none (`has.exposures`). */
export async function loadExposures(
  field: Field,
  fetcher: typeof fetch = fetch,
  base = FIELDS_BASE,
): Promise<ExposurePlanes | null> {
  if (!field.has?.exposures) return null;
  const dir = `${base}/${encodeURIComponent(field.slug)}`;
  const jr = await fetcher(`${dir}/exposures.json`);
  if (!jr.ok) throw new Error(`GET ${dir}/exposures.json failed: ${jr.status}`);
  const json = (await jr.json()) as ExposuresJson;
  const br = await fetcher(`${dir}/${json.file}`);
  if (!br.ok) throw new Error(`GET ${dir}/${json.file} failed: ${br.status}`);
  return decodeExposures(json, await br.arrayBuffer(), field.frames[0].mjd);
}

/**
 * Wavelength seen at pixel (x, y) from an 8 x 8 `wavelength_um` grid (field-schema.md section 7):
 * cell (cx, cy) is centred on pixel ((cx + 0.5) * W / n - 0.5, (cy + 0.5) * H / n - 0.5); bilinear
 * between the 4 surrounding cell centres, clamped at the outer cell centres. Null corners are
 * dropped and the remaining weights renormalised; null when all 4 are null.
 */
export function wavelengthAt(grid: (number | null)[][], w: number, h: number, x: number, y: number): number | null {
  const n = grid.length;
  if (!n) return null;
  const u = Math.min(n - 1, Math.max(0, ((x + 0.5) * n) / w - 0.5));
  const v = Math.min(n - 1, Math.max(0, ((y + 0.5) * n) / h - 0.5));
  const c0 = Math.min(n - 2, Math.floor(u));
  const r0 = Math.min(n - 2, Math.floor(v));
  const fu = u - c0;
  const fv = v - r0;
  let sw = 0;
  let s = 0;
  const add = (r: number, c: number, wt: number) => {
    const val = grid[r]?.[c];
    if (val === null || val === undefined || !Number.isFinite(val) || wt <= 0) return;
    s += val * wt;
    sw += wt;
  };
  add(r0, c0, (1 - fu) * (1 - fv));
  add(r0, c0 + 1, fu * (1 - fv));
  add(r0 + 1, c0, (1 - fu) * fv);
  add(r0 + 1, c0 + 1, fu * fv);
  if (sw === 0) {
    // On an exact cell centre every other weight is zero; fall back to the nearest cell.
    const val = grid[Math.round(v)]?.[Math.round(u)];
    return val === null || val === undefined || !Number.isFinite(val) ? null : val;
  }
  return s / sw;
}

/**
 * Position of a track at `tDays` (days since the first frame). With 2 or more marks, linear
 * interpolation between the marks in time order and linear extrapolation beyond the end marks
 * (fast movers do not move in a straight line, field-schema.md 6); otherwise the straight-line fit.
 */
export function trackPositionAt(track: Track, tDays: number): { x: number; y: number } {
  const m = [...track.marks].filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).sort((a, b) => a.tDays - b.tDays);
  // Drop duplicate times (keep the first) so segments have non-zero length.
  const pts = m.filter((p, i) => i === 0 || p.tDays > m[i - 1].tDays);
  if (pts.length < 2) {
    const dt = tDays - track.t0Days;
    return { x: track.x0 + track.vx * dt, y: track.y0 + track.vy * dt };
  }
  let i = 0;
  while (i < pts.length - 2 && tDays > pts[i + 1].tDays) i++;
  const a = pts[i];
  const b = pts[i + 1];
  const f = (tDays - a.tDays) / (b.tDays - a.tDays);
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

export interface PathSpectrum {
  wl: number[]; // micron, the wavelength that exposure saw at that spot
  mJy: number[]; // background-subtracted aperture sum
  err: number[]; // 1 sigma, mJy
  t: number[]; // MJD of the exposure (start, DATE-OBS)
  /** Extras for hover and caveats, one per point. */
  k: number[]; // exposure plane index
  frame: number[];
  det: number[];
  x: number[];
  y: number[];
  /** True when the exposure had its brightest pixels clipped (field-schema 7): the flux may be a lower limit. */
  clipped: boolean[];
}

/** Default aperture radius in pixels (BP 8.16 C.2: "radius about 1.5 px"). */
export const DEFAULT_APERTURE_PX = 1.5;

/** Median of finite values (sorted copy). */
export function median(values: ArrayLike<number>): number {
  const v: number[] = [];
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) v.push(values[i]);
  if (!v.length) return NaN;
  v.sort((a, b) => a - b);
  const n = v.length >> 1;
  return v.length % 2 ? v[n] : (v[n - 1] + v[n]) / 2;
}

/**
 * Aperture photometry in one plane. Aperture: pixels whose centre lies within `r` of (x, y).
 * Background: median of the ring rIn..rOut (robust to stars in the ring). Null if any aperture
 * pixel is missing or off the grid (a partial aperture would bias the sum), or if the ring has
 * fewer than 8 valid pixels.
 */
export function aperturePhotometry(
  plane: Float32Array,
  w: number,
  h: number,
  x: number,
  y: number,
  r: number,
  rIn: number,
  rOut: number,
): { sum: number; nAp: number; nRing: number; bg: number } | null {
  const ring: number[] = [];
  const ap: number[] = [];
  const R = Math.ceil(rOut);
  const cx = Math.round(x);
  const cy = Math.round(y);
  for (let j = cy - R; j <= cy + R; j++) {
    for (let i = cx - R; i <= cx + R; i++) {
      const d = Math.hypot(i - x, j - y);
      const inside = i >= 0 && j >= 0 && i < w && j < h;
      if (d <= r) {
        if (!inside) return null;
        const v = plane[j * w + i];
        if (!Number.isFinite(v)) return null;
        ap.push(v);
      } else if (d >= rIn && d <= rOut && inside) {
        const v = plane[j * w + i];
        if (Number.isFinite(v)) ring.push(v);
      }
    }
  }
  if (!ap.length || ring.length < 8) return null;
  const bg = median(ring);
  let sum = 0;
  for (const v of ap) sum += v - bg;
  return { sum, nAp: ap.length, nRing: ring.length, bg };
}

/**
 * Spectrum along a mover's path (BP 8.16 C.2). For each exposure: position of the track at the
 * exposure's time (MJD -> days since the first frame), aperture of radius `apPx` (background from a
 * ring 3 to 6 px, or 2*apPx to 2*apPx + 3 for larger apertures), sum in MJy/sr converted to mJy with
 * the pixel solid angle, wavelength from that exposure's 8 x 8 map at that position.
 * Error: noise * sqrt(nAp + (pi/2) * nAp^2 / nRing) (pixel noise in the aperture plus the error of a
 * median background; pi/2 is the variance ratio of median vs mean for Gaussian noise), in mJy.
 * One point per exposure whose aperture is fully covered; others are skipped. Points are sorted by
 * wavelength. No aperture correction is applied: light of the PSF outside 1.5 px is not counted.
 */
export function spectrumAlongPath(exps: ExposurePlanes, track: Track, apPx: number = DEFAULT_APERTURE_PX): PathSpectrum {
  const [w, h] = exps.size;
  const rIn = Math.max(3, 2 * apPx); // px: clear of the PSF core (FWHM about 1.6 px, field.json psf_fwhm_px)
  const rOut = rIn + 3;
  const toMJy = PIXEL_SR * MJY_TO_mJY; // MJy/sr * sr -> MJy -> mJy
  const pts: { wl: number; f: number; e: number; t: number; k: number; frame: number; det: number; x: number; y: number; clipped: boolean }[] = [];
  for (const e of exps.meta) {
    const plane = exps.planes[e.k];
    if (!plane) continue;
    const pos = trackPositionAt(track, e.mjd - exps.firstFrameMjd);
    const phot = aperturePhotometry(plane, w, h, pos.x, pos.y, apPx, rIn, rOut);
    if (!phot) continue;
    const wl = wavelengthAt(e.wavelength_um, w, h, pos.x, pos.y);
    if (wl === null) continue;
    const sigma = e.noise * Math.sqrt(phot.nAp + (Math.PI / 2) * (phot.nAp * phot.nAp) / phot.nRing);
    pts.push({ wl, f: phot.sum * toMJy, e: sigma * toMJy, t: e.mjd, k: e.k, frame: e.frame, det: e.detector, x: pos.x, y: pos.y, clipped: e.clipped });
  }
  pts.sort((a, b) => a.wl - b.wl);
  return {
    wl: pts.map((p) => p.wl),
    mJy: pts.map((p) => p.f),
    err: pts.map((p) => p.e),
    t: pts.map((p) => p.t),
    k: pts.map((p) => p.k),
    frame: pts.map((p) => p.frame),
    det: pts.map((p) => p.det),
    x: pts.map((p) => p.x),
    y: pts.map((p) => p.y),
    clipped: pts.map((p) => p.clipped),
  };
}

/** A PathSpectrum as a shared Spectrum (flux in mJy). */
export function pathToSpectrum(p: PathSpectrum): Spectrum {
  return { wl: p.wl, flux: p.mJy, err: p.err, det: p.det };
}

// ---------------------------------------------------------------------------------------------
// Blackbody
// ---------------------------------------------------------------------------------------------

/**
 * Planck B_nu(T) at wavelength `um` (W m^-2 Hz^-1 sr^-1). Both the cube (MJy/sr) and the aperture
 * sums (mJy) are per unit frequency, so B_nu is the matching shape.
 */
export function planckNu(um: number, tK: number): number {
  const lam = um * 1e-6;
  const nu = C_LIGHT / lam;
  const x = (H_PLANCK * nu) / (K_BOLTZ * tK);
  if (x > 700) return 0; // exp overflow: effectively zero
  return ((2 * H_PLANCK * nu ** 3) / (C_LIGHT * C_LIGHT)) / Math.expm1(x);
}

/** Usable points: finite wavelength in range, finite flux, positive finite error (or no error). */
function usable(spec: Spectrum): { wl: number; f: number; e: number }[] {
  const out: { wl: number; f: number; e: number }[] = [];
  for (let i = 0; i < spec.wl.length; i++) {
    const wl = spec.wl[i];
    const f = spec.flux[i];
    const e = spec.err?.[i];
    if (!Number.isFinite(wl) || !Number.isFinite(f)) continue;
    if (e !== undefined && !(Number.isFinite(e) && e > 0)) continue;
    out.push({ wl, f, e: e ?? NaN });
  }
  return out;
}

/**
 * Error inflation factor from the spectrum's own band-to-band scatter (>= 1).
 * Why: the cube's bands come from single images taken months apart, so a point source falls on a
 * different pixel phase in each band; on Eros-field stars this makes about 25 percent band-to-band
 * scatter while `noise` (sky noise) is far smaller. For each interior band in wavelength order,
 * r = f_i - (f_{i-1} + f_{i+1}) / 2 with expected sigma sqrt(e_i^2 + (e_{i-1}^2 + e_{i+1}^2) / 4);
 * the factor is the robust std (1.4826 x MAD) of r / sigma, floored at 1. A smooth curve or a broad
 * feature spanning several bands barely changes it; robust statistics ignore a few spikes.
 * Returns 1 with fewer than 8 usable bands.
 */
export function scatterInflation(spec: Spectrum): number {
  const pts = usable(spec)
    .filter((p) => Number.isFinite(p.e))
    .sort((a, b) => a.wl - b.wl);
  if (pts.length < 8) return 1;
  const z: number[] = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const r = pts[i].f - (pts[i - 1].f + pts[i + 1].f) / 2;
    const s = Math.sqrt(pts[i].e ** 2 + (pts[i - 1].e ** 2 + pts[i + 1].e ** 2) / 4);
    z.push(r / s);
  }
  const m = median(z);
  const mad = median(z.map((v) => Math.abs(v - m)));
  return Math.max(1, 1.4826 * mad); // 1.4826: MAD -> Gaussian sigma
}

/** The same spectrum with every error multiplied by scatterInflation(spec). */
export function withInflatedErrors<S extends Spectrum>(spec: S): S {
  const k = scatterInflation(spec);
  return k === 1 ? spec : { ...spec, err: spec.err.map((e) => e * k) };
}

/** Hot-star rule (BP 8.16 C.4): near-infrared barely changes above about 5000 K. */
export const HOT_LIMIT_K = 5000;
/** Temperature search range for the fit, K. Below 300 K there is almost no signal at 0.75 to 5 um; above 50000 K the curve is pure Rayleigh-Jeans. */
const FIT_T_MIN = 300;
const FIT_T_MAX = 50000;

/** Chi-square of a model shape vs data after normalising both to their median over the same points. */
function shapeChi2(pts: { wl: number; f: number; e: number }[], model: (um: number) => number): number {
  const md = median(pts.map((p) => p.f));
  const mm = median(pts.map((p) => model(p.wl)));
  if (!(md > 0) || !(mm > 0)) return Infinity;
  let chi = 0;
  for (const p of pts) {
    const e = Number.isFinite(p.e) ? p.e / md : 1;
    chi += ((p.f / md - model(p.wl) / mm) / e) ** 2;
  }
  return chi;
}

/**
 * Planck fit in shape only: normalise data and model to their medians over the shared bands and
 * minimise chi-square over temperature (log grid 300 to 50000 K, then golden-section refinement).
 * `lowerLimitOnly` is true above 5000 K (BP 8.16 C.4). Null when fewer than 3 usable points or the
 * spectrum's median is not positive (a blackbody shape is meaningless there).
 */
export function blackbodyFit(spec: Spectrum): { teffK: number; lowerLimitOnly: boolean; chi2: number; n: number } | null {
  const pts = usable(spec);
  if (pts.length < 3 || !(median(pts.map((p) => p.f)) > 0)) return null;
  const f = (lt: number) => shapeChi2(pts, (um) => planckNu(um, Math.exp(lt)));
  const lo = Math.log(FIT_T_MIN);
  const hi = Math.log(FIT_T_MAX);
  const N = 200;
  let best = lo;
  let bestChi = Infinity;
  for (let i = 0; i <= N; i++) {
    const lt = lo + ((hi - lo) * i) / N;
    const c = f(lt);
    if (c < bestChi) [best, bestChi] = [lt, c];
  }
  // Golden-section search in the bracket around the best grid point.
  const step = (hi - lo) / N;
  let a = Math.max(lo, best - step);
  let b = Math.min(hi, best + step);
  const g = (Math.sqrt(5) - 1) / 2;
  for (let it = 0; it < 60; it++) {
    const c1 = b - g * (b - a);
    const c2 = a + g * (b - a);
    if (f(c1) < f(c2)) b = c2;
    else a = c1;
  }
  const lt = (a + b) / 2;
  const chiRefined = f(lt);
  const [ltBest, chi] = chiRefined <= bestChi ? [lt, chiRefined] : [best, bestChi];
  const teffK = Math.exp(ltBest);
  return { teffK, lowerLimitOnly: teffK > HOT_LIMIT_K, chi2: chi, n: pts.length };
}

// ---------------------------------------------------------------------------------------------
// Reference spectra and matching
// ---------------------------------------------------------------------------------------------

export type ReferenceKind = "star" | "mover" | "brown-dwarf";

/** A reference spectrum sampled on its own wavelength grid (per-frequency flux, any scale). */
export interface Reference {
  id: string;
  label: string; // plain words for the UI
  kind: ReferenceKind;
  /** Blackbody temperature used to build it (stars only; movers never get a temperature). */
  teffK?: number;
  /** Spectral type (brown-dwarf templates, e.g. "T1"), for the Mamajek lookup. */
  spt?: string;
  wl: number[]; // micron, increasing
  flux: number[];
  source: string;
}

export interface Match {
  ref: Reference;
  chi2: number;
  /** chi2 / (n - 1): one free parameter (the normalisation) per comparison. */
  redChi2: number;
  n: number;
  /** The reference resampled to the measured wavelengths, scaled to the data (for the dashed line). */
  model: { wl: number[]; flux: number[] };
}

/** Wavelength grid for built-in references: 0.70 to 5.10 um in 0.01 um steps (covers 0.75 to 5.0 with margin). */
function refGrid(): number[] {
  const out: number[] = [];
  for (let i = 0; i <= 440; i++) out.push(+(0.7 + i * 0.01).toFixed(2));
  return out;
}

/**
 * Star blackbody ladder, K. Spans M/L-dwarf-like (1500 to 3500 K) to hot stars; above 5000 K the
 * near-infrared shape changes little, so the ladder is coarse there (BP 8.16 C.4).
 */
export const STAR_LADDER_K = [1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 6000, 7500, 10000, 20000];
/** Solar effective temperature for "reflected sunlight" (BP 8.16 C.3 says about 5800 K; IAU nominal 5772 K). */
export const SUN_TEFF_K = 5800;
/** Thermal component for "sunlight + heat glow": 300 K blackbody, a typical near-Earth asteroid dayside near 1 AU (illustrative). */
export const HEAT_GLOW_K = 300;
/** Thermal component scaled to equal the reflected component at this wavelength (a convention, not a measurement). */
export const HEAT_GLOW_EQUAL_AT_UM = 4.5;

/**
 * Built-in references (blackbodies only; see HAS_BROWN_DWARF_TEMPLATES).
 * `"star"`: the STAR_LADDER_K blackbodies. `"mover"`: "reflected sunlight" (5800 K blackbody) and
 * "sunlight + heat glow at 4 to 5 um" (5800 K + 300 K blackbodies, equal at 4.5 um).
 */
export function builtInReferences(target: "star" | "mover"): Reference[] {
  const wl = refGrid();
  if (target === "star") {
    return STAR_LADDER_K.map((t) => ({
      id: `bb-${t}`,
      label: `Star, blackbody ${t} K`,
      kind: "star" as const,
      teffK: t,
      wl,
      flux: wl.map((um) => planckNu(um, t)),
      source: "Planck's law, computed",
    }));
  }
  const sun = wl.map((um) => planckNu(um, SUN_TEFF_K));
  const k = planckNu(HEAT_GLOW_EQUAL_AT_UM, SUN_TEFF_K) / planckNu(HEAT_GLOW_EQUAL_AT_UM, HEAT_GLOW_K);
  return [
    { id: "reflected", label: "Reflected sunlight", kind: "mover", wl, flux: sun, source: `Planck's law, ${SUN_TEFF_K} K` },
    {
      id: "reflected-heat",
      label: "Sunlight + heat glow at 4 to 5 um",
      kind: "mover",
      wl,
      flux: wl.map((um, i) => sun[i] + k * planckNu(um, HEAT_GLOW_K)),
      source: `Planck's law, ${SUN_TEFF_K} K + ${HEAT_GLOW_K} K (equal at ${HEAT_GLOW_EQUAL_AT_UM} um, illustrative)`,
    },
  ];
}

/** Linear interpolation of a reference at `um`; NaN outside its range. */
function interpRef(ref: Reference, um: number): number {
  const { wl, flux } = ref;
  if (!wl.length || um < wl[0] || um > wl[wl.length - 1]) return NaN;
  let lo = 0;
  let hi = wl.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (wl[mid] <= um) lo = mid;
    else hi = mid;
  }
  if (hi === lo) return flux[lo];
  const f = (um - wl[lo]) / (wl[hi] - wl[lo]);
  return flux[lo] + (flux[hi] - flux[lo]) * f;
}

/** Minimum S/N per band and number of such bands before any comparison (BP 8.16 C.3). */
export const MATCH_MIN_SNR = 5;
export const MATCH_MIN_BANDS = 20;
/** Quality words from the best reduced chi-square: "good" <= 2, "rough" <= 10, else "poor" (our thresholds). */
export const QUALITY_GOOD_MAX = 2;
export const QUALITY_ROUGH_MAX = 10;

/** Number of bands with flux / err >= minSnr. */
export function bandsAboveSnr(spec: Spectrum, minSnr = MATCH_MIN_SNR): number {
  let n = 0;
  for (let i = 0; i < spec.flux.length; i++) {
    const e = spec.err[i];
    if (Number.isFinite(spec.flux[i]) && Number.isFinite(e) && e > 0 && spec.flux[i] / e >= minSnr) n++;
  }
  return n;
}

function matchOne(pts: { wl: number; f: number; e: number }[], ref: Reference): Match | null {
  const shared = pts.map((p) => ({ ...p, r: interpRef(ref, p.wl) })).filter((p) => Number.isFinite(p.r));
  if (shared.length < 2) return null;
  const md = median(shared.map((p) => p.f));
  const mr = median(shared.map((p) => p.r));
  if (!(md > 0) || !(mr > 0)) return null;
  let chi = 0;
  for (const p of shared) chi += ((p.f / md - p.r / mr) / (p.e / md)) ** 2;
  return {
    ref,
    chi2: chi,
    redChi2: chi / (shared.length - 1),
    n: shared.length,
    model: { wl: shared.map((p) => p.wl), flux: shared.map((p) => (p.r / mr) * md) },
  };
}

/**
 * "Looks most like..." (BP 8.16 C.3): median-normalise the spectrum and each reference over the
 * shared bands, resample the reference to the measured wavelengths (linear), chi-square with the
 * measured errors. Null unless the target has S/N >= 5 in at least 20 bands, or fewer than 2
 * references could be compared. `quality` comes from the best reduced chi-square.
 * `opts.inflateErrors` (default false, i.e. the measured errors as BP 8.16 says) multiplies the
 * errors by scatterInflation() for the chi-square only (the S/N gate always uses measured errors).
 * Without it, real cube pixels of bright stars almost always come out "poor" (see scatterInflation).
 */
export function matchReferences(
  spec: Spectrum,
  refs: Reference[],
  opts: { inflateErrors?: boolean } = {},
): { best: Match; runnerUp: Match; quality: "good" | "rough" | "poor" } | null {
  if (bandsAboveSnr(spec) < MATCH_MIN_BANDS) return null;
  const pts = usable(opts.inflateErrors ? withInflatedErrors(spec) : spec).filter((p) => Number.isFinite(p.e));
  const ms = refs.map((r) => matchOne(pts, r)).filter((m): m is Match => m !== null);
  if (ms.length < 2) return null;
  ms.sort((a, b) => a.redChi2 - b.redChi2);
  const q = ms[0].redChi2;
  return { best: ms[0], runnerUp: ms[1], quality: q <= QUALITY_GOOD_MAX ? "good" : q <= QUALITY_ROUGH_MAX ? "rough" : "poor" };
}

// ---------------------------------------------------------------------------------------------
// Temperature guess
// ---------------------------------------------------------------------------------------------

/** web/public/ref/spt_teff.json (Mamajek's table, SpT and Teff columns). */
export interface SptTeffTable {
  source: string;
  citation: string;
  version: string;
  rows: { spt: string; teff: number }[];
}

/** Load /ref/spt_teff.json; null if it is missing or malformed (temperatureGuess then skips spectral-type lookups). */
export async function loadSptTeff(fetcher: typeof fetch = fetch, url = "/ref/spt_teff.json"): Promise<SptTeffTable | null> {
  try {
    const r = await fetcher(url);
    if (!r.ok) return null;
    const j = (await r.json()) as SptTeffTable;
    return Array.isArray(j.rows) ? j : null;
  } catch {
    return null;
  }
}

/** Look up a dwarf spectral type ("T1", "T1V", "t1 v") in the table; null if absent. */
export function lookupSptTeff(table: SptTeffTable | null | undefined, spt: string): number | null {
  if (!table) return null;
  const norm = (s: string) => s.replace(/\s+/g, "").toUpperCase().replace(/V$/, "");
  const want = norm(spt);
  const row = table.rows.find((r) => norm(r.spt) === want);
  return row ? row.teff : null;
}

export interface TemperatureGuess {
  /** Approximate temperature in K; when `lowerLimitOnly`, read as "hotter than about approxK". */
  approxK: number;
  lowerLimitOnly: boolean;
  /** Plain words for where it came from, e.g. "blackbody fit" or "type T1 (Mamajek table)". */
  from: string;
}

/**
 * Temperature guess (BP 8.16 C.4). Always "approx." in the UI.
 * - movers (and a missing match): null, never a temperature.
 * - star (blackbody) match: the blackbody fit's temperature if `fit` is given, else the matched
 *   ladder temperature; above 5000 K returns approxK = 5000 with lowerLimitOnly ("hotter than about 5000 K").
 * - brown-dwarf (spectral type) match: Teff of that type from the Mamajek table; null if the
 *   table is missing or does not list the type.
 */
export function temperatureGuess(
  match: Match | null | undefined,
  sptTeff: SptTeffTable | null | undefined,
  fit?: { teffK: number } | null,
): TemperatureGuess | null {
  if (!match) return null;
  const ref = match.ref;
  if (ref.kind === "mover") return null;
  if (ref.kind === "brown-dwarf") {
    if (!ref.spt) return null;
    const t = lookupSptTeff(sptTeff, ref.spt);
    return t === null ? null : { approxK: t, lowerLimitOnly: false, from: `type ${ref.spt} (Mamajek table)` };
  }
  const t = fit && Number.isFinite(fit.teffK) ? fit.teffK : ref.teffK;
  if (t === undefined || !Number.isFinite(t)) return null;
  if (t > HOT_LIMIT_K) return { approxK: HOT_LIMIT_K, lowerLimitOnly: true, from: fit ? "blackbody fit" : "closest blackbody" };
  // Round to 50 K: the fit is a shape estimate, not a precise measurement.
  return { approxK: Math.round(t / 50) * 50, lowerLimitOnly: false, from: fit ? "blackbody fit" : "closest blackbody" };
}
