// A still picture of any patch from IRSA's SPHEREx all-sky HiPS (client and server).
// Shown at once while the live frames load, and alone when IRSA has no exposures there.
// The HiPS is cut into HEALPix tiles: order 5, 512 x 512 px, so one HiPS pixel is an order-14
// NESTED cell (about 12.9 arcsec, twice a SPHEREx pixel). Each grid pixel takes the HiPS pixel
// its centre falls in (nearest neighbour, as the astro convention for pixel art).
// CDS hips2fits would render this server-side, but it answered 404 (even for DSS2) and its mirror
// timed out on 2026-11-15, so the still is built from the tiles the map already uses (through the
// /api/hips proxy). The plain tile is the cube's first plane (0.75 um), cut 0..40 with asinh, so
// faint sky is black and the stars show.

import { hpxNest } from "./healpix";
import type { FieldWcs } from "./types";
import { pixelToSky } from "./wcs";

export const STILL_TILE_ORDER = 5;
export const STILL_TILE_PX = 512;
/** log2(512) = 9 more orders inside a tile. */
const SUB = 9;
const PER_TILE = 4 ** SUB;

/**
 * Where an order-14 cell sits inside its tile. NESTED index bits inside a tile interleave x (even
 * bits) and y (odd bits); a PNG tile of this HiPS stores it at row `x`, column `y`. Measured
 * 2026-11-15 by hipsStill.live.test.ts on the Eros field: correlation 0.53 with the field's
 * median frame for this choice, under 0.03 for each of the other 7 flips and turns.
 */
export function cellInTile(ipix: number): { tile: number; col: number; row: number } {
  const tile = Math.floor(ipix / PER_TILE);
  const sub = ipix - tile * PER_TILE;
  let x = 0;
  let y = 0;
  for (let b = 0; b < SUB; b++) {
    x |= ((sub >> (2 * b)) & 1) << b;
    y |= ((sub >> (2 * b + 1)) & 1) << b;
  }
  return { tile, ...orient(x, y) };
}

/** Tile pixel (col, row) for in-tile (x, y). Exported so the orientation check can try all 8. */
export let orient = (x: number, y: number): { col: number; row: number } => ({ col: y, row: x });
export function setOrientForCheck(f: typeof orient): void {
  orient = f;
}

/** The tile file under a HiPS base: `Norder5/Dir<10000*k>/Npix<t>.png`. */
export function stillTilePath(tile: number): string {
  return `Norder${STILL_TILE_ORDER}/Dir${Math.floor(tile / 10000) * 10000}/Npix${tile}.png`;
}

export interface StillPlan {
  /** Tiles to fetch, each once. */
  tiles: number[];
  /** For each output pixel (row-major, top row first): index into `tiles`, and the pixel in it. */
  src: { t: number; col: number; row: number }[];
  width: number;
  height: number;
}

/** Map every pixel of a w x h grid (north up, east left, `wcs`) to a HiPS tile pixel. Pure. */
export function planStill(wcs: FieldWcs, size: [number, number]): StillPlan {
  const [w, h] = size;
  const tiles: number[] = [];
  const at = new Map<number, number>();
  const src: StillPlan["src"] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [ra, dec] = pixelToSky(wcs, h, x, y);
      const c = cellInTile(hpxNest(ra, dec, STILL_TILE_ORDER + SUB));
      let t = at.get(c.tile);
      if (t === undefined) {
        t = tiles.length;
        tiles.push(c.tile);
        at.set(c.tile, t);
      }
      src.push({ t, col: c.col, row: c.row });
    }
  }
  return { tiles, src, width: w, height: h };
}

/** Fill RGBA output from decoded RGBA tiles (null: tile missing, drawn transparent). Pure. */
export function paintStill(plan: StillPlan, tiles: (Uint8ClampedArray | Uint8Array | null)[]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(plan.width * plan.height * 4);
  plan.src.forEach((s, k) => {
    const px = tiles[s.t];
    if (!px) return;
    const o = (s.row * STILL_TILE_PX + s.col) * 4;
    out[k * 4] = px[o];
    out[k * 4 + 1] = px[o + 1];
    out[k * 4 + 2] = px[o + 2];
    out[k * 4 + 3] = 255;
  });
  return out;
}
