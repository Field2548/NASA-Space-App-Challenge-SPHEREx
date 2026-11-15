// Circle spectrum for Inspect section C: aperture photometry of the cube in every band, then an
// ice-free continuum and the optical depth of each ice dip (H2O 3.0, CO2 4.27, CO 4.67 um).
// Pure functions plus one loader that fetches only the tiles the background annulus touches.

import { FIELDS_BASE } from "./fields";
import { FEATURES, FEATURE_MIN_SIGMA, loadSpectrumIndex, loadSpectrumTile, tileValue, type FeatureName, type SpectrumBand } from "./inspect";
import { PIXEL_ARCSEC } from "./marks";
import { scatterInflation } from "./spectra";
import type { Field, Spectrum } from "./types";

// ---------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------

/** Radius control range and default, in pixels (6.15 arcsec each). */
export const RADIUS_MIN = 1;
export const RADIUS_MAX = 6;
export const RADIUS_DEFAULT = 2;
/** Background annulus: r + 2 to r + 5 px, so the source's PSF wings (FWHM about 1.5 px) stay out of it. */
export const ANNULUS_GAP = 2;
export const ANNULUS_WIDTH = 3;
/** A band needs this share of the aperture area with data, and this many annulus pixels after clipping. */
const MIN_COVER = 0.5;
const MIN_ANNULUS = 8;

/** Integral of sqrt(r^2 - x^2) dx (the upper half of a circle). */
function halfDisc(x: number, r: number): number {
  const c = Math.max(-r, Math.min(r, x));
  return 0.5 * (c * Math.sqrt(Math.max(0, r * r - c * c)) + r * r * Math.asin(c / r));
}

/**
 * Exact area of the circle (cx, cy, r) inside pixel (px, py), which spans px - 0.5 .. px + 0.5
 * (photutils "exact" mode). Integrates the clipped chord length over x in closed form: between the
 * break points where the circle crosses the pixel's top or bottom edge, each bound is either a pixel
 * edge or the circle, so every piece is a constant or the half-disc integral.
 */
export function circlePixelOverlap(cx: number, cy: number, r: number, px: number, py: number): number {
  const x0 = px - 0.5 - cx;
  const x1 = px + 0.5 - cx;
  const y0 = py - 0.5 - cy;
  const y1 = py + 0.5 - cy;
  const a = Math.max(x0, -r);
  const b = Math.min(x1, r);
  if (!(b > a) || y0 >= r || y1 <= -r) return 0;
  const cuts = [a, b];
  for (const y of [y0, y1])
    if (Math.abs(y) < r) {
      const s = Math.sqrt(r * r - y * y);
      for (const c of [-s, s]) if (c > a && c < b) cuts.push(c);
    }
  cuts.sort((p, q) => p - q);
  let area = 0;
  for (let i = 0; i + 1 < cuts.length; i++) {
    const u = cuts[i];
    const v = cuts[i + 1];
    if (!(v > u)) continue;
    const m = (u + v) / 2;
    const h = Math.sqrt(Math.max(0, r * r - m * m));
    const upCircle = y1 >= h;
    const loCircle = y0 <= -h;
    if ((upCircle ? h : y1) <= (loCircle ? -h : y0)) continue; // the chord misses the pixel here
    const disc = halfDisc(v, r) - halfDisc(u, r);
    area += (upCircle ? disc : y1 * (v - u)) - (loCircle ? -disc : y0 * (v - u));
  }
  return area;
}

export interface ApertureGeometry {
  cx: number;
  cy: number;
  r: number;
  rIn: number;
  rOut: number;
  /** Full aperture area, pixels (pi r^2 up to rounding). */
  area: number;
  /** Pixels the circle touches, with their exact overlap area as weight. */
  ap: { x: number; y: number; w: number }[];
  /** Annulus pixels (centre at distance rIn <= d < rOut, the usual "center" rule for a median). */
  ann: { x: number; y: number }[];
}

export function apertureGeometry(cx: number, cy: number, r: number): ApertureGeometry {
  const rIn = r + ANNULUS_GAP;
  const rOut = r + ANNULUS_GAP + ANNULUS_WIDTH;
  const ap: ApertureGeometry["ap"] = [];
  const ann: ApertureGeometry["ann"] = [];
  let area = 0;
  for (let y = Math.floor(cy - rOut); y <= Math.ceil(cy + rOut); y++)
    for (let x = Math.floor(cx - rOut); x <= Math.ceil(cx + rOut); x++) {
      const w = circlePixelOverlap(cx, cy, r, x, y);
      if (w > 0) {
        ap.push({ x, y, w });
        area += w;
      }
      const d = Math.hypot(x - cx, y - cy);
      if (d >= rIn && d < rOut) ann.push({ x, y });
    }
  return { cx, cy, r, rIn, rOut, area, ap, ann };
}

