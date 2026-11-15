// Which HiPS tiles Aladin Lite will ask for next, so the sky map can fetch them early (zoom prefetch).
// Pure functions; the browser side is components/skymap/hipsPrefetch.ts.
//
// Aladin's tile choice, measured on /map with tmp/probe-zoom.cjs (1280 px wide canvas, both at device
// pixel ratio 1 and 2): it draws the lowest order whose tile pixel is no bigger than a screen pixel,
// i.e. ORDER0_TILE_DEG / 2^order / tileWidth <= fov / widthPx (fov 66 deg -> 2, 29 -> 3, 13 -> 4, 5.9 -> 5),
// and a wheel zoom keeps the view centre fixed. Tile files are <root>/Norder<k>/Dir<10000*m>/Npix<n>[_slice].<ext>.

import { ang2vec, query_disc_inclusive_nest } from "@hscmap/healpix";
import { cellCenter } from "./healpix";

const DEG = Math.PI / 180;

/** Side of an order-0 HEALPix cell in degrees (square root of its area, 4 pi / 12 sr). */
export const ORDER0_TILE_DEG = Math.sqrt((4 * Math.PI) / 12) / DEG;

/** The HiPS order Aladin draws for a view `fovDeg` wide on a canvas `widthPx` CSS pixels wide. */
export function viewOrder(fovDeg: number, widthPx: number, tileWidth = 512): number {
  return Math.max(0, Math.ceil(Math.log2((ORDER0_TILE_DEG * widthPx) / (tileWidth * fovDeg)) - 1e-9));
}

/** What a tile URL is made of; root, suffix and ext are copied from a request Aladin made itself. */
export interface TileUrlParts {
  root: string;
  order: number;
  npix: number;
  /** Cube slice suffix such as "_3", or "". */
  suffix: string;
  ext: string;
}

const TILE_RE = /^(.+)\/Norder(\d{1,2})\/Dir(\d{1,9})\/Npix(\d{1,12})(_\d{1,3})?\.(png|jpg)$/;

/** Split a HiPS tile URL, or null when it is not one. */
export function parseTileUrl(url: string): TileUrlParts | null {
  const m = TILE_RE.exec(url);
  if (!m) return null;
  const npix = Number(m[4]);
  if (Number(m[3]) !== Math.floor(npix / 10000) * 10000) return null;
  return { root: m[1], order: Number(m[2]), npix, suffix: m[5] ?? "", ext: m[6] };
}

/** The tile URL in the HiPS standard layout (the inverse of parseTileUrl). */
export function tileUrl(p: TileUrlParts): string {
  return `${p.root}/Norder${p.order}/Dir${Math.floor(p.npix / 10000) * 10000}/Npix${p.npix}${p.suffix}.${p.ext}`;
}

function angDist(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const s =
    Math.sin(dec1 * DEG) * Math.sin(dec2 * DEG) + Math.cos(dec1 * DEG) * Math.cos(dec2 * DEG) * Math.cos((ra1 - ra2) * DEG);
  return Math.acos(Math.min(1, Math.max(-1, s)));
}

/** NESTED tiles at `order` touching a view (ICRS centre, width and height in degrees), nearest the centre first. */
export function tilesInView(ra: number, dec: number, fovX: number, fovY: number, order: number, limit: number): number[] {
  const radius = Math.min(Math.PI, 0.5 * Math.hypot(fovX, fovY) * DEG);
  const found: number[] = [];
  query_disc_inclusive_nest(2 ** order, ang2vec((90 - dec) * DEG, ra * DEG), radius, (ipix) => {
    found.push(ipix);
  });
  const dist = new Map(found.map((p) => [p, angDist(ra, dec, ...cellCenter(p, order))]));
  return found.sort((a, b) => dist.get(a)! - dist.get(b)!).slice(0, limit);
}

export interface PredictView {
  ra: number;
  dec: number;
  /** Field width and height in degrees (Aladin getFov). */
  fovX: number;
  fovY: number;
  /** Canvas width in CSS pixels. */
  widthPx: number;
}

/**
 * Tiles Aladin will need for `next` that it did not need for `now` (null when there is no current view,
 * e.g. a fly-to from a far view). Empty when `next` draws no deeper order than `now` or the survey has
 * no deeper tiles than maxOrder.
 */
export function predictTiles(
  now: PredictView | null,
  next: PredictView,
  hips: { tileWidth: number; maxOrder: number },
  limit: number,
): { order: number; npix: number }[] {
  const order = Math.min(hips.maxOrder, viewOrder(next.fovX, next.widthPx, hips.tileWidth));
  if (now && order <= Math.min(hips.maxOrder, viewOrder(now.fovX, now.widthPx, hips.tileWidth))) return [];
  return tilesInView(next.ra, next.dec, next.fovX, next.fovY, order, limit).map((npix) => ({ order, npix }));
}
