import { describe, expect, it } from "vitest";
import { distanceLines, galactic, placePopup, safeHttpsUrl, type InfoExplore } from "./inspectPopup";

// Seeded LCG so the random cases are the same on every run.
function rng(seed: number) {
  let a = seed >>> 0;
  return (lo: number, hi: number) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return Math.floor(lo + u * (hi - lo + 1));
  };
}

describe("placePopup", () => {
  const vp = { w: 800, h: 600 };
  const pop = { w: 300, h: 200 };

  it("fits to the right of the click when there is room", () => {
    const p = placePopup({ x: 100, y: 100 }, pop, vp);
    expect(p.left).toBe(112);
    expect(p.top).toBe(100);
  });

  it("goes to the left when the right side would leave the viewport", () => {
    const p = placePopup({ x: 700, y: 100 }, pop, vp);
    expect(p.left).toBe(700 - 12 - 300);
    expect(p.left + pop.w).toBeLessThanOrEqual(vp.w);
  });

  it("goes below when neither side fits", () => {
    const narrow = { w: 700, h: 100 };
    const p = placePopup({ x: 400, y: 50 }, narrow, vp);
    expect(p.top).toBe(50 + 12);
    expect(p.left).toBeGreaterThanOrEqual(0);
    expect(p.left + narrow.w).toBeLessThanOrEqual(vp.w);
  });

  it("keeps the panel inside the viewport in the corners", () => {
    const corners = [
      { x: 0, y: 0 },
      { x: vp.w - 1, y: 0 },
      { x: 0, y: vp.h - 1 },
      { x: vp.w - 1, y: vp.h - 1 },
    ];
    for (const c of corners) {
      const p = placePopup(c, pop, vp);
      expect(p.left).toBeGreaterThanOrEqual(0);
      expect(p.top).toBeGreaterThanOrEqual(0);
      expect(p.left + pop.w).toBeLessThanOrEqual(vp.w);
      expect(p.top + pop.h).toBeLessThanOrEqual(vp.h);
    }
  });

  it("stays inside the viewport when the panel is bigger than it", () => {
    const p = placePopup({ x: 50, y: 50 }, { w: 1000, h: 900 }, vp);
    expect(p.left).toBe(0);
    expect(p.top).toBe(0);
  });

  it("never covers the click point in 200 seeded random cases where a side fits", () => {
    const next = rng(20260603);
    const gap = 12;
    let checked = 0;
    for (let i = 0; i < 200; i++) {
      const v = { w: next(200, 1920), h: next(200, 1200) };
      const c = { x: next(0, v.w - 1), y: next(0, v.h - 1) };
      const q = { w: next(40, 400), h: next(40, 400) };
      const anyFits =
        (q.h <= v.h && c.x + gap + q.w <= v.w) ||
        (q.h <= v.h && c.x - gap - q.w >= 0) ||
        (q.w <= v.w && c.y + gap + q.h <= v.h) ||
        (q.w <= v.w && c.y - gap - q.h >= 0);
      if (!anyFits) continue;
      checked++;
      const p = placePopup(c, q, v, gap);
      expect(p.left).toBeGreaterThanOrEqual(0);
      expect(p.top).toBeGreaterThanOrEqual(0);
      expect(p.left + q.w).toBeLessThanOrEqual(v.w);
      expect(p.top + q.h).toBeLessThanOrEqual(v.h);
      const outside =
        c.x <= p.left - gap || c.x >= p.left + q.w + gap || c.y <= p.top - gap || c.y >= p.top + q.h + gap;
      expect(outside, JSON.stringify({ c, q, v, p })).toBe(true);
    }
    expect(checked).toBeGreaterThan(150);
  });
});

