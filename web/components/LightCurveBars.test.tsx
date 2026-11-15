import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FrameMeta, RGB } from "@/lib/types";
import LightCurveBars, { barGeometry, verdictText } from "./LightCurveBars";

function frame(i: number, detectors: number[] = [3, 6]): FrameMeta {
  return {
    i,
    mjd: 60000 + i,
    utc: `2026-01-0${i}T00:47:00`,
    hours_since_prev: 1.6,
    n_bands: 8,
    detectors,
  };
}

const FRAMES = [1, 2, 3, 4, 5].map((i) => frame(i));
const COLORS: RGB[] = [
  [230, 159, 0],
  [86, 180, 233],
  [0, 158, 115],
  [240, 228, 66],
  [204, 121, 167],
];
const COLOR_STRINGS = COLORS.map(([r, g, b]) => `rgb(${r},${g},${b})`);
const SNR = [721.2, 1.0, 0.4, 1.5, 1.8];

describe("verdictText", () => {
  it("returns the plain-words sentence for each verdict", () => {
    expect(verdictText("steady")).toBe("Steady: about the same in every frame.");
    expect(verdictText("changed", 4)).toBe("Changed in frame 4.");
    expect(verdictText("changed")).toBe("Changed in one frame.");
    expect(verdictText("faint")).toBe("Too faint to tell.");
  });
});

describe("barGeometry", () => {
  it("scales bars to the largest finite positive value and handles NaN", () => {
    const bars = barGeometry([10, 0, -3, NaN, 5], 280, 120);
    expect(bars).toHaveLength(5);

    expect(bars[0].h).toBe(120 - 28);
    expect(bars[1].h).toBe(0);
    expect(bars[2].h).toBe(0);
    expect(bars[3].h).toBe(0);
    expect(bars[3].value).toBeNull();
    expect(Math.abs(bars[4].h - bars[0].h / 2)).toBeLessThan(0.01);

    for (const b of bars) {
      for (const v of [b.x, b.y, b.w, b.h]) {
        expect(Number.isNaN(v)).toBe(false);
        expect(v).toBeGreaterThanOrEqual(0);
      }
    }

    for (let k = 1; k < bars.length; k++) {
      expect(bars[k].x).toBeGreaterThanOrEqual(bars[k - 1].x + bars[k - 1].w);
    }
    for (const b of bars) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(280);
    }
  });

  it("does not throw when no value is positive, and returns [] for no frames", () => {
    const allNegative = barGeometry([-1, -2], 280, 120);
    expect(allNegative.map((b) => b.h)).toEqual([0, 0]);
    expect(barGeometry([], 280, 120)).toEqual([]);
  });
});

describe("LightCurveBars rendering", () => {
  const base = {
    frames: FRAMES,
    snr: SNR,
    verdict: "changed" as const,
    changedFrame: 1,
    colors: COLORS,
  };

  it("renders one bar per frame, the verdict, the frame list and the value labels", () => {
    const html = renderToStaticMarkup(<LightCurveBars {...base} />);
    expect(html.match(/<rect/g)).toHaveLength(5);
    expect(html).toContain('role="img"');
    expect(html).toContain("Changed in frame 1.");
    expect(html).toContain("721.2");
    expect(html).toContain(COLOR_STRINGS[0]);
    expect(html.match(/<li>/g)).toHaveLength(5);

    const firstItem = html.match(/<li>(.*?)<\/li>/)?.[1] ?? "";
    expect(firstItem).toContain("2026-01-01 00:47:00");
    expect(firstItem).toContain("D3, D6");
  });

  it("uses the same gray for every bar in mono mode", () => {
    const html = renderToStaticMarkup(<LightCurveBars {...base} mono />);
    expect(html).toContain("rgb(160,160,160)");
    for (const c of COLOR_STRINGS) expect(html).not.toContain(c);
  });

  it("labels missing values as no data and never prints NaN", () => {
    const html = renderToStaticMarkup(
      <LightCurveBars {...base} snr={[721.2, NaN, 0.4, 1.5, 1.8]} />,
    );
    expect(html).toContain("no data");
    expect(html).not.toContain("NaN");
  });

  it("renders only the frames that have a value when the lengths differ", () => {
    const html = renderToStaticMarkup(<LightCurveBars {...base} snr={[721.2, 1.0, 0.4]} />);
    expect(html.match(/<rect/g)).toHaveLength(3);
  });
});
