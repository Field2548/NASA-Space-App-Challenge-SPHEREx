// Route helpers and POST /api/check, called directly (no HTTP server needed).
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as check } from "@/app/api/check/route";
import { hit, resetRateLimit } from "@/lib/server/rateLimit";
import { decodeUnlocked, encodeUnlocked, isUnlocked, UNLOCK_COOKIE } from "@/lib/server/unlock";

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
    const good = encodeUnlocked(["eros"]);
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

describe("rate limit", () => {
  it("allows the limit, then asks to wait, then resets", () => {
    for (let i = 0; i < 3; i++) expect(hit("k", 3, 60_000, 1000)).toBe(0);
    expect(hit("k", 3, 60_000, 31_000)).toBe(30);
    expect(hit("other", 3, 60_000, 31_000)).toBe(0);
    expect(hit("k", 3, 60_000, 61_001)).toBe(0);
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
      post({ spot: "fixture", answer: "nothing" }, { cookie: `${UNLOCK_COOKIE}=${encodeUnlocked(["eros"])}` }),
    );
    expect((await res.json()).verdict.kind).toBe("nothing_wrong");
    expect(decodeUnlocked(cookieValue(res))).toEqual(["eros", "fixture"]);
  });
  it("answers with the contract's error shape", async () => {
    const cases: [unknown, number, string][] = [
      ["not json", 400, "bad_request"],
      [{ spot: "fixture", answer: "track", marks: [{ frame: 1, x: 1, y: 1 }] }, 400, "bad_request"],
      [{ spot: "fixture", answer: "maybe" }, 400, "bad_request"],
      [{ spot: "Bad Slug", answer: "nothing" }, 400, "bad_request"],
      [{ spot: "fixture", answer: "track", marks: [{ frame: 1, x: 1, y: 1 }, { frame: 9, x: 2, y: 2 }] }, 400, "bad_request"],
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
