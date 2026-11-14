// Health checks with a fake fetch. No real network.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";
import { checkAll, getHealth, resetHealthCache, UNLOCK_WARNING } from "@/lib/server/health";
import { resetRateLimit } from "@/lib/server/rateLimit";

const IDS = ["irsa_sia", "irsa_s3", "cds_sesame", "cds_hips", "simbad_tap", "gaia_tap", "jpl_horizons", "jpl_sbident", "supabase"];
const SB = { NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" } as unknown as NodeJS.ProcessEnv;
const NONE = {} as NodeJS.ProcessEnv;

const ok = (status = 200) => new Response(null, { status });
const fakeFetch = (fn: (url: string) => Response) =>
  vi.fn<typeof fetch>((input) => Promise.resolve(fn(String(input))));
const asFetch = (f: ReturnType<typeof vi.fn>) => f as unknown as typeof fetch;

beforeEach(() => {
  resetHealthCache();
  resetRateLimit();
  vi.unstubAllEnvs();
});

describe("checkAll", () => {
  it("all green with supabase configured", async () => {
    const r = await checkAll(asFetch(fakeFetch(() => ok())), Date.now, 5000, SB);
    expect(r.services.map((s) => s.id)).toEqual(IDS);
    expect(r.services.every((s) => s.status === "green" && s.http === 200)).toBe(true);
    expect(r.overall).toBe("green");
    expect(new Date(r.checked_at).toISOString()).toBe(r.checked_at);
  });

  it("sends the anon key to supabase", async () => {
    const f = fakeFetch(() => ok());
    await checkAll(asFetch(f), Date.now, 5000, SB);
    const call = f.mock.calls.find((c) => String(c[0]).includes("/auth/v1/health"));
    expect(call?.[1]?.headers).toEqual({ apikey: "k" });
  });

  it("one service throwing is red and the others stay green", async () => {
    const f = fakeFetch((url) => {
      if (url.includes("simbad")) throw new Error("boom");
      return ok();
    });
    const r = await checkAll(asFetch(f), Date.now, 5000, SB);
    const simbad = r.services.find((s) => s.id === "simbad_tap")!;
    expect(simbad.status).toBe("red");
    expect(simbad.http).toBeNull();
    expect(simbad.message).toContain("SIMBAD");
    expect(r.services.filter((s) => s.status === "green")).toHaveLength(8);
    expect(r.overall).toBe("red");
  });

  it("an HTTP 502 is red and keeps the status code", async () => {
    const f = fakeFetch((u) => (u.includes("irsa.ipac") ? ok(502) : ok()));
    const r = await checkAll(asFetch(f), Date.now, 5000, SB);
    const s = r.services.find((x) => x.id === "irsa_sia")!;
    expect(s.status).toBe("red");
    expect(s.http).toBe(502);
    expect(s.message).toBe("IRSA is not answering right now. Ready spots still work; quick look may fail.");
  });

  it("S3 answering 403 still counts as up", async () => {
    const f = fakeFetch((u) => (u.includes("amazonaws") ? ok(403) : ok()));
    const r = await checkAll(asFetch(f), Date.now, 5000, SB);
    expect(r.services.find((x) => x.id === "irsa_s3")!.status).toBe("green");
  });

  it("a probe that never answers times out as red", async () => {
    const f = vi.fn((input: RequestInfo | URL) =>
      String(input).includes("gea.esac") ? new Promise<Response>(() => {}) : Promise.resolve(ok()),
    );
    const r = await checkAll(asFetch(f), Date.now, 40, SB);
    const g = r.services.find((x) => x.id === "gaia_tap")!;
    expect(g.status).toBe("red");
    expect(g.ms).toBe(40);
    expect(r.services.filter((s) => s.status === "green")).toHaveLength(8);
  });

  it("a slow answer is amber", async () => {
    let t = 0;
    const f = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes("horizons")) t += 2500;
      return Promise.resolve(ok());
    });
    const r = await checkAll(asFetch(f), () => t, 5000, SB);
    const h = r.services.find((x) => x.id === "jpl_horizons")!;
    expect(h.status).toBe("amber");
    expect(h.ms).toBeGreaterThanOrEqual(2000);
    expect(r.overall).toBe("amber");
  });

  it("supabase not configured is amber, never red, and makes overall amber", async () => {
    const f = fakeFetch(() => ok());
    const r = await checkAll(asFetch(f), Date.now, 5000, NONE);
    const s = r.services.find((x) => x.id === "supabase")!;
    expect(s.status).toBe("amber");
    expect(s.http).toBeNull();
    expect(s.message).toBe("No database is connected. Guest play works; scores are not saved.");
    expect(r.services).toHaveLength(9);
    expect(r.overall).toBe("amber");
    expect(f.mock.calls).toHaveLength(8);
  });

  it("a red service beats the supabase amber", async () => {
    const f = fakeFetch((u) => (u.includes("ssd-api") ? ok(500) : ok()));
    const r = await checkAll(asFetch(f), Date.now, 5000, NONE);
    expect(r.overall).toBe("red");
  });
});

