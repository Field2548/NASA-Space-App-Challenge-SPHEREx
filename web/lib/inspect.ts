// Inspect popup science (BUILD_PROMPT 8.16, 9): cube spectrum at a pixel, colour hint, ice/PAH
// features, light curve, distances, ecliptic latitude, plain-word SIMBAD types.
// Pure functions plus one tile loader (field-schema.md section 8). Never invent a value: return null.

import { FIELDS_BASE } from "./fields";
import type { Field, Spectrum } from "./types";

// ---------------------------------------------------------------------------------------------
// Cube spectrum at a pixel (field-schema.md section 8)
// ---------------------------------------------------------------------------------------------

export interface SpectrumBand {
  band: number;
  detector: number;
  wavelength_um: number;
  bandwidth_um: number;
  date_obs: string;
  scale: number;
  offset: number;
  noise: number; // MJy/sr, sigma-clipped std over the spot
}

/** spectrum/index.json (field-schema.md section 8). */
export interface SpectrumIndex {
  size: [number, number];
  tile: number;
  nx: number;
  ny: number;
  origin: [number, number];
  covered: [number, number];
  units: "MJy/sr";
  nodata: number;
  bands: SpectrumBand[];
}

/**
 * Cube spectrum at one pixel. `flux` is surface brightness in MJy/sr per pixel (not mJy: the shared
 * Spectrum comment says mJy, see the report to the types owner); `err` is each band's `noise`.
 * Bands with no data at this pixel are left out; `band` and `dateObs` keep the band identity.
 */
export interface CubeSpectrum extends Spectrum {
  det: number[];
  band: number[];
  dateObs: string[];
  units: "MJy/sr";
}

const indexCache = new Map<string, Promise<SpectrumIndex>>();
const tileCache = new Map<string, Promise<Uint16Array>>();

/** Forget cached spectrum indexes and tiles (tests, or after a spot is re-exported). */
export function clearSpectrumCache(): void {
  indexCache.clear();
  tileCache.clear();
}

function cached<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let p = cache.get(key);
  if (!p) {
    p = load();
    cache.set(key, p);
    p.catch(() => cache.delete(key)); // a failed load may be retried later
  }
  return p;
}

/** Fetch (cached) spectrum/index.json for a spot. */
export function loadSpectrumIndex(field: Field, fetcher: typeof fetch = fetch, base = FIELDS_BASE): Promise<SpectrumIndex> {
  const url = `${base}/${encodeURIComponent(field.slug)}/spectrum/index.json`;
  return cached(indexCache, url, async () => {
    const r = await fetcher(url);
    if (!r.ok) throw new Error(`GET ${url} failed: ${r.status}`);
    return (await r.json()) as SpectrumIndex;
  });
}

/** Decode one band value from a tile (field-schema.md section 8 index formula). NaN for no data. */
export function tileValue(tile: Uint16Array, idx: SpectrumIndex, b: number, x: number, y: number): number {
  const t = idx.tile;
  const i = (b * t + ((y - idx.origin[1]) % t)) * t + ((x - idx.origin[0]) % t);
  const v = tile[i];
  return v === idx.nodata || v === undefined ? NaN : v * idx.bands[b].scale + idx.bands[b].offset;
}

/**
 * Spectrum of the cube at pixel (x, y) (rounded to the nearest pixel). Loads only the one tile that
 * holds the pixel, cached per URL. Null when the spot has no cube (`has.spectrum`), the pixel is
 * outside `origin`/`covered`, or every band is no-data there ("No spectrum here").
 */
