// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { CELEBRATED_KEY, loadCelebrated, markCelebrated } from "./celebrated";

beforeEach(() => window.localStorage.clear());

describe("celebrated set", () => {
  it("is empty by default and after corrupt JSON", () => {
    expect(loadCelebrated().size).toBe(0);
    window.localStorage.setItem(CELEBRATED_KEY, "{nope");
    expect(loadCelebrated().size).toBe(0);
    window.localStorage.setItem(CELEBRATED_KEY, JSON.stringify({ a: 1 }));
    expect(loadCelebrated().size).toBe(0);
  });
  it("accumulates slugs without duplicates and ignores non-strings", () => {
    markCelebrated(["eros"]);
    markCelebrated(["eros", "hektor"]);
    expect([...loadCelebrated()].sort()).toEqual(["eros", "hektor"]);
    window.localStorage.setItem(CELEBRATED_KEY, JSON.stringify(["a", 3, null]));
    expect([...loadCelebrated()]).toEqual(["a"]);
  });
});
