// Community patches on the sky map (all players' patches, anonymous), streamed by level of detail.
//
//   wide view   one Aladin catalog of glowing dots at HEALPix cell centres (density, like night lights)
//   close view  one graphic overlay of patch footprints (green: solved, amber: reported, cyan: yours)
//
// Tiles come from /api/patch-tiles (communityTiles.ts). The player's own patches come from local
// storage (lib/patchSolves.ts), so they show even with no database. One catalog and one overlay are
// created once; a redraw clears and refills them, and is skipped when the tiles on screen are unchanged.

import { cellCenter } from "@/lib/healpix";
import { cellOfPatch, patchIpix } from "@/lib/hpxTiles";
import { patchFromId } from "@/lib/patch";
import { loadLocalPatchSolves } from "@/lib/patchSolves";
import { authHeader } from "@/lib/supabase";
import type { AladinCatalog, AladinInstance, AladinOverlay, AladinShape, AladinSource, AladinStatic } from "./aladin";
import { drawGlow, glowLevel, type GlowData, type GlowKind } from "./communityGlyph";
import { selectLod, viewRadiusDeg, visibleTiles, zoomTargetFov, type Lod, type ViewState } from "./communityLod";
import { TILES_URL, tileKey, TileLoader, type TileData, type TilePatchInfo, type TileSpec } from "./communityTiles";

/** Most density dots drawn (the busiest are kept). */
export const MAX_DOTS = 4000;
/** Most footprints drawn. */
export const MAX_FOOTPRINTS = 500;
const RENDER_DELAY_MS = 120;

export const COLORS = {
  community: "#34d399",
  mine: "#67e8f9",
  reported: "#fbbf24",
};

export interface Footprint {
  id: string;
  solved: boolean;
  reported: boolean;
  mine: boolean;
}

export interface DensityCell {
  ipix: number;
  solves: number;
  reports: number;
  mine: boolean;
}

const D2R = Math.PI / 180;
function sepDeg(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const s = Math.sin(((dec2 - dec1) * D2R) / 2) ** 2 + Math.cos(dec1 * D2R) * Math.cos(dec2 * D2R) * Math.sin(((ra2 - ra1) * D2R) / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(s)))) / D2R;
}

interface Own {
  id: string;
  ra: number;
  dec: number;
  solved: boolean;
  reported: boolean;
  /** Also on the player's account, so the community counts already include it. */
  inDb: boolean;
}

/** The player's own patches: this device's local store plus the account's (`account`, from /api/patch-tiles?who=me). */
export function ownPatches(account: TilePatchInfo[] = []): Own[] {
  const by = new Map<string, Own>();
  for (const p of loadLocalPatchSolves()) {
    by.set(p.id, { id: p.id, ra: p.ra, dec: p.dec, solved: p.solved_at !== null, reported: p.reports.length > 0, inDb: false });
  }
  for (const a of account) {
    const e = by.get(a.id);
    if (e) {
      e.solved ||= a.solved;
      e.reported ||= a.reported;
      e.inDb = true;
      continue;
    }
    const p = patchFromId(a.id);
    if (p) by.set(a.id, { id: a.id, ra: p.ra, dec: p.dec, solved: a.solved, reported: a.reported, inDb: true });
  }
  return [...by.values()];
}

/** The player's own patches as footprints, within `radius` degrees of the view centre. */
export function localFootprints(view: ViewState, radius: number, account: TilePatchInfo[] = []): Footprint[] {
  return ownPatches(account)
    .filter((p) => sepDeg(view.ra, view.dec, p.ra, p.dec) <= radius)
    .map((p) => ({ id: p.id, solved: p.solved, reported: p.reported, mine: true }));
}

/** The player's own patches counted into cells at `order`, within `radius` degrees of the view centre. */
export function localCells(view: ViewState, radius: number, order: number, account: TilePatchInfo[] = []): DensityCell[] {
  const by = new Map<number, DensityCell & { inDb: number }>();
  for (const p of ownPatches(account)) {
    const ipix = patchIpix(p.id);
    if (ipix === null || sepDeg(view.ra, view.dec, p.ra, p.dec) > radius) continue;
    const cell = cellOfPatch(ipix, order);
    const e = by.get(cell) ?? { ipix: cell, solves: 0, reports: 0, mine: true, inDb: 0 };
    if (p.solved) e.solves++;
    if (p.reported) e.reports++;
    if (p.inDb) e.inDb++;
    by.set(cell, e);
  }
  return [...by.values()];
}

