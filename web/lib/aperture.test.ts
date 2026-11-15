import { describe, expect, it } from "vitest";
import {
  apertureGeometry,
  apertureSpectrum,
  circlePixelOverlap,
  iceDips,
  measureBand,
  MJY_PER_MJY_SR_PX,
  pixelSolidAngleSr,
  sigmaClip,
} from "./aperture";
import type { SpectrumBand } from "./inspect";
import type { Spectrum } from "./types";

// Seeded uniform in [0, 1) and a Box-Muller normal, so the noisy cases are the same on every run.
function rng(seed: number) {
  let a = seed >>> 0;
  const u = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u());
}

// Error function (Abramowitz and Stegun 7.1.26, |error| < 1.5e-7), for pixel-integrated Gaussians.
function erf(x: number): number {
  const s = Math.sign(x);
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}

/** Gaussian of total `total` and width `s` px at (cx, cy), integrated over each pixel (so the truth is exact). */
function gaussPixel(x: number, y: number, cx: number, cy: number, s: number, total: number): number {
  const k = 1 / (Math.SQRT2 * s);
  const fx = (erf((x + 0.5 - cx) * k) - erf((x - 0.5 - cx) * k)) / 2;
  const fy = (erf((y + 0.5 - cy) * k) - erf((y - 0.5 - cy) * k)) / 2;
  return total * fx * fy;
}

function sumOverlap(cx: number, cy: number, r: number): number {
  let s = 0;
  for (let y = Math.floor(cy - r) - 1; y <= Math.ceil(cy + r) + 1; y++)
    for (let x = Math.floor(cx - r) - 1; x <= Math.ceil(cx + r) + 1; x++) s += circlePixelOverlap(cx, cy, r, x, y);
  return s;
}

describe("circlePixelOverlap (exact circle-square area)", () => {
  it("sums to pi r^2 for centred and off-centre circles", () => {
    expect(sumOverlap(10, 10, 2)).toBeCloseTo(4 * Math.PI, 9);
    expect(sumOverlap(10.3, 9.8, 2.7)).toBeCloseTo(Math.PI * 2.7 * 2.7, 9);
    expect(sumOverlap(5, 5, 0.5)).toBeCloseTo(Math.PI / 4, 9);
  });

  it("is 1 for a pixel fully inside, 0 far away, and pi/4 for the inscribed circle", () => {
    expect(circlePixelOverlap(10, 10, 3, 10, 10)).toBeCloseTo(1, 12);
    expect(circlePixelOverlap(10, 10, 2, 14, 10)).toBe(0);
    expect(circlePixelOverlap(10, 10, 0.5, 10, 10)).toBeCloseTo(Math.PI / 4, 9);
  });

  it("r = 2 geometry: area exactly 4 pi, annulus r+2 to r+5 by pixel centre", () => {
    const g = apertureGeometry(10, 10, 2);
    expect(g.area).toBeCloseTo(4 * Math.PI, 9);
    expect(g.rIn).toBe(4);
    expect(g.rOut).toBe(7);
    for (const p of g.ann) {
      const d = Math.hypot(p.x - 10, p.y - 10);
      expect(d).toBeGreaterThanOrEqual(4);
      expect(d).toBeLessThan(7);
    }
  });
});

describe("pixel solid angle", () => {
  it("6.15 arcsec pixel = (6.15 / 206264.8)^2 sr, so 1 MJy/sr over one pixel is about 0.889 mJy", () => {
    const rad = ((6.15 / 3600) * Math.PI) / 180;
    expect(pixelSolidAngleSr(6.15)).toBeCloseTo(rad * rad, 20);
    expect(MJY_PER_MJY_SR_PX(6.15)).toBeCloseTo(0.889, 3);
  });
});

describe("sigmaClip", () => {
  it("drops a far outlier and returns the median and std of the rest", () => {
    const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 1000];
    const c = sigmaClip(v);
    expect(c.n).toBe(9);
    expect(c.median).toBe(5);
    expect(c.std).toBeCloseTo(Math.sqrt(7.5), 9);
  });
});

