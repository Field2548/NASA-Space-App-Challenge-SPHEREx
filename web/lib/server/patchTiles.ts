// GET /api/patch-tiles: community patches as HEALPix tiles (owner: SERVER). Server only.
//   ?tileOrder=k&tile=ipix&order=m          density: [[ipix, solves, reports]] per cell at order m
//   ?tileOrder=k&tile=ipix&mode=patches     footprints: the patches inside the tile (k >= 6)
// Anonymous: no user ids, no names. No database (or a failing one): { offline: true } and nothing else.

import { NextResponse } from "next/server";
import { z } from "zod";
import { PATCH_ORDER } from "@/lib/patch";
import { cellCount, MAX_ORDER_SPAN, MAX_TILE_ORDER, MIN_PATCH_TILE_ORDER } from "@/lib/hpxTiles";
import { ApiFail, parse, queryObject } from "@/lib/server/http";
import { patchStore, type PatchStore } from "@/lib/server/patchStore";
import { rateLimit } from "@/lib/server/rateLimit";

export const PATCHES_PER_TILE = 600;

export const TileQuery = z
  .object({
    tileOrder: z.coerce.number().int().min(0).max(MAX_TILE_ORDER),
    tile: z.coerce.number().int().min(0),
    mode: z.enum(["density", "patches"]).default("density"),
    order: z.coerce.number().int().min(0).max(PATCH_ORDER).optional(),
  })
  .superRefine((q, ctx) => {
    const bad = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (q.tile >= cellCount(q.tileOrder)) bad("tile", `must be below ${cellCount(q.tileOrder)} at order ${q.tileOrder}`);
    if (q.mode === "patches") {
      if (q.tileOrder < MIN_PATCH_TILE_ORDER) bad("tileOrder", `must be at least ${MIN_PATCH_TILE_ORDER} for mode=patches`);
    } else {
      if (q.order === undefined) bad("order", "is required for mode=density");
      else if (q.order < q.tileOrder) bad("order", "must not be below tileOrder");
      else if (q.order - q.tileOrder > MAX_ORDER_SPAN) bad("order", `must be within ${MAX_ORDER_SPAN} of tileOrder`);
    }
  });
export type TileQuery = z.infer<typeof TileQuery>;

export interface PatchTileDeps {
  store: () => PatchStore | null;
}
const realDeps: PatchTileDeps = { store: patchStore };

const OK = { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" };
const OFFLINE = { "Cache-Control": "no-store" };

export async function runPatchTiles(request: Request, deps: PatchTileDeps = realDeps): Promise<Response> {
  rateLimit(request, "patch-tiles", 240);
  const q = parse(TileQuery, queryObject(request));
  const store = deps.store();

  if (q.mode === "patches") {
    const found = store ? await store.tilePatches(q.tileOrder, q.tile, PATCHES_PER_TILE + 1) : null;
    if (found === null) return NextResponse.json({ offline: true, patches: [], truncated: false }, { headers: OFFLINE });
    const truncated = found.length > PATCHES_PER_TILE;
    return NextResponse.json({ patches: found.slice(0, PATCHES_PER_TILE), truncated }, { headers: OK });
  }

  const order = q.order;
  if (order === undefined) throw new ApiFail("bad_request", "order is required.");
  const cells = store ? await store.tileDensity(order, q.tileOrder, q.tile) : null;
  if (cells === null) return NextResponse.json({ offline: true, cells: [], max: 0 }, { headers: OFFLINE });
  const max = cells.reduce((m, [, s, r]) => Math.max(m, s + r), 0);
  return NextResponse.json({ cells, max }, { headers: OK });
}
