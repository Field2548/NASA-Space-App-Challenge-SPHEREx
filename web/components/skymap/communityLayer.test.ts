// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cellCenter, hpxNest } from "@/lib/healpix";
import { PATCH_SOLVES_KEY, saveLocalPatchResult } from "@/lib/patchSolves";
import { patchFromPoint } from "@/lib/patch";
import type { AladinInstance, AladinStatic } from "./aladin";
import { collectCells, createCommunityLayer, localCells, localFootprints, mergeFootprints, tileSpecs } from "./communityLayer";
import { GLOW_LEVELS, glowLevel, glowStyle } from "./communityGlyph";
import type { TileData } from "./communityTiles";
import { TileLoader } from "./communityTiles";

beforeEach(() => window.localStorage.removeItem(PATCH_SOLVES_KEY));
afterEach(() => vi.restoreAllMocks());

const density = (cells: [number, number, number][]): TileData => ({ kind: "density", cells });

describe("glow", () => {
  it("scales brightness with log of the count, 0 to the top step", () => {
    expect(glowLevel(1, 1000)).toBeGreaterThanOrEqual(0);
    expect(glowLevel(1000, 1000)).toBe(GLOW_LEVELS - 1);
    expect(glowLevel(10, 1000)).toBeGreaterThan(glowLevel(2, 1000));
    expect(glowLevel(0, 10)).toBe(0);
    expect(glowLevel(5, 0)).toBe(0);
    expect(glowLevel(500, 100)).toBe(GLOW_LEVELS - 1);
  });
  it("grows the dot and its opacity with brightness", () => {
    expect(glowStyle(GLOW_LEVELS - 1).radius).toBeGreaterThan(glowStyle(0).radius);
    expect(glowStyle(GLOW_LEVELS - 1).alpha).toBe(1);
  });
});

describe("collectCells", () => {
  it("keeps the busiest cells under the cap and reports the maximum", () => {
    const { cells, max } = collectCells([density([[1, 1, 0], [2, 5, 3]]), undefined, density([[3, 2, 0]])], 2);
    expect(cells.map((c) => c.ipix)).toEqual([2, 3]);
    expect(max).toBe(8);
  });
  it("ignores footprint and offline tiles", () => {
    expect(collectCells([{ kind: "offline" }, { kind: "patches", patches: [], truncated: false }]).cells).toEqual([]);
  });
});

describe("mergeFootprints", () => {
  it("merges flags per patch, puts the player's first and honours the cap", () => {
    const tiles: TileData[] = [
      { kind: "patches", patches: [{ id: "p11-1", solved: true, reported: false }, { id: "p11-2", solved: false, reported: true }, { id: "p11-3", solved: true, reported: false }], truncated: false },
    ];
    const merged = mergeFootprints(tiles, [{ id: "p11-2", solved: true, reported: false, mine: true }]);
    expect(merged.map((m) => m.id)).toEqual(["p11-2", "p11-1", "p11-3"]);
    expect(merged[0]).toEqual({ id: "p11-2", solved: true, reported: true, mine: true });
    expect(mergeFootprints(tiles, [], 2)).toHaveLength(2);
  });
});

describe("the player's own patches", () => {
  it("come from local storage, near the view only", () => {
    const here = patchFromPoint(83.8, -5.4);
    const far = patchFromPoint(200, 40);
    saveLocalPatchResult(here.id, { solved: true, objects: [] });
    saveLocalPatchResult(far.id, { solved: false, reports: [{ ra: 200, dec: 40 }] });
    const view = { ra: 83.8, dec: -5.4, fov: 2 };
    expect(localFootprints(view, 5)).toEqual([{ id: here.id, solved: true, reported: false, mine: true }]);
    const cells = localCells({ ra: 83.8, dec: -5.4, fov: 360 }, 180, 7);
    expect(cells).toHaveLength(2);
    expect(cells.find((c) => c.ipix === hpxNest(83.8, -5.4, 7))).toMatchObject({ solves: 1, reports: 0, mine: true });
  });
});

describe("tileSpecs", () => {
  it("builds one spec per tile with the LOD's orders", () => {
    expect(tileSpecs({ mode: "density", order: 8, tileOrder: 3 }, [4, 5])).toEqual([
      { mode: "density", order: 8, tileOrder: 3, tile: 4 },
      { mode: "density", order: 8, tileOrder: 3, tile: 5 },
    ]);
    expect(tileSpecs({ mode: "patches", tileOrder: 7 }, [9])[0]).toMatchObject({ mode: "patches", order: 11, tileOrder: 7, tile: 9 });
  });
});

function fakeAladin() {
  const sources: { ra: number; dec: number; data: unknown }[] = [];
  const footprints: unknown[] = [];
  const catalog = {
    addSources: vi.fn((s: typeof sources) => sources.push(...s)),
    clear: vi.fn(() => (sources.length = 0)),
  };
  const overlay = { addFootprints: vi.fn((f: unknown[]) => footprints.push(...f)), removeAll: vi.fn(() => (footprints.length = 0)) };
  const lib = {
    catalog: vi.fn(() => catalog),
    graphicOverlay: vi.fn(() => overlay),
    source: vi.fn((ra: number, dec: number, data: unknown) => ({ ra, dec, data })),
    polygon: vi.fn((c: unknown, o: unknown) => ({ c, o })),
  } as unknown as AladinStatic;
  const aladin = { addCatalog: vi.fn(), addOverlay: vi.fn(), removeOverlay: vi.fn() } as unknown as AladinInstance;
  return { lib, aladin, sources, footprints, catalog, overlay };
}

describe("createCommunityLayer", () => {
  it("draws density dots from loaded tiles and redraws only when the tile set changes", async () => {
    const f = fakeAladin();
    const view = { ra: 0, dec: 0, fov: 360 };
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ cells: [[10, 4, 0], [11, 1, 2]], max: 4 }), { status: 200 }));
    const loader = new TileLoader({ onTile: () => {}, fetcher: fetcher as unknown as typeof fetch });
    const layer = createCommunityLayer({ ...f, onFly: () => {}, loader });
    layer.update(view);
    expect(f.catalog.addSources).not.toHaveBeenCalled(); // nothing loaded yet
    await new Promise((r) => setTimeout(r, 10));
    layer.update(view); // the tiles are in: draws
    expect(fetcher).toHaveBeenCalledTimes(12);
    expect(f.sources).toHaveLength(24);
    const [ra, dec] = cellCenter(10, 5);
    expect(f.sources[0]).toMatchObject({ ra, dec, data: { kind: "community" } });
    const calls = f.catalog.addSources.mock.calls.length;
    layer.update({ ...view, ra: 1 }); // same tiles loaded: no redraw
    expect(f.catalog.addSources.mock.calls.length).toBe(calls);
    layer.destroy();
    expect(f.aladin.removeOverlay).toHaveBeenCalledTimes(2);
  });

  it("draws the player's own footprints close up even with no server", async () => {
    const p = patchFromPoint(83.8, -5.4);
    saveLocalPatchResult(p.id, { solved: true, objects: [] });
    const f = fakeAladin();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ offline: true, patches: [] }), { status: 200 }));
    const loader = new TileLoader({ onTile: () => {}, fetcher: fetcher as unknown as typeof fetch });
    const layer = createCommunityLayer({ ...f, onFly: () => {}, loader });
    layer.update({ ra: p.ra, dec: p.dec, fov: 0.4 });
    expect(f.footprints).toHaveLength(1);
    expect((f.footprints[0] as { o: { color: string } }).o.color).toBe("#67e8f9");
    layer.destroy();
  });
});
