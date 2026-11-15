// GET /api/info, called through the route with real files and the unlock cookie.
// The lock is tested on the JSON: a locked body has exactly the keys mode, locked, position.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/info/route";
import { answerInfo, guardBandPx } from "@/lib/server/info";
import { clearLiveCache } from "@/lib/server/liveCatalog";
import { pixelToSky } from "@/lib/wcs";
import type { FieldWcs } from "@/lib/types";
import { resetRateLimit } from "@/lib/server/rateLimit";
import { encodeUnlocked, UNLOCK_COOKIE } from "@/lib/server/unlock";

const WEB = process.cwd();
const readJson = (rel: string) => JSON.parse(readFileSync(path.join(WEB, rel), "utf8"));

const erosAnswer = readJson("data/answers/eros.json");
const erosObject = erosAnswer.objects[0];
const erosFrame1 = erosObject.positions.find((p: { frame: number }) => p.frame === 1);
const erosCatalog = readJson("data/catalog/eros.json");
const erosCentre = { ra: 13.2004, dec: 14.38 };

// The tests below check the old lock, which stays behind INSPECT_LOCK=1. The default (Inspect open
// for everyone, user decision 2026-11-15) is checked in "Inspect open by default" at the end.
beforeEach(() => {
  resetRateLimit();
  vi.stubEnv("INSPECT_LOCK", "1");
});
afterEach(() => vi.unstubAllEnvs());

/** Call GET /api/info; `unlocked` lists the spots the caller's cookie opens. */
async function call(query: string, unlocked?: string[]) {
  const headers: Record<string, string> = {};
  if (unlocked) headers.cookie = `${UNLOCK_COOKIE}=${encodeUnlocked(unlocked)}`;
  const res = await GET(new NextRequest(`http://localhost/api/info?${query}`, { headers }));
  return { status: res.status, text: await res.text(), res };
}
/** Status and parsed JSON body of one call. */
async function get(query: string, unlocked?: string[]) {
  const r = await call(query, unlocked);
  return { status: r.status, body: JSON.parse(r.text), res: r.res };
}

const erosXy = `spot=eros&x=${erosFrame1.x}&y=${erosFrame1.y}`;

describe("GET /api/info: the mode parameter", () => {
  it("an unknown mode is a 400 bad_request, not a silent round", async () => {
    const { status, body } = await get(`${erosXy}&mode=zz`);
    expect(status).toBe(400);
    expect(body.error.code).toBe("bad_request");
    const outside = await get(`ra=${erosCentre.ra}&dec=${erosCentre.dec}&mode=Explore`);
    expect(outside.status).toBe(400);
    expect(outside.body.error.code).toBe("bad_request");
  });

  it("a missing mode is round", async () => {
    const { status, body } = await get(`${erosXy}`);
    expect(status).toBe(200);
    expect(body).toMatchObject({ mode: "round", locked: true });
  });
});