describe("measureBand: aperture photometry on a synthetic cube", () => {
  const PIX = MJY_PER_MJY_SR_PX(6.15);
  const BG = 5;

  it("recovers a Gaussian source within 2 percent with the background subtracted", () => {
    const cx = 30;
    const cy = 30;
    const total = 200; // MJy/sr summed over pixels
    const s = 1.0;
    const noise = rng(7);
    const img = (x: number, y: number) => BG + 0.02 * noise() + gaussPixel(x, y, cx, cy, s, total);
    for (const r of [3, 4]) {
      const m = measureBand(img, apertureGeometry(cx, cy, r), PIX);
      expect(m).not.toBeNull();
      const truth = total * (1 - Math.exp((-r * r) / (2 * s * s))) * PIX;
      expect(Math.abs(m!.flux - truth) / truth).toBeLessThan(0.02);
      expect(m!.bg).toBeCloseTo(BG, 1);
      expect(m!.err).toBeGreaterThan(0);
    }
  });

  it("gives zero flux on pure background, within 3 sigma, with the stated error formula", () => {
    const noise = rng(11);
    const vals = new Map<string, number>();
    const img = (x: number, y: number) => {
      const k = `${x},${y}`;
      if (!vals.has(k)) vals.set(k, BG + 0.1 * noise());
      return vals.get(k)!;
    };
    const g = apertureGeometry(20, 20, 2);
    const m = measureBand(img, g, PIX)!;
    expect(Math.abs(m.flux)).toBeLessThan(3 * m.err);
    const sig = m.sigmaBg;
    const expected = Math.sqrt(g.area * sig * sig + (g.area * g.area * sig * sig * Math.PI) / 2 / m.nAnn) * PIX;
    expect(m.err).toBeCloseTo(expected, 12);
  });

  it("skips nodata pixels and renormalises the aperture area", () => {
    // 6 MJy/sr on every pixel the r = 2 aperture touches, 5 in the annulus: flux = 1 x area exactly.
    const g = apertureGeometry(20, 20, 2);
    const base = (x: number, y: number) => (Math.hypot(x - 20, y - 20) < 3.5 ? 6 : 5);
    const full = measureBand(base, g, PIX)!;
    expect(full.flux).toBeCloseTo(4 * Math.PI * PIX, 9);
    const holes = (x: number, y: number) => ((x === 21 && y === 20) || (x === 25 && y === 20) || (x === 20 && y === 15) ? NaN : base(x, y));
    const m = measureBand(holes, g, PIX)!;
    expect(m.cover).toBeLessThan(1);
    expect(m.flux).toBeCloseTo(4 * Math.PI * PIX, 9);
    expect(m.nAnn).toBe(full.nAnn - 2);
    // All aperture pixels missing: no measurement.
    expect(measureBand((x, y) => (Math.hypot(x - 20, y - 20) < 3 ? NaN : 5), g, PIX)).toBeNull();
  });
});

describe("apertureSpectrum", () => {
  const bands: SpectrumBand[] = [1.0, 2.0, 3.0].map((wl, i) => ({
    band: i + 1,
    detector: 1,
    wavelength_um: wl,
    bandwidth_um: 0.02,
    date_obs: "2025-05-12T03:11:20",
    scale: 1,
    offset: 0,
    noise: 0.1,
  }));

  it("returns one mJy point per band with data, and drops a band with no data", () => {
    const get = (b: number, x: number, y: number) => (b === 1 ? NaN : (Math.hypot(x - 20, y - 20) < 3.5 ? 6 + b : 5));
    const s = apertureSpectrum(get, bands, 20, 20, 2, 6.15)!;
    expect(s.units).toBe("mJy");
    expect(s.wl).toEqual([1.0, 3.0]);
    expect(s.flux[0]).toBeCloseTo(1 * 4 * Math.PI * MJY_PER_MJY_SR_PX(6.15), 9);
    expect(s.flux[1]).toBeCloseTo(3 * 4 * Math.PI * MJY_PER_MJY_SR_PX(6.15), 9);
    expect(s.band).toEqual([1, 3]);
  });
});

// SPHEREx-like grid: 6 detectors x 17 bands over 0.75 to 5 um.
const EDGES: [number, number][] = [
  [0.75, 1.09],
  [1.1, 1.62],
  [1.63, 2.41],
  [2.42, 3.82],
  [3.83, 4.41],
  [4.42, 5.0],
];
const WL = EDGES.flatMap(([lo, hi]) => Array.from({ length: 17 }, (_, i) => lo + ((hi - lo) * i) / 16));

