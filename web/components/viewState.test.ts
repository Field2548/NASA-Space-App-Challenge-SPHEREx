import { describe, expect, it } from "vitest";
import { applyView, parseView } from "./viewState";

describe("viewState", () => {
  it("parses valid params and ignores the old spacing key", () => {
    expect(parseView({ frames: "1-4", spacing: "real", vision: "deutan" })).toEqual({ frames: [1, 4], vision: "deutan" });
  });
  it("falls back to defaults on junk", () => {
    expect(parseView({ frames: "x", spacing: "odd", vision: "rainbow" })).toEqual({ frames: null, vision: "normal" });
    expect(parseView({ frames: ["1-2"], vision: ["mono"] })).toEqual({ frames: null, vision: "normal" });
    expect(parseView({})).toEqual({ frames: null, vision: "normal" });
  });
  it("writes non-defaults and drops defaults and the old spacing key, keeping other keys", () => {
    const base = new URLSearchParams("spot=a&ra=1&frames=0-2&vision=mono&spacing=real");
    expect(applyView(base, { frames: [3, 1], vision: "tritan" }).toString()).toBe("spot=a&ra=1&frames=1-3&vision=tritan");
    expect(applyView(base, { frames: null, vision: "normal" }).toString()).toBe("spot=a&ra=1");
  });
});