describe("galactic", () => {
  it("puts the galactic centre at l ~ 0, b ~ 0", () => {
    const { l, b } = galactic(266.405, -28.936);
    expect(Math.min(l, 360 - l)).toBeLessThan(0.01);
    expect(Math.abs(b)).toBeLessThan(0.01);
  });

  it("puts the north galactic pole at b ~ 90", () => {
    const { b } = galactic(192.859, 27.128);
    expect(b).toBeGreaterThan(89.99);
  });

  it("returns l in [0, 360)", () => {
    for (const [ra, dec] of [[0, 0], [359.9, 10], [120, -80]] as const) {
      const { l } = galactic(ra, dec);
      expect(l).toBeGreaterThanOrEqual(0);
      expect(l).toBeLessThan(360);
    }
  });
});

describe("distanceLines", () => {
  const base = { mode: "explore" as const, locked: false };

  it("rule 1: solar-system object gives AU, km and light-minutes from Earth and from the Sun", () => {
    const info: InfoExplore = {
      ...base,
      solar_system: [{ name: "433 Eros", frame: 2, delta_au: 1, r_au: 2, source: "JPL Horizons" }],
    };
    const lines = distanceLines(info);
    expect(lines).toHaveLength(2);
    expect(lines[0].source).toBe("JPL Horizons");
    expect(lines[0].text).toContain("1 AU from Earth");
    expect(lines[0].text).toContain("149,597,871 km");
    expect(lines[0].text).toContain("8.3 light-minutes");
    expect(lines[0].text).toContain("frame 2");
    expect(lines[1].text).toContain("2 AU from the Sun");
    expect(lines[1].text).toContain("16.6 light-minutes");
  });

  it("rule 2: Gaia star with parallax_over_error >= 5 gives parsecs and light-years", () => {
    const lines = distanceLines({ ...base, gaia: { plx: 10, plx_over_err: 20 } });
    expect(lines).toEqual([
      { text: "About 100 parsecs (326.2 light-years), from the Gaia parallax.", source: "Gaia DR3" },
    ]);
  });

  it("rule 2: Gaia star below the error ratio says too far or too faint", () => {
    const lines = distanceLines({ ...base, gaia: { plx: 1, plx_over_err: 3 } });
    expect(lines).toEqual([{ text: "Too far or too faint for a reliable distance.", source: "Gaia DR3" }]);
  });

  it("rule 3: SIMBAD galaxy with a redshift gives an approximate light-travel distance", () => {
    const lines = distanceLines({
      ...base,
      simbad: [{ name: "NGC 1", otype: "G", z: 0.1 }],
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].source).toBe("SIMBAD");
    expect(lines[0].text).toContain("approx., from catalog redshift");
    expect(lines[0].text).toMatch(/about 1\.\d+ billion light-years/);
  });

  it("rule 3: a SIMBAD star with a redshift is not treated as a galaxy", () => {
    const lines = distanceLines({ ...base, simbad: [{ name: "HD 5112", otype: "*", z: 0.1 }] });
    expect(lines).toEqual([
      { text: "SPHEREx alone can't measure this object's distance.", source: "SPHEREx" },
    ]);
  });

  it("rule 5: nothing to measure from gives the SPHEREx-alone line", () => {
    expect(distanceLines({ ...base })).toEqual([
      { text: "SPHEREx alone can't measure this object's distance.", source: "SPHEREx" },
    ]);
  });

  it("returns no lines for a locked response", () => {
    expect(distanceLines({ mode: "round", locked: true })).toEqual([]);
  });
});

describe("safeHttpsUrl", () => {
  it("returns an https address as it is", () => {
    const u = "https://simbad.cds.unistra.fr/simbad/sim-id?Ident=HD%205112";
    expect(safeHttpsUrl(u)).toBe(u);
  });
  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "http://simbad.cds.unistra.fr/",
    "ftp://example.org/x",
    "//example.org/x",
    "/relative/path",
    "not a url",
    "",
  ])("refuses %j", (u) => {
    expect(safeHttpsUrl(u)).toBeNull();
  });
  it("refuses values that are not strings", () => {
    for (const v of [undefined, null, 5, {}, ["https://a.org"]]) expect(safeHttpsUrl(v)).toBeNull();
  });
});
