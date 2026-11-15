// GET /api/player?name= with a fake Supabase. Contract: api.md section 7a.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Reply = { data: unknown; error: { code?: string; message: string } | null };
const state = vi.hoisted(() => ({
  configured: true,
  calls: [] as { name: string; args: Record<string, unknown> }[],
  reply: null as Reply | null,
  serviceConfigured: true,
  serviceCalls: [] as { name: string; args: Record<string, unknown> }[],
  spotsReply: null as Reply | null,
}));

vi.mock("@/lib/server/db", async (original) => ({
  ...(await original<typeof import("@/lib/server/db")>()),
  anonClient: () =>
    state.configured
      ? {
          rpc: (name: string, args: Record<string, unknown>) => {
            state.calls.push({ name, args });
            return { abortSignal: async (): Promise<Reply> => state.reply as Reply };
          },
        }
      : null,
  serviceClient: () =>
    state.serviceConfigured
      ? {
          rpc: (name: string, args: Record<string, unknown>) => {
            state.serviceCalls.push({ name, args });
            return { abortSignal: async (): Promise<Reply> => state.spotsReply as Reply };
          },
        }
      : null,
}));

import { GET } from "@/app/api/player/route";
import * as botModule from "@/lib/server/bot";
import { BOT_NAME, botScore } from "@/lib/server/bot";
import { progressFrom } from "@/lib/server/player";
import { resetRateLimit } from "@/lib/server/rateLimit";

