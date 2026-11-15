import { describe, expect, it } from "vitest";
import { hpxNest } from "./healpix";
import { parseTileUrl, predictTiles, tilesInView, tileUrl, viewOrder } from "./hipsPredict";

describe("viewOrder", () => {
  it("matches the orders Aladin requested on /map (1280 px canvas, tmp/probe-zoom.cjs)", () => {
    const seen: [number, number][] = [
      [148, 0],
      [98, 1],
      [66, 2],
      [44, 2],
      [29, 3],
      [13, 4],
      [5.9, 5],
    ];
    for (const [fov, order] of seen) expect(viewOrder(fov, 1280), `fov ${fov}`).toBe(order);
  });

  it("goes one order deeper for each halving of the field and never below 0", () => {
    expect(viewOrder(1, 1280) - viewOrder(2, 1280)).toBe(1);
    expect(viewOrder(360, 1280)).toBe(0);
  });
});

describe("parseTileUrl and tileUrl", () => {
  it("round-trips the URLs Aladin requests, slice suffix included", () => {
    for (const url of [
      "http://localhost:4000/api/hips/irsa/Norder2/Dir0/Npix187_3.png",
      "https://example.org/api/hips/cds/Norder7/Dir120000/Npix123456.png",
      "https://example.org/api/hips/cds/Norder3/Dir0/Npix9.jpg",
    ]) {
      const p = parseTileUrl(url);
      expect(p, url).not.toBeNull();
      expect(tileUrl(p!)).toBe(url);
    }
    expect(parseTileUrl("http://x/api/hips/irsa/Norder2/Dir0/Npix187_3.png")).toEqual({
      root: "http://x/api/hips/irsa",
      order: 2,
      npix: 187,
      suffix: "_3",
      ext: "png",
    });
  });

  it("puts tiles in Dir buckets of 10000 and refuses other files", () => {
    expect(tileUrl({ root: "r", order: 7, npix: 10000, suffix: "", ext: "png" })).toBe("r/Norder7/Dir10000/Npix10000.png");
    expect(tileUrl({ root: "r", order: 7, npix: 9999, suffix: "", ext: "png" })).toBe("r/Norder7/Dir0/Npix9999.png");
    expect(parseTileUrl("r/Norder7/Dir0/Npix10000.png")).toBeNull();
    expect(parseTileUrl("r/Norder3/Allsky.png")).toBeNull();
    expect(parseTileUrl("r/properties")).toBeNull();
  });
});

describe("tilesInView", () => {
  it("starts with the tile under the centre and covers the whole field", () => {
    for (const [ra, dec, fov, order] of [
      [266.4, -28.9, 13, 4],
      [10, 89, 6, 5],
      [359.5, 0.2, 2, 7],
    ]) {
      const tiles = tilesInView(ra, dec, fov, fov * 0.5625, order, 10000);
      expect(tiles[0]).toBe(hpxNest(ra, dec, order));
      const set = new Set(tiles);
      for (let i = -5; i <= 5; i++) {
        for (let j = -5; j <= 5; j++) {
          const d = dec + (j / 10) * fov * 0.5625;
          const r = ra + ((i / 10) * fov) / Math.cos((d * Math.PI) / 180);
          expect(set.has(hpxNest(r, Math.max(-90, Math.min(90, d)), order))).toBe(true);
        }
      }
    }
  });

  it("returns at most limit tiles", () => {
    expect(tilesInView(0, 0, 30, 20, 5, 24)).toHaveLength(24);
  });
});

describe("predictTiles", () => {
  const hips = { tileWidth: 512, maxOrder: 7 };
  const view = (fovX: number) => ({ ra: 266.4, dec: -28.9, fovX, fovY: fovX * 0.5625, widthPx: 1280 });

  it("asks for the next order's tiles around the centre when a zoom in will need them", () => {
    const tiles = predictTiles(view(29), view(14.5), hips, 24);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThanOrEqual(24);
    expect(tiles.every((t) => t.order === 4)).toBe(true);
    expect(tiles[0].npix).toBe(hpxNest(266.4, -28.9, 4));
  });

  it("asks for nothing when the order does not change or the survey has no deeper tiles", () => {
    expect(predictTiles(view(29), view(28), hips, 24)).toEqual([]);
    expect(predictTiles(view(5.9), view(2.9), { tileWidth: 512, maxOrder: 5 }, 24)).toEqual([]);
  });

  it("clamps a fly-to target to the survey's deepest order", () => {
    const tiles = predictTiles(null, view(0.1), { tileWidth: 512, maxOrder: 7 }, 24);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every((t) => t.order === 7)).toBe(true);
  });
});
