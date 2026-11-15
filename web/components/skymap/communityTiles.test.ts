import { describe, expect, it, vi } from "vitest";
import { parseTile, TileLoader, tileKey, tileUrl, type TileSpec } from "./communityTiles";
import { LruCache } from "./tileCache";

const spec = (tile: number, over: Partial<TileSpec> = {}): TileSpec => ({ mode: "density", order: 8, tileOrder: 3, tile, ...over });

describe("tile keys and urls", () => {
  it("keys by mode, order, tile order and tile", () => {
    expect(tileKey(spec(5))).toBe("density:8:3:5");
    expect(tileKey({ mode: "patches", order: 11, tileOrder: 7, tile: 9 })).toBe("patches:11:7:9");
  });
  it("builds the API query", () => {
    expect(tileUrl(spec(5))).toBe("/api/patch-tiles?tileOrder=3&tile=5&order=8");
    expect(tileUrl({ mode: "patches", order: 11, tileOrder: 7, tile: 9 })).toBe("/api/patch-tiles?tileOrder=7&tile=9&mode=patches");
  });
});

describe("parseTile", () => {
  it("reads cells and drops malformed ones", () => {
    expect(parseTile("density", { cells: [[1, 2, 0], [3, "x", 1], "bad"], max: 2 })).toEqual({ kind: "density", cells: [[1, 2, 0]] });
  });
  it("reads patches", () => {
    expect(parseTile("patches", { patches: [{ id: "p11-5", solved: true, reported: false }, { nope: 1 }], truncated: true })).toEqual({
      kind: "patches",
      patches: [{ id: "p11-5", solved: true, reported: false }],
      truncated: true,
    });
  });
  it("treats offline and junk as offline", () => {
    expect(parseTile("density", { offline: true, cells: [] })).toEqual({ kind: "offline" });
    expect(parseTile("patches", null)).toEqual({ kind: "offline" });
    expect(parseTile("density", { patches: [] })).toEqual({ kind: "offline" });
  });
});

function deferredFetch() {
  const pending: { url: string; signal: AbortSignal; resolve: (body: unknown) => void }[] = [];
  const fetcher = vi.fn((url: string, init?: RequestInit) => {
    return new Promise<Response>((resolve, reject) => {
      const signal = init!.signal!;
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      pending.push({ url, signal, resolve: (body) => resolve(new Response(JSON.stringify(body), { status: 200 })) });
    });
  });
  return { fetcher: fetcher as unknown as typeof fetch, pending };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("TileLoader", () => {
  it("runs at most 4 requests at once and starts the next as one finishes", async () => {
    const { fetcher, pending } = deferredFetch();
    const onTile = vi.fn();
    const loader = new TileLoader({ onTile, fetcher });
    loader.request([0, 1, 2, 3, 4, 5].map((t) => spec(t)));
    expect(loader.active).toBe(4);
    pending[0].resolve({ cells: [[1, 1, 0]] });
    await flush();
    expect(loader.active).toBe(4);
    expect(pending).toHaveLength(5);
    expect(onTile).toHaveBeenCalledTimes(1);
    expect(loader.get(spec(0))).toEqual({ kind: "density", cells: [[1, 1, 0]] });
  });
  it("aborts requests for tiles the view no longer needs", async () => {
    const { fetcher, pending } = deferredFetch();
    const loader = new TileLoader({ onTile: () => {}, fetcher });
    loader.request([spec(0), spec(1)]);
    loader.request([spec(1), spec(2)]);
    expect(pending[0].signal.aborted).toBe(true);
    expect(pending[1].signal.aborted).toBe(false);
    expect(pending).toHaveLength(3); // tile 1 was not asked for twice
    await flush();
    expect(loader.active).toBe(2);
  });
  it("does not fetch a tile it already holds, and refetches after the time to live", async () => {
    let t = 0;
    const cache = new LruCache<ReturnType<typeof parseTile>>(300, 60_000, () => t);
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ cells: [] }), { status: 200 }));
    const loader = new TileLoader({ onTile: () => {}, fetcher: fetcher as unknown as typeof fetch, cache });
    loader.request([spec(7)]);
    await flush();
    loader.request([spec(7)]);
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
    t = 61_000;
    loader.request([spec(7)]);
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("leaves a failed tile missing and keeps going", async () => {
    const fetcher = vi.fn(async (url: string) =>
      url.includes("tile=1&") ? new Response("no", { status: 500 }) : new Response(JSON.stringify({ cells: [] }), { status: 200 }),
    );
    const loader = new TileLoader({ onTile: () => {}, fetcher: fetcher as unknown as typeof fetch });
    loader.request([spec(1), spec(2)]);
    await flush();
    expect(loader.get(spec(1))).toBeUndefined();
    expect(loader.get(spec(2))).toBeDefined();
  });
  it("stops everything on destroy", async () => {
    const { fetcher, pending } = deferredFetch();
    const loader = new TileLoader({ onTile: () => {}, fetcher });
    loader.request([spec(0)]);
    loader.destroy();
    expect(pending[0].signal.aborted).toBe(true);
    loader.request([spec(1)]);
    expect(pending).toHaveLength(1);
  });
});
