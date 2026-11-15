// Patch identity: any point picked on the sky map becomes one playable patch (client and server).
//
// A point snaps to its HEALPix order-11 NESTED cell (about 1.7 arcmin). The patch id is
// `p11-<ipix>`, its centre is that cell's centre, and its picture is the quick-look grid
// (41 x 41 px of 6.15 arcsec, north up, east left) centred there. The same point always gives the
// same patch, and the server rebuilds the whole geometry from the id alone, never from a client WCS.
// The 41 px grid (4.2 arcmin) is larger than the cell, so neighbouring patches overlap.

import { cellCenter, hpxNest } from "./healpix";
import { DEFAULT_GRID_PX, PIXEL_ARCSEC, quickLookWcs } from "./quicklook";
import type { FieldWcs } from "./types";
import { pixelToSky } from "./wcs";

export const PATCH_ORDER = 11;
export const PATCH_GRID_PX = DEFAULT_GRID_PX;
export const PATCH_SIZE_DEG = (PATCH_GRID_PX * PIXEL_ARCSEC) / 3600;
const NPIX = 12 * 4 ** PATCH_ORDER;
const ID = /^p11-(\d{1,8})$/;

export interface Patch {
  id: string;
  ipix: number;
  /** Centre of the HEALPix cell, degrees. */
  ra: number;
  dec: number;
  /** Picture size in pixels, [W, H]. */
  size: [number, number];
  size_deg: number;
  wcs: FieldWcs;
  /** The picture's outer corners [ra, dec]: top-left, top-right, bottom-right, bottom-left. */
  corners: [number, number][];
}

function build(ipix: number): Patch {
  const [ra, dec] = cellCenter(ipix, PATCH_ORDER);
  const n = PATCH_GRID_PX;
  const wcs = quickLookWcs(ra, dec, n);
  const e = n - 0.5;
  const corners = ([[-0.5, -0.5], [e, -0.5], [e, e], [-0.5, e]] as const).map(([x, y]) => pixelToSky(wcs, n, x, y));
  return { id: `p11-${ipix}`, ipix, ra, dec, size: [n, n], size_deg: PATCH_SIZE_DEG, wcs, corners };
}

/** The patch a sky point falls in. Throws RangeError for a non-finite ra or a dec outside -90..90. */
export function patchFromPoint(ra: number, dec: number): Patch {
  return build(hpxNest(ra, dec, PATCH_ORDER));
}

/** The patch for an id, or null when the id is not a valid `p11-<ipix>`. */
export function patchFromId(id: string): Patch | null {
  const m = ID.exec(id);
  if (!m) return null;
  const ipix = Number(m[1]);
  return ipix < NPIX ? build(ipix) : null;
}

/** Read a /play address: `patch=p11-N` wins, else `ra` and `dec` in degrees. Null when neither is usable. */
export function patchFromParams(p: { patch?: unknown; ra?: unknown; dec?: unknown }): Patch | null {
  if (typeof p.patch === "string" && p.patch) return patchFromId(p.patch);
  if (typeof p.ra !== "string" || typeof p.dec !== "string" || !p.ra.trim() || !p.dec.trim()) return null;
  const ra = Number(p.ra);
  const dec = Number(p.dec);
  if (!Number.isFinite(ra) || !Number.isFinite(dec) || dec < -90 || dec > 90) return null;
  return patchFromPoint(ra, dec);
}

/** A random patch anywhere on the sky (uniform on the sphere). */
export function randomPatch(rand: () => number = Math.random): Patch {
  const ra = rand() * 360;
  const dec = (Math.asin(2 * rand() - 1) * 180) / Math.PI;
  return patchFromPoint(ra, dec);
}
