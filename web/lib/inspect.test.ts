import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { decodeFrames } from "./fields";
import {
  FEATURES,
  UNKNOWN_TYPE,
  clearSpectrumCache,
  colorHint,
  eclipticLatitude,
  findFeatures,
  lightCurveAt,
  loadSpectrumAt,
  parallaxDistance,
  redshiftDistance,
  toPlainType,
  type SpectrumIndex,
} from "./inspect";
import type { Field, Spectrum } from "./types";

const WEB = join(__dirname, "..");
const EROS = join(WEB, "public/fields/eros");
const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;
const field = readJson<Field>(join(EROS, "field.json"));
const withCube: Field = { ...field, has: { ...field.has, spectrum: true } };

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

const WL = Array.from({ length: 102 }, (_, i) => 0.75 + (4.25 * i) / 101);

/** Fake fetch serving files from web/public, recording URLs. */
function diskFetch(urls: string[]) {
  return (async (url: string) => {
    urls.push(url);
    try {
      return new Response(readFileSync(join(WEB, "public", url)));
    } catch {
      return new Response("missing", { status: 404 });
    }
  }) as unknown as typeof fetch;
}

describe("parallaxDistance", () => {
  it("500 mas at ratio 100 is 2 pc, 6.52 ly", () => {
    const d = parallaxDistance(500, 100)!;
    expect(d.pc).toBeCloseTo(2, 10);
    expect(d.ly).toBeCloseTo(6.52, 2);
  });
  it("is null when parallax/error < 5 or parallax <= 0", () => {
    expect(parallaxDistance(500, 4.99)).toBeNull();
    expect(parallaxDistance(-1, 50)).toBeNull();
    expect(parallaxDistance(NaN, 50)).toBeNull();
  });
});

describe("redshiftDistance", () => {
  it("z = 0.01 is about 0.14 Gly", () => {
    expect(redshiftDistance(0.01)!.lightTravelGly).toBeCloseTo(0.143, 2);
  });
  it("matches the Planck 2018 lookback times at larger z", () => {
    // flat LCDM H0 67.7, Om 0.31: lookback at z = 1 is about 7.9 Gyr, and approaches the age (13.8) at high z
    expect(redshiftDistance(1)!.lightTravelGly).toBeGreaterThan(7.7);
    expect(redshiftDistance(1)!.lightTravelGly).toBeLessThan(8.1);
    expect(redshiftDistance(1000)!.lightTravelGly).toBeLessThan(13.9);
    expect(redshiftDistance(1000)!.lightTravelGly).toBeGreaterThan(13.6);
  });
  it("is null for z <= 0", () => {
    expect(redshiftDistance(0)).toBeNull();
    expect(redshiftDistance(-0.001)).toBeNull();
  });
});

describe("eclipticLatitude", () => {
  it("is 0 at the equinox, about -5.4 deg for Eros, and the ecliptic pole is +90", () => {
    expect(eclipticLatitude(0, 0)).toBeCloseTo(0, 9);
    expect(eclipticLatitude(270, 66.560708)).toBeCloseTo(90, 3); // north ecliptic pole, RA 18h, Dec 90 - 23.4393
    expect(eclipticLatitude(90, 84381.406 / 3600)).toBeCloseTo(0, 9); // summer solstice point lies on the ecliptic (IAU 2006 obliquity)
    expect(Math.abs(eclipticLatitude(field.ra, field.dec))).toBeLessThan(10);
  });
});

describe("toPlainType", () => {
  it("maps common SIMBAD types and never guesses", () => {
    expect(toPlainType("BD*")).toBe("Brown dwarf");
    expect(toPlainType("*")).toBe("Star");
    expect(toPlainType("G")).toBe("Galaxy");
    expect(toPlainType("V*")).toBe("Variable star");
    expect(toPlainType("QSO")).toBe("Quasar");
    expect(toPlainType("BD?")).toBe("Possible brown dwarf");
    expect(toPlainType("BrownD*_Candidate")).toBe("Possible brown dwarf");
    expect(toPlainType("XyZ")).toBe(UNKNOWN_TYPE);
    expect(toPlainType("")).toBe(UNKNOWN_TYPE);
  });
});

