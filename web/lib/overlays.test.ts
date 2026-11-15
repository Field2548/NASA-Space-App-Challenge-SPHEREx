// /api/overlay: the pure builder on the real catalogs, and the route with real files and cookies.
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/overlay/route";
import { buildOverlay, EMPTY_OVERLAY, emptyOverlay, type OverlayCatalog } from "@/lib/overlays";
import { resetRateLimit } from "@/lib/server/rateLimit";
import { encodeUnlocked, UNLOCK_COOKIE } from "@/lib/server/unlock";

const WEB = process.cwd();
const readJson = (rel: string) => JSON.parse(readFileSync(path.join(WEB, rel), "utf8"));
const eros: OverlayCatalog = readJson("data/catalog/eros.json");
const cygnus: OverlayCatalog = readJson("data/catalog/cygnus.json");
const erosSize = readJson("public/fields/eros/field.json").size as [number, number];
const [W, H] = erosSize;
const inside = (x: number, y: number) => x >= -0.5 && x <= W - 0.5 && y >= -0.5 && y <= H - 0.5;

beforeEach(() => resetRateLimit());

describe("buildOverlay", () => {
  it("round mode equals the locked answer and leaks nothing", () => {
    const out = buildOverlay(eros, erosSize, "round");
    expect(out).toEqual({ locked: true, asteroids: [], stars: [] });
    expect(out).toEqual(EMPTY_OVERLAY);
    const text = JSON.stringify(out);
    for (const word of ["Eros", "433", "Gaia"]) expect(text).not.toContain(word);
    expect(emptyOverlay()).not.toBe(emptyOverlay());
  });

  it("explore on eros: the Eros body, stars and the inside rule", () => {
    const out = buildOverlay(eros, erosSize, "explore");
    expect(out.locked).toBe(false);
    const body = out.asteroids.find((a) => a.name.startsWith("433 Eros"));
    const cat = eros.asteroids!.find((a) => a.name.startsWith("433 Eros"))!;
    expect(body).toBeDefined();
    expect(body!.positions).toHaveLength(3);
    expect(body!.positions.map((p) => p.frame)).toEqual([1, 2, 3]);
    body!.positions.forEach((p, i) => expect(p).toMatchObject({ frame: cat.positions[i].frame, x: cat.positions[i].x, y: cat.positions[i].y }));
    expect(out.stars.length).toBeGreaterThan(0);
    for (const s of out.stars) {
      expect(s.xy).toHaveLength(5);
      expect([s.x, s.y]).toEqual(s.xy[0]);
      expect(s.xy.some(([x, y]) => inside(x, y))).toBe(true);
    }
    for (const a of out.asteroids) {
      expect(a.positions.length).toBeGreaterThan(0);
      for (const p of a.positions) expect(inside(p.x, p.y)).toBe(true);
    }
  });

  it("pm_arcsec_yr, name fallback, vmag null", () => {
    const cat: OverlayCatalog = {
      stars: [
        { source: "gaia", id: "G1", name: null, pmra: 600, pmdec: 800, g_mag: 12, xy: [[5, 5]] },
        { source: "simbad", id: "S1", name: "", pmra: null, pmdec: 3, xy: [[6, 6]] },
        { source: "simbad", id: "S2", name: "Vega", xy: [[7, 7]] },
      ],
      asteroids: [{ name: "X", positions: [{ frame: 1, x: 1, y: 1 }] }],
    };
    const out = buildOverlay(cat, [32, 32], "explore");
    expect(out.stars[0]).toMatchObject({ name: "G1", pm_arcsec_yr: 1, g_mag: 12 });
    expect(out.stars[1]).toMatchObject({ name: "S1", pm_arcsec_yr: null, g_mag: null });
    expect(out.stars[2]).toMatchObject({ name: "Vega", pm_arcsec_yr: null });
    expect(out.asteroids[0].positions[0].vmag).toBeNull();
  });

  it("drops outside-the-picture stars and positions, and empty bodies", () => {
    const cat: OverlayCatalog = {
      stars: [
        { source: "gaia", id: "out", xy: [[-0.6, 1], [10.6, 1]] },
        { source: "gaia", id: "edge", xy: [[-0.5, 10.5]] },
      ],
      asteroids: [
        { name: "A", positions: [{ frame: 1, x: 40, y: 1 }, { frame: 2, x: 3, y: 3 }] },
        { name: "B", positions: [{ frame: 1, x: 99, y: 99 }] },
      ],
    };
    const out = buildOverlay(cat, [11, 11], "explore");
    expect(out.stars.map((s) => s.name)).toEqual(["edge"]);
    expect(out.asteroids).toEqual([{ name: "A", positions: [{ frame: 2, x: 3, y: 3, vmag: null }] }]);
  });

  it("does not change the catalog", () => {
    const before = structuredClone(eros);
    buildOverlay(eros, erosSize, "explore");
    buildOverlay(eros, erosSize, "round");
    expect(eros).toEqual(before);
  });

  it("cygnus: no asteroids, many stars", () => {
    const out = buildOverlay(cygnus, readJson("public/fields/cygnus/field.json").size, "explore");
    expect(out.asteroids).toHaveLength(0);
    expect(out.stars.length).toBeGreaterThan(100);
  });
});

async function call(query: string, unlocked?: string[]) {
  const headers: Record<string, string> = {};
  if (unlocked) headers.cookie = `${UNLOCK_COOKIE}=${encodeUnlocked(unlocked)}`;
  const res = await GET(new NextRequest(`http://localhost/api/overlay?${query}`, { headers }));
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text), res };
}

describe("GET /api/overlay", () => {
  it("no cookie + explore gives the locked answer", async () => {
    const r = await call("spot=eros&mode=explore");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ locked: true, asteroids: [], stars: [] });
    for (const word of ["Eros", "433", "Gaia"]) expect(r.text).not.toContain(word);
  });

  it("a cookie for eros + explore gives the Eros body", async () => {
    const r = await call("spot=eros&mode=explore", ["eros"]);
    expect(r.status).toBe(200);
    expect(r.body.locked).toBe(false);
    expect(r.body.asteroids.some((a: { name: string }) => a.name.startsWith("433 Eros"))).toBe(true);
    expect(r.body.stars.length).toBeGreaterThan(0);
  });

  it("the same cookie + round, or no mode, or an unknown mode, is locked", async () => {
    for (const q of ["spot=eros&mode=round", "spot=eros", "spot=eros&mode=bogus"]) {
      const r = await call(q, ["eros"]);
      expect(r.body, q).toEqual({ locked: true, asteroids: [], stars: [] });
    }
  });

  it("a cookie for hektor does not unlock eros", async () => {
    const r = await call("spot=eros&mode=explore", ["hektor"]);
    expect(r.body).toEqual({ locked: true, asteroids: [], stars: [] });
  });

  it("unknown spot and spot without a catalog are 404 with the error shape", async () => {
    for (const spot of ["nope", "fixture"]) {
      const r = await call(`spot=${spot}&mode=explore`, [spot]);
      expect(r.status, spot).toBe(404);
      expect(r.body.error.code).toBe("not_found");
      expect(typeof r.body.error.message).toBe("string");
    }
  });

  it("a bad or missing slug is 400", async () => {
    for (const q of ["spot=../x", "spot=A%20B", "mode=explore"]) {
      const r = await call(q);
      expect(r.status, q).toBe(400);
      expect(r.body.error.code).toBe("bad_request");
    }
  });

  it("is never cached", async () => {
    const r = await call("spot=eros");
    expect(r.res.headers.get("cache-control")).toContain("no-store");
  });
});
