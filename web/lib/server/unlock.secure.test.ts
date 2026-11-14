import { NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { grantUnlock } from "@/lib/server/unlock";

type UnlockModule = typeof import("@/lib/server/unlock");

function setCookie(url: string, headers: Record<string, string> = {}): string {
  const res = NextResponse.json({});
  grantUnlock(new Request(url, { headers }), res, ["eros"]);
  return res.headers.get("set-cookie") ?? "";
}

describe("unlock cookie Secure flag", () => {
  it("is not Secure on plain http", () => {
    expect(setCookie("http://localhost/api/check")).not.toMatch(/;\s*Secure/i);
  });
  it("is Secure behind an https proxy", () => {
    expect(setCookie("http://localhost/api/check", { "x-forwarded-proto": "https" })).toMatch(/;\s*Secure/i);
    expect(setCookie("http://localhost/api/check", { "x-forwarded-proto": "https, http" })).toMatch(/;\s*Secure/i);
  });
  it("is Secure on an https URL", () => {
    expect(setCookie("https://example.com/api/check")).toMatch(/;\s*Secure/i);
  });
});

/** A fresh copy of the module (its own process key and warning flag) reading `env`. */
async function instance(env: Record<string, string | undefined>): Promise<UnlockModule> {
  vi.resetModules();
  const m: UnlockModule = await import("@/lib/server/unlock");
  m.setEnvForTests(() => env);
  return m;
}

describe("unlock signing key", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("production with no secret: signs nothing, sets no cookie, reads every cookie as empty, warns once", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const dev = await instance({ NODE_ENV: "development" });
    const devCookie = dev.encodeUnlocked(["eros"]);
    const prod = await instance({ NODE_ENV: "production" });
    expect(prod.unlockConfigured()).toBe(false);
    expect(prod.encodeUnlocked(["eros"])).toBeNull();
    expect(prod.decodeUnlocked(devCookie)).toEqual([]);
    const res = NextResponse.json({});
    expect(prod.grantUnlock(new Request("https://example.com/api/check"), res, ["eros"])).toBe(false);
    expect(res.headers.get("set-cookie")).toBeNull();
    prod.decodeUnlocked(devCookie);
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0][0])).toContain("UNLOCK_SECRET is not set in production");
  });

  it("production with UNLOCK_SECRET: two server instances accept each other's cookie", async () => {
    const env = { NODE_ENV: "production", UNLOCK_SECRET: "s3cret" };
    const a = await instance(env);
    expect(a.unlockConfigured()).toBe(true);
    const cookie = a.encodeUnlocked(["eros", "eris"]);
    const b = await instance(env);
    expect(b).not.toBe(a);
    expect(b.decodeUnlocked(cookie)).toEqual(["eros", "eris"]);
    const res = NextResponse.json({});
    expect(b.grantUnlock(new Request("https://example.com/api/check"), res, ["eros"])).toBe(true);
    expect(res.headers.get("set-cookie")).toMatch(/^unlock=v1\./);
  });

  it("production with only CRON_SECRET or the service key: a derived key, shared between instances", async () => {
    for (const env of [
      { NODE_ENV: "production", CRON_SECRET: "c" },
      { NODE_ENV: "production", SUPABASE_SERVICE_ROLE_KEY: "k" },
    ]) {
      const cookie = (await instance(env)).encodeUnlocked(["eros"]);
      const b = await instance(env);
      expect(b.unlockConfigured()).toBe(true);
      expect(b.decodeUnlocked(cookie)).toEqual(["eros"]);
    }
  });

  it("keeps the order UNLOCK_SECRET, CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY; changing them invalidates cookies", async () => {
    const svc = await instance({ NODE_ENV: "production", SUPABASE_SERVICE_ROLE_KEY: "k" });
    const fromSvc = svc.encodeUnlocked(["eros"]);
    // CRON_SECRET wins over the service key, so adding it invalidates the cookie.
    expect((await instance({ NODE_ENV: "production", SUPABASE_SERVICE_ROLE_KEY: "k", CRON_SECRET: "c" })).decodeUnlocked(fromSvc)).toEqual([]);
    const cron = await instance({ NODE_ENV: "production", SUPABASE_SERVICE_ROLE_KEY: "k", CRON_SECRET: "c" });
    const fromCron = cron.encodeUnlocked(["eros"]);
    expect((await instance({ NODE_ENV: "production", CRON_SECRET: "c" })).decodeUnlocked(fromCron)).toEqual(["eros"]);
    // UNLOCK_SECRET wins over both.
    expect((await instance({ NODE_ENV: "production", CRON_SECRET: "c", UNLOCK_SECRET: "u" })).decodeUnlocked(fromCron)).toEqual([]);
  });

  it("development with no secret: a random key per process, so two instances do not share cookies", async () => {
    const a = await instance({ NODE_ENV: "development" });
    expect(a.unlockConfigured()).toBe(false);
    const cookie = a.encodeUnlocked(["eros"]);
    expect(a.decodeUnlocked(cookie)).toEqual(["eros"]);
    const b = await instance({ NODE_ENV: "development" });
    expect(b.decodeUnlocked(cookie)).toEqual([]);
  });
});