export async function loadSpectrumAt(
  field: Field,
  x: number,
  y: number,
  fetcher: typeof fetch = fetch,
  base = FIELDS_BASE,
): Promise<CubeSpectrum | null> {
  if (!field.has?.spectrum) return null;
  const px = Math.round(x);
  const py = Math.round(y);
  const idx = await loadSpectrumIndex(field, fetcher, base);
  const dx = px - idx.origin[0];
  const dy = py - idx.origin[1];
  if (dx < 0 || dy < 0 || dx >= idx.covered[0] || dy >= idx.covered[1]) return null;
  const tx = Math.floor(dx / idx.tile);
  const ty = Math.floor(dy / idx.tile);
  const url = `${base}/${encodeURIComponent(field.slug)}/spectrum/t_${tx}_${ty}.u16`;
  const nB = idx.bands.length;
  const tile = await cached(tileCache, url, async () => {
    const r = await fetcher(url);
    if (!r.ok) throw new Error(`GET ${url} failed: ${r.status}`);
    const buf = await r.arrayBuffer();
    const expected = 2 * nB * idx.tile * idx.tile;
    if (buf.byteLength !== expected) throw new Error(`${url} is ${buf.byteLength} bytes, expected ${expected}`);
    // Explicit little-endian decode (contract), independent of host byte order.
    const view = new DataView(buf);
    const out = new Uint16Array(buf.byteLength / 2);
    for (let i = 0; i < out.length; i++) out[i] = view.getUint16(2 * i, true);
    return out;
  });
  const out: CubeSpectrum = { wl: [], flux: [], err: [], det: [], band: [], dateObs: [], units: "MJy/sr" };
  for (let b = 0; b < nB; b++) {
    const v = tileValue(tile, idx, b, px, py);
    if (!Number.isFinite(v)) continue;
    const bd = idx.bands[b];
    out.wl.push(bd.wavelength_um);
    out.flux.push(v);
    out.err.push(bd.noise);
    out.det.push(bd.detector);
    out.band.push(bd.band);
    out.dateObs.push(bd.date_obs);
  }
  return out.wl.length ? out : null;
}

// ---------------------------------------------------------------------------------------------
// Small statistics helpers
// ---------------------------------------------------------------------------------------------

