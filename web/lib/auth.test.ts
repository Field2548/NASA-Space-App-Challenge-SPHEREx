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

  it("replaces an identical body instead of storing it twice", () => {
    saveGuestSubmission(req(1));
    saveGuestSubmission(req(2));
    saveGuestSubmission(req(1));
    expect(loadGuestSubmissions()).toEqual([req(2), req(1)]);
  });

  it("keeps only the newest 20", () => {
    for (let i = 1; i <= 25; i++) saveGuestSubmission(req(i));
    const kept = loadGuestSubmissions();
    expect(kept).toHaveLength(20);
    expect(kept[0]).toEqual(req(6));
    expect(kept[19]).toEqual(req(25));
  });

  it("keeps track requests with their marks", () => {
    const track: CheckRequest = {
      spot: "eros",
      answer: "track",
      marks: [{ frame: 1, x: 84, y: 79 }],
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

  it("keeps the store and returns an error on 503", async () => {
    saveGuestSubmission(req(1));
    const result = await moveGuestProgress(fakeFetch(503), {});
    expect(result).toEqual({
      error: "Could not move guest progress (HTTP 503). It stays in this browser.",
    });
    expect(loadGuestSubmissions()).toEqual([req(1)]);
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
