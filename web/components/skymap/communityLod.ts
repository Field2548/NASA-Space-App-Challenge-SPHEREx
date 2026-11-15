// Level of detail for the community patches layer: which kind of picture, at which HEALPix
// order, and which tiles to ask for, from the map's field of view. Like terrain streaming in a
// game: far away you see glowing density, close up the real patch footprints.

import { ang2vec, pix2vec_nest, query_disc_inclusive_nest } from "@hscmap/healpix";
import { cellCount } from "@/lib/hpxTiles";

/** Individual footprints show at this field of view (degrees) or closer. Same value as PATCH_SHOW_FOV in SkyMap. */
export const FOOTPRINT_FOV = 3;
/** Most tiles asked for in one view. */
export const MAX_TILES = 48;

export type Lod =
  | { mode: "density"; /** order of the drawn cells */ order: number; tileOrder: number }
  | { mode: "patches"; tileOrder: number };

/** [fov above this (degrees), LOD]: the first row the field of view exceeds is used. */
const BANDS: readonly [number, Lod][] = [
  [100, { mode: "density", order: 5, tileOrder: 0 }],
  [50, { mode: "density", order: 6, tileOrder: 1 }],
  [20, { mode: "density", order: 7, tileOrder: 2 }],
  [10, { mode: "density", order: 8, tileOrder: 3 }],
  [5, { mode: "density", order: 9, tileOrder: 4 }],
  [FOOTPRINT_FOV, { mode: "density", order: 10, tileOrder: 5 }],
  [1.5, { mode: "patches", tileOrder: 6 }],
  [0.5, { mode: "patches", tileOrder: 7 }],
  [0, { mode: "patches", tileOrder: 8 }],
];

/** The level of detail for a field of view in degrees. */
export function selectLod(fov: number): Lod {
  const f = Number.isFinite(fov) ? fov : 360;
  for (const [above, lod] of BANDS) if (f > above) return lod;
  return BANDS[BANDS.length - 1][1];
}

/** Where to zoom to when a density dot is clicked: the next finer level of detail, at most half the field of view. */
export function zoomTargetFov(fov: number): number {
  const half = fov / 2;
  const finer = BANDS.map(([above]) => above).find((above) => above < fov);
  return Math.max(0.05, finer === undefined ? half : Math.min(half, finer));
}

export interface ViewState {
  ra: number;
  dec: number;
  /** Field of view across the map, degrees. */
  fov: number;
  /** Field of view down the map, degrees (defaults to `fov`). */
  fovY?: number;
}

const DEG = Math.PI / 180;

/** Radius in degrees of a cone that covers the view, with a margin. */
export function viewRadiusDeg(fov: number, fovY: number = fov): number {
  return Math.min(180, 0.6 * Math.hypot(fov, fovY));
}

/**
 * The tiles at `tileOrder` that touch the view, nearest the centre first, at most `cap`.
 * The whole sky when the cone is wider than 75 degrees.
 */
export function visibleTiles(view: ViewState, tileOrder: number, cap: number = MAX_TILES): number[] {
  const radius = viewRadiusDeg(view.fov, view.fovY);
  const nside = 2 ** tileOrder;
  const centre = ang2vec((90 - view.dec) * DEG, (((view.ra % 360) + 360) % 360) * DEG);
  const tiles: number[] = [];
  if (radius > 75) {
    for (let i = 0; i < cellCount(tileOrder); i++) tiles.push(i);
  } else {
    query_disc_inclusive_nest(nside, centre, radius * DEG, (i) => tiles.push(i));
  }
  const dist = new Map<number, number>();
  for (const t of tiles) {
    const v = pix2vec_nest(nside, t);
    dist.set(t, -(v[0] * centre[0] + v[1] * centre[1] + v[2] * centre[2])); // smaller = nearer
  }
  tiles.sort((a, b) => (dist.get(a) ?? 0) - (dist.get(b) ?? 0));
  return tiles.slice(0, cap);
}
