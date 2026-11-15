import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GUEST_REPLAY_KEY,
  clearGuestSubmissions,
  friendlyAuthError,
  loadGuestSubmissions,
  moveGuestProgress,
  saveGuestSubmission,
  validateDisplayName,
  validateEmail,
  validatePassword,
} from "./auth";
import type { CheckRequest } from "./types";

// A small in-memory localStorage, installed on globalThis for each test.
function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => (data.has(k) ? (data.get(k) as string) : null),
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
    _data: data,
  };
}

function installStorage(value: unknown) {
  Object.defineProperty(globalThis, "localStorage", { value, configurable: true, writable: true });
}

function req(n: number): CheckRequest {
  return { spot: `spot-${n}`, answer: "nothing" };
}

function fakeFetch(status: number) {
  return vi.fn<typeof fetch>(async () => new Response(null, { status }));
}

let store: ReturnType<typeof memoryStorage>;

beforeEach(() => {
  store = memoryStorage();
  installStorage(store);
});

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
  vi.restoreAllMocks();
});

describe("validateDisplayName", () => {
  it("accepts names that the SQL rule accepts", () => {
    for (const name of ["Nova", "Ann Lee", "ann_lee.2-x", "abc", "a".repeat(20), "Bot2"]) {
      expect(validateDisplayName(name), name).toBeNull();
    }
  });

  it("rejects names shorter than 3 or longer than 20 characters", () => {
    expect(validateDisplayName("")).toBe("Use at least 3 characters.");
    expect(validateDisplayName("ab")).toBe("Use at least 3 characters.");
    expect(validateDisplayName("a".repeat(21))).toBe("Use 20 characters or fewer.");
  });

  it("rejects leading and trailing spaces, as the SQL btrim check does", () => {
    expect(validateDisplayName(" Nova")).toBe("Remove the spaces at the start or end.");
    expect(validateDisplayName("Nova ")).toBe("Remove the spaces at the start or end.");
  });

  it("rejects characters outside A-Z a-z 0-9 space _ . -", () => {
    for (const name of ["Nova!", "Nova/x", "ñoño", "Nova#1", "Nova\tX"]) {
      expect(validateDisplayName(name), name).toBe("Use only letters, digits, spaces, _ . and -.");
    }
  });

  it("rejects the reserved names case-insensitively", () => {
    for (const name of ["bot", "Bot", "BOT", "shift-and-stack bot", "Shift-And-Stack Bot"]) {
      expect(validateDisplayName(name), name).toBe("That name is reserved. Pick another.");
    }
  });
});

describe("validateEmail and validatePassword", () => {
  it("checks the email shape", () => {
    expect(validateEmail("")).toBe("Enter your email address.");
    expect(validateEmail("no-at-sign")).toBe("That email address does not look right.");
    expect(validateEmail("a@b")).toBe("That email address does not look right.");
    expect(validateEmail("ada@example.org")).toBeNull();
  });

  it("needs at least 8 password characters", () => {
    expect(validatePassword("1234567")).toBe("Use at least 8 characters.");
    expect(validatePassword("12345678")).toBeNull();
  });
});

describe("friendlyAuthError", () => {
  it("maps the common Supabase messages", () => {
    expect(friendlyAuthError("Invalid login credentials")).toBe("Email or password is not right.");
    expect(friendlyAuthError("User already registered")).toBe(
      "An account with this email already exists. Try logging in.",
    );
    expect(friendlyAuthError("Database error saving new user")).toBe(
      "That display name is taken or not allowed.",
    );
    expect(friendlyAuthError("email rate limit exceeded")).toBe("Too many attempts. Wait a minute and try again.");
    expect(friendlyAuthError("Email not confirmed")).toBe("Confirm your email first. Check your inbox for the link.");
  });

  it("falls back to the default sentence", () => {
    expect(friendlyAuthError("something unexpected")).toBe("Could not sign in. Please try again.");
  });
});

