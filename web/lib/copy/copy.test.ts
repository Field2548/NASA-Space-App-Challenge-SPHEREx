import { describe, expect, it } from "vitest";
import { ABOUT_SECTIONS } from "./about";
import { TUTORIAL } from "./tutorial";

const DASHES = /[—–]/;

function allStrings(): string[] {
  const out: string[] = [];
  for (const level of TUTORIAL) {
    out.push(level.title, level.spot);
    for (const step of level.steps) {
      out.push(step.id, step.text, step.doneWhen);
      if (step.target) out.push(step.target);
    }
  }
  for (const section of ABOUT_SECTIONS) {
    out.push(section.heading, ...section.paragraphs);
  }
  return out;
}

describe("copy text", () => {
  it("uses no em-dash or en-dash anywhere", () => {
    const bad = allStrings().filter((s) => DASHES.test(s));
    expect(bad).toEqual([]);
  });
});

describe("tutorial", () => {
  it("has every step with non-empty text and a doneWhen", () => {
    for (const level of TUTORIAL) {
      for (const step of level.steps) {
        expect(step.text.trim().length, step.id).toBeGreaterThan(0);
        expect(step.doneWhen.trim().length, step.id).toBeGreaterThan(0);
      }
    }
  });

  it("has unique step ids", () => {
    const ids = TUTORIAL.flatMap((level) => level.steps.map((s) => s.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never asks to mark Eros in frames 4 or 5", () => {
    const frameRef = /\b(frame|frames|picture|pictures)\b[^.]*\b(4|5|four|five)\b/i;
    const listRef = /\b(4|5|four|five)\b[^.]*\b(frame|frames|picture|pictures)\b/i;
    for (const level of TUTORIAL) {
      for (const step of level.steps) {
        const text = `${level.spot} ${step.text}`;
        if (/Eros/i.test(text)) {
          expect(frameRef.test(text), step.id).toBe(false);
          expect(listRef.test(text), step.id).toBe(false);
        }
      }
    }
  });
});
