// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { GUEST_KEY, TUTORIAL_VERSION, defaultGuest, loadGuest, recordFind, resetGuest, saveGuest } from "./guest";

beforeEach(() => {
  window.localStorage.clear();
  resetGuest();
});

describe("guest store", () => {
  it("defaults when empty", () => expect(loadGuest()).toEqual(defaultGuest()));
  it("saveGuest merges and persists under the versioned key", () => {
    saveGuest({ tutorial: { level: 2 } });
    saveGuest({ settings: { vision: "deutan" }, name: "Ada" });
    const g = loadGuest();
    expect(g.tutorial).toEqual({ v: TUTORIAL_VERSION, level: 2, step: 0, done: [] });
    expect(g.settings.vision).toBe("deutan");
    expect(g.name).toBe("Ada");
    expect(JSON.parse(window.localStorage.getItem(GUEST_KEY) ?? "{}").name).toBe("Ada");
    expect(GUEST_KEY).toBe("onionsky:v1");
  });
  it("drops tutorial progress saved without the current version but keeps the rest", () => {
    window.localStorage.setItem(
      GUEST_KEY,
      JSON.stringify({ tutorial: { level: 2, step: 3, done: [0, 1] }, name: "Ada", settings: { vision: "deutan" } }),
    );
    const g = loadGuest();
    expect(g.tutorial).toEqual(defaultGuest().tutorial);
    expect(g.name).toBe("Ada");
    expect(g.settings.vision).toBe("deutan");
  });
  it("corrupt JSON resets to defaults", () => {
    window.localStorage.setItem(GUEST_KEY, "{not json");
    expect(loadGuest()).toEqual(defaultGuest());
    expect(JSON.parse(window.localStorage.getItem(GUEST_KEY) ?? "null")).toEqual(defaultGuest());
  });
  it("wrong-shaped JSON falls back per field", () => {
    window.localStorage.setItem(GUEST_KEY, JSON.stringify({ tutorial: "x", finds: 3, name: 5 }));
    expect(loadGuest()).toEqual(defaultGuest());
  });
  it("recordFind appends once per spot and kind", () => {
    recordFind("eros", "known", 100, "t1");
    recordFind("eros", "known", 100, "t2");
    recordFind("cygnus", "nothing_correct", 250, "t3");
    expect(loadGuest().finds).toEqual([
      { spot: "eros", kind: "known", points: 100, at: "t1" },
      { spot: "cygnus", kind: "nothing_correct", points: 250, at: "t3" },
    ]);
  });
  it("resetGuest clears storage", () => {
    saveGuest({ name: "x" });
    expect(resetGuest()).toEqual(defaultGuest());
    expect(window.localStorage.getItem(GUEST_KEY)).toBeNull();
  });
});

describe("no window", () => {
  it("is an in-memory store", () => {
    const g = globalThis as { window?: Window & typeof globalThis };
    const saved = g.window;
    delete g.window;
    try {
      expect(loadGuest()).toEqual(defaultGuest());
      saveGuest({ name: "mem" });
      expect(loadGuest().name).toBe("mem");
      resetGuest();
      expect(loadGuest().name).toBeUndefined();
    } finally {
      g.window = saved;
    }
  });
});
