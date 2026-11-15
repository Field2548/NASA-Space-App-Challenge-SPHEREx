// Saving answers, the /api/complete route and the no-database path. Contract: api.md sections 3, 4, 8.
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as complete } from "@/app/api/complete/route";
import { POST as check } from "@/app/api/check/route";
import { cellCenter, hpxNest } from "@/lib/healpix";
import { loadFieldForScoring, scoreSubmission, type AnswerKey, type FieldForScoring } from "@/lib/scoring";
import { hit, resetRateLimit } from "@/lib/server/rateLimit";
import { buildFindRow, hasVisit, saveFind } from "@/lib/server/persist";

const EROS_MARKS = [
  { frame: 1, x: 84, y: 79 },
  { frame: 3, x: 40, y: 43 },
];

// A small answer key with one known object that the marks above hit in two frames.
const erosKey = (nothingMoves = false): AnswerKey => ({
  slug: "eros",
  nothing_moves: nothingMoves,
  noise_bar_sigma: null,
  t_ref_mjd: 0,
  objects: [
    {
      id: "eros",
      name: "433 Eros (A898 PA)",
      kind: "asteroid",
      positions: [
        { frame: 1, x: 84, y: 79, in_grid: true },
        { frame: 3, x: 40, y: 43, in_grid: true },
      ],
    },
  ],
  bot: { candidates: [] },
});

async function erosField(difficulty = "easy"): Promise<FieldForScoring> {
  const field = await loadFieldForScoring("eros");
  if (!field) throw new Error("the eros field.json is missing");
  return { ...field, difficulty };
}

function fakeClient(rpc: (...args: unknown[]) => unknown): SupabaseClient {
  return { rpc } as unknown as SupabaseClient;
}

const REQ = new Request("http://localhost/api/check", { method: "POST" });

const post = (url: string, body: unknown) =>
  new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

function noDatabase() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
}

