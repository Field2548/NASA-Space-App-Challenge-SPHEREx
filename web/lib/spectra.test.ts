import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HAS_BROWN_DWARF_TEMPLATES,
  PIXEL_SR,
  blackbodyFit,
  builtInReferences,
  decodeExposures,
  loadExposures,
  loadSptTeff,
  lookupSptTeff,
  matchReferences,
  planckNu,
  spectrumAlongPath,
  temperatureGuess,
  trackPositionAt,
  wavelengthAt,
  wavelengthColor,
  type ExposuresJson,
  type Match,
  type Reference,
  type SptTeffTable,
} from "./spectra";
import type { Field, Spectrum, Track } from "./types";

const WEB = join(__dirname, "..");
const EROS = join(WEB, "public/fields/eros");
const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;
const readBuf = (p: string): ArrayBuffer => {
  const b = readFileSync(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

/** Deterministic Gaussian noise (mulberry32 + Box-Muller). */
function rng(seed: number) {
  let a = seed >>> 0;
  const u = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(u() || 1e-12)) * Math.cos(2 * Math.PI * u());
}

/** 102 SPHEREx-like wavelengths, 0.75 to 5.0 um. */
const WL = Array.from({ length: 102 }, (_, i) => 0.75 + (4.25 * i) / 101);

function bbSpectrum(tK: number, snr: number, seed = 1): Spectrum {
  const g = rng(seed);
  const truth = WL.map((um) => planckNu(um, tK));
  const md = [...truth].sort((a, b) => a - b)[51];
  const flux = truth.map((f) => (f / md) * 100);
  const err = flux.map((f) => Math.abs(f) / snr);
  return { wl: WL, flux: flux.map((f, i) => f + err[i] * g()), err };
}

function hue([r, g, b]: [number, number, number]): number {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const mx = Math.max(R, G, B);
  const mn = Math.min(R, G, B);
  const d = mx - mn;
  if (d === 0) return NaN;
  let h = mx === R ? ((G - B) / d) % 6 : mx === G ? (B - R) / d + 2 : (R - G) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

describe("wavelengthColor", () => {
  it("runs violet -> red with monotonically decreasing hue", () => {
    const hs = Array.from({ length: 50 }, (_, i) => hue(wavelengthColor(0.75 + (4.25 * i) / 49)));
    for (let i = 1; i < hs.length; i++) expect(hs[i]).toBeLessThan(hs[i - 1]);
    expect(hs[0]).toBeGreaterThan(260); // violet
    expect(hs[hs.length - 1]).toBeLessThan(5); // red
    expect(hue(wavelengthColor(2.0))).toBeGreaterThan(100); // green-ish around the middle third
  });
  it("is gray in mono vision", () => {
    for (const um of [0.75, 1.5, 3, 5]) {
      const [r, g, b] = wavelengthColor(um, "mono");
      expect(r).toBe(g);
      expect(g).toBe(b);
    }
  });
});

describe("constants", () => {
  it("pixel solid angle is about 8.9e-10 sr", () => {
    expect(PIXEL_SR).toBeCloseTo(8.89e-10, 11);
  });
  it("brown-dwarf templates are flagged as missing", () => {
    expect(HAS_BROWN_DWARF_TEMPLATES).toBe(false);
  });
});

describe("blackbodyFit", () => {
  it("recovers 3000 K within 10 percent", () => {
    const fit = blackbodyFit(bbSpectrum(3000, 30));
    expect(fit).not.toBeNull();
    expect(Math.abs(fit!.teffK - 3000) / 3000).toBeLessThan(0.1);
    expect(fit!.lowerLimitOnly).toBe(false);
  });
  it("reports a lower limit for an 8000 K star", () => {
    const fit = blackbodyFit(bbSpectrum(8000, 30, 2));
    expect(fit!.lowerLimitOnly).toBe(true);
    expect(fit!.teffK).toBeGreaterThan(5000);
  });
  it("returns null without enough positive points", () => {
    expect(blackbodyFit({ wl: [1, 2], flux: [1, 1], err: [0.1, 0.1] })).toBeNull();
  });
});

describe("matchReferences", () => {
  const stars = builtInReferences("star");
  it("picks the right blackbody with quality good for a clean template", () => {
    const m = matchReferences(bbSpectrum(3000, 50, 3), stars);
    expect(m).not.toBeNull();
    expect(m!.best.ref.id).toBe("bb-3000");
    expect(m!.quality).toBe("good");
    expect(["bb-2500", "bb-3500"]).toContain(m!.runnerUp.ref.id);
  });
  it("tells reflected sunlight from sunlight + heat glow for movers", () => {
    const movers = builtInReferences("mover");
    const heat = movers.find((r) => r.id === "reflected-heat")!;
    const g = rng(4);
    const flux = WL.map((um) => {
      const i = Math.round((um - heat.wl[0]) / 0.01);
      return heat.flux[i];
    });
    const err = flux.map((f) => f / 40);
    const m = matchReferences({ wl: WL, flux: flux.map((f, i) => f + err[i] * g()), err }, movers);
    expect(m!.best.ref.id).toBe("reflected-heat");
  });
  it("returns null when fewer than 20 bands reach S/N 5", () => {
    const s = bbSpectrum(3000, 4, 5);
    expect(matchReferences(s, stars)).toBeNull();
    // 19 bands at S/N 50, the rest at S/N 2: still too faint
    const t = bbSpectrum(3000, 50, 6);
    const err = t.err.map((e, i) => (i < 19 ? e : (e * 50) / 2));
    expect(matchReferences({ ...t, err }, stars)).toBeNull();
  });
});

describe("temperatureGuess", () => {
  const table = readJson<SptTeffTable>(join(WEB, "public/ref/spt_teff.json"));
  const fakeMatch = (ref: Reference): Match => ({ ref, chi2: 1, redChi2: 1, n: 30, model: { wl: [], flux: [] } });
  it("is null for movers, whatever else is given", () => {
    for (const r of builtInReferences("mover")) {
      expect(temperatureGuess(fakeMatch(r), table, { teffK: 300 })).toBeNull();
    }
    expect(temperatureGuess(null, table)).toBeNull();
  });
  it("uses the blackbody fit for stars and the 5000 K rule", () => {
    const star = builtInReferences("star").find((r) => r.teffK === 3000)!;
    expect(temperatureGuess(fakeMatch(star), table, { teffK: 3120 })).toEqual({ approxK: 3100, lowerLimitOnly: false, from: "blackbody fit" });
    expect(temperatureGuess(fakeMatch(star), null)).toEqual({ approxK: 3000, lowerLimitOnly: false, from: "closest blackbody" });
    const hot = temperatureGuess(fakeMatch(star), table, { teffK: 9000 });
    expect(hot).toEqual({ approxK: 5000, lowerLimitOnly: true, from: "blackbody fit" });
  });
  it("looks up a spectral-type match in the Mamajek table, null without it", () => {
    const t1 = table.rows.find((r) => r.spt === "T1V")!.teff;
    const bd: Reference = { id: "T1", label: "T1", kind: "brown-dwarf", spt: "T1", wl: [], flux: [], source: "test" };
    expect(temperatureGuess(fakeMatch(bd), table)).toEqual({ approxK: t1, lowerLimitOnly: false, from: "type T1 (Mamajek table)" });
    expect(temperatureGuess(fakeMatch(bd), null)).toBeNull();
    expect(lookupSptTeff(table, "t1 v")).toBe(t1);
    expect(lookupSptTeff(table, "Z9")).toBeNull();
  });
  it("spt_teff.json has the documented shape and covers O to Y", () => {
    expect(table.citation).toBe("Pecaut & Mamajek (2013, ApJS, 208, 9)");
    expect(table.version).toMatch(/^Version \d{4}\.\d{2}\.\d{2}$/);
    const first = new Set(table.rows.map((r) => r.spt[0]));
    for (const c of "OBAFGKMLTY") expect(first.has(c)).toBe(true);
    // Teff decreases down the sequence
    for (let i = 1; i < table.rows.length; i++) expect(table.rows[i].teff).toBeLessThanOrEqual(table.rows[i - 1].teff);
  });
  it("loadSptTeff returns null on a failed fetch", async () => {
    const fake = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
    expect(await loadSptTeff(fake)).toBeNull();
  });
});

describe("wavelengthAt / trackPositionAt", () => {
  it("bilinear on cell centres, null where uncovered", () => {
    const grid = Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => 1 + c * 0.1 + r * 0.01));
    // cell (cx=2, cy=3) centre for W = H = 80: (2.5*10 - 0.5, 3.5*10 - 0.5) = (24.5, 34.5)
    expect(wavelengthAt(grid, 80, 80, 24.5, 34.5)).toBeCloseTo(1.23, 9);
    expect(wavelengthAt(grid, 80, 80, 29.5, 34.5)).toBeCloseTo(1.28, 9);
    const nulls = grid.map((row) => row.map(() => null));
    expect(wavelengthAt(nulls, 80, 80, 10, 10)).toBeNull();
  });
  it("interpolates between marks and extrapolates beyond them", () => {
    const track: Track = {
      x0: 0, y0: 0, t0Days: 0, vx: 0, vy: 0, rms: 0,
      marks: [
        { frame: 1, x: 10, y: 10, tDays: 0 },
        { frame: 2, x: 20, y: 10, tDays: 1 },
        { frame: 3, x: 20, y: 30, tDays: 2 },
      ],
    };
    expect(trackPositionAt(track, 0.5)).toEqual({ x: 15, y: 10 });
    expect(trackPositionAt(track, 1.5)).toEqual({ x: 20, y: 20 });
    expect(trackPositionAt(track, -1)).toEqual({ x: 0, y: 10 });
    expect(trackPositionAt(track, 3)).toEqual({ x: 20, y: 50 });
    expect(trackPositionAt({ ...track, marks: [], x0: 1, y0: 2, vx: 2, vy: -1, t0Days: 1 }, 3)).toEqual({ x: 5, y: 0 });
  });
});

