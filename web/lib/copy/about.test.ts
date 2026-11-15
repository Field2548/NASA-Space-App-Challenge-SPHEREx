import { describe, expect, it } from "vitest";
import { ABOUT_SECTIONS } from "./about";

describe("about copy", () => {
  it("does not name the control field's constellation (its public title is a round answer)", () => {
    const text = ABOUT_SECTIONS.flatMap((s) => [s.heading, ...s.paragraphs]).join(" ");
    expect(text).not.toMatch(/cygnus/i);
    expect(text).toContain("In an empty control field, where no moving objects are expected");
    expect(text).toContain("8.4 sigma");
  });
});
