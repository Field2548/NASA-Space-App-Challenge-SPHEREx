// Gnomonic (TAN) sky <-> pixel for a spot (field-schema.md section 1).
// Pixels are 0-based, rows top-down; crpix stays 1-based bottom-up as in FITS.

import type { FieldWcs } from "./types";

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** Top-down 0-based reference pixel. */
function refPixel(wcs: FieldWcs, height: number): [number, number] {
  return [wcs.crpix[0] - 1, height - wcs.crpix[1]];
}

/** Pixel (x, y) on the top-down grid of height H -> ICRS [ra, dec] degrees. */
export function pixelToSky(wcs: FieldWcs, height: number, x: number, y: number): [number, number] {
  const [x0, y0] = refPixel(wcs, height);
  const xi = (x - x0) * wcs.cdelt[0] * D2R;
  const eta = -(y - y0) * wcs.cdelt[1] * D2R;
  const ra0 = wcs.crval[0] * D2R;
  const dec0 = wcs.crval[1] * D2R;
  const denom = Math.cos(dec0) - eta * Math.sin(dec0);
  const ra = ra0 + Math.atan2(xi, denom);
  const dec = Math.atan2(Math.sin(dec0) + eta * Math.cos(dec0), Math.hypot(xi, denom));
  return [(((ra * R2D) % 360) + 360) % 360, dec * R2D];
}

/** ICRS [ra, dec] degrees -> pixel [x, y] on the top-down grid, or null if on the far hemisphere. */
export function skyToPixel(wcs: FieldWcs, height: number, ra: number, dec: number): [number, number] | null {
  const [x0, y0] = refPixel(wcs, height);
  const ra0 = wcs.crval[0] * D2R;
  const dec0 = wcs.crval[1] * D2R;
  const a = ra * D2R - ra0;
  const d = dec * D2R;
  const cosc = Math.sin(dec0) * Math.sin(d) + Math.cos(dec0) * Math.cos(d) * Math.cos(a);
  if (cosc <= 0) return null;
  const xi = (Math.cos(d) * Math.sin(a)) / cosc;
  const eta = (Math.cos(dec0) * Math.sin(d) - Math.sin(dec0) * Math.cos(d) * Math.cos(a)) / cosc;
  return [x0 + (xi * R2D) / wcs.cdelt[0], y0 - (eta * R2D) / wcs.cdelt[1]];
}
