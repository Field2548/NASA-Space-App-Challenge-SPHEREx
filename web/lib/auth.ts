// Account helpers for the login dialog. Pure: no React, no Supabase import.
// Display-name rule: supabase/migrations/20261115000000_init.sql (display_name_valid).

import type { CheckRequest } from "@/lib/types";

const DISPLAY_NAME_PATTERN = /^[A-Za-z0-9 _.-]{3,20}$/;
const RESERVED_NAMES = ["shift-and-stack bot", "bot"];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

export const GUEST_REPLAY_KEY = "onion-sky:guest-replay";
/** Stored requests per spot: the first one ever stored, plus the newest 4. */
const MAX_PER_SPOT = 5;
/** Spots kept; the spot whose newest request is oldest is dropped whole. */
const MAX_SPOTS = 20;
/** Requests per POST /api/complete (the server accepts 1 to 20, api.md section 4). */
const REPLAY_CHUNK = 20;
const DEFAULT_ERROR = "Could not sign in. Please try again.";

/**
 * Null when the name is fine, otherwise a plain-words reason. The input must already be
 * trimmed: the SQL rule rejects spaces at either end rather than trimming them.
 */
export function validateDisplayName(name: string): string | null {
  if (name !== name.trim()) return "Remove the spaces at the start or end.";
  if (name.length < 3) return "Use at least 3 characters.";
  if (name.length > 20) return "Use 20 characters or fewer.";
  if (!DISPLAY_NAME_PATTERN.test(name)) return "Use only letters, digits, spaces, _ . and -.";
  if (RESERVED_NAMES.includes(name.toLowerCase())) return "That name is reserved. Pick another.";
  return null;
}

export function validateEmail(email: string): string | null {
  if (email.trim() === "") return "Enter your email address.";
  if (!EMAIL_PATTERN.test(email.trim())) return "That email address does not look right.";
  return null;
}

export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  return null;
}

const AUTH_ERROR_RULES: [RegExp, string][] = [
  [/invalid login credentials/i, "Email or password is not right."],
  [/user already registered|already registered|already been registered/i,
    "An account with this email already exists. Try logging in."],
  [/database error saving new user/i, "That display name is taken or not allowed."],
  [/rate limit|too many requests|over_request_rate_limit|over_email_send_rate_limit/i,
    "Too many attempts. Wait a minute and try again."],
  [/email not confirmed/i, "Confirm your email first. Check your inbox for the link."],
];

/** Plain sentence for a Supabase Auth error message. */
export function friendlyAuthError(message: string): string {
  for (const [pattern, text] of AUTH_ERROR_RULES) {
    if (pattern.test(message)) return text;
  }
  return DEFAULT_ERROR;
}

// ---------------------------------------------------------------- guest replay store

/** The browser's localStorage, or null when it is missing or blocked (the getter can throw). */
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const SPOT_SLUG = /^[a-z0-9-]{1,40}$/;
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The same shape the server accepts (CheckBody in lib/server/checkResponse.ts), minus its coordinate bounds. */
function isCheckRequest(value: unknown): value is CheckRequest {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  if (typeof r.spot !== "string" || !SPOT_SLUG.test(r.spot)) return false;
  if (r.answer === "nothing") return true;
  if (r.answer !== "track" || !Array.isArray(r.marks)) return false;
  if (r.marks.length < 2 || r.marks.length > 32) return false;
  return r.marks.every((m) => {
    if (!m || typeof m !== "object") return false;
    const k = m as Record<string, unknown>;
    return Number.isInteger(k.frame) && (k.frame as number) >= 1 && isFiniteNumber(k.x) && isFiniteNumber(k.y);
  });
}

function readList(store: Storage | null): CheckRequest[] {
  try {
    if (!store) return [];
    const raw = store.getItem(GUEST_REPLAY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isCheckRequest) : [];
  } catch {
    return [];
  }
}

