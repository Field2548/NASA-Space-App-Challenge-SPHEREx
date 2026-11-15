// POST /api/request-spot with a fake service client whose request_spot() answers as the SQL
// function does (supabase/migrations: new, duplicate, queue_full). Contract: api.md section 9.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type RpcResult = { data: unknown; error: { message: string } | null };
const state = vi.hoisted(() => ({
  result: { data: null, error: null } as RpcResult,
  calls: [] as { name: string; args: Record<string, unknown> }[],
  user: null as { id: string } | null,
}));

vi.mock("@/lib/server/db", () => ({
  serviceClient: () => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      state.calls.push({ name, args });
      return { abortSignal: async () => state.result };
    },
  }),
  anonClient: () => null,
  userFromRequest: async () => state.user,
}));

import { POST } from "@/app/api/request-spot/route";
import { resetRateLimit } from "@/lib/server/rateLimit";

const post = (body: unknown) =>
  new NextRequest("http://localhost/api/request-spot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  resetRateLimit();
  state.calls = [];
  state.user = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/request-spot", () => {
  it("a new request: 201 { id, status: queued }, through request_spot with the caller's id", async () => {
    state.user = { id: "user-1" };
    state.result = { data: [{ id: 17, status: "queued", duplicate: false }], error: null };
    const res = await POST(post({ ra: 133.795, dec: -7.245, fov: 0.2 }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 17, status: "queued" });
    expect(state.calls).toEqual([
      { name: "request_spot", args: { p_user: "user-1", p_ra: 133.795, p_dec: -7.245, p_fov: 0.2 } },
    ]);
  });

  it("RA 360 is sent as 0 (the same direction; the table allows [0, 360))", async () => {
    state.result = { data: [{ id: 1, status: "queued", duplicate: false }], error: null };
    await POST(post({ ra: 360, dec: 0 }));
    expect(state.calls[0].args).toMatchObject({ p_ra: 0, p_user: null, p_fov: 0.2 });
  });

  it("a duplicate: 200 { id, status, duplicate: true } with the existing row", async () => {
    state.result = { data: [{ id: 9, status: "processing", duplicate: true }], error: null };
    const res = await POST(post({ ra: 10, dec: 10 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 9, status: "processing", duplicate: true });
  });

  it("a full queue: 429 rate_limited with a plain message", async () => {
    state.result = { data: null, error: { message: "queue_full" } };
    const res = await POST(post({ ra: 10, dec: 10 }));
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error.code).toBe("rate_limited");
    expect(json.error.message).toMatch(/queue is full/i);
  });

  it("any other database error: 503 db_unavailable", async () => {
    state.result = { data: null, error: { message: "connection reset" } };
    const res = await POST(post({ ra: 10, dec: 10 }));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("db_unavailable");
  });

  it("an answer with no row: 503 db_unavailable", async () => {
    state.result = { data: [], error: null };
    expect((await POST(post({ ra: 10, dec: 10 }))).status).toBe(503);
  });
});