describe("spectrumAlongPath on real Eros data", () => {
  const field = readJson<Field>(join(EROS, "field.json"));
  const ej = readJson<ExposuresJson>(join(EROS, "exposures.json"));
  const exps = decodeExposures(ej, readBuf(join(EROS, "exposures.u16")), field.frames[0].mjd);
  const answer = readJson<{ objects: { positions: { frame: number; x: number; y: number; in_grid: boolean }[] }[] }>(
    join(WEB, "data/answers/eros.json"),
  );
  const tOf = (frame: number) => field.frames[frame - 1].mjd - field.frames[0].mjd;
  const marks = answer.objects[0].positions.map((p) => ({ frame: p.frame, x: p.x, y: p.y, tDays: tOf(p.frame) }));
  const track: Track = { x0: marks[0].x, y0: marks[0].y, t0Days: 0, vx: 0, vy: 0, rms: 0, marks };

  it("gives one point per exposure that covers Eros, and detects it clearly", () => {
    const p = spectrumAlongPath(exps, track);
    // Exposures whose aperture position is fully on the grid and has data.
    const covering = ej.exposures.filter((e) => {
      const pos = trackPositionAt(track, e.mjd - exps.firstFrameMjd);
      const plane = exps.planes[e.k];
      for (let j = Math.round(pos.y) - 2; j <= Math.round(pos.y) + 2; j++)
        for (let i = Math.round(pos.x) - 2; i <= Math.round(pos.x) + 2; i++) {
          if (Math.hypot(i - pos.x, j - pos.y) > 1.5) continue;
          if (i < 0 || j < 0 || i >= 119 || j >= 119 || !Number.isFinite(plane[j * 119 + i])) return false;
        }
      return true;
    });
    expect(p.wl.length).toBe(covering.length);
    expect(new Set(p.k).size).toBe(p.k.length);
    // Eros is in the grid in frames 1 to 3 only (22 exposures).
    expect(p.frame.every((f) => f <= 3)).toBe(true);
    expect(p.wl.length).toBe(22);
    const snr = p.mJy.map((f, i) => f / p.err[i]);
    // Report for the team.
    console.log(
      "Eros along path:\n" +
        p.wl
          .map((wl, i) => `  k=${p.k[i]} f${p.frame[i]} D${p.det[i]} ${wl.toFixed(3)} um  ${p.mJy[i].toFixed(1)} +- ${p.err[i].toFixed(2)} mJy  S/N ${snr[i].toFixed(0)}${p.clipped[i] ? " (clipped)" : ""}`)
          .join("\n"),
    );
    expect(Math.min(...snr)).toBeGreaterThan(20);
    for (const wl of p.wl) {
      expect(wl).toBeGreaterThan(0.7);
      expect(wl).toBeLessThan(5.1);
    }
    const m = matchReferences({ wl: p.wl, flux: p.mJy, err: p.err }, builtInReferences("mover"));
    console.log("Eros mover match:", m && { best: m.best.ref.id, redChi2: m.best.redChi2.toFixed(1), runnerUp: m.runnerUp.ref.id, quality: m.quality });
  });

  it("skips exposures where the aperture has no data (off the grid)", () => {
    const off: Track = { x0: -50, y0: -50, t0Days: 0, vx: 0, vy: 0, rms: 0, marks: [] };
    expect(spectrumAlongPath(exps, off).wl).toEqual([]);
  });

  it("loadExposures fetches and decodes per the contract", async () => {
    const urls: string[] = [];
    const fake = (async (url: string) => {
      urls.push(url);
      if (url.endsWith(".json")) return new Response(readFileSync(join(EROS, "exposures.json")));
      return new Response(readFileSync(join(EROS, "exposures.u16")));
    }) as unknown as typeof fetch;
    const loaded = await loadExposures({ ...field, has: { exposures: true } }, fake);
    expect(urls).toEqual(["/fields/eros/exposures.json", "/fields/eros/exposures.u16"]);
    expect(loaded!.planes).toHaveLength(34);
    expect(loaded!.planes[5][60 * 119 + 60]).toBe(exps.planes[5][60 * 119 + 60]);
    expect(await loadExposures({ ...field, has: {} }, fake)).toBeNull();
  });
});

describe("exposures.u16 encodings", () => {
  it("decodes asinh as soft * sinh((value - 32767) * step), keeps 65535 as NaN, and still decodes linear rows", () => {
    // Plane 0 asinh: sky (32767), +1 sigma-ish, the brightest end (65534), no data. Plane 1 linear.
    const u = new Uint16Array([32767, 33767, 65534, 65535, 100, 200, 300, 65535]);
    const e0 = { k: 0, soft: 0.0127, step: 0.000331 };
    const e1 = { k: 1, scale: 0.5, offset: -10 };
    const json = { size: [4, 1], nodata: 65535, encoding: "asinh", exposures: [e0, e1] } as unknown as ExposuresJson;
    const { planes } = decodeExposures(json, u.buffer, 0);
    expect(planes[0][0]).toBe(0);
    expect(planes[0][1]).toBeCloseTo(0.0127 * Math.sinh(1000 * 0.000331), 6);
    expect(planes[0][2]).toBeCloseTo(0.0127 * Math.sinh(32767 * 0.000331), 3); // top of the range: not clipped
    expect(planes[0][3]).toBeNaN();
    expect(Array.from(planes[1].slice(0, 3))).toEqual([40, 90, 140]);
    expect(planes[1][3]).toBeNaN();
  });
});
