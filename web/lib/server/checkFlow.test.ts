// /api/check and /api/complete with an injected database and login (FlowDeps), plus the pure
// practice rule. Contract: docs/contracts/api.md sections 3 and 4.
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decidePractice, runCheck, runComplete, type FlowDeps } from "@/lib/server/checkFlow";
import { handle } from "@/lib/server/http";
import { resetRateLimit } from "@/lib/server/rateLimit";
import { decodeUnlocked, encodeUnlocked, UNLOCK_COOKIE } from "@/lib/server/unlock";

const HIT = { spot: "fixture", answer: "track", marks: [{ frame: 1, x: 10, y: 16 }, { frame: 4, x: 16, y: 16 }] };
const WRONG = { spot: "fixture", answer: "nothing" };

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
const checkReq = (body: unknown, headers?: Record<string, string>) => post("http://localhost/api/check", body, headers);
const completeReq = (replay: unknown[], headers?: Record<string, string>) =>
  post("http://localhost/api/complete", { replay }, headers);
const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").match(new RegExp(`${UNLOCK_COOKIE}=([^;]+)`))?.[1];
const cover = (...slugs: string[]) => ({ cookie: `${UNLOCK_COOKIE}=${encodeUnlocked(slugs)}` });

/** A fake database whose record_find gives the base points unless the call is practice. */
function fakeDeps(opts: {
  user?: { id: string } | null;
  visits?: string[];
  dbConfigured?: boolean;
  hasVisitThrows?: boolean;
  rpcFails?: boolean;
} = {}) {
  const rpcCalls: Record<string, unknown>[] = [];
  const client = {
    rpc: async (_name: string, args: Record<string, unknown>) => {
      rpcCalls.push(args);
      if (opts.rpcFails) return { data: null, error: { message: "database down" } };
      return {
        data: [{ first_finder: false, already_found: false, points: args.p_practice ? 0 : args.p_points, counted: true }],
        error: null,
      };
    },
  } as unknown as SupabaseClient;
  const visits = new Set(opts.visits ?? []);
  const deps: FlowDeps = {
    persist: { client: () => client, user: async () => (opts.user === undefined ? { id: "user-1" } : opts.user) },
    dbConfigured: () => opts.dbConfigured ?? true,
    hasVisit: async (_userId, slug) => {
      if (opts.hasVisitThrows) throw new Error("visits table unreachable");
      return visits.has(slug);
    },
  };
  return { deps, rpcCalls };
}

beforeEach(() => {
  resetRateLimit();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("decidePractice", () => {
  const rows: [boolean, boolean, boolean, boolean, boolean][] = [];
  for (const loggedIn of [false, true])
    for (const dbConfigured of [false, true])
      for (const cookieCovers of [false, true])
        for (const hasVisit of [false, true]) {
          // A logged-in player with a database: visits only. Everyone else: the cookie.
          rows.push([loggedIn, dbConfigured, cookieCovers, hasVisit, loggedIn && dbConfigured ? hasVisit : cookieCovers]);
        }
  it.each(rows)("loggedIn=%s db=%s cookie=%s visit=%s -> practice=%s", (loggedIn, dbConfigured, cookieCovers, hasVisit, want) => {
    expect(decidePractice({ loggedIn, dbConfigured, cookieCovers, hasVisit })).toBe(want);
  });
  it("is exercised for all 16 combinations (the 8 of login, database and cookie, with and without a visit)", () => {
    expect(rows).toHaveLength(16);
  });
});

describe("POST /api/check: practice from visits for a logged-in player", () => {
  it("a cookie alone does not make a logged-in player's answer practice: they still score", async () => {
    const { deps, rpcCalls } = fakeDeps({ visits: [] });
    const res = await handle(() => runCheck(checkReq(HIT, cover("fixture")), deps));
    const json = await res.json();
    expect(json).toMatchObject({ practice: false, persisted: true, unlocked: true, verdict: { kind: "known", points: 100 } });
    expect(rpcCalls[0]).toMatchObject({ p_practice: false, p_user: "user-1" });
  });

  it("a saved visit makes it practice, with no cookie at all", async () => {
    const { deps, rpcCalls } = fakeDeps({ visits: ["fixture"] });
    const json = await (await handle(() => runCheck(checkReq(HIT), deps))).json();
    expect(json).toMatchObject({ practice: true, unlocked: true, verdict: { points: 0 } });
    expect(rpcCalls[0]).toMatchObject({ p_practice: true });
  });

  it("a wrong answer with a covering cookie reports the spot as open but is not practice", async () => {
    const { deps } = fakeDeps({ visits: [] });
    const json = await (await handle(() => runCheck(checkReq(WRONG, cover("fixture")), deps))).json();
    expect(json).toMatchObject({ practice: false, unlocked: true });
  });

  it("a guest is practice when the cookie covers the spot", async () => {
    const { deps, rpcCalls } = fakeDeps({ user: null });
    const json = await (await handle(() => runCheck(checkReq(HIT, cover("fixture")), deps))).json();
    expect(json).toMatchObject({ practice: true, persisted: false });
    expect(rpcCalls).toHaveLength(0);
    const fresh = await (await handle(() => runCheck(checkReq(HIT), deps))).json();
    expect(fresh).toMatchObject({ practice: false, verdict: { points: 100 } });
  });

  it("a logged-in player with no database falls back to the cookie", async () => {
    const { deps } = fakeDeps({ dbConfigured: false });
    const json = await (await handle(() => runCheck(checkReq(HIT, cover("fixture")), deps))).json();
    expect(json.practice).toBe(true);
  });

  it("when the visit lookup throws, the answer is still returned (not practice, saved as normal)", async () => {
    const { deps } = fakeDeps({ hasVisitThrows: true });
    const res = await handle(() => runCheck(checkReq(HIT), deps));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ practice: false, persisted: true, verdict: { kind: "known", points: 100 } });
  });

  it("when the visit lookup throws and the save fails too, the answer is returned as not persisted", async () => {
    const { deps } = fakeDeps({ hasVisitThrows: true, rpcFails: true });
    const res = await handle(() => runCheck(checkReq(HIT), deps));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ persisted: false, practice: false, unlocked: true, verdict: { points: 100 } });
  });
});

