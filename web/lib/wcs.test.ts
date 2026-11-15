import { describe, expect, it } from "vitest";
import type { FieldWcs } from "./types";
import { pixelToSky, skyToPixel } from "./wcs";

const wcsOf = (ra: number, dec: number, crpix: number): FieldWcs => ({
  ctype: ["RA---TAN", "DEC--TAN"],
  crval: [ra, dec],
  crpix: [crpix, crpix],
  cdelt: [-0.0017083, 0.0017083],
  rows: "top-down",
});

// [crval ra, crval dec, crpix, H, x, y, ra, dec] from astropy WCS.all_pix2world on FITS pixel (x+1, H-y).
const ASTROPY = [
  [150.0, 2.0, 16, 32, 0, 0, 150.02564054469852, 2.027332595092143],
  [150.0, 2.0, 16, 32, 5.5, 20.25, 150.0162386699119, 1.9927396450690857],
  [150.0, 2.0, 16, 32, 31, 31, 149.9726509686532, 1.9743752769611222],
  [13.2004, 14.38, 60, 119, 0, 0, 13.304496416568849, 14.480766701371577],
  [13.2004, 14.38, 60, 119, 5.5, 20.25, 13.29477791595965, 14.446177817319425],
  [13.2004, 14.38, 60, 119, 118, 118, 13.096397437686615, 14.279187841689662],
  [26.3271, -89.0, 60, 119, 0, 0, 31.55889990082028, -88.89460640672476],
  [26.3271, -89.0, 60, 119, 5.5, 20.25, 31.226778426199047, -88.92989390094095],
  [26.3271, -89.0, 60, 119, 118, 118, 19.93143727135717, -89.09515911466285],
] as const;

describe("wcs", () => {
  it.each(ASTROPY)("matches astropy: crval (%s, %s) crpix %s H %s pixel (%s, %s)", (cra, cdec, cp, H, x, y, ra, dec) => {
    const w = wcsOf(cra, cdec, cp);
    const [r, d] = pixelToSky(w, H, x, y);
    expect(Math.abs(r - ra) * Math.cos(dec * (Math.PI / 180)) * 3600).toBeLessThan(1e-6);
    expect(Math.abs(d - dec) * 3600).toBeLessThan(1e-6);
    const p = skyToPixel(w, H, ra, dec);
    expect(p).not.toBeNull();
    expect(Math.abs(p![0] - x)).toBeLessThan(1e-6);
    expect(Math.abs(p![1] - y)).toBeLessThan(1e-6);
  });

  it("reference pixel is (crpix0-1, H-crpix1) and maps to crval", () => {
    expect(pixelToSky(wcsOf(150, 2, 16), 32, 15, 16)).toEqual([150, 2]);
    const [x, y] = skyToPixel(wcsOf(13.2004, 14.38, 60), 119, 13.2004, 14.38)!;
    expect([x, y]).toEqual([59, 59]);
  });

  it("north is up and east is left", () => {
    const w = wcsOf(150, 2, 16);
    const [, decTop] = pixelToSky(w, 32, 15, 0);
    const [raLeft] = pixelToSky(w, 32, 0, 16);
    expect(decTop).toBeGreaterThan(2);
    expect(raLeft).toBeGreaterThan(150);
  });

  it("wraps RA across 0 and rejects the far hemisphere", () => {
    const w = wcsOf(0.01, 0, 60);
    const [ra] = pixelToSky(w, 119, 118, 59);
    expect(ra).toBeGreaterThan(359);
    const p = skyToPixel(w, 119, ra, 0);
    expect(Math.abs(p![0] - 118)).toBeLessThan(1e-6);
    expect(skyToPixel(w, 119, 180, 0)).toBeNull();
  });
});
