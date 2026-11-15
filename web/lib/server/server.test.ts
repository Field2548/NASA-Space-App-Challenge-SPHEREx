// Route helpers and POST /api/check, called directly (no HTTP server needed).
import { existsSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as check } from "@/app/api/check/route";
import { PRACTICE_SUFFIX, responseBody } from "@/lib/server/checkResponse";
import { loadAnswerKey, loadFieldForScoring, scoreSubmission, type AnswerKey, type FieldForScoring, type Scored } from "@/lib/scoring";
import { ApiFail, clientIp, handle } from "@/lib/server/http";
import { hit, MAX_KEYS, resetRateLimit } from "@/lib/server/rateLimit";
import { decodeUnlocked, encodeUnlocked, isUnlocked, UNLOCK_COOKIE } from "@/lib/server/unlock";

const have = (slug: string) => existsSync(path.join(process.cwd(), "data", "answers", `${slug}.json`));
const FIXTURE_HIT = { spot: "fixture", answer: "track", marks: [{ frame: 1, x: 10, y: 16 }, { frame: 4, x: 16, y: 16 }] };

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost/api/check", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const cookieValue = (res: Response): string | undefined => {
  const m = (res.headers.get("set-cookie") ?? "").match(new RegExp(`${UNLOCK_COOKIE}=([^;]+)`));
  return m?.[1];
};

beforeEach(() => resetRateLimit());

describe("unlock cookie", () => {
  it("round-trips the list of spots", () => {
    expect(decodeUnlocked(encodeUnlocked(["eros", "cygnus"]))).toEqual(["eros", "cygnus"]);
    expect(decodeUnlocked(encodeUnlocked([]))).toEqual([]);
  });
  it("rejects a missing, edited or forged cookie", () => {
    const good = encodeUnlocked(["eros"])!; // the test environment is not production, so a key exists
    const [v, , mac] = good.split(".");
    const forgedPayload = Buffer.from("eros,eris").toString("base64url");
    expect(decodeUnlocked(undefined)).toEqual([]);
    expect(decodeUnlocked("")).toEqual([]);
    expect(decodeUnlocked("v1.abc")).toEqual([]);
    expect(decodeUnlocked(`${v}.${forgedPayload}.${mac}`)).toEqual([]);
    expect(decodeUnlocked(`${v}.${forgedPayload}.`)).toEqual([]);
    expect(decodeUnlocked(good.slice(0, -2) + "xx")).toEqual([]);
    expect(decodeUnlocked(`v2.${good.split(".")[1]}.${mac}`)).toEqual([]);
  });
  it("drops anything that is not a slug", () => {
    expect(decodeUnlocked(encodeUnlocked(["eros", "../x", "A B", "eros"]))).toEqual(["eros"]);
  });
  it("reads the cookie from a request", () => {
    const req = new Request("http://localhost/api/info", {
      headers: { cookie: `a=1; ${UNLOCK_COOKIE}=${encodeUnlocked(["eris"])}; b=2` },
    });
    expect(isUnlocked(req, "eris")).toBe(true);
    expect(isUnlocked(req, "eros")).toBe(false);
  });
});

describe("handle()", () => {
  it("lets Next's prerender bail-out through instead of logging it as an error", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const bail = Object.assign(new Error("prerender interrupted"), { digest: "NEXT_PRERENDER_INTERRUPTED" });
    await expect(handle(() => Promise.reject(bail))).rejects.toBe(bail);
    const notFound = Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    await expect(handle(() => Promise.reject(notFound))).rejects.toBe(notFound);
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });
  it("turns ApiFail into its status and anything else into 500 internal", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const a = await handle(() => Promise.reject(new ApiFail("unauthorized", "no")));
    expect(a.status).toBe(401);
    const b = await handle(() => Promise.reject(new Error("disk on fire")));
    expect(b.status).toBe(500);
    expect((await b.json()).error.code).toBe("internal");
    expect(err).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });
});

describe("rate limit", () => {
  it("allows the limit, then asks to wait, then resets", () => {
    for (let i = 0; i < 3; i++) expect(hit("k", 3, 60_000, 1000)).toBe(0);
    expect(hit("k", 3, 60_000, 31_000)).toBe(30);
    expect(hit("other", 3, 60_000, 31_000)).toBe(0);
    expect(hit("k", 3, 60_000, 61_001)).toBe(0);
  });
});

