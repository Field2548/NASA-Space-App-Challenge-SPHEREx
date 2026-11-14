import { describe, expect, it } from "vitest";
import { ApiCallError, nothingRequest, submitCheck, toCheckRequest } from "./check";
import type { CheckResponse } from "./types";

const ok: CheckResponse = {
  verdict: { kind: "static", points: 0, message: "star" },
  first_finder: false,
  already_found: false,
  persisted: false,
  unlocked: true,
  noise_bar_sigma: null,
};

describe("request builders", () => {
  it("toCheckRequest keeps only frame,x,y", () => {
    const r = toCheckRequest("eros", [
      { frame: 1, x: 2, y: 3, tDays: 0 },
      { frame: 4, x: 5, y: 6, tDays: 2 },
    ]);
    expect(r).toEqual({ spot: "eros", answer: "track", marks: [{ frame: 1, x: 2, y: 3 }, { frame: 4, x: 5, y: 6 }] });
  });
  it("nothingRequest", () => expect(nothingRequest("cygnus")).toEqual({ spot: "cygnus", answer: "nothing" }));
});

describe("submitCheck", () => {
  it("POSTs JSON same-origin and returns the body", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify(ok));
    }) as unknown as typeof fetch;
    const out = await submitCheck(nothingRequest("cygnus"), fake);
    expect(out).toEqual(ok);
    expect(seen?.url).toBe("/api/check");
    expect(seen?.init.method).toBe("POST");
    expect(seen?.init.credentials).toBe("same-origin");
    expect(JSON.parse(seen?.init.body as string)).toEqual({ spot: "cygnus", answer: "nothing" });
  });
  it("throws ApiCallError with code, message, details, status on non-2xx", async () => {
    const body = { error: { code: "bad_request", message: "need 2 frames", details: { n: 1 } } };
    const fake = (async () => new Response(JSON.stringify(body), { status: 400 })) as unknown as typeof fetch;
    const e = await submitCheck(nothingRequest("x"), fake).catch((x) => x);
    expect(e).toBeInstanceOf(ApiCallError);
    expect(e).toBeInstanceOf(Error);
    expect(e).toMatchObject({ code: "bad_request", message: "need 2 frames", details: { n: 1 }, status: 400 });
  });
  it("non-JSON error body becomes internal", async () => {
    const fake = (async () => new Response("<html>", { status: 502 })) as unknown as typeof fetch;
    await expect(submitCheck(nothingRequest("x"), fake)).rejects.toMatchObject({ code: "internal", status: 502 });
  });
  it("network failure becomes upstream_failed", async () => {
    const fake = (async () => {
      throw new TypeError("offline");
    }) as unknown as typeof fetch;
    await expect(submitCheck(nothingRequest("x"), fake)).rejects.toMatchObject({ code: "upstream_failed", message: "offline" });
  });
});
