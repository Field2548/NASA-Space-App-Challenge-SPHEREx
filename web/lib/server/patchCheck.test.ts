// POST /api/patch-check and GET /api/patches with JPL, IRSA, the store and the login injected.
// Contract: docs/contracts/api.md sections 14 and 15. No network.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { patchFromPoint } from "@/lib/patch";
import type { QuickLookList } from "@/lib/quicklook";
import { handle } from "@/lib/server/http";
import { buildPatchKey, framesMatchList, runPatchCheck, runPatches, type PatchDeps } from "@/lib/server/patchCheck";
import type { PatchStore, ReportRow, SolveRow } from "@/lib/server/patchStore";
import { resetRateLimit } from "@/lib/server/rateLimit";
import type { SbResult } from "@/lib/server/sbIdent";
import { pixelToSky } from "@/lib/wcs";

const patch = patchFromPoint(13.2004, 14.38); // Eros's ready spot centre, snapped to its patch
const NAME = "433 Eros (A898 PA)";
const F = [
  { i: 1, mjd: 60865.752835 },
  { i: 2, mjd: 60865.888837 },
  { i: 3, mjd: 60865.955692 },
];
// The fake mover: frame 1 at (10, 12), frame 2 at (20, 22), frame 3 at (30, 32) on the 41 px grid.
const PX: Record<number, [number, number]> = { 1: [10, 12], 2: [20, 22], 3: [30, 32] };
const sky = (f: number) => pixelToSky(patch.wcs, patch.size[1], ...PX[f]);

/** IRSA's list: one 4-exposure burst (2 min apart, 1.5 min long) starting 3 min before each frame time. */
const list = {
  ra: patch.ra,
  dec: patch.dec,
  radius_deg: 0,
  exposures: F.flatMap((f, b) =>
    [0, 1, 2, 3].map((k) => ({ mjd: f.mjd - 3 / 1440 + (2 * k) / 1440, mjd_end: f.mjd - 1.5 / 1440 + (2 * k) / 1440, burst: b })),
  ),
  bursts: F.map((f, b) => ({ i: b, mjd: f.mjd - 3 / 1440, utc: "", exposures: [4 * b, 4 * b + 1, 4 * b + 2, 4 * b + 3], detectors: [] })),
  source: { service: "irsa_sia", collections: [], fetched_utc: "" },
} as unknown as QuickLookList;

function fakeStore(o: { solved?: boolean } = {}) {
  const solves: SolveRow[] = [];
  const reports: ReportRow[] = [];
  const store: PatchStore = {
    hasSolve: async () => o.solved ?? false,
    saveSolve: async (r) => (solves.push(r), true),
    saveReport: async (r) => (reports.push(r), true),
    near: async () => [],
  };
  return { store, solves, reports };
}

function deps(o: {
  jpl?: "ok" | "timeout" | "error" | "empty";
  vmag?: number;
  listFails?: boolean;
  store?: PatchStore | null;
  user?: { id: string } | null;
  calls?: number[];
} = {}): PatchDeps {
  return {
    list: async () => {
      if (o.listFails) throw new Error("IRSA 503");
      return list;
    },
    sbIdent: async (_ra, _dec, _h, mjd): Promise<SbResult> => {
      o.calls?.push(mjd);
      const st = o.jpl ?? "ok";
      if (st !== "ok") return { status: st, objects: [] };
      const f = F.find((x) => x.mjd === mjd);
      if (!f) return { status: "empty", objects: [] };
      const [ra, dec] = sky(f.i);
      return { status: "ok", objects: [{ name: NAME, ra, dec, vmag: o.vmag ?? 13.2 }] };
    },
    store: () => (o.store === undefined ? null : o.store),
    user: async () => o.user ?? null,
  };
}

