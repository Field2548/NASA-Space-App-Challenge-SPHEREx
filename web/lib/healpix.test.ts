import { describe, expect, it } from "vitest";
import { cellCenter, cellCorners, hpxNest, parent } from "@/lib/healpix";

const DEG = Math.PI / 180;

// Deterministic PRNG (mulberry32) so the "random" positions are reproducible.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomPositions(n: number, seed: number): [number, number][] {
  const r = rng(seed);
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const ra = r() * 360;
    const dec = (Math.asin(2 * r() - 1) * 180) / Math.PI; // uniform on the sphere
    out.push([ra, dec]);
  }
  return out;
}

/** Angular separation in degrees between two [ra, dec] points. */
function angSep(a: [number, number], b: [number, number]): number {
  const [ra1, dec1] = a;
  const [ra2, dec2] = b;
  const v1 = [Math.cos(dec1 * DEG) * Math.cos(ra1 * DEG), Math.cos(dec1 * DEG) * Math.sin(ra1 * DEG), Math.sin(dec1 * DEG)];
  const v2 = [Math.cos(dec2 * DEG) * Math.cos(ra2 * DEG), Math.cos(dec2 * DEG) * Math.sin(ra2 * DEG), Math.sin(dec2 * DEG)];
  const dot = Math.min(1, Math.max(-1, v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]));
  return Math.acos(dot) / DEG;
}

/** Approximate cell side in degrees (sqrt of the cell area). */
const cellSize = (order: number) => 58.6 / 2 ** order;

describe("parent", () => {
  it("NESTED parent of a cell is the cell containing the same point at each coarser order", () => {
    for (const [ra, dec] of randomPositions(60, 1)) {
      const fine = hpxNest(ra, dec, 12);
      for (let k = 0; k <= 12; k++) {
        expect(parent(fine, 12, k)).toBe(hpxNest(ra, dec, k));
      }
    }
  });

  it("parent at the same order is the identity", () => {
    for (const i of [0, 1, 7, 12 * 4 ** 12 - 1, 123456789]) {
      expect(parent(i, 12, 12)).toBe(i);
    }
  });

  it("matches a right shift for small values", () => {
    for (let i = 0; i < 12 * 64; i++) {
      expect(parent(i, 3, 1)).toBe(i >> 4);
    }
  });

  it("throws RangeError when toOrder > fromOrder", () => {
    expect(() => parent(0, 3, 4)).toThrow(RangeError);
  });

  it("throws RangeError for non-integer or out-of-range orders and out-of-range ipix", () => {
    expect(() => parent(0, 3.5, 1)).toThrow(RangeError);
    expect(() => parent(0, 16, 1)).toThrow(RangeError);
    expect(() => parent(0, 3, -1)).toThrow(RangeError);
    expect(() => parent(12 * 4 ** 3, 3, 0)).toThrow(RangeError);
    expect(() => parent(-1, 3, 0)).toThrow(RangeError);
  });
});

describe("hpxNest", () => {
  it("returns an integer in [0, 12 * 4**order)", () => {
    for (const order of [0, 1, 5, 12, 15]) {
      const npix = 12 * 4 ** order;
      for (const [ra, dec] of randomPositions(40, order + 10)) {
        const i = hpxNest(ra, dec, order);
        expect(Number.isInteger(i)).toBe(true);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(npix);
      }
    }
  });

  it("uses order 12 by default", () => {
    expect(hpxNest(133.795, -7.245)).toBe(hpxNest(133.795, -7.245, 12));
  });

  it("order 0 gives only indices 0..11", () => {
    for (const [ra, dec] of randomPositions(300, 3)) {
      const i = hpxNest(ra, dec, 0);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThanOrEqual(11);
    }
  });

  it("poles and RA edges do not throw and give valid indices", () => {
    const edges: [number, number][] = [
      [0, 90],
      [0, -90],
      [180, 90],
      [0, 0],
      [359.999, 0],
      [359.999, 89.999],
      [360, 0],
      [360, 45],
      [-1e-12, 0],
    ];
    for (const [ra, dec] of edges) {
      for (const order of [0, 12]) {
        const i = hpxNest(ra, dec, order);
        expect(Number.isInteger(i)).toBe(true);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(12 * 4 ** order);
      }
    }
  });

  it("RA 360 is the same cell as RA 0", () => {
    expect(hpxNest(360, 20, 12)).toBe(hpxNest(0, 20, 12));
    expect(hpxNest(720.5, -30, 8)).toBe(hpxNest(0.5, -30, 8));
    expect(hpxNest(-90, 10, 8)).toBe(hpxNest(270, 10, 8));
  });

  it("throws RangeError on invalid input", () => {
    expect(() => hpxNest(NaN, 0)).toThrow(RangeError);
    expect(() => hpxNest(Infinity, 0)).toThrow(RangeError);
    expect(() => hpxNest(0, NaN)).toThrow(RangeError);
    expect(() => hpxNest(0, 90.5)).toThrow(RangeError);
    expect(() => hpxNest(0, -91)).toThrow(RangeError);
    expect(() => hpxNest(0, 0, 1.5)).toThrow(RangeError);
    expect(() => hpxNest(0, 0, 16)).toThrow(RangeError);
    expect(() => hpxNest(0, 0, -1)).toThrow(RangeError);
  });

  it("base-cell structure: north polar cap is 0..3 and south polar cap is 8..11", () => {
    // The polar caps lie poleward of |dec| = 41.8 deg, so these points are well inside them.
    for (const ra of [0, 45, 90, 135, 180, 225, 270, 315]) {
      expect(hpxNest(ra, 80, 0)).toBeLessThanOrEqual(3);
      expect(hpxNest(ra, -80, 0)).toBeGreaterThanOrEqual(8);
    }
  });
});

