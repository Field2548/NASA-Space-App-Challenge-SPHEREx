import { describe, expect, it } from "vitest";
import { WORLD_ORDER, WORLD_TOTAL, WORLD_URL } from "./worldProgress";

describe("worldProgress", () => {
  it("total is 12 * 4^order HEALPix cells", () => {
    expect(WORLD_ORDER).toBe(4);
    expect(WORLD_TOTAL).toBe(12 * 4 ** WORLD_ORDER);
    expect(WORLD_TOTAL).toBe(3072);
  });
  it("asks the checked layer of everyone at that order", () => {
    expect(WORLD_URL).toBe("/api/density?layer=checked&order=4&who=all");
  });
});
