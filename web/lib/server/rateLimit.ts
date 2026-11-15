// Light, best-effort rate limit. Counts per address in memory, so on Vercel
// each serverless instance counts on its own. It slows a runaway loop; it is not a
// security control. Contract: docs/contracts/api.md section 1.

import { ApiFail, clientIp } from "@/lib/server/http";

type Window = { count: number; resetAt: number };
const windows = new Map<string, Window>();
/** How many addresses are tracked at once. Exported for tests. */
export const MAX_KEYS = 5000;
const EVICT_FRACTION = 0.1;

/**
 * Pure core, exported for tests. Returns seconds to wait, or 0 if the call is allowed.
 * `cost` is how many units this call uses (a replay of 20 entries uses 20), default 1.
 */
export function hit(key: string, limit: number, windowMs: number, now: number, cost = 1): number {
  const w = windows.get(key);
  if (!w || now >= w.resetAt) {
    if (windows.size >= MAX_KEYS) {
      for (const [k, v] of windows) if (now >= v.resetAt) windows.delete(k);
      if (windows.size >= MAX_KEYS) {
        // Still full: drop the ~10% of entries that end soonest (they are the closest to being
        // forgotten anyway). Never clear everything: one caller sending many addresses could
        // otherwise reset every other caller's count.
        const oldest = [...windows.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
        for (const [k] of oldest.slice(0, Math.ceil(MAX_KEYS * EVICT_FRACTION))) windows.delete(k);
      }
    }
    windows.set(key, { count: cost, resetAt: now + windowMs });
    return cost > limit ? Math.max(1, Math.ceil(windowMs / 1000)) : 0;
  }
  w.count += cost;
  return w.count > limit ? Math.max(1, Math.ceil((w.resetAt - now) / 1000)) : 0;
}

export function resetRateLimit(): void {
  windows.clear();
}

/**
 * Throws a 429 when this address has used more than `limit` units of `name` in the window.
 * `cost` (default 1) is the units this call uses. Routes that share a name share one budget.
 */
export function rateLimit(request: Request, name: string, limit: number, windowMs = 60_000, cost = 1): void {
  const wait = hit(`${name}:${clientIp(request)}`, limit, windowMs, Date.now(), cost);
  if (wait > 0) {
    throw new ApiFail(
      "rate_limited",
      `Too many requests. Try again in ${wait} s.`,
      { retry_after_s: wait },
      { "Retry-After": String(wait) },
    );
  }
}
