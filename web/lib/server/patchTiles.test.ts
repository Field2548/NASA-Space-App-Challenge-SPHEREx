import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/patch-tiles/route";
import type { PatchStore } from "@/lib/server/patchStore";
import { runPatchTiles, TileQuery } from "@/lib/server/patchTiles";
import { resetRateLimit } from "@/lib/server/rateLimit";

beforeEach(() => resetRateLimit());

const req = (q: string) => new NextRequest(`http://localhost/api/patch-tiles?${q}`);
const store = (over: Partial<PatchStore> = {}): PatchStore => ({
  hasSolve: async () => false,
  saveSolve: async () => true,
  saveReport: async () => true,
  near: async () => [],
  reportsFor: async () => [],
  tileDensity: async () => [],
  tilePatches: async () => [],
  minePatches: async () => [],
  ...over,
});

describe("TileQuery", () => {
  const ok = (o: Record<string, string>) => TileQuery.safeParse(o).success;
  it("accepts a density request within 5 orders of its tile", () => {
    expect(ok({ tileOrder: "3", tile: "100", order: "8" })).toBe(true);
    expect(ok({ tileOrder: "0", tile: "11", order: "5" })).toBe(true);
    expect(ok({ tileOrder: "9", tile: "0", order: "11" })).toBe(true);
  });
  it("refuses bad orders and tiles", () => {
    expect(ok({ tileOrder: "3", tile: "100", order: "9" })).toBe(false); // span 6
    expect(ok({ tileOrder: "3", tile: "100", order: "2" })).toBe(false); // finer than its tile
    expect(ok({ tileOrder: "3", tile: "100", order: "12" })).toBe(false);
    expect(ok({ tileOrder: "10", tile: "0", order: "11" })).toBe(false);
    expect(ok({ tileOrder: "3", tile: "768", order: "8" })).toBe(false); // 12 * 4^3 = 768 cells
    expect(ok({ tileOrder: "3", tile: "-1", order: "8" })).toBe(false);
    expect(ok({ tileOrder: "3", tile: "1.5", order: "8" })).toBe(false);
    expect(ok({ tileOrder: "3", tile: "1" })).toBe(false); // order missing
  });
  it("allows footprints only for tile order 6 and finer", () => {
    expect(ok({ tileOrder: "6", tile: "5", mode: "patches" })).toBe(true);
    expect(ok({ tileOrder: "5", tile: "5", mode: "patches" })).toBe(false);
    expect(ok({ tileOrder: "6", tile: "5", mode: "everything" })).toBe(false);
  });
});

describe("GET /api/patch-tiles", () => {
  it("answers offline with no database, and does not let a shared cache keep that", async () => {
    const res = await GET(req("tileOrder=3&tile=5&order=8"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ offline: true, cells: [], max: 0 });
    expect(res.headers.get("cache-control")).toBe("no-store");
    const p = await GET(req("tileOrder=7&tile=5&mode=patches"));
    expect(await p.json()).toMatchObject({ offline: true, patches: [] });
  });
  it("answers 400 with the error shape for a bad request", async () => {
    const res = await GET(req("tileOrder=3&tile=5&order=9"));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("bad_request");
  });
  it("returns density cells, the maximum and the cache header", async () => {
    const tileDensity = vi.fn(async () => [[10, 3, 0], [11, 1, 4]] as [number, number, number][]);
    const res = await runPatchTiles(req("tileOrder=3&tile=5&order=8"), { store: () => store({ tileDensity }) });
    expect(tileDensity).toHaveBeenCalledWith(8, 3, 5);
    expect(await res.json()).toEqual({ cells: [[10, 3, 0], [11, 1, 4]], max: 5 });
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=60, stale-while-revalidate=300");
  });
  it("returns footprints, trimmed and flagged truncated, with no user fields", async () => {
    const many = Array.from({ length: 601 }, (_, i) => ({ id: `p11-${i}`, solved: true, reported: false }));
    const tilePatches = vi.fn(async () => many);
    const res = await runPatchTiles(req("tileOrder=7&tile=5&mode=patches"), { store: () => store({ tilePatches }) });
    expect(tilePatches).toHaveBeenCalledWith(7, 5, 601);
    const body = await res.json();
    expect(body.patches).toHaveLength(600);
    expect(body.truncated).toBe(true);
    expect(Object.keys(body.patches[0]).sort()).toEqual(["id", "reported", "solved"]);
    expect(JSON.stringify(body)).not.toMatch(/user/);
  });
  it("is offline when the database fails", async () => {
    const res = await runPatchTiles(req("tileOrder=3&tile=5&order=8"), { store: () => store({ tileDensity: async () => null }) });
    expect(await res.json()).toMatchObject({ offline: true, cells: [] });
  });
  it("who=me gives only the signed-in player's own patches, never cached; guests get none", async () => {
    const minePatches = vi.fn(async () => [{ id: "p11-1", solved: true, reported: false }]);
    const deps = (id: string | null) => ({ store: () => store({ minePatches }), user: async () => (id ? { id } : null) });
    const res = await runPatchTiles(req("who=me"), deps("u1"));
    expect(minePatches).toHaveBeenCalledWith("u1");
    expect(await res.json()).toEqual({ patches: [{ id: "p11-1", solved: true, reported: false }] });
    expect(res.headers.get("cache-control")).toBe("no-store");
    minePatches.mockClear();
    expect(await (await runPatchTiles(req("who=me"), deps(null))).json()).toEqual({ patches: [] });
    expect(minePatches).not.toHaveBeenCalled();
  });
  it("is rate limited", async () => {
    let last = 200;
    for (let i = 0; i < 241; i++) last = (await GET(req("tileOrder=3&tile=5&order=8"))).status;
    expect(last).toBe(429);
  });
});
