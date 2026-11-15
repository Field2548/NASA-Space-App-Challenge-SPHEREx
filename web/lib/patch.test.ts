// Picked patches: ids, the /play address, the still's tile plan, JPL sb_ident parsing and the
// /api/patches summary. Pure; no network.
import { beforeEach, describe, expect, it } from "vitest";
import { cellInTile, paintStill, planStill, stillTilePath, STILL_TILE_PX } from "./hipsStill";
import { patchFromId, patchFromParams, patchFromPoint, PATCH_SIZE_DEG, randomPatch } from "./patch";
import { sepDeg, summarise } from "./server/patchStore";
import { clearSbIdentCache, obsTime, parseSbIdent, parseSexa, querySbIdent, sbIdentUrl, sexa } from "./server/sbIdent";
import { skyToPixel } from "./wcs";

describe("patch ids and addresses", () => {
  it("a point snaps to its patch; the id round-trips; the point lies in the picture", () => {
    const p = patchFromPoint(13.2004, 14.38);
    expect(p.id).toMatch(/^p11-\d+$/);
    expect(patchFromId(p.id)).toEqual(p);
    expect(sepDeg(p.ra, p.dec, 13.2004, 14.38)).toBeLessThan(PATCH_SIZE_DEG / 2);
    const [x, y] = skyToPixel(p.wcs, p.size[1], 13.2004, 14.38) as [number, number];
    expect(x).toBeGreaterThan(-0.5);
    expect(x).toBeLessThan(p.size[0] - 0.5);
    expect(y).toBeGreaterThan(-0.5);
    expect(y).toBeLessThan(p.size[1] - 0.5);
    expect(p.corners).toHaveLength(4);
  });

  it("refuses ids out of range or malformed", () => {
    expect(patchFromId("p11-50331648")).toBeNull(); // 12 * 4^11
    expect(patchFromId("p11-50331647")).not.toBeNull();
    expect(patchFromId("eros")).toBeNull();
    expect(patchFromId("p11--1")).toBeNull();
  });

  it("reads ?patch= first, then ?ra=&dec=, and refuses bad points", () => {
    const p = patchFromPoint(200, -40);
    expect(patchFromParams({ patch: p.id, ra: "1", dec: "2" })?.id).toBe(p.id);
    expect(patchFromParams({ ra: "200", dec: "-40" })?.id).toBe(p.id);
    expect(patchFromParams({ ra: "200", dec: "95" })).toBeNull();
    expect(patchFromParams({ ra: "x", dec: "1" })).toBeNull();
    expect(patchFromParams({ ra: "", dec: "1" })).toBeNull();
    expect(patchFromParams({})).toBeNull();
  });

  it("random patches are valid and spread over both hemispheres", () => {
    let s = 1;
    const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const ps = Array.from({ length: 200 }, () => randomPatch(rand));
    expect(ps.every((p) => patchFromId(p.id) !== null)).toBe(true);
    const north = ps.filter((p) => p.dec > 0).length;
    expect(north).toBeGreaterThan(70);
    expect(north).toBeLessThan(130);
  });
});

describe("the still", () => {
  it("de-interleaves the nested bits: x from even bits, y from odd, row = x, col = y", () => {
    expect(cellInTile(0)).toEqual({ tile: 0, col: 0, row: 0 });
    expect(cellInTile(1)).toEqual({ tile: 0, col: 0, row: 1 });
    expect(cellInTile(2)).toEqual({ tile: 0, col: 1, row: 0 });
    expect(cellInTile(STILL_TILE_PX * STILL_TILE_PX + 3)).toEqual({ tile: 1, col: 1, row: 1 });
    expect(cellInTile(STILL_TILE_PX * STILL_TILE_PX - 1)).toEqual({ tile: 0, col: 511, row: 511 });
  });

  it("names tile files by HiPS directory", () => {
    expect(stillTilePath(7)).toBe("Norder5/Dir0/Npix7.png");
    expect(stillTilePath(12345)).toBe("Norder5/Dir10000/Npix12345.png");
  });

  it("plans one source pixel per grid pixel, each tile once, and paints from the tiles", () => {
    const p = patchFromPoint(13.2004, 14.38);
    const plan = planStill(p.wcs, p.size);
    expect(plan.src).toHaveLength(41 * 41);
    expect(new Set(plan.tiles).size).toBe(plan.tiles.length);
    expect(plan.tiles.length).toBeLessThanOrEqual(4);
    // A tile whose pixel value is its column (red) and row (green): the paint must copy them.
    const tile = new Uint8ClampedArray(STILL_TILE_PX * STILL_TILE_PX * 4);
    for (let r = 0; r < STILL_TILE_PX; r++)
      for (let c = 0; c < STILL_TILE_PX; c++) {
        tile[(r * STILL_TILE_PX + c) * 4] = c % 256;
        tile[(r * STILL_TILE_PX + c) * 4 + 1] = r % 256;
      }
    const out = paintStill(plan, plan.tiles.map(() => tile));
    plan.src.forEach((s, k) => {
      expect(out[k * 4]).toBe(s.col % 256);
      expect(out[k * 4 + 1]).toBe(s.row % 256);
      expect(out[k * 4 + 3]).toBe(255);
    });
    expect(paintStill(plan, plan.tiles.map(() => null)).every((v) => v === 0)).toBe(true);
  });
});