/** Solid angle of a square pixel of side `arcsec`, steradian. */
export function pixelSolidAngleSr(arcsec: number): number {
  const rad = ((arcsec / 3600) * Math.PI) / 180;
  return rad * rad;
}

/** mJy from 1 MJy/sr over one pixel: 1 MJy = 1e9 mJy times the pixel solid angle (0.889 for 6.15 arcsec). */
export function MJY_PER_MJY_SR_PX(arcsec: number): number {
  return 1e9 * pixelSolidAngleSr(arcsec);
}

// ---------------------------------------------------------------------------------------------
// Photometry
// ---------------------------------------------------------------------------------------------

function median(sorted: number[]): number {
  const m = sorted.length >> 1;
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

/** Sigma-clipped median and sample std (astropy sigma_clip defaults: 3 sigma about the median, 5 rounds). */
export function sigmaClip(values: number[], k = 3, iters = 5): { median: number; std: number; n: number } {
  let v = values.filter(Number.isFinite).sort((p, q) => p - q);
  let med = NaN;
  let std = NaN;
  for (let it = 0; it <= iters && v.length; it++) {
    med = median(v);
    const mean = v.reduce((s, x) => s + x, 0) / v.length;
    std = v.length > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / (v.length - 1)) : 0;
    const kept = v.filter((x) => Math.abs(x - med) <= k * std);
    if (kept.length === v.length) break;
    v = kept;
  }
  return { median: med, std, n: v.length };
}

export interface BandPhotometry {
  /** Background-subtracted flux, mJy. */
  flux: number;
  /** 1 sigma, mJy. */
  err: number;
  /** Background per pixel, MJy/sr (clipped annulus median). */
  bg: number;
  sigmaBg: number;
  nAnn: number;
  /** Share of the aperture area with data. */
  cover: number;
}

/**
 * Aperture photometry of one band. `get(x, y)` is MJy/sr or NaN for no data.
 *   F = (sum w_i v_i) * A / A_valid - bg * A, then times mJy per MJy/sr per pixel.
 * w_i is the exact overlap, A the full circle area, A_valid the area of pixels with data (a hole is
 * filled with the mean surface brightness of the rest of the circle). bg and sigma_bg are the
 * sigma-clipped median and std of the annulus. Error (background-limited, no source shot noise:
 * the cube carries no gain):
 *   sigma_F^2 = A sigma_bg^2 + A^2 sigma_bg^2 (pi / 2) / N_ann,
 * the second term being the variance of a median of N_ann pixels. Null when under half the circle
 * has data or fewer than 8 annulus pixels survive.
 */
export function measureBand(get: (x: number, y: number) => number, g: ApertureGeometry, mjyPerPx: number): BandPhotometry | null {
  let sw = 0;
  let swv = 0;
  for (const p of g.ap) {
    const v = get(p.x, p.y);
    if (!Number.isFinite(v)) continue;
    sw += p.w;
    swv += p.w * v;
  }
  const cover = sw / g.area;
  if (!(cover >= MIN_COVER)) return null;
  const clip = sigmaClip(g.ann.map((p) => get(p.x, p.y)));
  if (clip.n < MIN_ANNULUS) return null;
  const A = g.area;
  const s2 = clip.std * clip.std;
  const flux = ((swv * A) / sw - clip.median * A) * mjyPerPx;
  const err = Math.sqrt(A * s2 + (A * A * s2 * Math.PI) / 2 / clip.n) * mjyPerPx;
  return { flux, err, bg: clip.median, sigmaBg: clip.std, nAnn: clip.n, cover };
}

/** Circle spectrum in mJy; `band`, `det`, `dateObs`, `bg` follow the kept bands. */
export interface ApertureSpectrum extends Spectrum {
  det: number[];
  band: number[];
  dateObs: string[];
  bg: number[];
  units: "mJy";
  r: number;
  rIn: number;
  rOut: number;
}

