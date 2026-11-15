import { describe, expect, it } from "vitest";
import { LruCache } from "./tileCache";

describe("LruCache", () => {
  it("drops the least recently used entry past the limit", () => {
    const c = new LruCache<number>(3, 1000, () => 0);
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    expect(c.get("a")).toBe(1); // a is now the freshest
    c.set("d", 4);
    expect(c.has("b")).toBe(false);
    expect(c.get("a")).toBe(1);
    expect(c.get("c")).toBe(3);
    expect(c.get("d")).toBe(4);
    expect(c.size).toBe(3);
  });
  it("forgets entries older than the time to live", () => {
    let t = 0;
    const c = new LruCache<string>(10, 60_000, () => t);
    c.set("k", "v");
    t = 59_999;
    expect(c.get("k")).toBe("v");
    t = 60_000;
    expect(c.get("k")).toBeUndefined();
    expect(c.size).toBe(0);
  });
  it("replaces a value and restarts its clock", () => {
    let t = 0;
    const c = new LruCache<number>(10, 100, () => t);
    c.set("k", 1);
    t = 90;
    c.set("k", 2);
    t = 150;
    expect(c.get("k")).toBe(2);
  });
});
