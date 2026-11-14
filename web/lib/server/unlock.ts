// The spoiler lock, enforced by the server (owner: SERVER).
// Contract: docs/contracts/api.md section 2. BP section 3: "The server enforces this."
//
// After a player submits on a spot, /api/check adds that spot to a signed cookie.
// /api/info (and /api/overlay) only give names and distances for a ready spot when the
// cookie covers it. The cookie is HttpOnly and HMAC-signed, so it can be neither read nor
// forged from the browser. Works for guests and with no database.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextResponse } from "next/server";

export const UNLOCK_COOKIE = "unlock";
const VERSION = "v1";
const MAX_SLUGS = 60;
const MAX_AGE_S = 60 * 60 * 24 * 30;
const SLUG = /^[a-z0-9-]{1,40}$/;

// Local development with no secrets: a key that lives as long as this server process.
let processKey: Buffer | null = null;

function key(): Buffer {
  const env = process.env;
  if (env.UNLOCK_SECRET) return Buffer.from(env.UNLOCK_SECRET, "utf8");
  // No dedicated secret: derive one from another server-only secret, never reuse it directly.
  const other = env.CRON_SECRET || env.SUPABASE_SERVICE_ROLE_KEY;
  if (other) return createHmac("sha256", other).update("onion-sky/unlock-cookie").digest();
  processKey ??= randomBytes(32);
  return processKey;
}

function sign(payload: string): string {
  return createHmac("sha256", key()).update(`${VERSION}.${payload}`).digest("base64url");
}

/** Cookie value for a list of unlocked spot slugs. */
export function encodeUnlocked(slugs: string[]): string {
  const clean = [...new Set(slugs.filter((s) => SLUG.test(s)))].slice(-MAX_SLUGS);
  const payload = Buffer.from(clean.join(","), "utf8").toString("base64url");
  return `${VERSION}.${payload}.${sign(payload)}`;
}

/** The unlocked slugs in a cookie value. A missing, edited or forged cookie gives []. */
export function decodeUnlocked(value: string | undefined | null): string[] {
  if (!value) return [];
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return [];
  const [, payload, mac] = parts;
  const want = Buffer.from(sign(payload));
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

/** Spots this caller has submitted on, according to their cookie. */
export function unlockedSpots(request: Request): string[] {
  return decodeUnlocked(cookieFrom(request));
}

export function isUnlocked(request: Request, slug: string): boolean {
  return unlockedSpots(request).includes(slug);
}

/** Add spots to the caller's cookie on the way out. */
export function grantUnlock(request: Request, response: NextResponse, slugs: string[]): void {
  const all = [...unlockedSpots(request).filter((s) => !slugs.includes(s)), ...slugs];
  response.cookies.set({
    name: UNLOCK_COOKIE,
    value: encodeUnlocked(all),
    httpOnly: true,
    sameSite: "lax",
    secure:
      new URL(request.url).protocol === "https:" ||
      request.headers.get("x-forwarded-proto")?.split(",")[0].trim().toLowerCase() === "https",
    path: "/api",
    maxAge: MAX_AGE_S,
  });
}