function synth(tau: (wl: number) => number, seed: number): Spectrum {
  const n = rng(seed);
  const flux: number[] = [];
  const err: number[] = [];
  for (const wl of WL) {
    const f = 50 * Math.pow(wl, -1.2) * Math.exp(-tau(wl));
    const e = 0.01 * 50 * Math.pow(wl, -1.2);
    flux.push(f + e * n());
    err.push(e);
  }
  return { wl: WL, flux, err };
}

describe("iceDips: continuum fit and optical depth", () => {
  const h2o = (wl: number) => 0.3 * Math.exp(-0.5 * ((wl - 3.0) / 0.12) ** 2);

  it("recovers an injected 3.0 um water-ice dip and reports it above 3 sigma", () => {
    const spec = synth(h2o, 3);
    const r = iceDips(spec);
    expect(r.continuum).not.toBeNull();
    const d = r.dips.find((x) => x.feature === "H2O")!;
    // Truth: -ln of the mean dimmed flux over the mean undimmed flux in the 2.9-3.1 um band.
    const inB = WL.filter((w) => w >= 2.9 && w <= 3.1);
    const c = inB.map((w) => 50 * Math.pow(w, -1.2));
    const f = inB.map((w, i) => c[i] * Math.exp(-h2o(w)));
    const truth = -Math.log(f.reduce((a, b) => a + b, 0) / c.reduce((a, b) => a + b, 0));
    expect(d.tau).not.toBeNull();
    expect(Math.abs(d.tau! - truth)).toBeLessThan(0.05);
    expect(d.sigma).toBeGreaterThanOrEqual(3);
    expect(d.detected).toBe(true);
    for (const o of r.dips.filter((x) => x.feature !== "H2O")) expect(o.detected).toBe(false);
  });

  it("finds no dip on a smooth spectrum", () => {
    for (const seed of [1, 2, 5]) {
      const r = iceDips(synth(() => 0, seed));
      expect(r.continuum).not.toBeNull();
      expect(r.dips.some((d) => d.detected)).toBe(false);
    }
  });

  it("does not call a single low band a dip (an ice band spans several SPHEREx bands)", () => {
    // Seen on a real Cygnus star: one band at 2.98 um 30 percent low, its neighbours on the continuum.
    const spec = synth(() => 0, 6);
    const i = WL.findIndex((w) => w >= 2.9 && w <= 3.1);
    const flux = spec.flux.map((f, j) => (j === i ? 0.7 * f : f));
    const d = iceDips({ ...spec, flux }).dips.find((x) => x.feature === "H2O")!;
    expect(d.detected).toBe(false);
  });

  it("a single spiked continuum band does not drag the continuum (sigma-clipped fit)", () => {
    // Seen on a real Hektor-field star: one band at 4.18 um 100 x its neighbours.
    const spec = synth(h2o, 8);
    const i = WL.findIndex((w) => w > 4.1 && w < 4.18);
    const flux = spec.flux.map((f, j) => (j === i ? 100 * f : f));
    const r = iceDips({ ...spec, flux });
    expect(r.dips.find((x) => x.feature === "H2O")!.detected).toBe(true);
    for (const o of r.dips.filter((x) => x.feature !== "H2O")) expect(o.detected).toBe(false);
  });

  it("a negative or implausibly deep single band is a bad band, not CO ice", () => {
    // Seen on a real Cygnus star: one band at 4.67 um at -0.11 of the continuum, neighbours at 0.95.
    const spec = synth(() => 0, 9);
    const i = WL.findIndex((w) => w >= 4.64 && w <= 4.7);
    for (const scale of [-0.1, 0.1]) {
      const flux = spec.flux.map((f, j) => (j === i ? scale * f : f));
      expect(iceDips({ ...spec, flux }).dips.find((x) => x.feature === "CO")!.detected).toBe(false);
    }
  });

  it("gives no continuum when the source is too faint", () => {
    const spec = synth(() => 0, 4);
    const faint = { ...spec, flux: spec.flux.map((f, i) => f - 50 * Math.pow(WL[i], -1.2)) };
    const r = iceDips(faint);
    expect(r.continuum).toBeNull();
    expect(r.dips).toEqual([]);
  });
});
