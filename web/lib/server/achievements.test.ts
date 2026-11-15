// GET /api/achievements with the real spot files and a fake database.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ user: null as { id: string } | null, rows: [] as unknown[], token: true }));
vi.mock("@/lib/server/db", () => ({
  bearerToken: () => (db.token ? "tok" : null),
  userFromRequest: async () => db.user,
  serviceClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: db.rows, error: null }) }) }) }),
  }),
}));

import { GET } from "@/app/api/achievements/route";
import { loadSpotInfos, summariseFinds } from "@/lib/server/achievements";
import { resetRateLimit } from "@/lib/server/rateLimit";

const call = async (qs = "") => {
  const res = await GET(new NextRequest(`http://localhost/api/achievements${qs}`));
  return { res, status: res.status, body: await res.json() };
};

beforeEach(() => {
  resetRateLimit();
  db.user = null;
  db.rows = [];
  db.token = false;
});

describe("summariseFinds", () => {
  it("counts only correct verdicts as solved, and skips fixture and quicklook", async () => {
    const spots = await loadSpotInfos();
    const rows = [
      { spot_slug: "eros", verdict: "nothing_wrong", points: 0, created_at: "2026-01-01T00:00:00Z" },
      { spot_slug: "hektor", verdict: "static", points: 0, created_at: "2026-01-01T00:00:00Z" },
      { spot_slug: "eris", verdict: "candidate", points: 0, created_at: "2026-01-01T00:00:00Z" },
      { spot_slug: "makemake", verdict: "known", points: 500, created_at: "2026-01-02T00:00:00Z" },
      { spot_slug: "quicklook", verdict: "known", points: 100, created_at: "2026-01-02T00:00:00Z" },
      { spot_slug: "fixture", verdict: "known", points: 100, created_at: "2026-01-02T00:00:00Z" },
    ];
    const r = summariseFinds(rows, spots);
    expect(r.solved.map((s) => s.slug)).toEqual(["makemake"]);
    expect(r.points).toBe(500);
  });
});

describe("GET /api/achievements", () => {
  it("guest with no solves: nothing unlocked, no-store, only goal counts exposed", async () => {
    const { res, status, body } = await call();
    expect(status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(body.source).toBe("guest");
    expect(body.unlocked).toBe(0);
    expect(body.total).toBe(body.achievements.length);
    expect(Object.keys(body).sort()).toEqual(["achievements", "source", "total", "unlocked"]);
    expect(JSON.stringify(body)).not.toMatch(/eris|makemake|eros|hektor|barnard/i);
  });

  it("guest solved list: unknown slugs ignored, times null", async () => {
    const { body } = await call("?solved=eros,nope,cygnus");
    const first = body.achievements.find((a: { id: string }) => a.id === "first-light");
    expect(first.unlocked).toBe(true);
    expect(first.unlockedAt).toBeNull();
    expect(body.achievements.find((a: { id: string }) => a.id === "still-sky").unlocked).toBe(true);
  });

  it("guest bad slug or too many entries is a 400", async () => {
    expect((await call("?solved=Bad_Slug")).status).toBe(400);
    const many = Array.from({ length: 41 }, (_, i) => `s${i}`).join(",");
    expect((await call(`?solved=${many}`)).status).toBe(400);
  });

  it("invalid bearer token is a 401", async () => {
    db.token = true;
    expect((await call()).status).toBe(401);
  });

  it("account: reads finds, wrong answers do not count", async () => {
    db.token = true;
    db.user = { id: "u1" };
    db.rows = [
      { spot_slug: "eros", verdict: "nothing_wrong", points: 0, created_at: "2026-01-01T00:00:00Z" },
      { spot_slug: "cygnus", verdict: "nothing_correct", points: 250, created_at: "2026-01-03T00:00:00Z" },
    ];
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.source).toBe("account");
    const get = (id: string) => body.achievements.find((a: { id: string }) => a.id === id);
    expect(get("first-light").unlockedAt).toBe("2026-01-03T00:00:00Z");
    expect(get("still-sky").unlocked).toBe(true);
    expect(get("rock-hunter").progress).toBe(0);
    expect(get("points-1").progress).toBe(250);
  });
});