const req = (body: unknown) =>
  new NextRequest("http://localhost/api/patch-check", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const call = async (body: unknown, d: PatchDeps) => {
  const res = await handle(() => runPatchCheck(req(body), d));
  return { status: res.status, text: await res.clone().text(), json: await res.json() };
};
const track = (marks: { frame: number; x: number; y: number }[], frames = F) => ({ patch: patch.id, answer: "track", marks, frames });
const HIT = [
  { frame: 1, x: 10.5, y: 12 },
  { frame: 2, x: 20, y: 21.4 },
];
const MISS = [
  { frame: 1, x: 5, y: 30 },
  { frame: 3, x: 12, y: 36 },
];

beforeEach(() => resetRateLimit());

describe("POST /api/patch-check", () => {
  it("a track on the known object is `known`, 100 points, and names it only now", async () => {
    const s = fakeStore();
    const r = await call(track(HIT), deps({ store: s.store, user: { id: "u1" } }));
    expect(r.status).toBe(200);
    expect(r.json.verdict.kind).toBe("known");
    expect(r.json.verdict.points).toBe(100);
    expect(r.json.verdict.object_name).toBe(NAME);
    expect(r.json.unlocked).toBe(true);
    expect(r.json.persisted).toBe(false);
    expect(r.json.patch).toEqual({ id: patch.id, ra: patch.ra, dec: patch.dec });
    expect(r.json.known_objects.asteroids[0].name).toBe(NAME);
    expect(r.json.known_objects.asteroids[0].positions[0]).toMatchObject({ frame: 1, vmag: 13.2 });
    expect(r.json.known_objects.asteroids[0].positions[0].x).toBeCloseTo(10, 6);
    expect(r.json.objects).toHaveLength(2);
    expect(r.json.solve_saved).toBe(true);
    expect(s.solves).toHaveLength(1);
    expect(JSON.stringify(s.solves[0])).not.toContain("Eros");
    expect(s.solves[0]).toMatchObject({ patch_id: patch.id, user_id: "u1" });
    expect(s.reports).toHaveLength(0);
  });

  it("asks JPL only at the marked frames' times", async () => {
    const calls: number[] = [];
    await call(track(HIT), deps({ calls }));
    expect(calls.sort()).toEqual([F[0].mjd, F[1].mjd]);
  });

  it("a moving track on nothing known is a `candidate`, saved as a report, with no name anywhere", async () => {
    const s = fakeStore();
    const r = await call(track(MISS), deps({ store: s.store }));
    expect(r.json.verdict.kind).toBe("candidate");
    expect(r.json.verdict.points).toBe(0);
    expect(r.json.unlocked).toBe(false);
    expect(r.text).not.toContain("Eros");
    expect(r.json.objects).toBeUndefined();
    expect(r.json.known_objects).toBeUndefined();
    expect(r.json.report.saved).toBe(true);
    expect(r.json.report.positions).toHaveLength(2);
    expect(s.reports).toHaveLength(1);
    expect(s.reports[0].marks[0]).toMatchObject({ frame: 1, x: 5, y: 30, mjd: F[0].mjd });
    expect(s.reports[0].frame_times).toEqual(F);
    expect(s.solves).toHaveLength(0);
  });

  it("with no database the check still answers, and nothing is saved", async () => {
    const r = await call(track(MISS), deps({ store: null }));
    expect(r.json.verdict.kind).toBe("candidate");
    expect(r.json.report).toEqual({ saved: false, positions: expect.any(Array) });
    expect(r.json.solve_saved).toBe(false);
  });

  it("a second correct answer by the same player is practice: 0 points, not saved again", async () => {
    const s = fakeStore({ solved: true });
    const r = await call(track(HIT), deps({ store: s.store, user: { id: "u1" } }));
    expect(r.json.verdict.kind).toBe("known");
    expect(r.json.verdict.points).toBe(0);
    expect(r.json.practice).toBe(true);
    expect(s.solves).toHaveLength(0);
  });

  it("a JPL timeout or error is an honest 502, never a score", async () => {
    for (const jpl of ["timeout", "error"] as const) {
      const r = await call(track(HIT), deps({ jpl }));
      expect(r.status).toBe(502);
      expect(r.json.error.code).toBe("upstream_failed");
      expect(r.json.error.details.service).toBe("jpl");
      expect(r.json.verdict).toBeUndefined();
    }
  });

  it("an IRSA list failure is a 502 naming IRSA", async () => {
    const r = await call(track(HIT), deps({ listFails: true }));
    expect(r.status).toBe(502);
    expect(r.json.error.details.service).toBe("irsa");
  });

  it("frame times that are not this patch's exposures are refused", async () => {
    const off = F.map((f) => ({ ...f, mjd: f.mjd + 0.5 }));
    const r = await call(track(HIT, off), deps());
    expect(r.status).toBe(400);
    expect(r.text).not.toContain("Eros");
  });

  it("refuses a bad patch id, a mark on a frame it does not list, and repeated frames", async () => {
    expect((await call({ ...track(HIT), patch: "p11-99999999" }, deps())).status).toBe(400);
    expect((await call({ ...track(HIT), patch: "eros" }, deps())).status).toBe(400);
    expect((await call(track([{ frame: 1, x: 1, y: 1 }, { frame: 9, x: 2, y: 2 }]), deps())).status).toBe(400);
    expect((await call(track(HIT, [F[0], F[0], F[1]]), deps())).status).toBe(400);
  });

  it("`nothing` is wrong when a bright known object is in the picture, and says no name", async () => {
    const r = await call({ patch: patch.id, answer: "nothing", frames: F }, deps({ vmag: 13.2 }));
    expect(r.json.verdict.kind).toBe("nothing_wrong");
    expect(r.json.unlocked).toBe(false);
    expect(r.text).not.toContain("Eros");
  });

  it("`nothing` with no bright known object is correct but earns 0 points (unknown movers are possible)", async () => {
    const faint = await call({ patch: patch.id, answer: "nothing", frames: F }, deps({ vmag: 20.5 }));
    expect(faint.json.verdict.kind).toBe("nothing_correct");
    expect(faint.json.verdict.points).toBe(0);
    expect(faint.json.verdict.message).toMatch(/cannot be ruled out/);
    const empty = await call({ patch: patch.id, answer: "nothing", frames: F }, deps({ jpl: "empty" }));
    expect(empty.json.verdict.kind).toBe("nothing_correct");
  });

  it("is rate limited at 10 a minute", async () => {
    const d = deps();
    for (let k = 0; k < 10; k++) expect((await call(track(MISS), d)).status).toBe(200);
    expect((await call(track(MISS), d)).status).toBe(429);
  });
});

describe("time budget", () => {
  it("JPL may take 110 s (measured 84 and 108 s on 2026-11-15); the route outlives the JPL timeout", async () => {
    const { maxDuration } = await import("@/app/api/patch-check/route");
    const { SB_IDENT_TIMEOUT_MS } = await import("@/lib/server/sbIdent");
    expect(SB_IDENT_TIMEOUT_MS).toBeGreaterThanOrEqual(120_000);
    expect(maxDuration * 1000).toBeGreaterThan(SB_IDENT_TIMEOUT_MS + 10_000);
    expect(maxDuration).toBeLessThanOrEqual(300); // Vercel's ceiling
  });
});

describe("buildPatchKey and framesMatchList", () => {
  it("groups rows by name, marks in-grid positions, calls a comet a comet, drops far rows", () => {
    const [ra, dec] = sky(1);
    const [fra, fdec] = pixelToSky(patch.wcs, 41, 200, 200);
    const key = buildPatchKey(
      patch,
      [
        { frame: 1, name: "C/2023 A3 (Tsuchinshan-ATLAS)", ra, dec, vmag: 9 },
        { frame: 2, name: "C/2023 A3 (Tsuchinshan-ATLAS)", ra: sky(2)[0], dec: sky(2)[1], vmag: 9 },
        { frame: 1, name: "far away", ra: fra, dec: fdec, vmag: 9 },
      ],
      F[0].mjd,
    );
    expect(key.objects).toHaveLength(1);
    expect(key.objects[0].kind).toBe("comet");
    expect(key.objects[0].positions.map((p) => p.in_grid)).toEqual([true, true]);
    expect(buildPatchKey(patch, [{ frame: 1, name: "433 Eros (A898 PA)", ra, dec, vmag: 9 }], 0).objects[0].kind).toBe("asteroid");
  });

  it("accepts frame times inside a burst (+-2 min) and refuses others", () => {
    expect(framesMatchList(F, list)).toBe(true);
    expect(framesMatchList([{ mjd: F[0].mjd + 10 / 1440 }], list)).toBe(false);
  });
});

describe("GET /api/patches", () => {
  const get = (q: string, store: PatchStore | null) =>
    handle(() => runPatches(new NextRequest(`http://localhost/api/patches?${q}`), { store: () => store }));

  it("with no database answers offline, edge-cacheable", async () => {
    const res = await get("ra=13.2&dec=14.4&r=1", null);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ patches: [], offline: true });
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=60");
  });

  it("passes the point and radius to the store and returns its patches", async () => {
    const seen: number[][] = [];
    const s = fakeStore().store;
    s.near = async (ra, dec, r) => (seen.push([ra, dec, r]), []);
    const res = await get("ra=-10&dec=14.4&r=5", s);
    expect(await res.json()).toEqual({ patches: [] });
    expect(seen).toEqual([[350, 14.4, 5]]);
  });

  it("refuses a radius over 5 degrees or a bad point", async () => {
    expect((await get("ra=1&dec=2&r=6", null)).status).toBe(400);
    expect((await get("ra=1&dec=95", null)).status).toBe(400);
    expect((await get("ra=x&dec=2", null)).status).toBe(400);
  });
});