beforeEach(() => {
  resetRateLimit();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("buildFindRow", () => {
  it("stores the spot centre and its order-12 HEALPix cell for a known Eros find, never the mover", async () => {
    const field = await erosField();
    const scored = scoreSubmission(erosKey(), field, { answer: "track", marks: EROS_MARKS });
    expect(scored.verdict.kind).toBe("known");

    const row = buildFindRow("eros", field, scored, false);
    expect(row.p_spot).toBe("eros");
    expect(row.p_ra).toBe(field.ra);
    expect(row.p_dec).toBe(field.dec);
    expect(row.p_hpx12).toBe(hpxNest(field.ra!, field.dec!, 12));
    // The order-12 cell really is the spot centre (cells are about 0.86 arcmin).
    const [ra, dec] = cellCenter(row.p_hpx12, 12);
    expect(Math.abs(ra - field.ra!)).toBeLessThan(0.02);
    expect(Math.abs(dec - field.dec!)).toBeLessThan(0.02);
    expect(row.p_find_key).toBe("object:eros");
    expect(row.p_object_name).toBe("433 Eros (A898 PA)");
    expect(row.p_verdict).toBe("known");
  });

  it("gives the base points, and the first-finder bonus for easy and boss", async () => {
    const easy = await erosField("easy");
    const easyScored = scoreSubmission(erosKey(), easy, { answer: "track", marks: EROS_MARKS });
    expect(buildFindRow("eros", easy, easyScored, false)).toMatchObject({ p_points: 100, p_bonus: 50 });

    const boss = await erosField("boss");
    const bossScored = scoreSubmission(erosKey(), boss, { answer: "track", marks: EROS_MARKS });
    expect(buildFindRow("eros", boss, bossScored, false)).toMatchObject({ p_points: 1000, p_bonus: 500 });

    expect(buildFindRow("eros", easy, easyScored, true).p_practice).toBe(true);
  });

  it("a nothing answer has null track values", async () => {
    const field = await erosField("control");
    const scored = scoreSubmission(erosKey(true), field, { answer: "nothing" });
    const row = buildFindRow("eros", field, scored, false);
    expect(row).toMatchObject({
      p_x: null,
      p_y: null,
      p_vx: null,
      p_vy: null,
      p_verdict: "nothing_correct",
      p_find_key: "nothing",
      p_points: 250,
      p_bonus: 0,
    });
  });

  it("throws when the field has no centre (saveFind then reports not persisted)", async () => {
    const field = await erosField();
    const scored = scoreSubmission(erosKey(), field, { answer: "track", marks: EROS_MARKS });
    expect(() => buildFindRow("eros", { ...field, ra: undefined }, scored, false)).toThrow(/no centre/);
  });
});

describe("saveFind", () => {
  it("returns the RPC's values with persisted: true", async () => {
    const field = await erosField();
    const scored = scoreSubmission(erosKey(), field, { answer: "track", marks: EROS_MARKS });
    const rpc = vi.fn(async () => ({
      data: [{ first_finder: true, already_found: false, points: 150, counted: true }],
      error: null,
    }));
    const result = await saveFind(REQ, "eros", field, scored, false, {
      client: () => fakeClient(rpc),
      user: async () => ({ id: "user-1" }),
    });
    expect(result).toEqual({ persisted: true, first_finder: true, already_found: false, points: 150 });
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(fn).toBe("record_find");
    expect(args).toMatchObject({ p_user: "user-1", p_spot: "eros", p_find_key: "object:eros", p_bonus: 50 });
  });

  it("an RPC error gives not persisted, with the base points, and does not throw", async () => {
    const field = await erosField();
    const scored = scoreSubmission(erosKey(), field, { answer: "track", marks: EROS_MARKS });
    const result = await saveFind(REQ, "eros", field, scored, false, {
      client: () => fakeClient(async () => ({ data: null, error: { message: "boom" } })),
      user: async () => ({ id: "user-1" }),
    });
    expect(result).toEqual({ persisted: false, first_finder: false, already_found: false, points: 100 });
  });

  it("a thrown RPC gives not persisted and does not throw", async () => {
    const field = await erosField();
    const scored = scoreSubmission(erosKey(), field, { answer: "track", marks: EROS_MARKS });
    const result = await saveFind(REQ, "eros", field, scored, true, {
      client: () => fakeClient(() => Promise.reject(new Error("network down"))),
      user: async () => ({ id: "user-1" }),
    });
    expect(result).toEqual({ persisted: false, first_finder: false, already_found: false, points: 0 });
  });

  it("with no user it is not persisted and the RPC is not called", async () => {
    const field = await erosField();
    const scored = scoreSubmission(erosKey(), field, { answer: "track", marks: EROS_MARKS });
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    const result = await saveFind(REQ, "eros", field, scored, false, {
      client: () => fakeClient(rpc),
      user: async () => null,
    });
    expect(result.persisted).toBe(false);
    expect(result.points).toBe(100);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("with no database it is not persisted", async () => {
    noDatabase();
    const field = await erosField();
    const scored = scoreSubmission(erosKey(), field, { answer: "track", marks: EROS_MARKS });
    const result = await saveFind(REQ, "eros", field, scored, false);
    expect(result).toEqual({ persisted: false, first_finder: false, already_found: false, points: 100 });
  });
});

describe("hasVisit", () => {
  it("is false with no database", async () => {
    noDatabase();
    expect(await hasVisit("user-1", "eros")).toBe(false);
  });

  it("is true when the visits table has a row, and false on an error", async () => {
    const table = (data: unknown, error: unknown) => ({
      from: () => ({
        select: () => ({
          eq: () => ({ eq: () => ({ limit: async () => ({ data, error }) }) }),
        }),
      }),
    });
    const found = table([{ spot_slug: "eros" }], null) as unknown as SupabaseClient;
    expect(await hasVisit("user-1", "eros", { client: () => found })).toBe(true);
    const broken = table(null, { message: "x" }) as unknown as SupabaseClient;
    expect(await hasVisit("user-1", "eros", { client: () => broken })).toBe(false);
  });
});

describe("POST /api/complete", () => {
  it("answers 503 db_unavailable with no database", async () => {
    noDatabase();
    const res = await complete(post("http://localhost/api/complete", { replay: [{ spot: "fixture", answer: "nothing" }] }));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("db_unavailable");
  });

  it("answers 400 bad_request for a bad body", async () => {
    const empty = await complete(post("http://localhost/api/complete", { replay: [] }));
    expect(empty.status).toBe(400);
    expect((await empty.json()).error.code).toBe("bad_request");
    const notJson = await complete(post("http://localhost/api/complete", "not json"));
    expect(notJson.status).toBe(400);
    const tooMany = await complete(
      post("http://localhost/api/complete", { replay: Array.from({ length: 21 }, () => ({ spot: "fixture", answer: "nothing" })) }),
    );
    expect(tooMany.status).toBe(400);
  });

  it("answers 401 unauthorized with a database but no login token", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    const res = await complete(post("http://localhost/api/complete", { replay: [{ spot: "fixture", answer: "nothing" }] }));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized");
  });
});

describe("rate limit cost (hit)", () => {
  it("a call with cost uses that many units of the window", () => {
    expect(hit("cost-a", 30, 60_000, 0, 20)).toBe(0);
    expect(hit("cost-a", 30, 60_000, 0, 10)).toBe(0);
    expect(hit("cost-a", 30, 60_000, 0)).toBe(60);
  });

  it("a single call costing more than the whole limit is refused at once", () => {
    expect(hit("cost-b", 30, 60_000, 0, 31)).toBe(60);
  });
});

describe("POST /api/check without a database", () => {
  it("still answers persisted: false with the same points", async () => {
    noDatabase();
    const res = await check(
      post("http://localhost/api/check", {
        spot: "fixture",
        answer: "track",
        marks: [{ frame: 1, x: 10, y: 16 }, { frame: 4, x: 16, y: 16 }],
      }),
    );
    const json = await res.json();
    expect(json).toMatchObject({ persisted: false, first_finder: false, already_found: false, practice: false, unlocked: true });
    expect(json.verdict.points).toBe(100);
  });
});