describe("findFeatures", () => {
  it("returns [] on flat noise (many seeds)", () => {
    let hits = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const g = rng(seed);
      const s: Spectrum = { wl: WL, flux: WL.map(() => 10 + g()), err: WL.map(() => 1) };
      hits += findFeatures(s).length;
      if (seed <= 20) expect(findFeatures(s)).toEqual([]);
    }
    // 4 tests at 3 sigma one-sided: expected false-alarm rate about 0.5 percent per spectrum
    expect(hits).toBeLessThanOrEqual(4);
  });
  it("finds a synthetic 3.0 um water-ice dip and nothing else", () => {
    const g = rng(7);
    const flux = WL.map((um) => 100 + 5 * um - 40 * Math.exp(-0.5 * ((um - 3.0) / 0.08) ** 2) + g());
    const f = findFeatures({ wl: WL, flux, err: WL.map(() => 1) });
    expect(f.map((x) => x.feature)).toEqual(["H2O"]);
    expect(f[0].sigma).toBeGreaterThanOrEqual(3);
  });
  it("finds a PAH bump at 3.3 um", () => {
    const flux = WL.map((um) => 50 + 30 * Math.exp(-0.5 * ((um - 3.3) / 0.03) ** 2));
    expect(findFeatures({ wl: WL, flux, err: WL.map(() => 1) }).map((x) => x.feature)).toContain("PAH");
  });
  it("measurement bands match the ice family in molecule_bands.json", () => {
    const mb = readJson<{ families: { id: string; bands: { feature?: string; range_um: [number, number] }[] }[] }>(
      join(WEB, "public/ref/molecule_bands.json"),
    );
    const ice = mb.families.find((f) => f.id === "ice")!;
    for (const def of FEATURES) {
      const b = ice.bands.find((x) => x.feature === def.feature)!;
      expect(b.range_um).toEqual(def.band);
    }
  });
});

describe("colorHint", () => {
  const star = (k: number, m: number): Spectrum => ({
    wl: [1.2, 1.3, 2.2, 2.3, 4.6, 4.7],
    flux: [100, 100, 100 * k, 100 * k, 100 * m, 100 * m],
    err: [1, 1, 1, 1, 1, 1],
  });
  const stars = [star(0.5, 0.1), star(0.55, 0.11), star(0.48, 0.095), star(0.52, 0.1)];
  it("says typical, redder or bluer relative to the spot's stars", () => {
    expect(colorHint(star(0.5, 0.1), stars)).toBe("typical");
    expect(colorHint(star(1, 0.5), stars)).toBe("redder");
    expect(colorHint(star(0.3, 0.03), stars)).toBe("bluer");
  });
  it("is null without enough stars or a usable target", () => {
    expect(colorHint(star(0.5, 0.1), stars.slice(0, 2))).toBeNull();
    expect(colorHint({ wl: [1.2], flux: [1], err: [1] }, stars)).toBeNull();
  });
});