function medianOf(v: number[]): number {
  const a = v.filter(Number.isFinite).sort((p, q) => p - q);
  if (!a.length) return NaN;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** Inverse-variance weighted mean of the points with lo <= wl <= hi, or null with none. */
function windowMean(spec: Spectrum, lo: number, hi: number): { mean: number; err: number } | null {
  let sw = 0;
  let s = 0;
  for (let i = 0; i < spec.wl.length; i++) {
    const wl = spec.wl[i];
    const f = spec.flux[i];
    const e = spec.err[i];
    if (!(wl >= lo && wl <= hi) || !Number.isFinite(f) || !(Number.isFinite(e) && e > 0)) continue;
    const w = 1 / (e * e);
    s += w * f;
    sw += w;
  }
  return sw > 0 ? { mean: s / sw, err: 1 / Math.sqrt(sw) } : null;
}

// ---------------------------------------------------------------------------------------------
// Colour hint (BP 8.16 "Spectrum hints. Color")
// ---------------------------------------------------------------------------------------------

/** Colour windows, micron (BP 8.16): 1 to 1.5, 2 to 2.5, 4.4 to 5. */
export const COLOR_WINDOWS: Record<"j" | "k" | "m", [number, number]> = { j: [1.0, 1.5], k: [2.0, 2.5], m: [4.4, 5.0] };
/** A window mean must have S/N >= 5 to be used (same bar as the reference comparison). */
const COLOR_MIN_SNR = 5;
/** Minimum number of comparison stars with a valid colour. */
const COLOR_MIN_STARS = 3;
/** Minimum colour difference (dex) before saying "bluer"/"redder": 0.1 dex = 26 percent in flux ratio. */
const COLOR_MIN_DEX = 0.1;

/** log10 colours relative to 1 to 1.5 um: k = log(F[2-2.5]/F[1-1.5]), m = log(F[4.4-5]/F[1-1.5]). Null if J is unusable. */
function colours(spec: Spectrum): { k: number | null; m: number | null } | null {
  const ok = (w: { mean: number; err: number } | null) => (w && w.mean > 0 && w.mean / w.err >= COLOR_MIN_SNR ? w : null);
  const j = ok(windowMean(spec, ...COLOR_WINDOWS.j));
  if (!j) return null;
  const k = ok(windowMean(spec, ...COLOR_WINDOWS.k));
  const m = ok(windowMean(spec, ...COLOR_WINDOWS.m));
  return { k: k ? Math.log10(k.mean / j.mean) : null, m: m ? Math.log10(m.mean / j.mean) : null };
}

/**
 * Colour relative to the bright stars of the same spot (no calibration guesswork, BP 8.16).
 * Uses the 4.4-5 um colour when available, else the 2-2.5 um colour. Threshold: the larger of
 * 0.1 dex and 3 x the stars' robust spread (1.4826 x MAD). Null when the target or fewer than 3
 * stars have usable windows.
 */
export function colorHint(spec: Spectrum, spotStars: Spectrum[]): "bluer" | "typical" | "redder" | null {
  const me = colours(spec);
  if (!me) return null;
  const stars = spotStars.map(colours).filter((c): c is { k: number | null; m: number | null } => c !== null);
  for (const key of ["m", "k"] as const) {
    const mine = me[key];
    if (mine === null) continue;
    const vals = stars.map((s) => s[key]).filter((v): v is number => v !== null);
    if (vals.length < COLOR_MIN_STARS) continue;
    const med = medianOf(vals);
    const spread = 1.4826 * medianOf(vals.map((v) => Math.abs(v - med))); // 1.4826: MAD -> Gaussian sigma
    const thr = Math.max(COLOR_MIN_DEX, 3 * spread);
    const d = mine - med;
    return d > thr ? "redder" : d < -thr ? "bluer" : "typical";
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Ice dips and PAH glow (BP 8.16 "Ice dips / PAH glow")
// ---------------------------------------------------------------------------------------------

export type FeatureName = "H2O" | "CO2" | "CO" | "PAH";

export interface FeatureDef {
  feature: FeatureName;
  kind: "dip" | "bump";
  /** Where the feature is measured, micron. Centres from BP 8.16; widths are ours (about one SPHEREx band each side). */
  band: [number, number];
  /** Continuum windows, micron, from BP 8.16 verbatim. */
  continuum: [[number, number], [number, number]];
}

/**
 * Feature definitions. Continuum windows: BP 8.16. PAH has no window of its own in the BP; it uses
 * the 3.0 um windows (2.6-2.8, 3.5-3.7), which bracket 3.3 um. Measurement bands must agree with
 * the "ice and dust" family of web/public/ref/molecule_bands.json (inspect.test.ts checks).
 */
export const FEATURES: FeatureDef[] = [
  { feature: "H2O", kind: "dip", band: [2.9, 3.1], continuum: [[2.6, 2.8], [3.5, 3.7]] },
  { feature: "PAH", kind: "bump", band: [3.25, 3.35], continuum: [[2.6, 2.8], [3.5, 3.7]] },
  { feature: "CO2", kind: "dip", band: [4.24, 4.3], continuum: [[4.1, 4.2], [4.35, 4.45]] },
  { feature: "CO", kind: "dip", band: [4.64, 4.7], continuum: [[4.5, 4.6], [4.75, 4.85]] },
];

/** Report threshold (BP 8.16: only >= 3 sigma). */
export const FEATURE_MIN_SIGMA = 3;

/**
 * Measure one feature: weighted straight-line continuum through both windows (at least one point
 * in each and 3 in total), then the mean residual over the feature band and its 1 sigma error
 * (measurement errors plus the continuum fit's covariance). Positive `depthSigma` = dip.
 */
export function measureFeature(spec: Spectrum, def: FeatureDef): { depthSigma: number; nBand: number; nCont: number } | null {
  const inW = (wl: number, [lo, hi]: [number, number]) => wl >= lo && wl <= hi;
  const cont: { x: number; f: number; w: number }[] = [];
  const band: { x: number; f: number; e: number }[] = [];
  let left = 0;
  let right = 0;
  for (let i = 0; i < spec.wl.length; i++) {
    const x = spec.wl[i];
    const f = spec.flux[i];
    const e = spec.err[i];
    if (!Number.isFinite(x) || !Number.isFinite(f) || !(Number.isFinite(e) && e > 0)) continue;
    if (inW(x, def.continuum[0])) {
      cont.push({ x, f, w: 1 / (e * e) });
      left++;
    } else if (inW(x, def.continuum[1])) {
      cont.push({ x, f, w: 1 / (e * e) });
      right++;
    } else if (inW(x, def.band)) band.push({ x, f, e });
  }
  if (!left || !right || cont.length < 3 || !band.length) return null;
  // Weighted least squares f = a + b x.
  let S = 0;
  let Sx = 0;
  let Sxx = 0;
  let Sy = 0;
  let Sxy = 0;
  for (const p of cont) {
    S += p.w;
    Sx += p.w * p.x;
    Sxx += p.w * p.x * p.x;
    Sy += p.w * p.f;
    Sxy += p.w * p.x * p.f;
  }
  const D = S * Sxx - Sx * Sx;
  if (!(D > 0)) return null;
  const a = (Sxx * Sy - Sx * Sxy) / D;
  const b = (S * Sxy - Sx * Sy) / D;
  const varA = Sxx / D;
  const varB = S / D;
  const covAB = -Sx / D;
  const n = band.length;
  const xm = band.reduce((s, p) => s + p.x, 0) / n;
  let resid = 0;
  let varData = 0;
  for (const p of band) {
    resid += a + b * p.x - p.f;
    varData += p.e * p.e;
  }
  resid /= n;
  const varMean = varData / (n * n) + varA + xm * xm * varB + 2 * xm * covAB;
  return { depthSigma: resid / Math.sqrt(varMean), nBand: n, nCont: cont.length };
}

/**
 * Possible ice dips (H2O 3.0, CO2 4.27, CO 4.67 um) and PAH glow (3.3 um), each only when >= 3 sigma
 * (dip below or bump above the continuum). Empty when nothing qualifies. Never an amount.
 */
export function findFeatures(spec: Spectrum): { feature: FeatureName; sigma: number }[] {
  const out: { feature: FeatureName; sigma: number }[] = [];
  for (const def of FEATURES) {
    const m = measureFeature(spec, def);
    if (!m) continue;
    const s = def.kind === "dip" ? m.depthSigma : -m.depthSigma;
    if (s >= FEATURE_MIN_SIGMA) out.push({ feature: def.feature, sigma: s });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Light curve (BP 8.16 B)
// ---------------------------------------------------------------------------------------------

/** Verdict thresholds: "too faint" when every frame is under S/N 5; "changed" at a leave-one-out residual >= 5 sigma (BP 8.16 B). */
export const LC_FAINT_SNR = 5;
export const LC_CHANGED_SIGMA = 5;
/**
 * Fractional scatter floor between frames for a steady source, our choice: frames use different
 * detectors and wavelengths (field.json `detectors`) and the 3 x 3 max samples the PSF differently,
 * so a bright steady star's S/N varies by tens of percent between frames.
 */
export const LC_FRACTIONAL_FLOOR = 0.3;

/**
 * S/N per frame at (x, y): max of the 3 x 3 pixels around the rounded position (NaN if all are
 * missing). Verdict: "faint" if no frame reaches S/N 5; otherwise, for each frame, the residual
 * from the mean of the other frames divided by max(1, their std, 0.3 x |their mean|) (1 = one
 * noise unit, since frames are in S/N). The largest residual >= 5 gives "changed" with that frame
 * (FrameMeta.i, i.e. index + 1); otherwise "steady". With fewer than 3 valid frames: "steady" is
 * not claimed and the verdict is "faint" unless a frame stands out against the other.
 */
export function lightCurveAt(
  frames: Float32Array[],
  x: number,
  y: number,
  w: number,
): { snr: number[]; verdict: "steady" | "changed" | "faint"; frame?: number; sigma?: number } {
  const h = frames.length ? Math.floor(frames[0].length / w) : 0;
  const cx = Math.round(x);
  const cy = Math.round(y);
  const snr = frames.map((f) => {
    let m = -Infinity;
    for (let j = cy - 1; j <= cy + 1; j++)
      for (let i = cx - 1; i <= cx + 1; i++) {
        if (i < 0 || j < 0 || i >= w || j >= h) continue;
        const v = f[j * w + i];
        if (Number.isFinite(v) && v > m) m = v;
      }
    return m === -Infinity ? NaN : m;
  });
  const valid = snr.map((v, i) => ({ v, i })).filter((p) => Number.isFinite(p.v));
  if (!valid.length || Math.max(...valid.map((p) => p.v)) < LC_FAINT_SNR) return { snr, verdict: "faint" };
  let best: { i: number; s: number } | null = null;
  for (const p of valid) {
    const others = valid.filter((q) => q.i !== p.i).map((q) => q.v);
    if (!others.length) continue;
    const mean = others.reduce((s, v) => s + v, 0) / others.length;
    const std = others.length > 1 ? Math.sqrt(others.reduce((s, v) => s + (v - mean) ** 2, 0) / (others.length - 1)) : 0;
    const scale = Math.max(1, std, LC_FRACTIONAL_FLOOR * Math.abs(mean));
    const s = Math.abs(p.v - mean) / scale;
    if (!best || s > best.s) best = { i: p.i, s };
  }
  if (best && best.s >= LC_CHANGED_SIGMA) return { snr, verdict: "changed", frame: best.i + 1, sigma: best.s };
  if (valid.length < 3) return { snr, verdict: "faint" };
  return { snr, verdict: "steady", sigma: best?.s };
}

// ---------------------------------------------------------------------------------------------
// Distances (BP 8.16 E)
// ---------------------------------------------------------------------------------------------

/** Light-years per parsec (IAU: 1 pc = 3.26156 ly; BP 8.16 uses 3.2616). */
export const LY_PER_PC = 3.2616;
/** Minimum parallax_over_error for a distance (BP 8.16 E.2). */
export const MIN_PLX_OVER_ERR = 5;

/** Gaia parallax distance: pc = 1000 / plx(mas). Null when plx/err < 5 or plx <= 0 ("Too far or too faint"). */
export function parallaxDistance(plxMas: number, plxOverErr: number): { pc: number; ly: number } | null {
  if (!Number.isFinite(plxMas) || !Number.isFinite(plxOverErr) || plxOverErr < MIN_PLX_OVER_ERR || plxMas <= 0) return null;
  const pc = 1000 / plxMas;
  return { pc, ly: pc * LY_PER_PC };
}

/** Planck 2018 flat LCDM as given in BP 8.16 E.3: H0 = 67.7 km/s/Mpc, Omega_m = 0.31, Omega_L = 1 - Omega_m (radiation ignored). */
export const H0 = 67.7;
export const OMEGA_M = 0.31;
/** Hubble time 1/H0 in Gyr: 977.792 / H0 (977.792 Gyr km/s/Mpc = 1 / (1 km/s/Mpc)). */
const HUBBLE_TIME_GYR = 977.792 / H0;

/**
 * Light-travel distance (Gly, numerically equal to the lookback time in Gyr) for redshift z:
 * t = (1/H0) * integral_0^z dz' / ((1+z') E(z')), E = sqrt(Om (1+z)^3 + (1 - Om)); Simpson's rule.
 * Null for z <= 0 or non-finite (blueshifts are local motions, not distances). Label "approx., from catalog redshift".
 */
export function redshiftDistance(z: number): { lightTravelGly: number } | null {
  if (!Number.isFinite(z) || z <= 0) return null;
  const f = (zz: number) => 1 / ((1 + zz) * Math.sqrt(OMEGA_M * (1 + zz) ** 3 + (1 - OMEGA_M)));
  const n = 2000; // even, Simpson's rule; integrand is smooth, error far below 1e-6 Gly
  const hh = z / n;
  let s = f(0) + f(z);
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * f(i * hh);
  return { lightTravelGly: HUBBLE_TIME_GYR * (s * hh) / 3 };
}

// ---------------------------------------------------------------------------------------------
// Where (BP 8.16 A)
// ---------------------------------------------------------------------------------------------

/** Mean obliquity of the ecliptic at J2000.0, degrees (IAU 2006: 84381.406 arcsec). */
export const OBLIQUITY_J2000_DEG = 84381.406 / 3600;
/** Ecliptic latitude hint threshold, degrees (BP 8.16 A: |beta| < 10 deg). */
export const NEAR_ECLIPTIC_DEG = 10;

/** Ecliptic latitude (degrees) of ICRS ra, dec (degrees), J2000 mean ecliptic. */
export function eclipticLatitude(ra: number, dec: number): number {
  const d2r = Math.PI / 180;
  const e = OBLIQUITY_J2000_DEG * d2r;
  const a = ra * d2r;
  const d = dec * d2r;
  const s = Math.sin(d) * Math.cos(e) - Math.cos(d) * Math.sin(e) * Math.sin(a);
  return Math.asin(Math.max(-1, Math.min(1, s))) / d2r;
}

// ---------------------------------------------------------------------------------------------
// SIMBAD object types in plain words (BP 8.16 D)
// ---------------------------------------------------------------------------------------------

/**
 * SIMBAD object-type codes (short codes, plus a few long labels SIMBAD also returns) mapped to plain
 * words. Source: SIMBAD object type list (simbad.cds.unistra.fr/guide/otypes.htx). Deliberately
 * small; anything else falls back to UNKNOWN_TYPE. A trailing "?" or "_Candidate" means a candidate.
 */
const PLAIN_TYPES: Record<string, string> = {
  "*": "Star",
  Star: "Star",
  "**": "Double star",
  "SB*": "Binary star",
  "EB*": "Eclipsing binary star",
  EclBin: "Eclipsing binary star",
  "BD*": "Brown dwarf",
  BrownD: "Brown dwarf",
  "BrownD*": "Brown dwarf",
  "LM*": "Low-mass star",
  "LowMass*": "Low-mass star",
  "WD*": "White dwarf",
  WhiteDwarf: "White dwarf",
  "PM*": "Star (fast-moving on the sky)",
  "HPM*": "Star (fast-moving on the sky)",
  "HighPM*": "Star (fast-moving on the sky)",
  "V*": "Variable star",
  "Variable*": "Variable star",
  "Ir*": "Variable star",
  "RR*": "Variable star (RR Lyrae)",
  RRLyrae: "Variable star (RR Lyrae)",
  "Ce*": "Variable star (Cepheid)",
  Cepheid: "Variable star (Cepheid)",
  "LP*": "Variable star (long period)",
  "LongPeriodV*": "Variable star (long period)",
  "Mi*": "Variable star (Mira)",
  Mira: "Variable star (Mira)",
  "Fl*": "Flare star",
  "Y*O": "Young star",
  YSO: "Young star",
  "TT*": "Young star (T Tauri)",
  "Em*": "Star with emission lines",
  "C*": "Carbon star",
  "RG*": "Red giant star",
  "No*": "Nova",
  "SN*": "Supernova",
  G: "Galaxy",
  Galaxy: "Galaxy",
  GiG: "Galaxy",
  GiC: "Galaxy",
  BiC: "Galaxy",
  EmG: "Galaxy",
  SBG: "Galaxy (starburst)",
  LSB: "Galaxy",
  rG: "Galaxy (radio)",
  AGN: "Galaxy with an active nucleus",
  Sy1: "Galaxy with an active nucleus",
  Sy2: "Galaxy with an active nucleus",
  SyG: "Galaxy with an active nucleus",
  QSO: "Quasar",
  BLL: "Quasar-like galaxy (blazar)",
  Bla: "Quasar-like galaxy (blazar)",
  GrG: "Group of galaxies",
  ClG: "Cluster of galaxies",
  "Cl*": "Star cluster",
  OpC: "Star cluster",
  GlC: "Star cluster (globular)",
  PN: "Planetary nebula",
  HII: "Glowing gas cloud",
  MoC: "Molecular cloud",
  DNe: "Dark cloud",
  RNe: "Reflection nebula",
  SNR: "Supernova remnant",
  Pl: "Planet",
  IR: "Infrared source",
  X: "X-ray source",
  Rad: "Radio source",
};

/** Plain phrase for any type we do not map: neutral, never a guess. */
export const UNKNOWN_TYPE = "Catalogued object (type not described here)";

/** SIMBAD otype -> plain words ("BD*" -> "Brown dwarf"). Candidates ("BD?", "BD*?", "..._Candidate") get "Possible ...". */
export function toPlainType(simbadOtype: string): string {
  const code = (simbadOtype ?? "").trim();
  if (!code) return UNKNOWN_TYPE;
  if (PLAIN_TYPES[code]) return PLAIN_TYPES[code];
  let base: string | null = null;
  if (code.endsWith("_Candidate")) base = code.slice(0, -"_Candidate".length);
  else if (code.endsWith("?")) base = code.slice(0, -1);
  if (base) {
    const plain = PLAIN_TYPES[base] ?? PLAIN_TYPES[`${base}*`];
    if (plain) return `Possible ${plain.charAt(0).toLowerCase()}${plain.slice(1)}`;
  }
  return UNKNOWN_TYPE;
}
