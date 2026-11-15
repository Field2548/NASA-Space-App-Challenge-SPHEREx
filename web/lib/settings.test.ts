// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetGuest, saveGuest } from "./guest";
import { loadVision, saveVision } from "./settings";

beforeEach(() => {
  resetGuest();
});
afterEach(() => {
  resetGuest();
});

describe("settings", () => {
  it("defaults to normal vision", () => {
    expect(loadVision()).toBe("normal");
  });

  it("saves the choice in the guest store and reads it back", () => {
    saveVision("tritan");
    expect(loadVision()).toBe("tritan");
    expect(JSON.parse(localStorage.getItem("onionsky:v1") ?? "{}").settings.vision).toBe("tritan");
  });

  it("falls back to normal when the stored value is not a known mode", () => {
    saveGuest({ settings: { vision: "sepia" as never } });
    expect(loadVision()).toBe("normal");
  });
});