describe("guest replay store", () => {
  it("uses the agreed key", () => {
    expect(GUEST_REPLAY_KEY).toBe("onion-sky:guest-replay");
  });

  it("appends saved requests in order", () => {
    saveGuestSubmission(req(1));
    saveGuestSubmission(req(2));
    expect(loadGuestSubmissions()).toEqual([req(1), req(2)]);
    expect(store._data.has(GUEST_REPLAY_KEY)).toBe(true);
  });

  it("does not store an identical body twice", () => {
    saveGuestSubmission(req(1));
    saveGuestSubmission(req(2));
    saveGuestSubmission(req(1));
    expect(loadGuestSubmissions()).toEqual([req(1), req(2)]);
  });

  const marks = (x: number) => [{ frame: 1, x, y: 5 }, { frame: 3, x: x + 2, y: 5 }];

  it("keeps a right answer and a later wrong one on the same spot, in order, so both count", () => {
    const right: CheckRequest = { spot: "eros", answer: "track", marks: marks(10) };
    const wrong: CheckRequest = { spot: "eros", answer: "nothing" };
    saveGuestSubmission(right);
    saveGuestSubmission(wrong);
    expect(loadGuestSubmissions()).toEqual([right, wrong]);
  });

  it("on one spot keeps the FIRST request ever stored plus the newest 4 (6 stored: 1, 3, 4, 5, 6)", () => {
    const all = [1, 2, 3, 4, 5, 6].map((n) => ({ spot: "eros", answer: "track" as const, marks: marks(n * 10) }));
    for (const r of all) saveGuestSubmission(r);
    expect(loadGuestSubmissions()).toEqual([all[0], all[2], all[3], all[4], all[5]]);
  });

  it("groups the list by spot, keeping each spot's requests in time order", () => {
    const hektor: CheckRequest = { spot: "hektor", answer: "nothing" };
    const eros1: CheckRequest = { spot: "eros", answer: "track", marks: marks(10) };
    const eros2: CheckRequest = { spot: "eros", answer: "nothing" };
    saveGuestSubmission(hektor);
    saveGuestSubmission(eros1);
    saveGuestSubmission(eros2);
    expect(loadGuestSubmissions()).toEqual([eros1, eros2, hektor]);
  });

  it("silently ignores an invalid entry and keeps what was stored", () => {
    saveGuestSubmission(req(1));
    const marks = (n: number) => Array.from({ length: n }, (_, i) => ({ frame: i + 1, x: 1, y: 1 }));
    const bad: unknown[] = [
      { spot: "Bad Slug", answer: "nothing" },
      { spot: "", answer: "nothing" },
      { spot: "a".repeat(41), answer: "nothing" },
      { spot: "eros", answer: "maybe" },
      { spot: "eros", answer: "track" },
      { spot: "eros", answer: "track", marks: marks(1) },
      { spot: "eros", answer: "track", marks: marks(33) },
      { spot: "eros", answer: "track", marks: [{ frame: 1, x: 1, y: 1 }, { frame: 0, x: 1, y: 1 }] },
      { spot: "eros", answer: "track", marks: [{ frame: 1.5, x: 1, y: 1 }, { frame: 2, x: 1, y: 1 }] },
      { spot: "eros", answer: "track", marks: [{ frame: 1, x: Infinity, y: 1 }, { frame: 2, x: 1, y: 1 }] },
      { spot: "eros", answer: "track", marks: [{ frame: 1, x: NaN, y: 1 }, { frame: 2, x: 1, y: 1 }] },
      { spot: "eros", answer: "track", marks: [{ frame: 1, x: "3", y: 1 }, { frame: 2, x: 1, y: 1 }] },
      { spot: "eros", answer: "track", marks: [null, { frame: 2, x: 1, y: 1 }] },
      null,
      7,
    ];
    for (const b of bad) expect(() => saveGuestSubmission(b as CheckRequest)).not.toThrow();
    expect(loadGuestSubmissions()).toEqual([req(1)]);
    saveGuestSubmission({ spot: "eros", answer: "track", marks: marks(2) });
    saveGuestSubmission({ spot: "eros2", answer: "track", marks: marks(32) });
    expect(loadGuestSubmissions()).toHaveLength(3);
  });

  it("keeps at most 20 spots: the 5 oldest spots are dropped whole", () => {
    for (let i = 1; i <= 25; i++) saveGuestSubmission(req(i));
    const kept = loadGuestSubmissions();
    expect(kept).toHaveLength(20);
    const spots = kept.map((r) => r.spot);
    for (let i = 1; i <= 5; i++) expect(spots).not.toContain(`spot-${i}`);
    for (let i = 6; i <= 25; i++) expect(spots).toContain(`spot-${i}`);
  });

  it("keeps track requests with their marks", () => {
    const track: CheckRequest = {
      spot: "eros",
      answer: "track",
      marks: [{ frame: 1, x: 84, y: 79 }, { frame: 3, x: 40, y: 43 }],
    };
    saveGuestSubmission(track);
    expect(loadGuestSubmissions()).toEqual([track]);
  });

  it("ignores stored junk and bad JSON", () => {
    store.setItem(GUEST_REPLAY_KEY, JSON.stringify([req(1), { nope: true }, 7]));
    expect(loadGuestSubmissions()).toEqual([req(1)]);
    store.setItem(GUEST_REPLAY_KEY, "{not json");
    expect(loadGuestSubmissions()).toEqual([]);
  });

  it("clears the store", () => {
    saveGuestSubmission(req(1));
    clearGuestSubmissions();
    expect(loadGuestSubmissions()).toEqual([]);
  });

  it("never throws when localStorage is blocked", () => {
    Object.defineProperty(globalThis, "localStorage", {
      get() {
        throw new Error("SecurityError");
      },
      configurable: true,
    });
    expect(() => saveGuestSubmission(req(1))).not.toThrow();
    expect(loadGuestSubmissions()).toEqual([]);
    expect(() => clearGuestSubmissions()).not.toThrow();
  });

  it("never throws when setItem fails (full storage)", () => {
    installStorage({
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    });
    expect(() => saveGuestSubmission(req(1))).not.toThrow();
  });
});