describe("base cells cover the sphere", () => {
  it("a 2000-point grid at order 0 hits exactly the 12 indices 0..11", () => {
    const seen = new Set<number>();
    const nRa = 40;
    const nDec = 50;
    for (let a = 0; a < nRa; a++) {
      for (let d = 0; d < nDec; d++) {
        const ra = (360 * (a + 0.5)) / nRa;
        const dec = (Math.asin(-1 + (2 * (d + 0.5)) / nDec) * 180) / Math.PI;
        seen.add(hpxNest(ra, dec, 0));
      }
    }
    expect([...seen].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
});

describe("cellCenter", () => {
  it("is within about one cell of the position it was computed from", () => {
    for (const order of [3, 8, 12]) {
      for (const pos of randomPositions(60, 20 + order)) {
        const c = cellCenter(hpxNest(pos[0], pos[1], order), order);
        expect(angSep(c, pos)).toBeLessThan(cellSize(order));
      }
    }
  });

  it("round-trips: hpxNest(cellCenter(i)) === i", () => {
    for (const order of [3, 8, 12]) {
      const npix = 12 * 4 ** order;
      const r = rng(100 + order);
      const samples = [0, npix - 1, ...Array.from({ length: 80 }, () => Math.floor(r() * npix))];
      for (const i of samples) {
        const [ra, dec] = cellCenter(i, order);
        expect(hpxNest(ra, dec, order)).toBe(i);
      }
    }
  });

  it("returns ra in [0, 360) and dec in [-90, 90]", () => {
    for (const i of [0, 5, 11]) {
      const [ra, dec] = cellCenter(i, 0);
      expect(ra).toBeGreaterThanOrEqual(0);
      expect(ra).toBeLessThan(360);
      expect(dec).toBeGreaterThanOrEqual(-90);
      expect(dec).toBeLessThanOrEqual(90);
    }
  });

  it("throws RangeError for an out-of-range index or order", () => {
    expect(() => cellCenter(12 * 4 ** 3, 3)).toThrow(RangeError);
    expect(() => cellCenter(0, 16)).toThrow(RangeError);
  });
});

describe("cellCorners", () => {
  it("returns 4 corners, each within about 1.5 cells of the centre", () => {
    for (const order of [3, 8, 12]) {
      const r = rng(200 + order);
      const npix = 12 * 4 ** order;
      for (let n = 0; n < 40; n++) {
        const i = Math.floor(r() * npix);
        const centre = cellCenter(i, order);
        const corners = cellCorners(i, order);
        expect(corners).toHaveLength(4);
        for (const [ra, dec] of corners) {
          expect(ra).toBeGreaterThanOrEqual(0);
          expect(ra).toBeLessThan(360);
          expect(dec).toBeGreaterThanOrEqual(-90);
          expect(dec).toBeLessThanOrEqual(90);
          expect(angSep([ra, dec], centre)).toBeLessThan(1.5 * cellSize(order));
        }
      }
    }
  });

  it("corners of a cell contain its centre's cell (corner points are not the centre)", () => {
    const i = hpxNest(100, 30, 6);
    const corners = cellCorners(i, 6);
    const centre = cellCenter(i, 6);
    for (const c of corners) {
      expect(angSep(c, centre)).toBeGreaterThan(0);
    }
  });

  it("throws RangeError for an out-of-range index", () => {
    expect(() => cellCorners(-1, 3)).toThrow(RangeError);
    expect(() => cellCorners(12 * 4 ** 3, 3)).toThrow(RangeError);
  });
});
