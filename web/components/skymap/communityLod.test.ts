import { describe, expect, it } from "vitest";
import { cellCenter, hpxNest } from "@/lib/healpix";
import { FOOTPRINT_FOV, MAX_TILES, selectLod, viewRadiusDeg, visibleTiles, zoomTargetFov } from "./communityLod";

describe("selectLod", () => {
  it("shows coarse density for the whole sky and finer density as you zoom", () => {
    expect(selectLod(360)).toMatchObject({ mode: "density", order: 5 });
    expect(selectLod(60)).toMatchObject({ mode: "density", order: 6 });
    expect(selectLod(30)).toMatchObject({ mode: "density", order: 7 });
  });
  it("uses orders 8 to 10 between 20 and 3 degrees", () => {
    expect(selectLod(20)).toMatchObject({ mode: "density", order: 8 });
    expect(selectLod(8)).toMatchObject({ mode: "density", order: 9 });
    expect(selectLod(4)).toMatchObject({ mode: "density", order: 10 });
  });
  it("switches to footprints at the patch field of view", () => {
    expect(selectLod(FOOTPRINT_FOV)).toMatchObject({ mode: "patches" });
    expect(selectLod(FOOTPRINT_FOV + 0.01)).toMatchObject({ mode: "density" });
    expect(selectLod(0.01)).toMatchObject({ mode: "patches", tileOrder: 8 });
  });
  it("never asks for a density span the API refuses (more than 5 orders) or patch tiles above order 6", () => {
    for (let f = 360; f > 0.01; f /= 1.07) {
      const l = selectLod(f);
      if (l.mode === "density") {
        expect(l.order - l.tileOrder).toBeLessThanOrEqual(5);
        expect(l.order).toBeGreaterThanOrEqual(l.tileOrder);
        expect(l.order).toBeLessThanOrEqual(10);
      } else expect(l.tileOrder).toBeGreaterThanOrEqual(6);
    }
  });
  it("treats a bad field of view as the whole sky", () => {
    expect(selectLod(NaN)).toMatchObject({ mode: "density", order: 5 });
  });
});

describe("zoomTargetFov", () => {
  it("halves the view or reaches the next level of detail, whichever is closer", () => {
    expect(zoomTargetFov(360)).toBe(100);
    expect(zoomTargetFov(60)).toBe(30);
    expect(selectLod(zoomTargetFov(4)).mode).toBe("patches");
  });
  it("always lands on a finer level than it left (until patches)", () => {
    for (const f of [360, 150, 70, 30, 15, 7, 4]) {
      const before = selectLod(f);
      const after = selectLod(zoomTargetFov(f));
      const rank = (l: ReturnType<typeof selectLod>) => (l.mode === "patches" ? 100 + l.tileOrder : "order" in l ? l.order : 0);
      expect(rank(after)).toBeGreaterThan(rank(before));
    }
  });
});

describe("visibleTiles", () => {
  it("returns the whole sky when the view is huge", () => {
    expect(visibleTiles({ ra: 0, dec: 0, fov: 360 }, 0)).toHaveLength(12);
    expect(visibleTiles({ ra: 0, dec: 0, fov: 360 }, 1)).toHaveLength(MAX_TILES);
  });
  it("contains the tile under the view centre first, and stays under the cap", () => {
    const view = { ra: 83.82, dec: -5.39, fov: 6 };
    const l = selectLod(view.fov);
    const tiles = visibleTiles(view, l.tileOrder);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThanOrEqual(MAX_TILES);
    expect(tiles[0]).toBe(hpxNest(view.ra, view.dec, l.tileOrder));
    expect(new Set(tiles).size).toBe(tiles.length);
  });
  it("covers every tile whose centre lies inside the view cone", () => {
    const view = { ra: 200, dec: 30, fov: 4 };
    const tiles = new Set(visibleTiles(view, 6));
    const r = viewRadiusDeg(view.fov) * 0.9;
    const D = Math.PI / 180;
    for (const [dra, ddec] of [[0, 0], [r * 0.6, 0], [0, r * 0.6], [-r * 0.5, -r * 0.4]]) {
      const ra = view.ra + dra / Math.cos(view.dec * D);
      const dec = view.dec + ddec;
      expect(tiles.has(hpxNest(ra, dec, 6))).toBe(true);
    }
    // And a tile far away is not asked for.
    expect(tiles.has(hpxNest(20, -60, 6))).toBe(false);
  });
  it("works near the pole and across ra 0", () => {
    expect(visibleTiles({ ra: 359.9, dec: 89.5, fov: 5 }, 5).length).toBeGreaterThan(0);
    const t = visibleTiles({ ra: 0.1, dec: 0, fov: 2 }, 6);
    expect(t).toContain(hpxNest(359.95, 0, 6));
    expect(t).toContain(hpxNest(0.05, 0, 6));
  });
  it("honours a smaller cap", () => {
    expect(visibleTiles({ ra: 10, dec: 10, fov: 20 }, 5, 5)).toHaveLength(5);
  });
  it("uses the taller side of a portrait view", () => {
    expect(viewRadiusDeg(2, 6)).toBeGreaterThan(viewRadiusDeg(2));
    const c = cellCenter(hpxNest(100, 20, 6), 6);
    expect(visibleTiles({ ra: c[0], dec: c[1], fov: 1 }, 6)).toContain(hpxNest(c[0], c[1], 6));
  });
});