/**
 * Take the player's own counts out of the community counts for the same cell, so a cell is cyan for what is
 * theirs and green for what is other players' (never both colours over the same patches). Only account-saved
 * patches are subtracted: those are the ones the server counted.
 */
export function withoutOwn(cells: DensityCell[], mine: (DensityCell & { inDb?: number })[]): DensityCell[] {
  const own = new Map(mine.map((m) => [m.ipix, m]));
  return cells
    .map((c) => {
      const m = own.get(c.ipix);
      if (!m?.inDb) return c;
      return { ...c, solves: Math.max(0, c.solves - m.solves), reports: Math.max(0, c.reports - m.reports) };
    })
    .filter((c) => c.solves + c.reports > 0);
}

/** Merge tile footprints with the player's own: one entry per patch, mine first, at most `cap`. */
export function mergeFootprints(tiles: (TileData | undefined)[], mine: Footprint[], cap: number = MAX_FOOTPRINTS): Footprint[] {
  const by = new Map<string, Footprint>();
  for (const m of mine) by.set(m.id, m);
  for (const t of tiles) {
    if (t?.kind !== "patches") continue;
    for (const p of t.patches) {
      const e = by.get(p.id);
      if (e) {
        e.solved ||= p.solved;
        e.reported ||= p.reported;
      } else by.set(p.id, { id: p.id, solved: p.solved, reported: p.reported, mine: false });
    }
  }
  return [...by.values()].slice(0, cap);
}

/** Cells from density tiles, busiest first, at most `cap`. The player's own cells follow separately. */
export function collectCells(tiles: (TileData | undefined)[], cap: number = MAX_DOTS): { cells: DensityCell[]; max: number } {
  const cells: DensityCell[] = [];
  for (const t of tiles) {
    if (t?.kind !== "density") continue;
    for (const [ipix, solves, reports] of t.cells) cells.push({ ipix, solves, reports, mine: false });
  }
  cells.sort((a, b) => b.solves + b.reports - (a.solves + a.reports));
  const kept = cells.slice(0, cap);
  return { cells: kept, max: kept.reduce((m, c) => Math.max(m, c.solves + c.reports), 0) };
}

export function tileSpecs(lod: Lod, tiles: number[]): TileSpec[] {
  return tiles.map((tile) => ({
    mode: lod.mode,
    order: lod.mode === "density" ? lod.order : 11,
    tileOrder: lod.tileOrder,
    tile,
  }));
}

export interface CommunityLayerOptions {
  lib: AladinStatic;
  aladin: AladinInstance;
  /** Fly the map to a dot that was clicked. */
  onFly: (ra: number, dec: number, fov: number) => void;
  /** A dot was clicked: the map must not also treat it as a click on the sky. */
  onObjectClick?: () => void;
  loader?: TileLoader;
  /** The account's own patches (default: GET /api/patch-tiles?who=me with the login token; none for guests). */
  loadMine?: () => Promise<TilePatchInfo[]>;
}

export interface CommunityLayer {
  /** The view settled: choose the level of detail, ask for tiles, redraw. */
  update(view: ViewState): void;
  destroy(): void;
}