describe("moveGuestProgress", () => {
  it("does nothing when nothing is saved", async () => {
    const f = fakeFetch(200);
    await expect(moveGuestProgress(f, {})).resolves.toEqual({ moved: 0 });
    expect(f).not.toHaveBeenCalled();
  });

  it("POSTs the replay with the auth headers and clears the store on 200", async () => {
    saveGuestSubmission(req(1));
    saveGuestSubmission(req(2));
    const f = fakeFetch(200);
    const result = await moveGuestProgress(f, { Authorization: "Bearer t" });

    expect(result).toEqual({ moved: 2 });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("/api/complete");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer t" });
    expect(JSON.parse(String(init?.body))).toEqual({ replay: [req(1), req(2)] });
    expect(loadGuestSubmissions()).toEqual([]);
  });

  it("keeps the store and reports nothing moved on 404", async () => {
    saveGuestSubmission(req(1));
    await expect(moveGuestProgress(fakeFetch(404), {})).resolves.toEqual({ moved: 0 });
    expect(loadGuestSubmissions()).toEqual([req(1)]);
  });

  it("clears the store on 400: the server will never accept this replay", async () => {
    saveGuestSubmission(req(1));
    const f = fakeFetch(400);
    const result = await moveGuestProgress(f, {});
    expect(f).toHaveBeenCalledTimes(1);
    expect(result).toHaveProperty("error");
    expect(loadGuestSubmissions()).toEqual([]);
  });

  it.each([401, 429, 503, 500])("keeps the store on HTTP %i (try again later)", async (status) => {
    saveGuestSubmission(req(1));
    const result = await moveGuestProgress(fakeFetch(status), {});
    expect(result).toHaveProperty("error");
    expect(loadGuestSubmissions()).toEqual([req(1)]);
  });

  it("keeps the store and returns an error on 503", async () => {
    saveGuestSubmission(req(1));
    const result = await moveGuestProgress(fakeFetch(503), {});
    expect(result).toEqual({
      error: "Could not move guest progress (HTTP 503). It stays in this browser.",
    });
    expect(loadGuestSubmissions()).toEqual([req(1)]);
  });

  const trackReq = (spot: string, n: number): CheckRequest => ({
    spot,
    answer: "track",
    marks: [{ frame: 1, x: n, y: 5 }, { frame: 3, x: n + 2, y: 5 }],
  });

  /** 9 spots with 5 different requests each: 45 stored entries. */
  function saveFortyFive() {
    for (let s = 0; s < 9; s++) for (let k = 0; k < 5; k++) saveGuestSubmission(trackReq(`spot-${s}`, s * 10 + k + 1));
    expect(loadGuestSubmissions()).toHaveLength(45);
  }

  it("sends 45 stored requests as 3 calls of 20, 20 and 5, and clears them on 200", async () => {
    saveFortyFive();
    const f = fakeFetch(200);
    await expect(moveGuestProgress(f, {})).resolves.toEqual({ moved: 45 });
    expect(f).toHaveBeenCalledTimes(3);
    const sizes = f.mock.calls.map(([, init]) => (JSON.parse(String(init?.body)) as { replay: unknown[] }).replay.length);
    expect(sizes).toEqual([20, 20, 5]);
    expect(loadGuestSubmissions()).toEqual([]);
  });

  it("a 503 on the second call keeps chunks 2 and 3, and sends nothing after the failure", async () => {
    saveFortyFive();
    const before = loadGuestSubmissions();
    const answers = [200, 503];
    const f = vi.fn<typeof fetch>(async () => new Response(null, { status: answers.shift() ?? 200 }));
    const result = await moveGuestProgress(f, {});
    expect(result).toEqual({ error: "Could not move guest progress (HTTP 503). It stays in this browser." });
    expect(f).toHaveBeenCalledTimes(2);
    const second = (JSON.parse(String(f.mock.calls[1][1]?.body)) as { replay: CheckRequest[] }).replay;
    expect(second).toEqual(before.slice(20, 40));
    expect(loadGuestSubmissions()).toEqual(before.slice(20));
  });

  it("a 400 on the first call discards only that chunk and stops", async () => {
    saveFortyFive();
    const before = loadGuestSubmissions();
    const f = fakeFetch(400);
    const result = await moveGuestProgress(f, {});
    expect(f).toHaveBeenCalledTimes(1);
    expect(result).toHaveProperty("error");
    expect(loadGuestSubmissions()).toEqual(before.slice(20));
  });

  it("keeps the store and returns an error when the network fails", async () => {
    saveGuestSubmission(req(1));
    const failing = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const result = await moveGuestProgress(failing, {});
    expect(result).toHaveProperty("error");
    expect(loadGuestSubmissions()).toEqual([req(1)]);
  });
});