describe("GET /api/info: the lock", () => {
  it("mode=round on eros returns exactly mode, locked and position, with no name or number 433", async () => {
    const { status, text, res } = await call(`${erosXy}&mode=round`);
    const body = JSON.parse(text);
    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(["locked", "mode", "position"]);
    expect(body).toMatchObject({ mode: "round", locked: true });
    expect(body.position).toMatchObject({ x: erosFrame1.x, y: erosFrame1.y });
    expect(text).not.toContain("Eros");
    expect(text).not.toContain("433");
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("mode=explore without the cookie gives the identical locked shape", async () => {
    const round = await get(`${erosXy}&mode=round`);
    const explore = await get(`${erosXy}&mode=explore`);
    expect(explore.body).toEqual(round.body);
    expect(Object.keys(explore.body).sort()).toEqual(["locked", "mode", "position"]);
  });

  it("mode=explore with a cookie for a different spot is still locked", async () => {
    const { body } = await get(`${erosXy}&mode=explore`, ["hektor"]);
    expect(body).toMatchObject({ mode: "round", locked: true });
    expect(Object.keys(body).sort()).toEqual(["locked", "mode", "position"]);
  });

  it("a forged cookie does not unlock", async () => {
    const forged = `${UNLOCK_COOKIE}=v1.${Buffer.from("eros").toString("base64url")}.nope`;
    const res = await GET(new NextRequest(`http://localhost/api/info?${erosXy}&mode=explore`, { headers: { cookie: forged } }));
    expect((await res.json()).locked).toBe(true);
  });

  it("ra/dec at the eros spot centre is locked without the cookie (inside a ready spot)", async () => {
    const { body } = await get(`ra=${erosCentre.ra}&dec=${erosCentre.dec}&mode=explore`);
    expect(body).toMatchObject({ mode: "round", locked: true });
    expect(body.position).toHaveProperty("x");
    expect(body.position).toHaveProperty("y");
  });
});

describe("GET /api/info: explore on a ready spot with the cookie", () => {
  it("names the asteroid at its frame-1 pixel with sep_px <= 2 and the reveal title", async () => {
    const { status, body } = await get(`${erosXy}&mode=explore`, ["eros"]);
    expect(status).toBe(200);
    expect(body).toMatchObject({ mode: "explore", locked: false });
    expect(Object.keys(body).sort()).toEqual(
      ["gaia", "links", "locked", "mode", "position", "simbad", "solar_system", "sources", "spot_reveal"].sort(),
    );
    const hit = body.solar_system.find((s: { name: string }) => s.name.includes("Eros"));
    expect(hit).toBeDefined();
    expect(Number.isFinite(hit.sep_px)).toBe(true);
    expect(hit.sep_px).toBeLessThanOrEqual(2);
    expect(hit).toMatchObject({ frame: 1, r_au: expect.any(Number), delta_au: expect.any(Number) });
    expect(body.spot_reveal.title).toBe("(433) Eros");
    // No Gaia star within 6 arcsec of this pixel, so gaia is "empty" (the file has the source).
    expect(body.sources).toEqual({ simbad: "error", gaia: "empty", jpl: "premade" });
  });

  it("a pixel far from everything has no solar-system entries", async () => {
    const { body } = await get("spot=eros&x=0&y=0&mode=explore", ["eros"]);
    expect(body.locked).toBe(false);
    expect(body.solar_system).toEqual([]);
  });

  it("finds the nearest Gaia star at its frame-1 pixel (within 6 arcsec)", async () => {
    const star = erosCatalog.stars.find((s: { source: string; xy?: number[][] }) => s.source === "gaia" && s.xy?.length);
    const [sx, sy] = star.xy[0];
    const { body } = await get(`spot=eros&x=${sx}&y=${sy}&mode=explore`, ["eros"]);
    expect(body.gaia.id).toBe(star.id);
    expect(body.gaia.sep_arcsec).toBeLessThan(6);
  });

  it("answers the ra/dec of a pixel with the cookie", async () => {
    const { body } = await get(`ra=${erosCentre.ra}&dec=${erosCentre.dec}&mode=explore`, ["eros"]);
    expect(body.locked).toBe(false);
    expect(body.spot_reveal.title).toBe("(433) Eros");
  });
});

describe("GET /api/info: outside every ready spot", () => {
  it("explore is granted; SIMBAD and Gaia are asked live with an injected fetch, JPL is skipped", async () => {
    // CDS answers 404 (it was down), Gaia finds nothing: each source reports its own status.
    const seen: string[] = [];
    const fake = async (url: string) => {
      seen.push(url);
      return url.includes("simbad")
        ? new Response("not found", { status: 404 })
        : new Response(JSON.stringify({ metadata: [], data: [] }), { status: 200 });
    };
    const body = await answerInfo(new Request("http://localhost/api/info"), { ra: 100, dec: -60, mode: "explore" }, undefined, {
      fetchImpl: fake,
      now: () => 0,
    });
    expect(body).toEqual({
      mode: "explore",
      locked: false,
      position: { ra: 100, dec: -60 },
      sources: { simbad: "error", gaia: "empty", jpl: "skipped" },
      simbad: [],
      gaia: null,
      solar_system: [],
      links: [
        { label: "IRSA Spectrophotometry Tool", url: "https://irsa.ipac.caltech.edu/applications/spherex/tool-spectrophotometry" },
      ],
    });
    expect(seen).toHaveLength(2);
  });

  it("mode=round outside every ready spot gives the locked shape and makes no network call", async () => {
    let calls = 0;
    const fake = async () => {
      calls++;
      throw new Error("no network allowed for a round answer");
    };
    const body = await answerInfo(new Request("http://localhost/api/info"), { ra: 102, dec: -61, mode: "round" }, undefined, {
      fetchImpl: fake,
    });
    expect(body).toEqual({ mode: "round", locked: true, position: { ra: 102, dec: -61 } });
    expect(Object.keys(body).sort()).toEqual(["locked", "mode", "position"]);
    expect(calls).toBe(0);
  });
});

describe("GET /api/info: a ready spot without a catalog file", () => {
  let root: string | undefined;
  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("all sources skipped, empty lists, still open with the cookie", async () => {
    // Every real ready spot has a catalog file, so build a temporary app folder with one spot that has none.
    root = mkdtempSync(path.join(tmpdir(), "info-nocat-"));
    mkdirSync(path.join(root, "public", "fields", "nocat"), { recursive: true });
    writeFileSync(path.join(root, "public", "fields", "index.json"), JSON.stringify([{ slug: "nocat" }]));
    copyFileSync(
      path.join(WEB, "public", "fields", "eros", "field.json"),
      path.join(root, "public", "fields", "nocat", "field.json"),
    );
    const req = new Request("http://localhost/api/info", {
      headers: { cookie: `${UNLOCK_COOKIE}=${encodeUnlocked(["nocat"])}` },
    });
    const body = await answerInfo(req, { spot: "nocat", x: 10, y: 10, mode: "explore" }, root);
    expect(body).toMatchObject({
      mode: "explore",
      locked: false,
      sources: { simbad: "skipped", gaia: "skipped", jpl: "skipped" },
      simbad: [],
      gaia: null,
      solar_system: [],
    });
    expect(body.links).toEqual([expect.objectContaining({ label: "IRSA Spectrophotometry Tool" })]);
    expect(body).not.toHaveProperty("spot_reveal");
  });

  it("the real cygnus file answers, with SIMBAD marked as an error (CDS was down when it was made)", async () => {
    const { body } = await get("spot=cygnus&x=60&y=60&mode=explore", ["cygnus"]);
    expect(body.locked).toBe(false);
    expect(body.sources.simbad).toBe("error");
  });
});

describe("GET /api/info: overlapping ready spots", () => {
  let overlapRoot: string | undefined;
  afterAll(() => {
    if (overlapRoot) rmSync(overlapRoot, { recursive: true, force: true });
  });

  it("a position inside two spots is unlocked only with the cookie for both", async () => {
    // Two spots with the same picture, so every position in one is in the other too.
    overlapRoot = mkdtempSync(path.join(tmpdir(), "info-overlap-"));
    for (const slug of ["alpha", "beta"]) {
      mkdirSync(path.join(overlapRoot, "public", "fields", slug), { recursive: true });
      copyFileSync(
        path.join(WEB, "public", "fields", "eros", "field.json"),
        path.join(overlapRoot, "public", "fields", slug, "field.json"),
      );
    }
    writeFileSync(
      path.join(overlapRoot, "public", "fields", "index.json"),
      JSON.stringify([{ slug: "alpha" }, { slug: "beta" }]),
    );
    const req = (cookieSpots: string[]) =>
      new Request("http://localhost/api/info", {
        headers: { cookie: `${UNLOCK_COOKIE}=${encodeUnlocked(cookieSpots)}` },
      });
    const query = { ra: erosCentre.ra, dec: erosCentre.dec, mode: "explore" } as const;

    const oneOnly = await answerInfo(req(["alpha"]), query, overlapRoot);
    expect(oneOnly).toMatchObject({ mode: "round", locked: true });
    expect(Object.keys(oneOnly).sort()).toEqual(["locked", "mode", "position"]);

    const both = await answerInfo(req(["alpha", "beta"]), query, overlapRoot);
    expect(both).toMatchObject({ mode: "explore", locked: false, sources: { simbad: "skipped" } });
  });
});

describe("GET /api/info: the guard band around a ready spot's picture", () => {
  const field = readJson("public/fields/eros/field.json");
  const [W, H] = field.size as [number, number];
  /** ra/dec of pixel (x, y) on the eros picture. */
  const skyOf = (x: number, y: number) => {
    const [ra, dec] = pixelToSky(field.wcs as FieldWcs, H, x, y);
    return `ra=${ra}&dec=${dec}`;
  };
  const fetchSpy = vi.fn(async (): Promise<Response> => {
    throw new Error("a live lookup was made inside a ready spot's guard band");
  });
  beforeEach(() => {
    fetchSpy.mockClear();
    clearLiveCache();
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("the band is ceil(9 arcsec / pixel) + 1 px wide (3 px for 6.15 arcsec pixels)", () => {
    expect(guardBandPx(6.15)).toBe(3);
  });

  const near: [number, number][] = [
    [-0.51, 60], [-0.6, 60], [-1.5, 60], [-2, 60],
    [60, -0.6], [60, -2], [60, H - 0.4], [60, H + 1.4],
    [W - 0.4, 60], [W + 1.4, 60], [-2, -2], [W + 1.4, H + 1.4],
  ];
  it.each(near)("pixel (%f, %f) just outside the picture is locked, with no outbound call", async (x, y) => {
    const { status, body } = await get(`${skyOf(x, y)}&mode=explore`);
    expect(status).toBe(200);
    expect(body).toMatchObject({ mode: "round", locked: true });
    expect(Object.keys(body).sort()).toEqual(["locked", "mode", "position"]);
    expect(body.position.x).toBeCloseTo(x, 3);
    expect(body.position.y).toBeCloseTo(y, 3);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("with the cookie the band is answered from the pre-made catalog, echoing the asked position", async () => {
    const { body } = await get(`${skyOf(-1.5, 60)}&mode=explore`, ["eros"]);
    expect(body).toMatchObject({ mode: "explore", locked: false });
    expect(body.position.x).toBeCloseTo(-1.5, 3);
    expect(body.sources.jpl).toMatch(/^(premade|empty)$/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the cookie of another spot does not open the band", async () => {
    const { body } = await get(`${skyOf(-2, 60)}&mode=explore`, ["hektor"]);
    expect(body).toMatchObject({ mode: "round", locked: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a position 10 px outside the picture is live: SIMBAD and Gaia are asked", async () => {
    fetchSpy.mockImplementation(async () => new Response(JSON.stringify({ metadata: [], data: [] }), { status: 200 }));
    const { body } = await get(`${skyOf(-10, 60)}&mode=explore`);
    expect(body).toMatchObject({ mode: "explore", locked: false, sources: { simbad: "empty", gaia: "empty", jpl: "skipped" } });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("GET /api/info: input errors", () => {
  it("400 for a missing position", async () => {
    expect((await get("mode=explore")).status).toBe(400);
  });
  it("400 for x without a spot", async () => {
    const { status, body } = await get("x=10&y=10&mode=explore");
    expect(status).toBe(400);
    expect(body.error.code).toBe("bad_request");
  });
  it("400 for ra=400", async () => {
    expect((await get("ra=400&dec=0")).status).toBe(400);
  });
  it("400 for a spot without x and y", async () => {
    expect((await get("spot=eros")).status).toBe(400);
  });
  it("400 for a pixel more than 2 px outside the picture", async () => {
    expect((await get("spot=eros&x=-3&y=10")).status).toBe(400);
  });
  it("400 for an empty x (not read as 0)", async () => {
    expect((await get("spot=eros&x=&y=10")).status).toBe(400);
  });
  it("404 for an unknown spot", async () => {
    const { status, body } = await get("spot=nosuch&x=1&y=1");
    expect(status).toBe(404);
    expect(body.error.code).toBe("not_found");
  });
});

describe("GET /api/info: Inspect open by default", () => {
  it("mode=round on eros, with no cookie, answers in full and names the object", async () => {
    vi.stubEnv("INSPECT_LOCK", "");
    const { status, text } = await call(`${erosXy}&mode=round`);
    const body = JSON.parse(text);
    expect(status).toBe(200);
    expect(body.locked).toBe(false);
    expect(text).toContain("Eros");
  });

  it("a missing mode is also answered in full", async () => {
    vi.stubEnv("INSPECT_LOCK", "");
    const { body } = await get(`${erosXy}`);
    expect(body.locked).toBe(false);
  });
});
