import { describe, expect, it } from "vitest";
import data from "./skyData.json";
import { FIELD_RADIUS, STARS, TITLE_VIEW, galacticToEquatorial, linesPath, milkyWayBlobs, placedStars, project } from "./project";

const byHip = (hip: number) => {
  const s = STARS.find((x) => x.hip === hip);
  if (!s) throw new Error(`HIP ${hip} missing`);
  return s;
};
const BETELGEUSE = 27989;
const POLARIS = 11767;

describe("project", () => {
  it("puts the view centre at the origin", () => {
    const b = byHip(BETELGEUSE);
    const p = project(b.ra, b.dec, { ra: b.ra, dec: b.dec, scale: 40 });
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(0, 9);
    expect(p.k).toBeCloseTo(1, 9);
  });

  it("puts Betelgeuse at its expected spot when the view is centred on Orion's belt", () => {
    // Belt centre near RA 83.8, Dec -1.2: Betelgeuse is ~5 deg east (left) and ~8.6 deg north (up).
    const b = byHip(BETELGEUSE);
    const p = project(b.ra, b.dec, { ra: 83.8, dec: -1.2, scale: 40 });
    expect(p.x).toBeLessThan(0);
    expect(p.y).toBeLessThan(0);
    // Stereographic near the centre is ~linear: separation in degrees times pi/180 times scale.
    const dx = (b.ra - 83.8) * Math.cos((b.dec * Math.PI) / 180);
    expect(-p.x).toBeCloseTo((dx * Math.PI) / 180 * 40, 0);
    expect(-p.y).toBeCloseTo(((b.dec + 1.2) * Math.PI) / 180 * 40, 0);
  });

  it("puts Polaris within a fraction of a unit of the centre in the title view", () => {
    const s = byHip(POLARIS);
    const p = project(s.ra, s.dec, TITLE_VIEW);
    const expected = 2 * Math.tan(((90 - s.dec) * Math.PI) / 360) * TITLE_VIEW.scale;
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(expected, 6);
    expect(Math.hypot(p.x, p.y)).toBeLessThan(1);
  });

  it("keeps east to the left and north up", () => {
    const v = { ra: 100, dec: 0, scale: 40 };
    expect(project(110, 0, v).x).toBeLessThan(0);
    expect(project(90, 0, v).x).toBeGreaterThan(0);
    expect(project(100, 10, v).y).toBeLessThan(0);
  });

  it("maps the galactic centre and north pole to their known equatorial places", () => {
    const gc = galacticToEquatorial(0, 0);
    expect(gc.ra).toBeCloseTo(266.405, 1);
    expect(gc.dec).toBeCloseTo(-28.936, 1);
    const ngp = galacticToEquatorial(0, 90);
    expect(ngp.ra).toBeCloseTo(192.859, 2);
    expect(ngp.dec).toBeCloseTo(27.128, 2);
  });
});

describe("baked sky data", () => {
  it("has about a thousand and a half stars to magnitude 5, sorted bright first, with Sirius brightest", () => {
    expect(STARS.length).toBeGreaterThan(1400);
    expect(STARS.length).toBeLessThan(1900);
    for (const s of STARS) {
      expect(s.ra).toBeGreaterThanOrEqual(0);
      expect(s.ra).toBeLessThan(360);
      expect(Math.abs(s.dec)).toBeLessThanOrEqual(90);
      expect(s.mag).toBeLessThanOrEqual(5.0);
    }
    expect(STARS[0].hip).toBe(32349); // Sirius
    expect(STARS.filter((s) => s.mag < 1.5).length).toBeGreaterThanOrEqual(8);
    expect(byHip(BETELGEUSE).mag).toBeCloseTo(0.45, 1);
  });

  it("has the constellation figures and stays small", () => {
    expect(data.lines.length).toBeGreaterThan(100);
    expect(JSON.stringify(data).length).toBeLessThan(100_000);
  });

  it("draws stars, figures and a band inside the disc", () => {
    const placed = placedStars();
    expect(placed.length).toBeGreaterThan(900);
    for (const p of placed) expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(FIELD_RADIUS + 0.2);
    expect(linesPath().startsWith("M")).toBe(true);
    expect(milkyWayBlobs().length).toBeGreaterThan(40);
  });
});