export function createCommunityLayer(opts: CommunityLayerOptions): CommunityLayer {
  const { lib, aladin: a } = opts;
  let view: ViewState | null = null;
  let lod: Lod | null = null;
  let specs: TileSpec[] = [];
  let signature = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dead = false;
  const cornerCache = new Map<string, [number, number][]>();

  const loader = opts.loader ?? new TileLoader({ onTile: () => schedule() });
  let account: TilePatchInfo[] = [];
  const loadMine =
    opts.loadMine ??
    (async (): Promise<TilePatchInfo[]> => {
      const headers = await authHeader();
      if (!headers.Authorization) return [];
      const res = await fetch(`${TILES_URL}?who=me`, { headers });
      const body = (await res.json()) as { patches?: TilePatchInfo[] };
      return res.ok && Array.isArray(body.patches) ? body.patches : [];
    });
  loadMine()
    .then((p) => {
      if (dead) return;
      account = p;
      schedule();
    })
    .catch(() => {
      /* guests and failures: only this device's own patches show */
    });

  let dots: AladinCatalog | null = null;
  let outline: AladinOverlay | null = null;
  try {
    dots = lib.catalog({
      name: "Community patches",
      shape: drawGlow,
      sourceSize: 16,
      color: COLORS.community,
      onClick: (src: AladinSource<unknown>) => {
        opts.onObjectClick?.();
        if (view) opts.onFly(src.ra, src.dec, zoomTargetFov(view.fov));
      },
    });
    a.addCatalog(dots);
    outline = lib.graphicOverlay({ name: "Community patch footprints", lineWidth: 1 });
    a.addOverlay(outline);
  } catch (e) {
    console.error("SkyMap: could not create the community layer", e);
  }

  function schedule(): void {
    if (dead || timer) return;
    timer = setTimeout(() => {
      timer = null;
      render();
    }, RENDER_DELAY_MS);
  }

  function corners(id: string): [number, number][] | null {
    const hit = cornerCache.get(id);
    if (hit) return hit;
    const p = patchFromId(id);
    if (!p) return null;
    if (cornerCache.size > 4000) cornerCache.clear();
    cornerCache.set(id, p.corners);
    return p.corners;
  }

  function renderDensity(l: Extract<Lod, { mode: "density" }>, v: ViewState): void {
    const collected = collectCells(specs.map((s) => loader.get(s)));
    const mine = localCells(v, viewRadiusDeg(v.fov, v.fovY), l.order, account);
    const cells = withoutOwn(collected.cells, mine);
    const max = collected.max;
    const sources: AladinSource<GlowData>[] = [];
    for (const c of cells) {
      const [ra, dec] = cellCenter(c.ipix, l.order);
      const kind: GlowKind = c.solves === 0 && c.reports > 0 ? "reported" : "community";
      sources.push(lib.source(ra, dec, { kind, level: glowLevel(c.solves + c.reports, max) }));
    }
    for (const c of mine) {
      const [ra, dec] = cellCenter(c.ipix, l.order);
      sources.push(lib.source(ra, dec, { kind: "mine" as const, level: glowLevel(c.solves + c.reports, Math.max(max, 1)) }));
    }
    dots?.clear();
    outline?.removeAll();
    if (sources.length) dots?.addSources(sources);
  }

  function renderPatches(v: ViewState): void {
    const mine = localFootprints(v, viewRadiusDeg(v.fov, v.fovY), account);
    const merged = mergeFootprints(specs.map((s) => loader.get(s)), mine);
    const shapes: AladinShape[] = [];
    for (const f of merged) {
      const c = corners(f.id);
      if (!c) continue;
      const color = f.mine ? COLORS.mine : f.solved ? COLORS.community : COLORS.reported;
      const rgb = f.mine ? "103, 232, 249" : f.solved ? "52, 211, 153" : "251, 191, 36";
      shapes.push(
        lib.polygon(c, {
          color,
          fill: f.solved || f.mine,
          fillColor: `rgba(${rgb}, 0.14)`,
          lineWidth: f.reported && !f.solved ? 2 : 1,
        }),
      );
    }
    dots?.clear();
    outline?.removeAll();
    if (shapes.length) outline?.addFootprints(shapes);
  }

  function render(): void {
    if (dead || !view || !lod) return;
    // Skip when nothing on screen changed: same level of detail and the same tiles loaded.
    const sig = `${lod.mode}:${"order" in lod ? lod.order : 11}:${specs.map((s) => (loader.get(s) ? tileKey(s) : "-")).join(",")}:${loadLocalPatchSolves().length}:${account.length}`;
    if (sig === signature) return;
    signature = sig;
    try {
      if (lod.mode === "density") renderDensity(lod, view);
      else renderPatches(view);
    } catch (e) {
      console.error("SkyMap: could not draw the community layer", e);
    }
  }

  return {
    update(v) {
      if (dead) return;
      view = v;
      lod = selectLod(v.fov);
      specs = tileSpecs(lod, visibleTiles(v, lod.tileOrder));
      loader.request(specs);
      render();
    },
    destroy() {
      dead = true;
      if (timer) clearTimeout(timer);
      timer = null;
      loader.destroy();
      for (const layer of [dots, outline]) {
        if (!layer) continue;
        try {
          a.removeOverlay(layer);
        } catch {
          /* map already gone */
        }
      }
    },
  };
}