describe("configuration warnings", () => {
  const f = () => asFetch(fakeFetch(() => ok()));
  it("warns in production when no secret signs the unlock cookie, without adding a service", async () => {
    const r = await checkAll(f(), Date.now, 5000, { ...SB, NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv);
    expect(r.warnings).toEqual(["UNLOCK_SECRET is not set: finished spots will lock again."]);
    expect(r.warnings).toEqual([UNLOCK_WARNING]);
    expect(r.services.map((s) => s.id)).toEqual(IDS);
    expect(r.overall).toBe("green");
  });
  it("no warning in production with UNLOCK_SECRET (or a derived key), and none outside production", async () => {
    for (const extra of [{ UNLOCK_SECRET: "u" }, { CRON_SECRET: "c" }, { SUPABASE_SERVICE_ROLE_KEY: "k" }]) {
      const r = await checkAll(f(), Date.now, 5000, { ...SB, NODE_ENV: "production", ...extra } as unknown as NodeJS.ProcessEnv);
      expect(r.warnings).toBeUndefined();
    }
    expect((await checkAll(f(), Date.now, 5000, { ...SB, NODE_ENV: "development" } as unknown as NodeJS.ProcessEnv)).warnings).toBeUndefined();
  });
  it("probes JPL SB Identification with a geocentric observer, not mpc-code=500", async () => {
    const calls = fakeFetch(() => ok());
    await checkAll(asFetch(calls), Date.now, 5000, SB);
    const url = calls.mock.calls.map((c) => String(c[0])).find((u) => u.includes("sb_ident"))!;
    expect(url).toContain("xobs=0,0,0,0,0,0");
    expect(url).not.toContain("mpc-code");
  });
});

describe("getHealth cache", () => {
  it("two calls make one round of probes; a call after 60 s makes another", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const f = fakeFetch(() => ok());
    let t = 1_000_000;
    const now = () => t;
    const [a, b] = await Promise.all([getHealth(asFetch(f), now), getHealth(asFetch(f), now)]);
    expect(b).toBe(a);
    await getHealth(asFetch(f), now);
    expect(f.mock.calls).toHaveLength(8);
    t += 61_000;
    await getHealth(asFetch(f), now);
    expect(f.mock.calls).toHaveLength(16);
  });
});

describe("GET /api/health", () => {
  it("answers 200 with the contract shape even when everything fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    const res = await GET(new NextRequest("http://localhost/api/health"));
    vi.unstubAllGlobals();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["checked_at", "overall", "services"]);
    expect(body.overall).toBe("red");
    expect(body.services.map((s: { id: string }) => s.id)).toEqual(IDS);
    for (const s of body.services) {
      expect(Object.keys(s).sort()).toEqual(["http", "id", "message", "ms", "name", "status"]);
    }
  });
});