const get = (url: string, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${url}`, { headers });

const STATS = {
  display_name: "nova",
  is_me: false,
  country: "TH",
  member_since: "2026-11-15T03:10:00+00:00",
  last_active: "2026-11-15T09:28:00+00:00",
  points: 1850,
  points_week: 600,
  rank_all: 1,
  rank_week: 2,
  classifications: 14,
  correct: 11,
  first_finds: 2,
  patches_solved: 5,
  active_days: 2,
};

// eros (easy), hektor (medium), makemake (hard), two tools, and a slug that is not a ready spot.
const SPOTS = ["eros", "hektor", "makemake", "barnard", "rw-aur", "old-stage"];

beforeEach(() => {
  resetRateLimit();
  state.configured = true;
  state.calls = [];
  state.reply = { data: [STATS], error: null };
  state.serviceConfigured = true;
  state.serviceCalls = [];
  state.spotsReply = { data: SPOTS, error: null };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/player", () => {
  it("answers for a player, with stages mapped from the spot list", async () => {
    const res = await GET(get("/api/player?name=Nova", { authorization: "Bearer t" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(state.calls).toEqual([{ name: "player_stats", args: { p_name: "Nova" } }]);
    // The slugs come from the service-role client only, by the stored display name.
    expect(state.serviceCalls).toEqual([{ name: "player_spots", args: { p_name: "nova" } }]);
    expect(await res.json()).toEqual({
      name: "nova",
      is_bot: false,
      is_me: false,
      country: "TH",
      member_since: "2026-11-15T03:10:00.000Z",
      last_active: "2026-11-15T09:28:00.000Z",
      points: 1850,
      points_week: 600,
      rank_all: 1,
      rank_week: 2,
      classifications: 14,
      correct: 11,
      accuracy: 0.786,
      stages_completed: 5,
      stages_total: 11,
      by_difficulty: {
        easy: { done: 1, total: 1 },
        medium: { done: 1, total: 2 },
        hard: { done: 1, total: 1 },
        boss: { done: 0, total: 1 },
        tool: { done: 2, total: 6 },
      },
      first_finds: 2,
      patches_solved: 5,
      active_days: 2,
    });
  });

  it("has null accuracy, ranks and dates for a player with nothing yet", async () => {
    state.reply = {
      data: [{ ...STATS, classifications: 0, correct: 0, rank_all: null, rank_week: null, last_active: null, country: null, points: 0, points_week: 0 }],
      error: null,
    };
    state.spotsReply = { data: [], error: null };
    const body = await (await GET(get("/api/player?name=nova"))).json();
    expect(body).toMatchObject({ accuracy: null, rank_all: null, rank_week: null, last_active: null, country: null, stages_completed: 0, stages_total: 11 });
  });

  it("leaves the stage fields out, and still answers, without the service key or when its call fails", async () => {
    const check = async () => {
      const res = await GET(get("/api/player?name=nova"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ name: "nova", points: 1850, rank_all: 1, classifications: 14 });
      for (const key of ["stages_completed", "stages_total", "by_difficulty"]) expect(body, key).not.toHaveProperty(key);
    };
    state.serviceConfigured = false;
    await check();
    state.serviceConfigured = true;
    state.spotsReply = { data: null, error: { code: "42501", message: "permission denied" } };
    await check();
    state.spotsReply = { data: "not a list", error: null };
    await check();
  });

  it("never asks the public player_stats for stages, and never returns slugs", async () => {
    // Even if a (stale) database still sent spots_solved, it is not used or passed on.
    state.reply = { data: [{ ...STATS, spots_solved: ["eros"] }], error: null };
    state.spotsReply = { data: [], error: null };
    const body = await (await GET(get("/api/player?name=nova"))).json();
    expect(body.stages_completed).toBe(0);
    expect(JSON.stringify(body)).not.toMatch(/spots_solved|eros|hektor/);
  });

  it("answers for the bot with points and a description only, no per-stage keys", async () => {
    const res = await GET(get("/api/player?name=SHIFT-AND-STACK%20bot"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["about", "is_bot", "is_me", "name", "points"]);
    expect(body).toMatchObject({ name: BOT_NAME, is_bot: true, is_me: false, points: (await botScore()).score });
    expect(body.about).toMatch(/shifts and stacks every frame/);
    expect(state.calls).toHaveLength(0);
    expect(state.serviceCalls).toHaveLength(0);
  });

  it("is 404 for an unknown name", async () => {
    state.reply = { data: [], error: null };
    const res = await GET(get("/api/player?name=nobody"));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });

  it("is 400 for a missing, empty or over-long name", async () => {
    for (const url of ["/api/player", "/api/player?name=", "/api/player?name=%20%20", `/api/player?name=${"a".repeat(41)}`]) {
      const res = await GET(get(url));
      expect(res.status, url).toBe(400);
      expect((await res.json()).error.code).toBe("bad_request");
    }
    expect((await GET(get(`/api/player?name=${"a".repeat(40)}`))).status).toBe(200);
    expect(state.calls).toHaveLength(1);
  });

  it("is 503 db_unavailable with no database, a missing function, or any database error", async () => {
    state.configured = false;
    for (const q of ["nova"]) {
      const res = await GET(get(`/api/player?name=${q}`));
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ error: { code: "db_unavailable", message: "Player stats are not available right now." } });
    }
    state.configured = true;
    for (const error of [
      { code: "PGRST202", message: "Could not find the function public.player_stats(p_name)" },
      { message: "function public.player_stats(text) does not exist" },
      { code: "XX000", message: "boom" },
    ]) {
      state.reply = { data: null, error };
      const res = await GET(get("/api/player?name=nova"));
      expect(res.status, error.message).toBe(503);
      expect((await res.json()).error.code).toBe("db_unavailable");
    }
  });

  it("returns no user id or email, even if the database sent one", async () => {
    state.reply = { data: [{ ...STATS, user_id: "00000000-0000-4000-8000-000000000001", email: "a@b.c" }], error: null };
    const text = JSON.stringify(await (await GET(get("/api/player?name=nova"))).json());
    expect(text).not.toMatch(/user_id|email|@|0000-4000/i);
  });

  it("is rate limited to 60 calls a minute", async () => {
    let last = 200;
    for (let i = 0; i < 61; i++) last = (await GET(get("/api/player?name=nova"))).status;
    expect(last).toBe(429);
  });
});

describe("rank_all counts the bot row like the all-time board", () => {
  const rankFor = async (points: number) => {
    state.reply = { data: [{ ...STATS, points, rank_all: 3 }], error: null };
    return (await (await GET(get("/api/player?name=nova"))).json()).rank_all;
  };

  it("adds 1 when the bot has strictly more points, and nothing when equal or fewer", async () => {
    const bot = (await botScore()).score;
    expect(bot).toBeGreaterThan(0);
    expect(await rankFor(bot - 1)).toBe(4);
    expect(await rankFor(bot)).toBe(3);
    expect(await rankFor(bot + 1)).toBe(3);
  });

  it("leaves a null rank null and rank_week alone", async () => {
    state.reply = { data: [{ ...STATS, points: 0, rank_all: null, rank_week: 2 }], error: null };
    const body = await (await GET(get("/api/player?name=nova"))).json();
    expect(body.rank_all).toBeNull();
    expect(body.rank_week).toBe(2);
  });

  it("leaves the rank unchanged when the bot is unavailable", async () => {
    const spy = vi.spyOn(botModule, "botScore").mockRejectedValue(new Error("no answer keys"));
    try {
      expect(await rankFor(0)).toBe(3);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("progressFrom", () => {
  const spots = [
    { slug: "a", difficulty: "easy" },
    { slug: "b", difficulty: "tool" },
    { slug: "c", difficulty: "tool" },
    { slug: "d", difficulty: "weird" },
  ];
  it("orders the fixed difficulties first and any other alphabetically after them", () => {
    const keys = Object.keys(progressFrom([...spots, { slug: "e", difficulty: "control" }], []).by_difficulty);
    expect(keys).toEqual(["easy", "tool", "control", "weird"]);
  });

  it("counts distinct ready spots per difficulty and ignores other slugs", () => {
    expect(progressFrom(spots, ["a", "a", "c", "zzz"])).toEqual({
      stages_completed: 2,
      stages_total: 4,
      by_difficulty: { easy: { done: 1, total: 1 }, tool: { done: 1, total: 2 }, weird: { done: 0, total: 1 } },
    });
    expect(Object.keys(progressFrom(spots, []).by_difficulty)).toEqual(["easy", "tool", "weird"]);
  });
});