/** Aperture photometry in every band. `get(b, x, y)` is MJy/sr or NaN. Null when no band has data. */
export function apertureSpectrum(
  get: (b: number, x: number, y: number) => number,
  bands: SpectrumBand[],
  cx: number,
  cy: number,
  r: number,
  pixelArcsec: number,
): ApertureSpectrum | null {
  const g = apertureGeometry(cx, cy, r);
  const k = MJY_PER_MJY_SR_PX(pixelArcsec);
  const out: ApertureSpectrum = { wl: [], flux: [], err: [], det: [], band: [], dateObs: [], bg: [], units: "mJy", r, rIn: g.rIn, rOut: g.rOut };
  bands.forEach((bd, b) => {
    const m = measureBand((x, y) => get(b, x, y), g, k);
    if (!m) return;
    out.wl.push(bd.wavelength_um);
    out.flux.push(m.flux);
    out.err.push(m.err);
    out.det.push(bd.detector);
    out.band.push(bd.band);
    out.dateObs.push(bd.date_obs);
    out.bg.push(m.bg);
  });
  return out.wl.length ? out : null;
}

/**
 * Circle spectrum of the cube centred on pixel (x, y), radius r px. Fetches only the tiles under
 * the annulus box. Null ("No spectrum here") when the spot has no cube, the circle is not fully
 * inside `covered`, or no band has data. Annulus pixels outside `covered` count as no data.
 */
export async function loadApertureSpectrum(
  field: Field,
  x: number,
  y: number,
  r: number,
  fetcher: typeof fetch = fetch,
  base = FIELDS_BASE,
): Promise<ApertureSpectrum | null> {
  if (!field.has?.spectrum) return null;
  const cx = Math.round(x);
  const cy = Math.round(y);
  const idx = await loadSpectrumIndex(field, fetcher, base);
  const [ox, oy] = idx.origin;
  const [cw, ch] = idx.covered;
  if (cx - r < ox - 0.5 || cy - r < oy - 0.5 || cx + r > ox + cw - 0.5 || cy + r > oy + ch - 0.5) return null;
  const rOut = r + ANNULUS_GAP + ANNULUS_WIDTH;
  const t = idx.tile;
  const lo = (v: number, o: number) => Math.floor((Math.max(o, Math.floor(v - rOut)) - o) / t);
  const hi = (v: number, o: number, n: number) => Math.floor((Math.min(o + n - 1, Math.ceil(v + rOut)) - o) / t);
  const tiles = new Map<string, Uint16Array>();
  const jobs: Promise<void>[] = [];
  for (let ty = lo(cy, oy); ty <= hi(cy, oy, ch); ty++)
    for (let tx = lo(cx, ox); tx <= hi(cx, ox, cw); tx++)
      jobs.push(loadSpectrumTile(field, idx, tx, ty, fetcher, base).then((tile) => void tiles.set(`${tx},${ty}`, tile)));
  await Promise.all(jobs);
  const get = (b: number, px: number, py: number) => {
    const dx = px - ox;
    const dy = py - oy;
    if (dx < 0 || dy < 0 || dx >= cw || dy >= ch) return NaN;
    const tile = tiles.get(`${Math.floor(dx / t)},${Math.floor(dy / t)}`);
    return tile ? tileValue(tile, idx, b, px, py) : NaN;
  };
  return apertureSpectrum(get, idx.bands, cx, cy, r, field.pixel_arcsec || PIXEL_ARCSEC);
}

// ---------------------------------------------------------------------------------------------
// Continuum and ice dips
// ---------------------------------------------------------------------------------------------

/** Continuum fit range, micron: the ice region, wide enough for points on both sides of each dip. */
export const CONTINUUM_RANGE: [number, number] = [2.4, 5.0];
/**
 * Left out of the continuum fit, micron: the broad H2O ice band with its long red wing (where
 * CH3OH 3.53 um and the 3.3 um PAH also sit), CO2 4.27 and CO 4.67 um, each about one band wider
 * than the measurement band of FEATURES.
 */
export const ICE_WINDOWS: [number, number][] = [
  [2.8, 3.6],
  [4.18, 4.36],
  [4.6, 4.74],
];
/** Ice bands wider than one SPHEREx band, which must show in more than one band. */
const BROAD_DIPS = new Set<FeatureName>(["H2O"]);
/** Largest believable optical depth of a dip narrower than one band (CO2, CO), see iceDips. */
const NARROW_TAU_MAX = 1;
/** Continuum points must lie within this distance of a dip band on each side, micron. */
const BRACKET_UM = 0.3;
/** Degree of the continuum polynomial in ln(flux) against wavelength. */
const CONT_DEGREE = 2;
/** A continuum point needs S/N >= 3 (ln of a noisy, possibly negative flux is meaningless). */
const CONT_MIN_SNR = 3;
const CONT_MIN_POINTS = 6;
/** Centre of the fit variable, so the normal equations stay well conditioned. */
const WL_PIVOT = 3.7;

