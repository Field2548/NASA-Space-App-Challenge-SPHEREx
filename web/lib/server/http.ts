// Shared helpers for route handlers (owner: SERVER). Server only.
// Error shape and codes: docs/contracts/api.md section 1.

import { NextResponse } from "next/server";
import type { ZodType } from "zod";
import { ScoringError } from "@/lib/scoring";

export type ErrorCode =
  | "bad_request"
  | "unauthorized"
  | "not_found"
  | "rate_limited"
  | "upstream_failed"
  | "db_unavailable"
  | "internal";

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  not_found: 404,
  rate_limited: 429,
  upstream_failed: 502,
  db_unavailable: 503,
  internal: 500,
};

/** Throw this anywhere inside a handler to answer with the contract's error shape. */
export class ApiFail extends Error {
  code: ErrorCode;
  details?: Record<string, unknown>;
  headers?: Record<string, string>;
  constructor(
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>,
    headers?: Record<string, string>,
  ) {
    super(message);
    this.code = code;
    this.details = details;
    this.headers = headers;
  }
}

export function errorResponse(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
  headers?: Record<string, string>,
): NextResponse {
  return NextResponse.json(
    { error: { code, message, ...(details ? { details } : {}) } },
    { status: STATUS[code], headers },
  );
}

/** Validate with zod; a failure becomes a 400 that carries the zod issues. */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const first = r.error.issues[0];
  const where = first?.path?.length ? ` (${first.path.join(".")})` : "";
  throw new ApiFail("bad_request", `That request is not valid${where}: ${first?.message ?? "bad input"}.`, {
    issues: r.error.issues,
  });
}

/** Read a JSON body. Refuses bodies over 64 kB and anything that is not JSON. */
export async function readJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > 64_000) throw new ApiFail("bad_request", "That request is too large.");
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiFail("bad_request", "The request body must be JSON.");
  }
}

/** Query string as a plain object (first value of each key). */
export function queryObject(request: Request): Record<string, string> {
  return Object.fromEntries(new URL(request.url).searchParams.entries());
}

/** Best guess at the caller's address, for the light rate limit only. */
export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0] : request.headers.get("x-real-ip") ?? "local").trim();
}

/** Run a handler and turn every failure into the contract's error JSON. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiFail) return errorResponse(e.code, e.message, e.details, e.headers);
    if (e instanceof ScoringError) return errorResponse(e.code, e.message);
    console.error("[api] unexpected error", e);
    return errorResponse("internal", "Something went wrong on our side. Please try again.");
  }
}
