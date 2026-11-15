// GET /api/leaderboard with the new period / region / country query, against a fake Supabase.
// Contract: api.md section 7. The old query must answer exactly as before (the play page's
// Scoreboard and the profile page call it without the new parameters).
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Reply = { data: unknown; error: { code?: string; message: string } | null };
const state = vi.hoisted(() => ({
  configured: true,
  calls: [] as { name: string; args: Record<string, unknown> }[],
  replies: {} as Record<string, Reply | ((signal: AbortSignal) => Promise<Reply>)>,
}));

vi.mock("@/lib/server/db", async (original) => ({
  ...(await original<typeof import("@/lib/server/db")>()),
  anonClient: () =>
    state.configured
      ? {
          rpc: (name: string, args: Record<string, unknown>) => {
            state.calls.push({ name, args });
            return {
              abortSignal: async (signal: AbortSignal): Promise<Reply> => {
                const r = state.replies[name];
                if (!r) return { data: null, error: { code: "PGRST202", message: `Could not find the function public.${name}` } };
                return typeof r === "function" ? r(signal) : r;
              },
            };
          },
        }
      : null,
}));

import { GET } from "@/app/api/leaderboard/route";
import { BOT_NAME } from "@/lib/server/bot";
import { rememberCountry } from "@/lib/server/leaderboard";
import { resetRateLimit } from "@/lib/server/rateLimit";
import { encodeUnlocked, UNLOCK_COOKIE } from "@/lib/server/unlock";

