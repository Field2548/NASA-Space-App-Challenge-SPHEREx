// GET /api/info, called through the route with real files and the unlock cookie.
// The lock is tested on the JSON: a locked body has exactly the keys mode, locked, position.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/info/route";
import { answerInfo } from "@/lib/server/info";
import { resetRateLimit } from "@/lib/server/rateLimit";
import { encodeUnlocked, UNLOCK_COOKIE } from "@/lib/server/unlock";

const WEB = process.cwd();
const readJson = (rel: string) => JSON.parse(readFileSync(path.join(WEB, rel), "utf8"));

const erosAnswer = readJson("data/answers/eros.json");
const erosObject = erosAnswer.objects[0];
const erosFrame1 = erosObject.positions.find((p: { frame: number }) => p.frame === 1);
const erosCatalog = readJson("data/catalog/eros.json");
const erosCentre = { ra: 13.2004, dec: 14.38 };

beforeEach(() => resetRateLimit());

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
  it("explore is granted, live lookups are skipped, nothing is invented", async () => {
    const { status, body } = await get("ra=100&dec=-60&mode=explore");
    expect(status).toBe(200);
    expect(body).toEqual({
      mode: "explore",
      locked: false,
      position: { ra: 100, dec: -60 },
      sources: { simbad: "skipped", gaia: "skipped", jpl: "skipped" },
      simbad: [],
      gaia: null,
      solar_system: [],
      links: [
        { label: "IRSA Spectrophotometry Tool", url: "https://irsa.ipac.caltech.edu/applications/spherex/tool-spectrophotometry" },
      ],
    });
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