describe("loadSpectrumAt on real Eros tiles", () => {
  beforeEach(() => clearSpectrumCache());
  const idx = readJson<SpectrumIndex>(join(EROS, "spectrum/index.json"));

  it("equals an independent decode of the tile and loads one tile only", async () => {
    const urls: string[] = [];
    const fetcher = diskFetch(urls);
    const [x, y] = [70, 45]; // tile t_2_1
    const s = await loadSpectrumAt(withCube, x, y, fetcher);
    expect(urls).toEqual(["/fields/eros/spectrum/index.json", "/fields/eros/spectrum/t_2_1.u16"]);
    // Independent decode with Buffer.readUInt16LE
    const buf = readFileSync(join(EROS, "spectrum/t_2_1.u16"));
    const T = idx.tile;
    const want: number[] = [];
    idx.bands.forEach((b, i) => {
      const v = buf.readUInt16LE(2 * ((i * T + (y - 32)) * T + (x - 64)));
      if (v !== 65535) want.push(v * b.scale + b.offset);
    });
    expect(s).not.toBeNull();
    expect(s!.flux.length).toBe(want.length);
    s!.flux.forEach((f, i) => expect(f).toBeCloseTo(want[i], 9));
    expect(s!.err[0]).toBe(idx.bands.find((b) => b.band === s!.band[0])!.noise);
    expect(s!.wl[0]).toBe(idx.bands.find((b) => b.band === s!.band[0])!.wavelength_um);
    // second pixel in the same tile: no new fetch (cache)
    await loadSpectrumAt(withCube, 71, 46, fetcher);
    expect(urls).toHaveLength(2);
  });

  it("is null outside the cube or when the spot has no cube", async () => {
    const urls: string[] = [];
    const fetcher = diskFetch(urls);
    expect(await loadSpectrumAt(withCube, -1, 5, fetcher)).toBeNull();
    expect(await loadSpectrumAt(withCube, 5, 119, fetcher)).toBeNull();
    expect(await loadSpectrumAt({ ...withCube, has: { spectrum: false } }, 5, 5, fetcher)).toBeNull();
    expect(urls.filter((u) => u.endsWith(".u16"))).toEqual([]);
  });

  it("is null for a covered-but-empty pixel", async () => {
    // Serve a tile made only of 65535
    const fake = (async (url: string) => {
      if (url.endsWith("index.json")) return new Response(JSON.stringify(idx));
      return new Response(new Uint16Array(idx.bands.length * 32 * 32).fill(65535).buffer);
    }) as unknown as typeof fetch;
    expect(await loadSpectrumAt(withCube, 10, 10, fake)).toBeNull();
  });

  it("a bright star's cube spectrum has no spurious features", async () => {
    const s = await loadSpectrumAt(withCube, 32, 28, diskFetch([]));
    expect(s).not.toBeNull();
    console.log("star (32,28) cube: bands", s!.wl.length, "features", JSON.stringify(findFeatures(s!)));
    expect(findFeatures(s!)).toEqual([]);
  });
});

describe("lightCurveAt on real Eros frames", () => {
  const buf = readFileSync(join(EROS, "frames.u16"));
  const frames = decodeFrames(field, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const W = field.size[0];
  const answer = readJson<{ objects: { positions: { frame: number; x: number; y: number }[] }[] }>(join(WEB, "data/answers/eros.json"));

  it("says 'changed' at Eros's frame-1 position, in frame 1", () => {
    const p = answer.objects[0].positions[0];
    const lc = lightCurveAt(frames, p.x, p.y, W);
    console.log("Eros f1 light curve", lc.snr.map((v) => v.toFixed(1)), lc.verdict, lc.frame, lc.sigma?.toFixed(0));
    expect(lc.verdict).toBe("changed");
    expect(lc.frame).toBe(1);
    expect(lc.snr[0]).toBeCloseTo(721.2, 0); // answer-key snr is the same 3x3 max
  });
  it("says 'steady' on a bright star", () => {
    const lc = lightCurveAt(frames, 32, 28, W);
    console.log("star (32,28) light curve", lc.snr.map((v) => v.toFixed(0)), lc.verdict, lc.sigma?.toFixed(2));
    expect(lc.verdict).toBe("steady");
  });
  it("says 'faint' on empty sky", () => {
    // find a pixel whose 3x3 max is under 5 in all frames
    let found = false;
    for (let y = 5; y < 115 && !found; y += 7)
      for (let x = 5; x < 115 && !found; x += 7) {
        const lc = lightCurveAt(frames, x, y, W);
        if (lc.snr.every((v) => v < 5)) {
          expect(lc.verdict).toBe("faint");
          found = true;
        }
      }
    expect(found).toBe(true);
  });
});
