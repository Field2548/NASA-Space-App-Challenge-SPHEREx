// TAN-SIP vs astropy on real SPHEREx headers (BUILD_PROMPT 16: <= 0.01 px on 3 real files).
// Ground truth: lib/testdata/sip_ref.json, made by lib/testdata/gen_sip_ref.py with astropy.

import { describe, expect, it } from "vitest";
import type { FitsHeader } from "./fits";
import { compileSipWcs, sipPixelToWorld, sipWorldToPixel } from "./sipwcs";
import ref from "./testdata/sip_ref.json";

interface RefPoint {
  ra: number;
  dec: number;
  x: number;
  y: number;
  grid_x: number | null;
  grid_y: number | null;
}
interface RefCase {
  name: string;
  naxis: [number, number];
  cards: FitsHeader;
  points: RefPoint[];
}

const cases = ref.cases as unknown as RefCase[];
const TOL_PX = 0.01;

/** Angular distance in arcsec between two sky positions (small-angle is enough here). */
function sepArcsec(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const dra = (((ra1 - ra2 + 540) % 360) - 180) * Math.cos((dec1 * Math.PI) / 180);
  return Math.hypot(dra, dec1 - dec2) * 3600;
}

function stripSip(h: FitsHeader): FitsHeader {
  return {
    ...h,
    CTYPE1: String(h.CTYPE1).replace("-SIP", ""),
    CTYPE2: String(h.CTYPE2).replace("-SIP", ""),
  };
}

describe("sipWorldToPixel vs astropy world_to_pixel", () => {
  it("has 3 real cutouts from different detectors plus one full-size header", () => {
    expect(cases.length).toBe(4);
    const dets = new Set(cases.slice(0, 3).map((c) => c.name.match(/_D(\d)\.fits$/)?.[1]));
    expect(dets.size).toBe(3);
    for (const c of cases) expect(c.points.length).toBeGreaterThanOrEqual(50);
  });

  for (const c of cases) {
    it(`${c.name}: every point within ${TOL_PX} px, with and without the -SIP suffix`, () => {
      for (const header of [c.cards, stripSip(c.cards)]) {
        let worst = 0;
        for (const p of c.points) {
          const { x, y } = sipWorldToPixel(header, p.ra, p.dec);
          worst = Math.max(worst, Math.hypot(x - p.x, y - p.y));
        }
        expect(worst).toBeLessThan(TOL_PX);
      }
    });

    it(`${c.name}: pixel -> world matches astropy and round-trips`, () => {
      const w = compileSipWcs(c.cards);
      for (const p of c.points) {
        if (p.grid_x === null || p.grid_y === null) continue;
        const s = sipPixelToWorld(w, p.grid_x, p.grid_y);
        // astropy's all_pix2world gave p.ra, p.dec for this pixel: 1e-4 arcsec = 0.00002 px.
        expect(sepArcsec(s.ra, s.dec, p.ra, p.dec)).toBeLessThan(1e-4);
        const back = sipWorldToPixel(w, s.ra, s.dec);
        expect(Math.hypot(back.x - p.grid_x, back.y - p.grid_y)).toBeLessThan(1e-6);
      }
    });
  }

  it("SIP matters: ignoring it would be off by pixels", () => {
    const c = cases[3];
    const noSip: FitsHeader = {};
    for (const [k, v] of Object.entries(c.cards)) if (!/^(A|B|AP|BP)_/.test(k)) noSip[k] = v;
    let worst = 0;
    for (const p of c.points) {
      const { x, y } = sipWorldToPixel(noSip, p.ra, p.dec);
      worst = Math.max(worst, Math.hypot(x - p.x, y - p.y));
    }
    expect(worst).toBeGreaterThan(1);
  });

  it("reports the worst error (for the record)", () => {
    let worst = 0;
    for (const c of cases) {
      for (const p of c.points) {
        const { x, y } = sipWorldToPixel(c.cards, p.ra, p.dec);
        worst = Math.max(worst, Math.hypot(x - p.x, y - p.y));
      }
    }
    console.log(`max |TAN-SIP - astropy| = ${worst.toExponential(3)} px over ${cases.length} headers`);
    expect(worst).toBeLessThan(TOL_PX);
  });
});