describe("clientIp", () => {
  const ip = (headers: Record<string, string>) => clientIp(new Request("http://localhost/x", { headers }));
  it("prefers x-vercel-forwarded-for (first entry), whatever else is sent", () => {
    expect(ip({ "x-vercel-forwarded-for": "198.51.100.1, 10.0.0.1", "x-real-ip": "192.0.2.5", "x-forwarded-for": "1.1.1.1, 2.2.2.2" })).toBe("198.51.100.1");
  });
  it("then x-real-ip", () => {
    expect(ip({ "x-real-ip": "192.0.2.5", "x-forwarded-for": "1.1.1.1, 2.2.2.2" })).toBe("192.0.2.5");
  });
  it("then the LAST x-forwarded-for entry, the one added by the nearest proxy (a client-written first entry is ignored)", () => {
    expect(ip({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" })).toBe("203.0.113.7");
    expect(ip({ "x-forwarded-for": "203.0.113.8" })).toBe("203.0.113.8");
  });
  it("else local", () => {
    expect(ip({})).toBe("local");
    expect(ip({ "x-forwarded-for": "" })).toBe("local");
  });
});

describe("rate limit eviction", () => {
  it("a full map drops the ~10% that end soonest and keeps everyone else's counts", () => {
    resetRateLimit();
    // Key i starts its window at time i, so key 0 ends first and the last key ends last.
    for (let i = 0; i < MAX_KEYS; i++) expect(hit(`e${i}`, 1, 1_000_000, i)).toBe(0);
    // One more address arrives while the map is full and nothing has expired.
    expect(hit("newcomer", 1, 1_000_000, MAX_KEYS)).toBe(0);
    // The newest keys kept their count: their second hit is over the limit of 1.
    expect(hit(`e${MAX_KEYS - 1}`, 1, 1_000_000, MAX_KEYS + 1)).toBeGreaterThan(0);
    expect(hit(`e${Math.ceil(MAX_KEYS * 0.1) + 5}`, 1, 1_000_000, MAX_KEYS + 1)).toBeGreaterThan(0);
    expect(hit("newcomer", 1, 1_000_000, MAX_KEYS + 1)).toBeGreaterThan(0);
    // The earliest-ending keys were evicted: they start again from zero.
    expect(hit("e0", 1, 1_000_000, MAX_KEYS + 1)).toBe(0);
    expect(hit(`e${Math.ceil(MAX_KEYS * 0.1) - 1}`, 1, 1_000_000, MAX_KEYS + 1)).toBe(0);
  });
});

describe("POST /api/check", () => {
  it("confirms the fixture mover, returns points and unlocks the spot", async () => {
    const res = await check(
      post({ spot: "fixture", answer: "track", marks: [{ frame: 1, x: 10, y: 16 }, { frame: 4, x: 16, y: 16 }] }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verdict).toEqual({
      kind: "known",
      object_name: "Fixture mover",
      points: 100,
      message: "Confirmed: Fixture mover, asteroid.",
    });
    expect(body).toMatchObject({
      first_finder: false,
      already_found: false,
      persisted: false,
      unlocked: true,
      practice: false,
      reveal: { frame: 1, x: 10, y: 16 },
      noise_bar_sigma: 6,
    });
    expect(body.track.rate_arcsec_per_hour).toBeCloseTo((16 * 6.15) / 24, 6);
    expect(body.matched).toBeUndefined(); // internal detail, never sent
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(setCookie).toMatch(/Path=\/api/i);
    expect(decodeUnlocked(cookieValue(res))).toEqual(["fixture"]);
  });
  it("keeps earlier unlocked spots in the cookie", async () => {
    const res = await check(
      post(FIXTURE_HIT, { cookie: `${UNLOCK_COOKIE}=${encodeUnlocked(["eros"])}` }),
    );
    expect((await res.json()).verdict.kind).toBe("known");
    expect(decodeUnlocked(cookieValue(res))).toEqual(["eros", "fixture"]);
  });
  it("a wrong answer does not unlock the spot, so the player can try again", async () => {
    const wrong: [unknown, string][] = [
      [{ spot: "fixture", answer: "nothing" }, "nothing_wrong"],
      [{ spot: "fixture", answer: "track", marks: [{ frame: 1, x: 8, y: 8 }, { frame: 4, x: 8.4, y: 8 }] }, "static"],
      [{ spot: "fixture", answer: "track", marks: [{ frame: 1, x: 2, y: 2 }, { frame: 4, x: 25, y: 28 }] }, "candidate"],
    ];
    for (const [body, kind] of wrong) {
      const res = await check(post(body));
      const json = await res.json();
      expect(json.verdict.kind).toBe(kind);
      expect(json.unlocked).toBe(false);
      expect(json.practice).toBe(false);
      expect(res.headers.get("set-cookie")).toBeNull();
    }
    // ...and the next, correct, try still scores in full.
    const res = await check(post(FIXTURE_HIT));
    expect((await res.json()).verdict.points).toBe(100);
  });
  it("on a spot that is already open, answers are judged but earn 0 points (practice)", async () => {
    const cookie = { cookie: `${UNLOCK_COOKIE}=${encodeUnlocked(["fixture"])}` };
    const res = await check(post(FIXTURE_HIT, cookie));
    const json = await res.json();
    expect(json.verdict).toEqual({
      kind: "known",
      object_name: "Fixture mover",
      points: 0,
      message: `Confirmed: Fixture mover, asteroid.${PRACTICE_SUFFIX}`,
    });
    expect(json).toMatchObject({ practice: true, unlocked: true, reveal: { frame: 1, x: 10, y: 16 } });
    const wrong = await (await check(post({ spot: "fixture", answer: "nothing" }, cookie))).json();
    expect(wrong).toMatchObject({ practice: true, unlocked: true, verdict: { kind: "nothing_wrong", points: 0 } });
    expect(wrong.verdict.message).toContain("Practice: this spot is already open, so no points.");
    // Another spot's cookie does not make this one practice.
    const other = await (await check(post(FIXTURE_HIT, { cookie: `${UNLOCK_COOKIE}=${encodeUnlocked(["eros"])}` }))).json();
    expect(other).toMatchObject({ practice: false, verdict: { points: 100 } });
  });
  it.runIf(have("hektor"))("hektor: bot-path marks, then accurate marks, score once (the second is practice)", async () => {
    const key = (await loadAnswerKey("hektor"))!;
    const field = (await loadFieldForScoring("hektor"))!;
    const c = key.bot.candidates[0];
    const botMarks = [2, 5].map((i) => {
      const t = field.frames.find((f) => f.i === i)!.mjd - key.t_ref_mjd;
      return { frame: i, x: c.x + c.vx_px_per_day * t, y: c.y + c.vy_px_per_day * t };
    });
    const first = await check(post({ spot: "hektor", answer: "track", marks: botMarks }));
    const a = await first.json();
    expect(a.verdict).toMatchObject({ kind: "known", object_name: "624 Hektor (A907 CF)", points: 250 });
    const exact = key.objects[0].positions.filter((p) => p.frame === 2 || p.frame === 5).map((p) => ({ frame: p.frame, x: p.x, y: p.y }));
    const b = await (await check(post({ spot: "hektor", answer: "track", marks: exact }, { cookie: `${UNLOCK_COOKIE}=${cookieValue(first)}` }))).json();
    expect(b.verdict).toMatchObject({ kind: "known", points: 0 });
    expect(b.practice).toBe(true);
    expect(a.verdict.points + b.verdict.points).toBe(250);
  });
  it.runIf(have("eris"))("eris: the bot's rank-2 candidate is a bot match with 0 points, and it unlocks", async () => {
    const key = (await loadAnswerKey("eris"))!;
    const field = (await loadFieldForScoring("eris"))!;
    const c = key.bot.candidates.find((x) => x.rank === 2)!;
    const marks = [1, 5].map((i) => {
      const t = field.frames.find((f) => f.i === i)!.mjd - key.t_ref_mjd;
      return { frame: i, x: c.x + c.vx_px_per_day * t, y: c.y + c.vy_px_per_day * t };
    });
    const res = await check(post({ spot: "eris", answer: "track", marks }));
    const json = await res.json();
    expect(json.verdict).toEqual({
      kind: "bot_match",
      points: 0,
      message: "Matches the bot: 6.2σ against a 5.9σ noise bar. Not a confirmed object, so no points.",
    });
    expect(json.unlocked).toBe(true);
    expect(json.noise_bar_sigma).toBe(5.9);
    expect(decodeUnlocked(cookieValue(res))).toEqual(["eris"]);
  });
  it("refuses huge, out-of-picture and oversized input with 400", async () => {
    const huge = await check(post({ spot: "fixture", answer: "track", marks: [{ frame: 1, x: 1e308, y: 0 }, { frame: 4, x: -1e308, y: 0 }] }));
    expect(huge.status).toBe(400);
    expect((await huge.json()).error.code).toBe("bad_request");
    const outside = await check(post({ spot: "fixture", answer: "track", marks: [{ frame: 1, x: 40, y: 16 }, { frame: 4, x: 16, y: 16 }] }));
    expect(outside.status).toBe(400);
    expect((await outside.json()).error.message).toContain("outside the picture");
    // 63,000 euro signs are about 189 kB in UTF-8, though only 63,000 characters long.
    const wide = JSON.stringify({ spot: "fixture", answer: "nothing", pad: "€".repeat(63_000) });
    expect(wide.length).toBeLessThan(64_000 + 100);
    expect((await check(post(wide))).status).toBe(400);
    // A declared Content-Length over the limit is refused before the body is read.
    const declared = new NextRequest("http://localhost/api/check", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "1000000" },
      body: JSON.stringify({ spot: "fixture", answer: "nothing" }),
    });
    const r = await check(declared);
    expect(r.status).toBe(400);
    expect((await r.json()).error.message).toBe("That request is too large.");
  });
  it("answers with the contract's error shape", async () => {
    const cases: [unknown, number, string][] = [
      ["not json", 400, "bad_request"],
      [{ spot: "fixture", answer: "track", marks: [{ frame: 1, x: 1, y: 1 }] }, 400, "bad_request"],
      [{ spot: "fixture", answer: "maybe" }, 400, "bad_request"],
      [{ spot: "Bad Slug", answer: "nothing" }, 400, "bad_request"],
      [{ spot: "fixture", answer: "track", marks: [{ frame: 1, x: 1, y: 1 }, { frame: 9, x: 2, y: 2 }] }, 400, "bad_request"],
      [{ spot: "fixture", answer: "track", marks: [{ frame: 1, x: 1e308, y: 0 }, { frame: 4, x: 0, y: 0 }] }, 400, "bad_request"],
      [{ spot: "no-such-spot", answer: "nothing" }, 404, "not_found"],
    ];
    for (const [body, status, code] of cases) {
      const res = await check(post(body));
      expect(res.status).toBe(status);
      const json = await res.json();
      expect(json.error.code).toBe(code);
      expect(typeof json.error.message).toBe("string");
      expect(res.headers.get("set-cookie")).toBeNull(); // a failed call unlocks nothing
    }
  });
  it("rate-limits one address after 30 calls a minute", async () => {
    let last: Response | undefined;
    for (let i = 0; i < 31; i++) {
      last = await check(post({ spot: "fixture", answer: "nothing" }, { "x-forwarded-for": "203.0.113.9" }));
    }
    expect(last!.status).toBe(429);
    expect(last!.headers.get("retry-after")).toBeTruthy();
    expect((await last!.json()).error.details.retry_after_s).toBeGreaterThan(0);
    const other = await check(post({ spot: "fixture", answer: "nothing" }, { "x-forwarded-for": "203.0.113.10" }));
    expect(other.status).toBe(200);
  });
});

describe("spot_reveal", () => {
  const REVEAL = { title: "A Secret Rock", kind: "asteroid", difficulty: "easy" };
  const key = (reveal?: AnswerKey["reveal"]): AnswerKey => ({
    slug: "spot-x",
    nothing_moves: false,
    noise_bar_sigma: null,
    t_ref_mjd: 0,
    objects: [],
    bot: { candidates: [] },
    ...(reveal ? { reveal } : {}),
  });
  const field: FieldForScoring = {
    slug: "spot-x",
    difficulty: "easy",
    pixel_arcsec: 6.15,
    size: [100, 100],
    frames: [{ i: 1, mjd: 0 }, { i: 2, mjd: 1 }],
  };
  const scoredWrong: Scored = {
    verdict: { kind: "nothing_wrong", points: 0, message: "Something does move here. Look again." },
    noise_bar_sigma: null,
  };
  const scoredKnown: Scored = {
    verdict: { kind: "known", object_name: "Rock", points: 100, message: "Confirmed: Rock, asteroid." },
    noise_bar_sigma: null,
    spot_reveal: REVEAL,
  };

  it("scoreSubmission carries the key's reveal on the result", () => {
    const scored = scoreSubmission(key(REVEAL), field, { answer: "nothing" });
    expect(scored.spot_reveal).toEqual(REVEAL);
    expect(scoreSubmission(key(), field, { answer: "nothing" }).spot_reveal).toBeUndefined();
  });
  it("a correct, unlocking answer carries spot_reveal", () => {
    const body = responseBody(scoredKnown, { unlocked: true, practice: false });
    expect(body.unlocked).toBe(true);
    expect(body.spot_reveal).toEqual(REVEAL);
  });
  it("a wrong answer to a locked spot never carries spot_reveal", () => {
    const body = responseBody({ ...scoredWrong, spot_reveal: REVEAL }, { unlocked: false, practice: false });
    expect(body.unlocked).toBe(false);
    expect("spot_reveal" in body).toBe(false);
  });
  it("a practice answer on an open spot carries spot_reveal, with the practice rules", () => {
    const body = responseBody({ ...scoredWrong, spot_reveal: REVEAL }, { unlocked: true, practice: true });
    expect(body.practice).toBe(true);
    expect(body.spot_reveal).toEqual(REVEAL);
    expect(body.verdict.points).toBe(0);
    expect(body.verdict.message.endsWith(PRACTICE_SUFFIX)).toBe(true);
  });
});
