// POST /api/playtime with a fake Supabase. Contract: api.md section 7b.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Reply = { data: unknown; error: { code?: string; message: string } | null };
const state = vi.hoisted(() => ({
  configured: true,
  auth: { data: { user: { id: "u1" } }, error: null } as { data: { user: { id: string } | null }; error: { status?: number; message: string } | null },
  authThrows: null as Error | null,
  authHangs: false,
  calls: [] as { name: string; args: Record<string, unknown> }[],
  reply: { data: 60, error: null } as Reply,
  serviceUsed: 0,
  clientRequests: [] as (string | null)[],
}));

vi.mock("@/lib/server/db", async (original) => ({
  ...(await original<typeof import("@/lib/server/db")>()),
  anonClient: (req?: Request) => {
    state.clientRequests.push(req?.headers.get("authorization") ?? null);
    return state.configured
      ? {
          auth: {
            getUser: async (token: string) => {
              state.clientRequests.push(`getUser:${token}`);
              if (state.authHangs) return new Promise(() => {});
              if (state.authThrows) throw state.authThrows;
              return state.auth;
            },
          },
          rpc: (name: string, args: Record<string, unknown>) => {
            state.calls.push({ name, args });
            return { abortSignal: async (): Promise<Reply> => state.reply };
          },
        }
      : null;
  },
  serviceClient: () => {
    state.serviceUsed += 1;
    return null;
  },
}));

import { POST } from "@/app/api/playtime/route";
import { resetRateLimit } from "@/lib/server/rateLimit";

const post = (body: unknown, headers: Record<string, string> = { authorization: "Bearer tok" }) =>
  new NextRequest("http://localhost/api/playtime", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  resetRateLimit();
  state.configured = true;
  state.auth = { data: { user: { id: "u1" } }, error: null };
  state.authThrows = null;
  state.authHangs = false;
  state.calls = [];
  state.reply = { data: 60, error: null };
  state.serviceUsed = 0;
  state.clientRequests = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/playtime", () => {
  it("credits the caller through add_play_time with the caller's token, never the service client", async () => {
    const res = await POST(post({ seconds: 60 }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ credited: 60 });
    expect(state.calls).toEqual([{ name: "add_play_time", args: { p_seconds: 60 } }]);
    expect(state.clientRequests).toEqual(["Bearer tok", "getUser:tok"]);
    expect(state.serviceUsed).toBe(0);
  });

  it("answers what the database credited, which may be less than was claimed", async () => {
    state.reply = { data: 10, error: null };
    expect(await (await POST(post({ seconds: 120 }))).json()).toEqual({ credited: 10 });
  });

  it("refuses a guest with 401 in the api.md error shape, without calling the database", async () => {
    const res = await POST(post({ seconds: 60 }, {}));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("unauthorized");
    expect(typeof body.error.message).toBe("string");
    expect(state.calls).toHaveLength(0);
  });

  it.each([
    [401, "bad_jwt"],
    [403, "user_not_found"],
    [400, "bad request"],
  ])("refuses a token the auth server calls invalid (status %i) with 401", async (status, message) => {
    state.auth = { data: { user: null }, error: { status, message } };
    const res = await POST(post({ seconds: 60 }));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized");
    expect(state.calls).toHaveLength(0);
  });

  it("refuses a token with no user and no error with 401", async () => {
    state.auth = { data: { user: null }, error: null };
    expect((await POST(post({ seconds: 60 }))).status).toBe(401);
    expect(state.calls).toHaveLength(0);
  });

  it.each([
    [500, "auth server error"],
    [502, "bad gateway"],
    [503, "unavailable"],
    [429, "rate limited"],
    [408, "timeout"],
    [undefined, "fetch failed"],
  ])("answers 503 db_unavailable, not 401, when the auth server errors (status %s)", async (status, message) => {
    state.auth = { data: { user: null }, error: { status, message } };
    const res = await POST(post({ seconds: 60 }));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("db_unavailable");
    expect(state.calls).toHaveLength(0);
  });

  it("answers 503 db_unavailable when the auth call throws", async () => {
    state.authThrows = new Error("network down");
    const res = await POST(post({ seconds: 60 }));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("db_unavailable");
    expect(state.calls).toHaveLength(0);
  });

  it("answers 503 db_unavailable when the auth server times out", async () => {
    vi.useFakeTimers();
    try {
      state.authHangs = true;
      const pending = POST(post({ seconds: 60 }));
      await vi.advanceTimersByTimeAsync(5001);
      const res = await pending;
      expect(res.status).toBe(503);
      expect((await res.json()).error.code).toBe("db_unavailable");
      expect(state.calls).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("503 db_unavailable with no database, and when the function is missing or fails", async () => {
    state.configured = false;
    let res = await POST(post({ seconds: 60 }));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("db_unavailable");

    state.configured = true;
    state.reply = { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
    res = await POST(post({ seconds: 60 }));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("db_unavailable");
  });

  it.each([
    [{ seconds: 0 }],
    [{ seconds: -5 }],
    [{ seconds: 121 }],
    [{ seconds: 1.5 }],
    [{ seconds: "60" }],
    [{}],
    [{ seconds: null }],
    ["not json"],
  ])("400 bad_request for %j", async (body) => {
    const res = await POST(post(body));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("bad_request");
    expect(state.calls).toHaveLength(0);
  });

  it("accepts the limits 1 and 120", async () => {
    expect((await POST(post({ seconds: 1 }))).status).toBe(200);
    expect((await POST(post({ seconds: 120 }))).status).toBe(200);
  });

  it("rate limits at 60 a minute", async () => {
    for (let i = 0; i < 60; i++) expect((await POST(post({ seconds: 5 }))).status).toBe(200);
    const res = await POST(post({ seconds: 5 }));
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("rate_limited");
  });
});