export interface IceDip {
  feature: FeatureName;
  /** Optical depth -ln(F / F_cont) over the feature band; null when the band flux is not positive. */
  tau: number | null;
  tauErr: number | null;
  /** Depth (F_cont - F) in sigma, after the error inflation below. */
  sigma: number;
  detected: boolean;
}

export interface IceResult {
  /** The fitted continuum on a fine grid (mJy), the chart's model curve; null when too faint to fit. */
  continuum: { wl: number[]; value: number[] } | null;
  dips: IceDip[];
  /** Error inflation used: the larger of the band-to-band scatter and sqrt(reduced chi^2) of the fit. */
  inflation: number;
}

function invert3(m: number[][]): number[][] | null {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!(Math.abs(det) > 0)) return null;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

/**
 * Ice continuum and dips. Fits ln F = c0 + c1 t + c2 t^2 (t = wl - 3.7) by weighted least squares
 * over 2.4 to 5 um outside ICE_WINDOWS, on points with S/N >= 3, weight (F / err)^2 (the variance of
 * ln F), clipping points beyond 3 x the robust spread of the residuals. For each dip of FEATURES
 * (H2O, CO2, CO), over its measurement band:
 *   depth D = mean(F_cont - F), var(D) = sum err^2 / n^2 + g' C g (C the fit covariance),
 *   sigma = D / (k sqrt(var D)), tau = -ln(mean F / mean F_cont),
 * where k = max(1, scatterInflation, sqrt(chi^2 / dof)): on real stars the cube's sky-noise errors
 * alone gave "features" at hundreds of sigma (see findFeatures). A dip needs a kept continuum point
 * within 0.3 um on each side and sigma >= FEATURE_MIN_SIGMA to count as detected. The broad H2O band
 * also needs 2 bands and the bar met with every single band left out in turn (on a real Cygnus star
 * one low band at 2.98 um alone gave 5 sigma); CO2 and CO need 0 < tau <= 1.
 */
