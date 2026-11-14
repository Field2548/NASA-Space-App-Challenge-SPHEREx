// Light, best-effort rate limit (owner: SERVER). Counts per address in memory, so on Vercel
// each serverless instance counts on its own. It slows a runaway loop; it is not a
// security control. Contract: docs/contracts/api.md section 1.

import { ApiFail, clientIp } from "@/lib/server/http";

type Window = { count: number; resetAt: number };
const windows = new Map<string, Window>();
const MAX_KEYS = 5000;

/** Pure core, exported for tests. Returns seconds to wait, or 0 if the call is allowed. */
export function hit(key: string, limit: number, windowMs: number, now: number): number {
  const w = windows.get(key);
  if (!w || now >= w.resetAt) {
    if (windows.size >= MAX_KEYS) {
      for (const [k, v] of windows) if (now >= v.resetAt) windows.delete(k);
      if (windows.size >= MAX_KEYS) windows.clear();
    }
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return 0;
  }
  w.count += 1;
  return w.count > limit ? Math.max(1, Math.ceil((w.resetAt - now) / 1000)) : 0;
}

export function resetRateLimit(): void {
  windows.clear();
}

/** Throws a 429 when this address called `name` more than `limit` times in the window. */
export function rateLimit(request: Request, name: string, limit: number, windowMs = 60_000): void {
  const wait = hit(`${name}:${clientIp(request)}`, limit, windowMs, Date.now());
  if (wait > 0) {
    throw new ApiFail(
      "rate_limited",
      `Too many requests. Try again in ${wait} s.`,
      { retry_after_s: wait },
      { "Retry-After": String(wait) },
    );
  }
}
