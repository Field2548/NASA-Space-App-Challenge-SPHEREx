// Account helpers for the login dialog. Pure: no React, no Supabase import.
// Display-name rule: supabase/migrations/20261115000000_init.sql (display_name_valid).

import type { CheckRequest } from "@/lib/types";

const DISPLAY_NAME_PATTERN = /^[A-Za-z0-9 _.-]{3,20}$/;
const RESERVED_NAMES = ["shift-and-stack bot", "bot"];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

export const GUEST_REPLAY_KEY = "onion-sky:guest-replay";
const MAX_GUEST_SUBMISSIONS = 20;
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

function isCheckRequest(value: unknown): value is CheckRequest {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  if (typeof r.spot !== "string") return false;
  if (r.answer === "nothing") return true;
  return r.answer === "track" && Array.isArray(r.marks);
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

/** Appends a guest's check request. An identical body is replaced; only the newest 20 are kept. */
export function saveGuestSubmission(req: CheckRequest): void {
  try {
    const store = storage();
    if (!store) return;
    const body = JSON.stringify(req);
    const kept = readList(store).filter((item) => JSON.stringify(item) !== body);
    kept.push(req);
    store.setItem(GUEST_REPLAY_KEY, JSON.stringify(kept.slice(-MAX_GUEST_SUBMISSIONS)));
  } catch {
    // Blocked or full storage: guest play goes on, the progress just is not kept.
  }
}

export function loadGuestSubmissions(): CheckRequest[] {
  return readList(storage());
}

export function clearGuestSubmissions(): void {
  try {
    storage()?.removeItem(GUEST_REPLAY_KEY);
  } catch {
    // Nothing to clear if storage is blocked.
  }
}

/**
 * Sends the guest's saved check requests to POST /api/complete. The store is cleared only on
 * HTTP 200. A 404 (route not built yet) keeps the store and reports nothing moved.
 */
export async function moveGuestProgress(
  fetchImpl: typeof fetch = fetch,
  headers: Record<string, string>,
): Promise<{ moved: number } | { error: string }> {
  const replay = loadGuestSubmissions();
  if (replay.length === 0) return { moved: 0 };

  let res: Response;
  try {
    res = await fetchImpl("/api/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ replay }),
    });
  } catch {
    return { error: "Could not reach the server to move guest progress. It stays in this browser." };
  }

  if (res.status === 404) return { moved: 0 };
  if (res.status === 200) {
    clearGuestSubmissions();
    return { moved: replay.length };
  }
  return { error: `Could not move guest progress (HTTP ${res.status}). It stays in this browser.` };
}