describe("POST /api/complete: the replay", () => {
  it("the same spot twice in one replay: the first scores, the second is practice", async () => {
    const { deps, rpcCalls } = fakeDeps();
    const res = await handle(() => runComplete(completeReq([HIT, HIT]), deps));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.results[0]).toMatchObject({ practice: false, verdict: { kind: "known", points: 100 } });
    expect(json.results[1]).toMatchObject({ practice: true, verdict: { kind: "known", points: 0 } });
    expect(json.total_points).toBe(100);
    expect(rpcCalls.map((c) => c.p_practice)).toEqual([false, true]);
  });

  it("wrong then right on one spot: the wrong one is not practice, so the right one still scores", async () => {
    const { deps } = fakeDeps();
    const json = await (await handle(() => runComplete(completeReq([WRONG, HIT]), deps))).json();
    expect(json.results[0]).toMatchObject({ practice: false, verdict: { kind: "nothing_wrong" } });
    expect(json.results[1]).toMatchObject({ practice: false, verdict: { kind: "known", points: 100 } });
    expect(json.total_points).toBe(100);
  });

  it("a visit saved before the replay makes every entry for that spot practice", async () => {
    const { deps, rpcCalls } = fakeDeps({ visits: ["fixture"] });
    const json = await (await handle(() => runComplete(completeReq([WRONG, HIT, HIT]), deps))).json();
    expect(json.results.map((r: { practice: boolean }) => r.practice)).toEqual([true, true, true]);
    expect(json.total_points).toBe(0);
    expect(rpcCalls.every((c) => c.p_practice === true)).toBe(true);
  });

  it("the guest's cookie never makes an entry practice", async () => {
    const { deps } = fakeDeps();
    const json = await (await handle(() => runComplete(completeReq([HIT], cover("fixture")), deps))).json();
    expect(json.results[0]).toMatchObject({ practice: false, verdict: { points: 100 } });
    expect(json.total_points).toBe(100);
  });

  it("sets the unlock cookie for correct spots only, keeping earlier ones", async () => {
    const { deps } = fakeDeps();
    const ok = await handle(() => runComplete(completeReq([WRONG, HIT], cover("eros")), deps));
    expect(decodeUnlocked(cookieOf(ok))).toEqual(["eros", "fixture"]);
    resetRateLimit();
    const onlyWrong = await handle(() => runComplete(completeReq([WRONG]), deps));
    expect(onlyWrong.status).toBe(200);
    expect(onlyWrong.headers.get("set-cookie")).toBeNull();
    expect((await onlyWrong.json()).results[0].unlocked).toBe(false);
  });
});

describe("POST /api/complete: the shared /api/check budget", () => {
  const replay = (n: number) => Array.from({ length: n }, () => WRONG);

  it("a 20-entry replay then an 11-entry one from one address gives 429 on the second", async () => {
    const { deps } = fakeDeps();
    const first = await handle(() => runComplete(completeReq(replay(20)), deps));
    expect(first.status).toBe(200);
    // 20 + 11 = 31 > 30: refused whole, before anything is scored.
    const second = await handle(() => runComplete(completeReq(replay(11)), deps));
    expect(second.status).toBe(429);
    const json = await second.json();
    expect(json.error.code).toBe("rate_limited");
    expect(json.error.details.retry_after_s).toBeGreaterThan(0);
  });

  it("anonymous (401) and no-database (503) calls do not drain the /api/check budget", async () => {
    const anon = fakeDeps({ user: null });
    for (let i = 0; i < 3; i++) {
      expect((await handle(() => runComplete(completeReq(replay(20)), anon.deps))).status).toBe(401);
    }
    const noDb = fakeDeps({ dbConfigured: false });
    expect((await handle(() => runComplete(completeReq(replay(20)), noDb.deps))).status).toBe(503);
    // Four calls with 80 units of entries, none charged: all 30 checks still pass, the 31st does not.
    const { deps } = fakeDeps({ user: null });
    let last = 0;
    for (let i = 0; i < 30; i++) last = (await handle(() => runCheck(checkReq(WRONG), deps))).status;
    expect(last).toBe(200);
    expect((await handle(() => runCheck(checkReq(WRONG), deps))).status).toBe(429);
  });

  it("the route's own call limit (5 a minute) still runs first, before 503 and 401", async () => {
    const anon = fakeDeps({ user: null });
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await handle(() => runComplete(completeReq(replay(1)), anon.deps))).status);
    expect(codes).toEqual([401, 401, 401, 401, 401, 429]);
  });
});