describe("JPL sb_ident", () => {
  beforeEach(() => clearSbIdentCache());

  it("formats and reads sexagesimal and times as the API wants", () => {
    expect(sexa(13.2004, true)).toBe("00-52-48.10");
    expect(sexa(-5.5)).toBe("M05-30-00.00");
    expect(parseSexa("00:52:48.10", true)).toBeCloseTo(13.2004, 4);
    expect(parseSexa("-05 30'00.0\"")).toBeCloseTo(-5.5, 6);
    expect(parseSexa("junk")).toBeNaN();
    expect(obsTime(60865.5)).toBe("2025-07-09_12:00:00");
  });

  it("asks a geocentric two-pass box widened in RA by 1/cos(dec)", () => {
    const q = new URL(sbIdentUrl(13.2, 60, 0.04, 60865.5)).searchParams;
    expect(q.get("xobs")).toBe("0,0,0,0,0,0");
    expect(q.get("two-pass")).toBe("true");
    expect(q.get("fov-dec-hwidth")).toBe("0.0400");
    expect(Number(q.get("fov-ra-hwidth"))).toBeCloseTo(0.08, 4);
  });

  const answer = {
    signature: {},
    fields_second: ["Object name", "Astrometric RA (hh:mm:ss)", "Astrometric Dec (dd mm'ss\")", "Dist. from center RA (\")", "Visual magnitude (V)"],
    data_second_pass: [
      ["433 Eros (A898 PA)", "00:52:48.10", "+14 22'48.0\"", "1", "13.2"],
      ["2001 XY", "00:52:50.00", "-01 00'00\"", "2", "n.a."],
    ],
  };

  it("parses rows, a missing magnitude as null, and no records as []", () => {
    const rows = parseSbIdent(answer);
    expect(rows[0]).toMatchObject({ name: "433 Eros (A898 PA)", vmag: 13.2 });
    expect(rows[0].dec).toBeCloseTo(14.38, 6);
    expect(rows[1].vmag).toBeNull();
    expect(rows[1].dec).toBeCloseTo(-1, 6);
    expect(parseSbIdent({ signature: {}, warning: "no matching records" })).toEqual([]);
    expect(() => parseSbIdent({ foo: 1 })).toThrow();
  });

  it("never throws: HTTP errors are `error`, a stall is `timeout`; answers are cached", async () => {
    let calls = 0;
    const ok = async () => (calls++, new Response(JSON.stringify(answer)));
    expect((await querySbIdent(1, 2, 0.04, 60000, { fetchImpl: ok })).status).toBe("ok");
    expect((await querySbIdent(1, 2, 0.04, 60000, { fetchImpl: ok })).status).toBe("ok");
    expect(calls).toBe(1);
    const bad = async () => new Response("", { status: 503 });
    expect(await querySbIdent(3, 4, 0.04, 60000, { fetchImpl: bad })).toEqual({ status: "error", objects: [] });
    const stall = (_u: string, init?: RequestInit) =>
      new Promise<Response>((_, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted"))));
    expect((await querySbIdent(5, 6, 0.04, 60000, { fetchImpl: stall, timeoutMs: 10 })).status).toBe("timeout");
  });
});

describe("summarise for /api/patches", () => {
  it("one entry per patch near the point, earliest solve time, reports merged, far patches dropped", () => {
    const a = patchFromPoint(13.2, 14.4);
    const far = patchFromPoint(200, -40);
    const out = summarise(
      [
        { patch_id: a.id, objects: [{ ra: 13.2, dec: 14.4 }], created_at: "2026-11-02T00:00:00Z" },
        { patch_id: a.id, objects: [{ ra: 9, dec: 9 }], created_at: "2026-11-01T00:00:00Z" },
        { patch_id: far.id, objects: [], created_at: "2026-11-01T00:00:00Z" },
        { patch_id: "junk", objects: [], created_at: "2026-11-01T00:00:00Z" },
      ],
      [{ patch_id: a.id, marks: [{ ra: 13.21, dec: 14.41, frame: 1, name: "x" }, { bad: true }] }],
      13.2,
      14.4,
      1,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: a.id, solved_at: "2026-11-01T00:00:00Z", objects: [{ ra: 13.2, dec: 14.4 }], reports: [{ ra: 13.21, dec: 14.41 }] });
    expect(JSON.stringify(out)).not.toContain('"name"');
  });
});
