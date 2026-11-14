// Leaderboard, density, request-spot, keepalive and the bot score, called directly.
// No env vars and no network: "no database" is the normal state being tested.
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as density } from "@/app/api/density/route";
import { GET as keepalive } from "@/app/api/keepalive/route";
import { GET as leaderboard } from "@/app/api/leaderboard/route";
import { GET as listRequests, POST as postRequest } from "@/app/api/request-spot/route";
import { BOT_NAME, botScore, mergeBot } from "@/lib/server/bot";
import { resetRateLimit } from "@/lib/server/rateLimit";

const KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CRON_SECRET",
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  resetRateLimit();
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const get = (url: string, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${url}`, { headers });
const post = (body: unknown, raw = false) =>
  new NextRequest("http://localhost/api/request-spot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });

describe("GET /api/leaderboard without a database", () => {
  it("serves the snapshot with the bot row", async () => {
    const res = await leaderboard(get("/api/leaderboard?scope=all"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("snapshot");
    expect(body.scope).toBe("all");
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({ rank: 1, name: BOT_NAME, is_bot: true, is_me: false });
    expect(body.me).toBeUndefined();
  });
  it("defaults to scope=all and builds a per-spot bot row", async () => {
    const all = await (await leaderboard(get("/api/leaderboard"))).json();
    expect(all.scope).toBe("all");
    const eris = await (await leaderboard(get("/api/leaderboard?scope=spot&slug=eris"))).json();
    expect(eris).toMatchObject({ scope: "spot", slug: "eris", source: "snapshot" });
    expect(eris.rows[0]).toMatchObject({ is_bot: true, score: 1000 });
  });
  it("the committed snapshot agrees with botScore", async () => {
    const file = JSON.parse(readFileSync("public/leaderboard-snapshot.json", "utf8"));
    const bot = await botScore();
    expect(file.rows).toHaveLength(1);
    expect(file.rows[0]).toMatchObject({ is_bot: true, score: bot.score, accuracy: bot.accuracy });
  });
  it("rejects bad input with the contract error shape", async () => {
    for (const url of [
      "/api/leaderboard?scope=spot",
      "/api/leaderboard?scope=nope",
      "/api/leaderboard?scope=spot&slug=A B",
    ]) {
      const res = await leaderboard(get(url));
      expect(res.status, url).toBe(400);
      expect((await res.json()).error.code).toBe("bad_request");
    }
  });
});

describe("GET /api/leaderboard for an unknown spot", () => {
  it("answers 404 not_found for a slug that is not a ready spot", async () => {
    const res = await leaderboard(get("/api/leaderboard?scope=spot&slug=no-such-spot"));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error.code).toBe("not_found");
    expect(typeof json.error.message).toBe("string");
  });
  it("still serves a ready spot and the test-only fixture", async () => {
    expect((await leaderboard(get("/api/leaderboard?scope=spot&slug=eris"))).status).toBe(200);
    expect((await leaderboard(get("/api/leaderboard?scope=spot&slug=fixture"))).status).toBe(200);
  });
});

describe("mergeBot", () => {
  const h = (name: string, score: number, is_me = false) => ({ name, score, accuracy: 0.5, is_me });
  it("puts the bot by score, humans first on a tie, and renumbers", () => {
    const { rows } = mergeBot([h("a", 2000), h("b", 1000), h("c", 10)], { score: 1000, accuracy: 1 });
    expect(rows.map((r) => [r.rank, r.name])).toEqual([
      [1, "a"],
      [2, "b"],
      [3, BOT_NAME],
      [4, "c"],
    ]);
  });
  it("re-ranks me when I am further down than the shown rows", () => {
    const { me } = mergeBot(
      [h("a", 5)],
      { score: 100, accuracy: null },
      { rank: 80, name: "kt", score: 50, accuracy: 0.2 },
    );
    expect(me?.rank).toBe(81);
  });
  it("takes my rank from the merged rows when I am shown", () => {
    const { me, rows } = mergeBot(
      [h("a", 5), h("kt", 4, true)],
      { score: 100, accuracy: null },
      { rank: 2, name: "kt", score: 4, accuracy: 0.5 },
    );
    expect(rows.find((r) => r.is_me)?.rank).toBe(3);
    expect(me?.rank).toBe(3);
  });
});

describe("GET /api/density", () => {
  it("returns the empty shape without a database", async () => {
    const res = await density(get("/api/density?layer=finds"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ layer: "finds", order: 4, who: "all", source: "none", max: 0, cells: [] });
  });
  it("accepts order and layer", async () => {
    const body = await (await density(get("/api/density?layer=checked&order=12&who=all"))).json();
    expect(body).toMatchObject({ layer: "checked", order: 12, source: "none" });
  });
  it("who=me without a login is 401", async () => {
    const res = await density(get("/api/density?layer=finds&who=me"));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized");
    const withToken = await density(get("/api/density?layer=finds&who=me", { authorization: "Bearer abc" }));
    expect(withToken.status).toBe(401);
  });
  it("who=others without a login is 401, like who=me", async () => {
    const res = await density(get("/api/density?layer=finds&who=others"));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized");
    const withToken = await density(get("/api/density?layer=checked&who=others", { authorization: "Bearer abc" }));
    expect(withToken.status).toBe(401);
  });
  it("who=all without a database is the empty shape with who all", async () => {
    const res = await density(get("/api/density?layer=checked&who=all"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ layer: "checked", order: 4, who: "all", source: "none", max: 0, cells: [] });
  });
  it("who=bogus is 400", async () => {
    const res = await density(get("/api/density?layer=finds&who=bogus"));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("bad_request");
  });
  it("rejects bad input with 400", async () => {
    for (const url of [
      "/api/density",
      "/api/density?layer=x",
      "/api/density?layer=finds&order=13",
      "/api/density?layer=finds&order=-1",
      "/api/density?layer=finds&order=1.5",
      "/api/density?layer=finds&who=you",
    ]) {
      const res = await density(get(url));
      expect(res.status, url).toBe(400);
      expect((await res.json()).error.code).toBe("bad_request");
    }
  });
});

describe("/api/request-spot without a database", () => {
  it("POST is 503 db_unavailable", async () => {
    const res = await postRequest(post({ ra: 133.795, dec: -7.245, fov: 0.2 }));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("db_unavailable");
  });
  it("GET is an empty list", async () => {
    const res = await listRequests(get("/api/request-spot"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ requests: [], source: "none" });
  });
  it("POST validates before anything else", async () => {
    const bad: unknown[] = [
      { ra: 361, dec: 0, fov: 0.2 },
      { ra: -1, dec: 0, fov: 0.2 },
      { ra: 10, dec: 91, fov: 0.2 },
      { ra: 10, dec: 0, fov: 0.01 },
      { ra: 10, dec: 0, fov: 0.6 },
      { ra: "10", dec: 0 },
      {},
    ];
    for (const b of bad) {
      const res = await postRequest(post(b));
      expect(res.status, JSON.stringify(b)).toBe(400);
      expect((await res.json()).error.code).toBe("bad_request");
    }
    const notJson = await postRequest(post("nope", true));
    expect(notJson.status).toBe(400);
  });
});

describe("GET /api/keepalive", () => {
  it("is 401 when CRON_SECRET is unset, whatever is sent", async () => {
    expect((await keepalive(get("/api/keepalive"))).status).toBe(401);
    expect((await keepalive(get("/api/keepalive", { authorization: "Bearer " }))).status).toBe(401);
    expect((await keepalive(get("/api/keepalive", { authorization: "Bearer undefined" }))).status).toBe(401);
  });
  it("is 401 without or with a wrong secret", async () => {
    process.env.CRON_SECRET = "s3cret";
    expect((await keepalive(get("/api/keepalive"))).status).toBe(401);
    const wrong = await keepalive(get("/api/keepalive", { authorization: "Bearer nope" }));
    expect(wrong.status).toBe(401);
    expect((await wrong.json()).error.code).toBe("unauthorized");
    expect((await keepalive(get("/api/keepalive", { authorization: "s3cret" }))).status).toBe(401);
  });
  it("is 200 not_configured with the right secret and no database", async () => {
    process.env.CRON_SECRET = "s3cret";
    const res = await keepalive(get("/api/keepalive", { authorization: "Bearer s3cret" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, db: "not_configured" });
  });
});

describe("botScore against the real answer keys", () => {
  it("scores each ready spot by the known objects its candidates match", async () => {
    const bot = await botScore();
    const per = Object.fromEntries(bot.spots.map((s) => [s.slug, s]));
    expect(Object.keys(per).sort()).toEqual(["cygnus", "eris", "eros", "hektor", "makemake"]);
    expect(per.eris).toMatchObject({ score: 1000, above_bar: 2, matched: 1 });
    expect(per.hektor).toMatchObject({ score: 250, above_bar: 3, matched: 1 });
    expect(per.makemake).toMatchObject({ score: 500, above_bar: 1, matched: 1 });
    expect(per.eros).toMatchObject({ score: 0, above_bar: 0, matched: 0 });
    expect(per.cygnus).toMatchObject({ score: 0, above_bar: 0, matched: 0 });
    expect(per.eris.matches).toEqual([{ rank: 1, object: "136199 Eris (2003 UB313)" }]);
    expect(per.hektor.matches).toEqual([{ rank: 1, object: "624 Hektor (A907 CF)" }]);
    expect(per.makemake.matches).toEqual([{ rank: 1, object: "136472 Makemake (2005 FY9)" }]);
    expect(bot.score).toBe(1750);
    expect(bot.above_bar).toBe(6);
    expect(bot.matched).toBe(3);
    expect(bot.accuracy).toBe(0.5);
  });
  it("can be limited to some spots, and has null accuracy with no candidates", async () => {
    const one = await botScore(["eris"]);
    expect(one.score).toBe(1000);
    const none = await botScore(["cygnus"]);
    expect(none).toMatchObject({ score: 0, accuracy: null });
    expect((await botScore(["nope"])).spots).toEqual([]);
  });
});