/**
 * Keeps a guest's check request. An invalid one is ignored. The store keeps, per spot, up to 5
 * requests in the order they were given: the FIRST one ever stored for the spot (it may be the
 * correct answer that earns the points) and the newest 4. An identical body already stored is not
 * stored twice. At most 20 spots are kept; the spot whose newest request is oldest is dropped.
 * The server re-scores every entry on replay, so each one counts, not only the newest.
 */
export function saveGuestSubmission(req: CheckRequest): void {
  try {
    if (!isCheckRequest(req)) return;
    const store = storage();
    if (!store) return;
    const all = readList(store);
    const body = JSON.stringify(req);
    if (all.some((item) => JSON.stringify(item) === body)) return;
    all.push(req);

    const ofSpot = all.filter((item) => item.spot === req.spot);
    if (ofSpot.length > MAX_PER_SPOT) all.splice(all.indexOf(ofSpot[1]), 1);

    const newest = new Map<string, number>();
    all.forEach((item, i) => newest.set(item.spot, i));
    if (newest.size > MAX_SPOTS) {
      let stalest = "";
      let stalestAt = Infinity;
      for (const [spot, i] of newest) {
        if (i < stalestAt) {
          stalest = spot;
          stalestAt = i;
        }
      }
      store.setItem(GUEST_REPLAY_KEY, JSON.stringify(all.filter((item) => item.spot !== stalest)));
      return;
    }
    store.setItem(GUEST_REPLAY_KEY, JSON.stringify(all));
  } catch {
    // Blocked or full storage: guest play goes on, the progress just is not kept.
  }
}

/** Every stored request, ordered by spot, then by the time it was stored. */
export function loadGuestSubmissions(): CheckRequest[] {
  // Array.prototype.sort is stable, so equal spots keep their time order.
  return readList(storage()).sort((a, b) => (a.spot < b.spot ? -1 : a.spot > b.spot ? 1 : 0));
}

/** Removes exactly these requests from the store, leaving the others in their stored order. */
function forgetSent(sent: CheckRequest[]): void {
  try {
    const store = storage();
    if (!store) return;
    const gone = new Set(sent.map((item) => JSON.stringify(item)));
    store.setItem(GUEST_REPLAY_KEY, JSON.stringify(readList(store).filter((item) => !gone.has(JSON.stringify(item)))));
  } catch {
    // Nothing to forget if storage is blocked.
  }
}

export function clearGuestSubmissions(): void {
  try {
    storage()?.removeItem(GUEST_REPLAY_KEY);
  } catch {
    // Nothing to clear if storage is blocked.
  }
}

/**
 * Sends the guest's saved check requests to POST /api/complete, in chunks of 20 (one call each),
 * in the order of loadGuestSubmissions. A chunk is removed from the store only when the server
 * accepted it (200) or rejected it for good (400). Sending stops at the first other answer, so
 * that chunk and the rest stay for the next try: 401, 429, 503, any other status, or a network
 * error. A 404 (route not built yet) also stops, reporting only what was already accepted.
 */
export async function moveGuestProgress(
  fetchImpl: typeof fetch = fetch,
  headers: Record<string, string>,
): Promise<{ moved: number } | { error: string }> {
  const replay = loadGuestSubmissions();
  let moved = 0;

  for (let start = 0; start < replay.length; start += REPLAY_CHUNK) {
    const chunk = replay.slice(start, start + REPLAY_CHUNK);
    let res: Response;
    try {
      res = await fetchImpl("/api/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ replay: chunk }),
      });
    } catch {
      return { error: "Could not reach the server to move guest progress. It stays in this browser." };
    }

    if (res.status === 200) {
      forgetSent(chunk);
      moved += chunk.length;
      continue;
    }
    if (res.status === 404) return { moved };
    if (res.status === 400) {
      forgetSent(chunk);
      return { error: "Part of the saved guest progress was not accepted by the server, so it was discarded." };
    }
    return { error: `Could not move guest progress (HTTP ${res.status}). It stays in this browser.` };
  }
  return { moved };
}
