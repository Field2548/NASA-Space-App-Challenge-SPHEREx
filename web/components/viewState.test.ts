import { describe, expect, it } from "vitest";
import { applyView, parseView } from "./viewState";

describe("viewState", () => {
  it("parses valid params", () => {
    expect(parseView({ frames: "1-4", spacing: "real", vision: "deutan" })).toEqual({ frames: [1, 4], realSpacing: true, vision: "deutan" });
  });
  it("falls back to defaults on junk", () => {
    expect(parseView({ frames: "x", spacing: "odd", vision: "rainbow" })).toEqual({ frames: null, realSpacing: false, vision: "normal" });
    expect(parseView({ frames: ["1-2"], vision: ["mono"] })).toEqual({ frames: null, realSpacing: false, vision: "normal" });
    expect(parseView({})).toEqual({ frames: null, realSpacing: false, vision: "normal" });
  });
  it("writes non-defaults and drops defaults, keeping other keys", () => {
    const base = new URLSearchParams("spot=a&ra=1&frames=0-2&vision=mono");
    expect(applyView(base, { frames: [3, 1], realSpacing: true, vision: "tritan" }).toString()).toBe("spot=a&ra=1&frames=1-3&vision=tritan&spacing=real");
    expect(applyView(base, { frames: null, realSpacing: false, vision: "normal" }).toString()).toBe("spot=a&ra=1");
  });
});
