// HEALPix NESTED tile arithmetic shared by the server (/api/patch-tiles) and the sky map's
// community layer. A tile is a cell at some order k; a patch is a cell at order 11 (lib/patch.ts).
// NESTED indices keep a cell's children together, so the patches inside a tile are one contiguous
// range of order-11 indices. Plain doubles are exact here: 12 * 4^11 is about 5e7.

import { PATCH_ORDER } from "./patch";

/** Deepest tile order the API accepts. */
export const MAX_TILE_ORDER = 9;
/** Patch footprints are served only for tiles of this order or finer (they hold at most 4^5 patches). */
export const MIN_PATCH_TILE_ORDER = 6;
/** A density request may aggregate at most this many orders below its tile. */
export const MAX_ORDER_SPAN = 5;

/** Number of cells at an order. */
export const cellCount = (order: number): number => 12 * 4 ** order;

/** True for an integer tile index that exists at `tileOrder`. */
export function validTile(tileOrder: number, tile: number): boolean {
  return Number.isInteger(tileOrder) && tileOrder >= 0 && tileOrder <= PATCH_ORDER && Number.isInteger(tile) && tile >= 0 && tile < cellCount(tileOrder);
}

/** The order-11 indices a tile covers, both ends included: [tile * 4^(11-k), (tile + 1) * 4^(11-k) - 1]. */
export function tileRange(tileOrder: number, tile: number): [number, number] {
  if (!validTile(tileOrder, tile)) throw new RangeError(`tile ${tile} does not exist at order ${tileOrder}`);
  const span = 4 ** (PATCH_ORDER - tileOrder);
  return [tile * span, (tile + 1) * span - 1];
}

/** The cell at `order` (<= 11) that contains an order-11 index. */
export function cellOfPatch(hpx11: number, order: number): number {
  return Math.floor(hpx11 / 4 ** (PATCH_ORDER - order));
}

/** The tile at `tileOrder` that contains a cell at `order` (tileOrder <= order). */
export function tileOfCell(ipix: number, order: number, tileOrder: number): number {
  return Math.floor(ipix / 4 ** (order - tileOrder));
}

/** The order-11 index in a patch id `p11-<ipix>`, or null. */
export function patchIpix(id: string): number | null {
  const m = /^p11-(\d{1,8})$/.exec(id);
  if (!m) return null;
  const n = Number(m[1]);
  return n < cellCount(PATCH_ORDER) ? n : null;
}
