// Client for POST /api/check (api.md section 3).

import type { ApiError, CheckRequest, CheckResponse, Mark } from "./types";

export const CHECK_URL = "/api/check";

type ErrorCode = ApiError["error"]["code"];

export class ApiCallError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;
  readonly status: number;
  constructor(code: ErrorCode, message: string, status = 0, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiCallError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export async function submitCheck(req: CheckRequest, fetcher: typeof fetch = fetch): Promise<CheckResponse> {
  let res: Response;
  try {
    res = await fetcher(CHECK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(req),
    });
  } catch (e) {
    throw new ApiCallError("upstream_failed", e instanceof Error ? e.message : "Network request failed");
  }
  if (!res.ok) {
    let err: ApiError["error"] | undefined;
    try {
      err = ((await res.json()) as ApiError).error;
    } catch {
      /* not JSON */
    }
    if (err && typeof err.code === "string") throw new ApiCallError(err.code, err.message, res.status, err.details);
    throw new ApiCallError("internal", `POST ${CHECK_URL} failed: ${res.status}`, res.status);
  }
  try {
    return (await res.json()) as CheckResponse;
  } catch {
    throw new ApiCallError("upstream_failed", "Unreadable response from /api/check", res.status);
  }
}

/** answer:"track" body: frame, x, y only (the server fits the track itself). */
export function toCheckRequest(spot: string, marks: Mark[]): CheckRequest {
  return { spot, answer: "track", marks: marks.map(({ frame, x, y }) => ({ frame, x, y })) };
}

export function nothingRequest(spot: string): CheckRequest {
  return { spot, answer: "nothing" };
}
