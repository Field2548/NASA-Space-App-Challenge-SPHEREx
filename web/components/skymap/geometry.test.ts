import { describe, expect, it } from "vitest";
import type { FieldSummary } from "@/lib/types";
import {
  angularSeparationDeg,
  DIFFICULTY_STYLE,
  flyFovForSpot,
  HEAT_STOPS,
  heatColor,
  heatFraction,
  heatGradientCss,
  heatRgb,
  pickRandom,
  spotCovering,
} from "./geometry";

const spot = (slug: string, ra: number, dec: number, fov_deg: number): FieldSummary => ({
  slug,
  title: slug,
  ra,
  dec,
  fov_deg,
  difficulty: "easy",
  kind: "asteroid",
  thumbnail: `${slug}/thumbs/1.webp`,
});

// The real index.json positions (web/public/fields/index.json).
const SPOTS = [
  spot("eros", 13.2004, 14.38, 0.2),
  spot("hektor", 184.3049, -6.3773, 0.2),
  spot("makemake", 200.0075, 21.523, 0.1),
  spot("eris", 26.3271, -0.4338, 0.1),
  spot("cygnus", 304.6935, 42.4437, 0.2),
];

describe("angularSeparationDeg", () => {
  it("is zero for the same point", () => {
    expect(angularSeparationDeg(13.2, 14.38, 13.2, 14.38)).toBe(0);
  });
  it("gives 90 deg from the equator to the pole and 180 deg for antipodes", () => {
    expect(angularSeparationDeg(10, 0, 123, 90)).toBeCloseTo(90, 10);
    expect(angularSeparationDeg(0, 0, 180, 0)).toBeCloseTo(180, 10);
    expect(angularSeparationDeg(45, 30, 225, -30)).toBeCloseTo(180, 6);
  });
  it("wraps RA across 0/360", () => {
    expect(angularSeparationDeg(359.9, 0, 0.1, 0)).toBeCloseTo(0.2, 10);
  });
  it("shrinks RA differences by cos(dec)", () => {
    // 1 deg of RA at dec 60 is about 0.5 deg on the sky.
    expect(angularSeparationDeg(10, 60, 11, 60)).toBeCloseTo(0.49998, 4);
  });
  it("is accurate at arcsecond scale", () => {
    expect(angularSeparationDeg(100, 20, 100, 20 + 1 / 3600) * 3600).toBeCloseTo(1, 6);
  });
  it("is symmetric", () => {
    const a = angularSeparationDeg(269.452, 4.693, 13.2, 14.38);
    const b = angularSeparationDeg(13.2, 14.38, 269.452, 4.693);
    expect(a).toBeCloseTo(b, 12);
  });
});

describe("spotCovering", () => {
  it("finds Eros at its own centre", () => {
    expect(spotCovering(13.2004, 14.38, SPOTS)?.slug).toBe("eros");
  });
  it("uses each spot's own fov: inside half the fov counts, outside does not", () => {
    // Eros fov 0.2 deg -> radius 0.1 deg. 0.09 deg north is inside, 0.11 deg north is outside.
    expect(spotCovering(13.2004, 14.38 + 0.09, SPOTS)?.slug).toBe("eros");
    expect(spotCovering(13.2004, 14.38 + 0.11, SPOTS)).toBeNull();
    // Eris fov 0.1 deg -> radius 0.05 deg.
    expect(spotCovering(26.3271, -0.4338 + 0.04, SPOTS)?.slug).toBe("eris");
    expect(spotCovering(26.3271, -0.4338 + 0.06, SPOTS)).toBeNull();
  });
  it("returns null far from every spot and for an empty list", () => {
    expect(spotCovering(269.452, 4.693, SPOTS)).toBeNull(); // Barnard's Star
    expect(spotCovering(13.2004, 14.38, [])).toBeNull();
  });
  it("picks the closest when two pictures overlap", () => {
    const a = spot("a", 10, 0, 1);
    const b = spot("b", 10.3, 0, 1);
    expect(spotCovering(10.2, 0, [a, b])?.slug).toBe("b");
    expect(spotCovering(10.1, 0, [a, b])?.slug).toBe("a");
  });
});

describe("pickRandom", () => {
  it("returns null for an empty list", () => {
    expect(pickRandom([])).toBeNull();
  });
  it("maps the rng range onto every index, including the ends", () => {
    expect(pickRandom(SPOTS, () => 0)?.slug).toBe("eros");
    expect(pickRandom(SPOTS, () => 0.999999)?.slug).toBe("cygnus");
    expect(pickRandom(SPOTS, () => 0.5)?.slug).toBe("makemake");
  });
});

describe("flyFovForSpot", () => {
  it("shows a few times the picture, never less than 0.3 deg", () => {
    expect(flyFovForSpot({ fov_deg: 0.2 })).toBeCloseTo(0.8);
    expect(flyFovForSpot({ fov_deg: 0.05 })).toBe(0.3);
  });
});

describe("heat scale", () => {
  it("clamps the fraction and treats a bad max as zero", () => {
    expect(heatFraction(5, 10)).toBe(0.5);
    expect(heatFraction(-1, 10)).toBe(0);
    expect(heatFraction(20, 10)).toBe(1);
    expect(heatFraction(5, 0)).toBe(0);
    expect(heatFraction(Number.NaN, 10)).toBe(0);
    expect(heatFraction(5, Number.POSITIVE_INFINITY)).toBe(0);
  });
  it("starts and ends on the ramp's end stops", () => {
    expect(heatRgb(0, 10)).toEqual([...HEAT_STOPS[0]]);
    expect(heatRgb(10, 10)).toEqual([...HEAT_STOPS[HEAT_STOPS.length - 1]]);
    expect(heatRgb(99, 10)).toEqual([...HEAT_STOPS[HEAT_STOPS.length - 1]]);
  });
  it("hits the interior stops exactly", () => {
    expect(heatRgb(1, 3)).toEqual([...HEAT_STOPS[1]]);
    expect(heatRgb(2, 3)).toEqual([...HEAT_STOPS[2]]);
  });
  it("gets lighter as the value rises (sequential)", () => {
    const luma = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let prev = -1;
    for (let v = 0; v <= 100; v += 5) {
      const l = luma(heatRgb(v, 100));
      expect(l).toBeGreaterThanOrEqual(prev);
      prev = l;
    }
  });
  it("formats CSS colours", () => {
    expect(heatColor(0, 10)).toBe("rgb(18, 48, 77)");
    expect(heatColor(0, 10, 0.5)).toBe("rgba(18, 48, 77, 0.5)");
    expect(heatGradientCss()).toMatch(/^linear-gradient\(90deg, rgb\(18, 48, 77\) 0%, .* 100%\)$/);
  });
});

describe("difficulty styles", () => {
  it("gives every difficulty a distinct glyph and a word, not just a colour", () => {
    const glyphs = Object.values(DIFFICULTY_STYLE).map((s) => s.glyph);
    expect(new Set(glyphs).size).toBe(glyphs.length);
    for (const s of Object.values(DIFFICULTY_STYLE)) expect(s.word.length).toBeGreaterThan(0);
  });
});
