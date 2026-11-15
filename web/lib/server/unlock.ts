// The spoiler lock, enforced by the server.
// Contract: docs/contracts/api.md section 2. BP section 3: "The server enforces this."
//
// After a player's first CORRECT submission on a spot, /api/check adds that spot to a signed
// cookie. /api/info (and /api/overlay) only give names and distances for a ready spot when the
// cookie covers it. The cookie is HttpOnly and HMAC-signed, so it can be neither read nor
// forged from the browser. Works for guests and with no database.
//
// Signing key, in this order: UNLOCK_SECRET; else a key derived from CRON_SECRET; else one
// derived from SUPABASE_SERVICE_ROLE_KEY. Adding or changing any of these invalidates every
// cookie already handed out. Outside production with none of them set, a random key per server
// process is used. In production with none set, nothing is signed: no cookie is set, every
// cookie reads as empty, and the lock stays on (UNLOCK_SECRET is REQUIRED in production).

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextResponse } from "next/server";

export const UNLOCK_COOKIE = "unlock";
const VERSION = "v1";
const MAX_SLUGS = 60;
const MAX_AGE_S = 60 * 60 * 24 * 30;
const SLUG = /^[a-z0-9-]{1,40}$/;

type Env = Record<string, string | undefined>;

// Read through a function, not `process.env.NODE_ENV` directly: bundlers (and vitest) replace
// that expression at build time, which would make the production branch untestable.
let readEnv: () => Env = () => process.env;

/** Tests only: read the environment from `fn` instead of process.env (null restores it). */
export function setEnvForTests(fn: (() => Env) | null): void {
  readEnv = fn ?? (() => process.env);
}

const NO_KEY_MESSAGE =
  "[unlock] UNLOCK_SECRET is not set in production (nor CRON_SECRET or SUPABASE_SERVICE_ROLE_KEY): " +
  "the spoiler-lock cookie is disabled, so finished spots lock again. Set UNLOCK_SECRET.";

// Development with no secrets: a key that lives as long as this server process.
let processKey: Buffer | null = null;
let warned = false;

function stableKey(env: Env): Buffer | null {
  if (env.UNLOCK_SECRET) return Buffer.from(env.UNLOCK_SECRET, "utf8");
  // No dedicated secret: derive one from another server-only secret, never reuse it directly.
  const other = env.CRON_SECRET || env.SUPABASE_SERVICE_ROLE_KEY;
  if (other) return createHmac("sha256", other).update("onion-sky/unlock-cookie").digest();
  return null;
}

/** The signing key, or null in production with no secret (then nothing is signed). */
function key(): Buffer | null {
  const env = readEnv();
  const stable = stableKey(env);
  if (stable) return stable;
  if (env.NODE_ENV === "production") {
    if (!warned) {
      warned = true;
      console.error(NO_KEY_MESSAGE);
    }
    return null;
  }
  processKey ??= randomBytes(32);
  return processKey;
}

/** True when a stable secret signs the cookie (UNLOCK_SECRET, or one derived from CRON_SECRET / SUPABASE_SERVICE_ROLE_KEY). */
export function unlockConfigured(env: Env = readEnv()): boolean {
  return stableKey(env) !== null;
}

function sign(k: Buffer, payload: string): string {
  return createHmac("sha256", k).update(`${VERSION}.${payload}`).digest("base64url");
}

/** Cookie value for a list of unlocked spot slugs, or null when no key is available. */
export function encodeUnlocked(slugs: string[]): string | null {
  const k = key();
  if (!k) return null;
  const clean = [...new Set(slugs.filter((s) => SLUG.test(s)))].slice(-MAX_SLUGS);
  const payload = Buffer.from(clean.join(","), "utf8").toString("base64url");
  return `${VERSION}.${payload}.${sign(k, payload)}`;
}

/** The unlocked slugs in a cookie value. A missing, edited or forged cookie gives []. */
export function decodeUnlocked(value: string | undefined | null): string[] {
  if (!value) return [];
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return [];
  const k = key();
  if (!k) return [];
  const [, payload, mac] = parts;
  const want = Buffer.from(sign(k, payload));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return [];
  const text = Buffer.from(payload, "base64url").toString("utf8");
  return text ? text.split(",").filter((s) => SLUG.test(s)) : [];
}

function cookieFrom(request: Request): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === UNLOCK_COOKIE) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** Spots this caller has unlocked, according to their cookie. */
export function unlockedSpots(request: Request): string[] {
  return decodeUnlocked(cookieFrom(request));
}

export function isUnlocked(request: Request, slug: string): boolean {
  return unlockedSpots(request).includes(slug);
}

/** Add spots to the caller's cookie on the way out. Returns false (and sets nothing) with no key. */
export function grantUnlock(request: Request, response: NextResponse, slugs: string[]): boolean {
  const all = [...unlockedSpots(request).filter((s) => !slugs.includes(s)), ...slugs];
  const value = encodeUnlocked(all);
  if (value === null) return false;
  response.cookies.set({
    name: UNLOCK_COOKIE,
    value,
    httpOnly: true,
    sameSite: "lax",
    secure:
      new URL(request.url).protocol === "https:" ||
      request.headers.get("x-forwarded-proto")?.split(",")[0].trim().toLowerCase() === "https",
    path: "/api",
    maxAge: MAX_AGE_S,
  });
  return true;
}
