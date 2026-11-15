import { describe, expect, it } from "vitest";
import { ciede2000, simulateCvd, srgbToLab, timeColors, type Lab } from "./palettes";
import type { RGB } from "./types";

// Sharma, Wu, Dalal (2005) supplementary test data.
const SHARMA: [Lab, Lab, number][] = [
  [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
  [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
  [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
  [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0],
  [[50, 0, 0], [50, -1, 2], 2.3669],
  [[50, 2.49, -0.001], [50, -2.49, 0.0009], 7.1792],
  [[50, 2.5, 0], [50, 0, -2.5], 4.3065],
  [[50, 2.5, 0], [73, 25, -18], 27.1492],
  [[50, 2.5, 0], [61, -5, 29], 22.8977],
  [[50, 2.5, 0], [56, -27, -3], 31.903],
  [[50, 2.5, 0], [58, 24, 15], 19.4535],
  [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
  [[63.0109, -31.0961, -5.8663], [62.8187, -29.7946, -4.0864], 1.263],
];

describe("ciede2000", () => {
  it.each(SHARMA.map((r, i) => [i, ...r]))("Sharma pair %i", (_i, a, b, want) => {
    expect(ciede2000(a as Lab, b as Lab)).toBeCloseTo(want as number, 4);
    expect(ciede2000(b as Lab, a as Lab)).toBeCloseTo(want as number, 4);
  });
  it("srgbToLab: white and black", () => {
    const w = srgbToLab([255, 255, 255]);
    expect(w[0]).toBeCloseTo(100, 2);
    expect(Math.abs(w[1])).toBeLessThan(0.01);
    expect(Math.abs(w[2])).toBeLessThan(0.01);
    expect(srgbToLab([0, 0, 0])[0]).toBeCloseTo(0, 6);
  });
});

describe("simulateCvd", () => {
  it("keeps grays (matrix rows sum to 1)", () => {
    for (const t of ["protan", "deutan", "tritan"] as const) {
      const [r, g, b] = simulateCvd([128, 128, 128], t);
      for (const v of [r, g, b]) expect(v).toBeCloseTo(128, 0);
    }
  });
  it("protan darkens pure red", () => {
    // linear 0.152286 encodes to about 108.8
    expect(simulateCvd([255, 0, 0], "protan")[0]).toBeCloseTo(108.79, 1);
  });
});

describe("timeColors", () => {
  it("Okabe-Ito order for normal, protan, deutan", () => {
    for (const v of ["normal", "protan", "deutan"] as const) {
      expect(timeColors(3, v)).toEqual([[0, 114, 178], [86, 180, 233], [0, 158, 115]]);
    }
  });
  it("n > 7 falls back to n distinct hues from blue-ish to red", () => {
    const c = timeColors(9, "normal");
    expect(c).toHaveLength(9);
    expect(new Set(c.map((x) => x.join())).size).toBe(9);
    for (const px of c) for (const v of px) expect(v).toBeGreaterThanOrEqual(0);
    expect(c[8]).toEqual([255, 0, 0]);
  });
  it("mono gives gray, increasing", () => {
    const c = timeColors(4, "mono");
    for (const [r, g, b] of c) expect(r === g && g === b).toBe(true);
    for (let i = 1; i < 4; i++) expect(c[i][0]).toBeGreaterThan(c[i - 1][0]);
  });

  const types = ["normal", "protan", "deutan", "tritan"] as const;
  it.each(types)("all pairs for n = 2..7 stay CIEDE2000 >= 10 under %s", (v) => {
    const mins: string[] = [];
    for (let n = 2; n <= 7; n++) {
      const cols = timeColors(n, v).map((c): RGB => (v === "normal" ? c : simulateCvd(c, v)));
      const labs = cols.map(srgbToLab);
      let min = Infinity;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) min = Math.min(min, ciede2000(labs[i], labs[j]));
      mins.push(`n=${n}:${min.toFixed(1)}`);
      expect(min, `${v} n=${n}`).toBeGreaterThanOrEqual(10);
    }
    console.log(`min dE00 ${v} ${mins.join(" ")}`);
  });
});