export function iceDips(spec: Spectrum): IceResult {
  const pts: { t: number; y: number; w: number; e: number }[] = [];
  for (let i = 0; i < spec.wl.length; i++) {
    const wl = spec.wl[i];
    const f = spec.flux[i];
    const e = spec.err[i];
    if (!(wl >= CONTINUUM_RANGE[0] && wl <= CONTINUUM_RANGE[1]) || ICE_WINDOWS.some(([lo, hi]) => wl >= lo && wl <= hi)) continue;
    if (!Number.isFinite(f) || !(e > 0) || f / e < CONT_MIN_SNR) continue;
    pts.push({ t: wl - WL_PIVOT, y: Math.log(f), w: 0, e });
  }
  // Weights (F / err)^2 from the median of each point and its neighbours, not the point itself, so
  // one spiked band does not also get a huge weight; after each fit they come from the model.
  pts.sort((p, q) => p.t - q.t);
  pts.forEach((p, i) => {
    const near = pts.slice(Math.max(0, i - 1), i + 2).map((q) => Math.exp(q.y)).sort((a, b) => a - b);
    p.w = (median(near) / p.e) ** 2;
  });
  const N = CONT_DEGREE + 1;
  const fit = (use: typeof pts) => {
    const M = Array.from({ length: N }, () => new Array<number>(N).fill(0));
    const v = new Array<number>(N).fill(0);
    for (const p of use)
      for (let j = 0; j < N; j++) {
        v[j] += p.w * p.y * p.t ** j;
        for (let l = 0; l < N; l++) M[j][l] += p.w * p.t ** (j + l);
      }
    const C = invert3(M);
    if (!C) return null;
    const c = C.map((row) => row.reduce((s, x, l) => s + x * v[l], 0));
    return { C, at: (t: number) => c.reduce((s, x, j) => s + x * t ** j, 0) };
  };
  // Sigma-clipped fit: single bad bands (a 100 x spike was seen on a real star) would otherwise
  // pull the continuum far off. Clip at 3 x the robust spread of the normalised residuals.
  let kept = pts;
  let model = kept.length >= CONT_MIN_POINTS ? fit(kept) : null;
  for (let it = 0; it < 5 && model; it++) {
    const m = model;
    const z = kept.map((p) => (p.y - m.at(p.t)) * Math.sqrt(p.w));
    const s = Math.max(1, 1.4826 * median(z.map(Math.abs).sort((a, b) => a - b))); // 1.4826: MAD -> sigma
    const next = kept.filter((_, i) => Math.abs(z[i]) <= 3 * s).map((p) => ({ ...p, w: (Math.exp(m.at(p.t)) / p.e) ** 2 }));
    if (next.length < CONT_MIN_POINTS) break;
    const done = next.length === kept.length;
    kept = next;
    model = fit(kept) ?? m;
    if (done) break;
  }
  if (!model) return { continuum: null, dips: [], inflation: 1 };
  const { C, at } = model;
  const lnCont = (wl: number) => at(wl - WL_PIVOT);
  const chi2 = kept.reduce((s, p) => s + p.w * (p.y - at(p.t)) ** 2, 0);
  const k = Math.max(1, scatterInflation(spec), Math.sqrt(chi2 / (kept.length - N)));

  const dips: IceDip[] = [];
  for (const def of FEATURES) {
    if (def.kind !== "dip") continue;
    const [lo, hi] = def.band;
    // Continuum on both sides within BRACKET_UM of the left-out window, so the depth is never an extrapolation.
    const [wlo, whi] = ICE_WINDOWS.find(([a, b]) => a <= lo && b >= hi) ?? def.band;
    const wls = kept.map((p) => p.t + WL_PIVOT);
    if (!wls.some((w) => w < wlo && w >= wlo - BRACKET_UM) || !wls.some((w) => w > whi && w <= whi + BRACKET_UM)) continue;
    const inBand: { wl: number; f: number; e: number }[] = [];
    for (let i = 0; i < spec.wl.length; i++) {
      const wl = spec.wl[i];
      const f = spec.flux[i];
      const e = spec.err[i];
      if (wl >= lo && wl <= hi && Number.isFinite(f) && e > 0) inBand.push({ wl, f, e });
    }
    if (!inBand.length) continue;
    const depth = (use: typeof inBand) => {
      const n = use.length;
      let sf = 0;
      let sc = 0;
      let ve = 0;
      const g = new Array<number>(N).fill(0);
      for (const p of use) {
        const fc = Math.exp(lnCont(p.wl));
        sf += p.f;
        sc += fc;
        ve += p.e * p.e;
        for (let j = 0; j < N; j++) g[j] += (fc * (p.wl - WL_PIVOT) ** j) / n; // d mean(F_cont) / d c_j
      }
      const varCont = g.reduce((s, x, j) => s + x * g.reduce((t, y, l) => t + C[j][l] * y, 0), 0);
      const fm = sf / n;
      const cm = sc / n;
      const varF = ve / (n * n);
      return { fm, cm, varF, varCont, sigma: (cm - fm) / (k * Math.sqrt(varF + varCont)) };
    };
    const all = depth(inBand);
    // Leave-one-out for the broad water band (about 0.3 um wide, several SPHEREx bands): the dip must
    // stay above the bar with any single band removed, so a lone low band is not a dip. CO2 and CO
    // are narrower than one band at R ~ 110, so a single band is all they can show.
    // A narrow band can only show in one band, so there the guard is physical: an unresolved CO2 or
    // CO dip cannot reach tau > 1 at this resolution, and a deeper or negative band is a bad band.
    const robust = BROAD_DIPS.has(def.feature)
      ? inBand.length >= 2 && inBand.every((_, i) => depth(inBand.filter((__, j) => j !== i)).sigma >= FEATURE_MIN_SIGMA)
      : all.fm > 0 && -Math.log(all.fm / all.cm) <= NARROW_TAU_MAX;
    const tau = all.fm > 0 ? -Math.log(all.fm / all.cm) : null;
    const tauErr = all.fm > 0 ? k * Math.sqrt(all.varF / (all.fm * all.fm) + all.varCont / (all.cm * all.cm)) : null;
    dips.push({ feature: def.feature, tau, tauErr, sigma: all.sigma, detected: all.sigma >= FEATURE_MIN_SIGMA && robust });
  }
  const wl: number[] = [];
  for (let x = CONTINUUM_RANGE[0]; x <= CONTINUUM_RANGE[1] + 1e-9; x += 0.02) wl.push(x);
  return { continuum: { wl, value: wl.map((x) => Math.exp(lnCont(x))) }, dips, inflation: k };
}
