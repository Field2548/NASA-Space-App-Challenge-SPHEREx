import { describe, expect, it } from "vitest";
import { hpxNest } from "./healpix";
import { cellOfPatch, patchIpix, tileOfCell, tileRange, validTile } from "./hpxTiles";

describe("tileRange", () => {
  it("covers the whole sky at order 0, 12 tiles of 4^11 patches", () => {
    expect(tileRange(0, 0)).toEqual([0, 4 ** 11 - 1]);
    expect(tileRange(0, 11)).toEqual([11 * 4 ** 11, 12 * 4 ** 11 - 1]);
  });
  it("is the identity at order 11 and splits evenly in between", () => {
    expect(tileRange(11, 12345)).toEqual([12345, 12345]);
    const [lo, hi] = tileRange(6, 7);
    expect(hi - lo + 1).toBe(4 ** 5);
    expect(lo).toBe(7 * 4 ** 5);
  });
  it("matches the real cell tree: a patch lies in the range of its ancestor tile", () => {
    const ipix = hpxNest(83.82, -5.39, 11);
    for (const k of [0, 3, 6, 9]) {
      const tile = tileOfCell(ipix, 11, k);
      const [lo, hi] = tileRange(k, tile);
      expect(ipix).toBeGreaterThanOrEqual(lo);
      expect(ipix).toBeLessThanOrEqual(hi);
      expect(tile).toBe(hpxNest(83.82, -5.39, k));
    }
  });
  it("rejects tiles that do not exist", () => {
    expect(() => tileRange(2, 192)).toThrow(RangeError);
    expect(() => tileRange(2, -1)).toThrow(RangeError);
    expect(validTile(2, 191)).toBe(true);
    expect(validTile(2, 1.5)).toBe(false);
  });
});

describe("cells and ids", () => {
  it("aggregates an order-11 index to a coarser cell like the database's bit shift (>> 2 per order)", () => {
    for (const ipix of [0, 1, 4, 1234567, 50331647]) {
      expect(cellOfPatch(ipix, 9)).toBe(Math.floor(ipix / 16));
      expect(cellOfPatch(ipix, 11)).toBe(ipix);
    }
  });
  it("reads patch ids", () => {
    expect(patchIpix("p11-42")).toBe(42);
    expect(patchIpix("p11-50331648")).toBeNull();
    expect(patchIpix("p10-42")).toBeNull();
    expect(patchIpix("nope")).toBeNull();
  });
});