const get = (url: string, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${url}`, { headers });
const ok = (data: unknown): Reply => ({ data, error: null });
const row = (rank: number, name: string, score: number, finds: number | null, is_me = false, accuracy: number | null = 0.5) =>
  ({ rank, display_name: name, score, accuracy, ...(finds === null ? {} : { finds }), is_me });

const V2 = [row(1, "nova", 1850, 14), row(2, "kt", 350, 6, true)];
const COUNTRIES = [
  { code: "US", players: 2 },
  { code: "TH", players: 4 },
];

beforeEach(() => {
  resetRateLimit();
  state.configured = true;
  state.calls = [];
  state.replies = {
    leaderboard_v2: ok(V2),
    leaderboard_countries: ok(COUNTRIES),
    leaderboard: ok([row(1, "nova", 1850, null), row(2, "kt", 350, null, true)]),
    set_my_country: ok(null),
  };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const rpcNames = () => state.calls.map((c) => c.name);

describe("the old query (no new parameters)", () => {
  it("answers with the old keys and meaning, plus the new keys", async () => {
    const res = await GET(get("/api/leaderboard"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("cache-control")).toContain("private");
    const body = await res.json();
    expect(body).toMatchObject({
      scope: "all",
      slug: null,
      source: "db",
      period: "all",
      region: "global",
      country: null,
      detected_country: null,
      available: true,
    });
    expect(typeof body.updated_at).toBe("string");
    // The bot (1750) sits between nova (1850) and kt (350), exactly as mergeBot always did.
    expect(body.rows.map((r: { name: string; rank: number }) => [r.rank, r.name])).toEqual([
      [1, "nova"],
      [2, BOT_NAME],
      [3, "kt"],
    ]);
    expect(body.rows[0]).toEqual({ rank: 1, name: "nova", score: 1850, accuracy: 0.5, is_bot: false, is_me: false, finds: 14 });
    expect(body.rows[1]).toMatchObject({ is_bot: true, finds: null });
    expect(body.me).toMatchObject({ rank: 3, name: "kt", score: 350, finds: 6 });
    expect(body.countries).toBeUndefined();
    expect(rpcNames()).toEqual(["leaderboard_v2"]);
    expect(state.calls[0].args).toEqual({ p_slug: null, p_since: null, p_country: null, p_limit: 50 });
  });

  it("keeps the 404 for a spot that is not ready, on every board", async () => {
    for (const q of ["", "&period=week", "&region=local&country=TH"]) {
      const res = await GET(get(`/api/leaderboard?scope=spot&slug=no-such-spot${q}`));
      expect(res.status, q).toBe(404);
      expect((await res.json()).error.code).toBe("not_found");
    }
  });

  it("keeps the unlock rule for the bot on a spot", async () => {
    const without = await (await GET(get("/api/leaderboard?scope=spot&slug=eris"))).json();
    expect(without.rows.some((r: { is_bot: boolean }) => r.is_bot)).toBe(false);
    const cookie = `${UNLOCK_COOKIE}=${encodeUnlocked(["eris"])}`;
    const withCookie = await (await GET(get("/api/leaderboard?scope=spot&slug=eris", { cookie }))).json();
    expect(withCookie.rows.some((r: { is_bot: boolean }) => r.is_bot)).toBe(true);
    expect(state.calls[0].args.p_slug).toBe("eris");
  });

  it("rejects bad new parameters with the error shape", async () => {
    for (const q of ["period=month", "region=moon", "region=local&country=THA", "country=1a"]) {
      const res = await GET(get(`/api/leaderboard?${q}`));
      expect(res.status, q).toBe(400);
      expect((await res.json()).error.code).toBe("bad_request");
    }
  });
});

describe("period=week", () => {
  it("asks for finds from about 7 days ago, and has no bot row", async () => {
    const before = Date.now();
    const body = await (await GET(get("/api/leaderboard?period=week"))).json();
    const since = Date.parse(state.calls[0].args.p_since as string);
    expect(Math.abs(before - since - 7 * 86_400_000)).toBeLessThan(5000);
    expect(body).toMatchObject({ period: "week", region: "global", available: true, source: "db" });
    expect(body.rows.some((r: { is_bot: boolean }) => r.is_bot)).toBe(false);
    // Database ranks are kept (no bot to shift them).
    expect(body.rows.map((r: { rank: number }) => r.rank)).toEqual([1, 2]);
    expect(body.me).toMatchObject({ rank: 2, name: "kt", finds: 6 });
  });
});

describe("region=local", () => {
  it("uses the country in the query, upper-cased, and lists the countries", async () => {
    const body = await (await GET(get("/api/leaderboard?region=local&country=th", { "x-vercel-ip-country": "US" }))).json();
    expect(state.calls.find((c) => c.name === "leaderboard_v2")?.args).toMatchObject({ p_country: "TH" });
    expect(body).toMatchObject({ region: "local", country: "TH", detected_country: "US", available: true });
    expect(body.countries).toEqual([
      { code: "TH", players: 4 },
      { code: "US", players: 2 },
    ]);
    expect(body.rows.some((r: { is_bot: boolean }) => r.is_bot)).toBe(false);
  });

  it("falls back to the detected country from the header", async () => {
    const body = await (await GET(get("/api/leaderboard?region=local", { "x-vercel-ip-country": "th" }))).json();
    expect(state.calls.find((c) => c.name === "leaderboard_v2")?.args).toMatchObject({ p_country: "TH" });
    expect(body).toMatchObject({ country: "TH", detected_country: "TH" });
  });

  it("answers no_country (still listing the countries) when none is given or detected", async () => {
    for (const header of [{} as Record<string, string>, { "x-vercel-ip-country": "XX" }, { "x-vercel-ip-country": "T1" }, { "x-vercel-ip-country": "THA" }]) {
      state.calls = [];
      const body = await (await GET(get("/api/leaderboard?region=local", header))).json();
      expect(body).toMatchObject({ available: false, reason: "no_country", country: null, detected_country: null, rows: [] });
      expect(body.me).toBeUndefined();
      expect(body.countries).toHaveLength(2);
      expect(rpcNames()).not.toContain("leaderboard_v2");
    }
  });

  it("combines with the weekly window and a spot", async () => {
    await GET(get("/api/leaderboard?scope=spot&slug=eros&period=week&region=local&country=US"));
    const a = state.calls.find((c) => c.name === "leaderboard_v2")?.args;
    expect(a).toMatchObject({ p_slug: "eros", p_country: "US" });
    expect(typeof a?.p_since).toBe("string");
    expect(state.calls.find((c) => c.name === "leaderboard_countries")?.args).toMatchObject({ p_slug: "eros" });
  });

  it("does not list countries on a global board", async () => {
    const body = await (await GET(get("/api/leaderboard?period=week"))).json();
    expect(body.countries).toBeUndefined();
    expect(rpcNames()).not.toContain("leaderboard_countries");
  });
});

describe("when the new database functions are not installed", () => {
  beforeEach(() => {
    delete state.replies.leaderboard_v2;
    delete state.replies.leaderboard_countries;
  });

  it("serves the default board from the old leaderboard function, as before", async () => {
    const body = await (await GET(get("/api/leaderboard"))).json();
    expect(rpcNames()).toEqual(["leaderboard_v2", "leaderboard"]);
    expect(state.calls[1].args).toEqual({ p_slug: null, p_limit: 50 });
    expect(body).toMatchObject({ available: true, source: "db", period: "all", region: "global" });
    expect(body.rows.map((r: { name: string }) => r.name)).toEqual(["nova", BOT_NAME, "kt"]);
    expect(body.rows[0].finds).toBeUndefined();
    expect(body.rows[1].finds).toBeNull();
    expect(body.me).toMatchObject({ rank: 3, name: "kt" });
    expect(body.me.finds).toBeUndefined();
  });

  it("recognises the error by message too", async () => {
    state.replies.leaderboard_v2 = { data: null, error: { message: "function public.leaderboard_v2(text) does not exist" } };
    const body = await (await GET(get("/api/leaderboard?period=week"))).json();
    expect(body).toMatchObject({ available: false, reason: "not_installed", rows: [] });
  });

  it("answers not_installed on the other boards", async () => {
    for (const q of ["period=week", "region=local&country=TH", "region=local"]) {
      const res = await GET(get(`/api/leaderboard?${q}`));
      expect(res.status, q).toBe(200);
      const body = await res.json();
      expect(body, q).toMatchObject({ available: false, reason: "not_installed", rows: [] });
      expect(body.me).toBeUndefined();
    }
  });
});

describe("a database error that is not a missing function", () => {
  beforeEach(() => {
    state.replies.leaderboard_v2 = { data: null, error: { code: "XX000", message: "boom" } };
  });

  it("tries the old leaderboard function for the default board, and answers no_database for the others", async () => {
    const def = await (await GET(get("/api/leaderboard"))).json();
    expect(rpcNames()).toEqual(["leaderboard_v2", "leaderboard"]);
    expect(def).toMatchObject({ source: "db", available: true });
    expect(def.rows.map((r: { name: string }) => r.name)).toEqual(["nova", BOT_NAME, "kt"]);
    state.calls = [];
    const week = await (await GET(get("/api/leaderboard?period=week"))).json();
    expect(week).toMatchObject({ available: false, reason: "no_database", rows: [] });
    expect(rpcNames()).toEqual(["leaderboard_v2"]);
  });

  it("serves the snapshot when the old function fails too", async () => {
    state.replies.leaderboard = { data: null, error: { code: "XX000", message: "boom again" } };
    const def = await (await GET(get("/api/leaderboard"))).json();
    expect(rpcNames()).toEqual(["leaderboard_v2", "leaderboard"]);
    expect(def).toMatchObject({ source: "snapshot", available: true });
    expect(def.rows).toHaveLength(1);
  });
});

describe("a timeout on the new function", () => {
  it("goes straight to the snapshot for the default board (the old function is not tried)", async () => {
    vi.useFakeTimers();
    try {
      state.replies.leaderboard_v2 = (signal) =>
        new Promise<Reply>((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
      const pending = GET(get("/api/leaderboard"));
      await vi.advanceTimersByTimeAsync(5000);
      const def = await (await pending).json();
      expect(rpcNames()).toEqual(["leaderboard_v2"]);
      expect(def).toMatchObject({ source: "snapshot", available: true });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("no database", () => {
  beforeEach(() => {
    state.configured = false;
  });

  it("serves the snapshot for the default board", async () => {
    const body = await (await GET(get("/api/leaderboard"))).json();
    expect(body).toMatchObject({ source: "snapshot", available: true, period: "all", region: "global" });
    expect(body.rows[0]).toMatchObject({ name: BOT_NAME, is_bot: true });
  });

  it("answers no_database for the weekly and local boards", async () => {
    for (const q of ["period=week", "region=local&country=TH", "region=local"]) {
      const res = await GET(get(`/api/leaderboard?${q}`));
      expect(res.status, q).toBe(200);
      const body = await res.json();
      expect(body, q).toMatchObject({ available: false, reason: "no_database", rows: [], source: "snapshot" });
    }
  });
});

describe("the bot row", () => {
  it("appears only on the global all-time board", async () => {
    const isBot = (b: { rows: { is_bot: boolean }[] }) => b.rows.some((r) => r.is_bot);
    expect(isBot(await (await GET(get("/api/leaderboard"))).json())).toBe(true);
    expect(isBot(await (await GET(get("/api/leaderboard?period=all&region=global"))).json())).toBe(true);
    expect(isBot(await (await GET(get("/api/leaderboard?period=week"))).json())).toBe(false);
    expect(isBot(await (await GET(get("/api/leaderboard?region=local&country=TH"))).json())).toBe(false);
    expect(isBot(await (await GET(get("/api/leaderboard?period=week&region=local&country=TH"))).json())).toBe(false);
  });

  it("is absent from weekly and local boards for a caller who has unlocked the spot", async () => {
    const isBot = (b: { rows: { is_bot: boolean }[] }) => b.rows.some((r) => r.is_bot);
    const cookie = `${UNLOCK_COOKIE}=${encodeUnlocked(["eris"])}`;
    const q = "scope=spot&slug=eris";
    expect(isBot(await (await GET(get(`/api/leaderboard?${q}`, { cookie }))).json())).toBe(true);
    expect(isBot(await (await GET(get(`/api/leaderboard?${q}&period=week`, { cookie }))).json())).toBe(false);
    expect(isBot(await (await GET(get(`/api/leaderboard?${q}&region=local&country=TH`, { cookie }))).json())).toBe(false);
    expect(isBot(await (await GET(get(`/api/leaderboard?${q}&period=week&region=local&country=TH`, { cookie }))).json())).toBe(false);
  });
});

describe("saving the caller's country", () => {
  const country = (calls = state.calls) => calls.filter((c) => c.name === "set_my_country");

  it("is sent for a logged-in caller on a local board, with only the two letters", async () => {
    await GET(get("/api/leaderboard?region=local", { authorization: "Bearer tok", "x-vercel-ip-country": "th" }));
    expect(country()).toEqual([{ name: "set_my_country", args: { p_country: "TH" } }]);
  });

  it("is not sent for the global boards, all time or weekly", async () => {
    const headers = { authorization: "Bearer tok", "x-vercel-ip-country": "TH" };
    await GET(get("/api/leaderboard", headers));
    await GET(get("/api/leaderboard?period=week", headers));
    await GET(get("/api/leaderboard?scope=spot&slug=eros", headers));
    expect(country()).toHaveLength(0);
  });

  it("is not sent for a guest, or without a detected country, even on a local board", async () => {
    await GET(get("/api/leaderboard?region=local&country=TH", { "x-vercel-ip-country": "TH" }));
    await GET(get("/api/leaderboard?region=local&country=TH", { authorization: "Bearer tok" }));
    await GET(get("/api/leaderboard?region=local&country=TH", { authorization: "Bearer tok", "x-vercel-ip-country": "XX" }));
    expect(country()).toHaveLength(0);
  });

  it("does not use the country from the query (only the detected one is saved)", async () => {
    await GET(get("/api/leaderboard?region=local&country=FR", { authorization: "Bearer tok", "x-vercel-ip-country": "TH" }));
    expect(country()).toEqual([{ name: "set_my_country", args: { p_country: "TH" } }]);
  });

  it("a failure (error result, or a throw) changes nothing in the response", async () => {
    const headers = { authorization: "Bearer tok", "x-vercel-ip-country": "TH" };
    const url = "/api/leaderboard?period=week&region=local";
    const clean = await (await GET(get(url, headers))).json();
    state.replies.set_my_country = { data: null, error: { code: "PGRST202", message: "not installed" } };
    const failing = await (await GET(get(url, headers))).json();
    state.replies.set_my_country = () => Promise.reject(new Error("network down"));
    const throwing = await GET(get(url, headers));
    expect(throwing.status).toBe(200);
    const strip = (b: { updated_at: string }) => ({ ...b, updated_at: "" });
    expect(strip(failing)).toEqual(strip(clean));
    expect(strip(await throwing.json())).toEqual(strip(clean));
  });

  it("is sent once per request however often it is asked", () => {
    const req = get("/api/leaderboard", { authorization: "Bearer tok", "x-vercel-ip-country": "TH" });
    rememberCountry(req);
    rememberCountry(req);
    expect(country()).toHaveLength(1);
  });
});

describe("what a response may contain", () => {
  it("has no user id or email, and is never cacheable", async () => {
    state.replies.leaderboard_v2 = ok([{ ...row(1, "nova", 10, 1), user_id: "x" }]);
    for (const q of ["", "?period=week", "?region=local&country=TH", "?scope=spot&slug=eros"]) {
      const res = await GET(get(`/api/leaderboard${q}`, { authorization: "Bearer tok" }));
      const text = JSON.stringify(await res.json());
      expect(text, q).not.toMatch(/user_id|@|email/i);
      expect(res.headers.get("cache-control"), q).toContain("no-store");
    }
  });
});
