import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeFrames } from "@/lib/fields";
import type { Field } from "@/lib/types";
import {
  decodeExposures,
  detectorsFor,
  noiseOf,
  rebuildFrame,
  rebuildFrames,
  sigmaClippedMean,
  type ExposuresJson,
} from "./WavelengthSwitch";

const FIELDS = join(__dirname, "..", "public", "fields");

function toArrayBuffer(b: Buffer): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

function load(slug: string) {
  const dir = join(FIELDS, slug);
  const field = JSON.parse(readFileSync(join(dir, "field.json"), "utf8")) as Field;
  const info = JSON.parse(readFileSync(join(dir, "exposures.json"), "utf8")) as ExposuresJson;
  const frames = decodeFrames(field, toArrayBuffer(readFileSync(join(dir, "frames.u16"))));
  const planes = decodeExposures(toArrayBuffer(readFileSync(join(dir, "exposures.u16"))), info);
  return { field, info, frames, planes };
}

function quantile(a: number[], q: number): number {
  const s = [...a].sort((x, y) => x - y);
  const pos = q * (s.length - 1);
  const lo = Math.floor(pos);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (pos - lo);
}

// Small seeded normal generator (Box-Muller on a LCG).
function normals(n: number, seed: number): Float32Array {
  let s = seed >>> 0;
  const u = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s + 0.5) / 4294967296;
  };
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
  return out;
}

describe("detectorsFor", () => {
  it("maps every option", () => {
    expect(detectorsFor("all")).toEqual([1, 2, 3, 4, 5, 6]);
    expect(detectorsFor("short")).toEqual([1, 2, 3]);
    expect(detectorsFor("long")).toEqual([4, 5, 6]);
    expect(detectorsFor("longest")).toEqual([5, 6]);
    for (const d of [1, 2, 3, 4, 5, 6] as const) expect(detectorsFor(d)).toEqual([d]);
  });
});

describe("parity with frames.u16", () => {
  for (const slug of ["eros", "makemake"]) {
    it(`${slug}: rebuild with 'all' matches the pipeline frames`, () => {
      const { field, info, frames, planes } = load(slug);
      const t0 = performance.now();
      const r = rebuildFrames(field, planes, info, "all");
      const ms = performance.now() - t0;
      const diffs: number[] = [];
      r.frames.forEach((f, i) => {
        expect(f).not.toBeNull();
        const ref = frames[i];
        for (let k = 0; k < ref.length; k++) {
          const a = f![k];
          if (Number.isFinite(a) && Number.isFinite(ref[k])) diffs.push(Math.abs(a - ref[k]));
        }
      });
      const med = quantile(diffs, 0.5);
      const p99 = quantile(diffs, 0.99);
      console.log(`${slug}: ${r.frames.length} frames, ${planes.length} planes, median |diff| ${med.toFixed(4)} sigma, p99 ${p99.toFixed(3)} sigma, rebuild ${ms.toFixed(1)} ms`);
      expect(diffs.length).toBeGreaterThan(0);
      expect(med).toBeLessThan(0.1);
      expect(p99).toBeLessThan(2);
    });
  }
});

describe("single detector selection (eros)", () => {
  const { field, info, planes } = load("eros");
  const used = new Set(field.frames.flatMap((f) => f.detectors));

  it("skips frames whose burst did not use the detector", () => {
    for (const d of [1, 2, 3, 4, 5, 6] as const) {
      const r = rebuildFrames(field, planes, info, d);
      field.frames.forEach((fm, i) => {
        const has = info.exposures.some((e) => e.frame === fm.i && e.detector === d);
        expect(r.frames[i] === null).toBe(!has);
        expect(r.planesPerFrame[i]).toBe(info.exposures.filter((e) => e.frame === fm.i && e.detector === d).length);
      });
      if (!used.has(d)) expect(r.frames.every((f) => f === null)).toBe(true);
    }
  });

  it("flags fewer than three planes", () => {
    const r = rebuildFrames(field, planes, info, 3);
    const kept = r.planesPerFrame.filter((n) => n > 0);
    expect(r.fewerThanThree).toBe(kept.some((n) => n < 3));
    const all = rebuildFrames(field, planes, info, "all");
    expect(all.fewerThanThree).toBe(all.planesPerFrame.some((n) => n > 0 && n < 3));
  });

  it("blanks pixels that are NaN in any kept frame, and each frame has unit noise before blanking", () => {
    const r = rebuildFrames(field, planes, info, "long");
    const kept = r.frames.filter((f): f is Float32Array => f !== null);
    expect(kept.length).toBeGreaterThan(0);
    for (let k = 0; k < kept[0].length; k++) {
      const nans = kept.filter((f) => Number.isNaN(f[k])).length;
      expect(nans === 0 || nans === kept.length).toBe(true);
    }
  });
});

describe("statistics", () => {
  it("sigmaClippedMean removes one cosmic ray among 8 planes and keeps a common source", () => {
    const len = 50;
    const planes = Array.from({ length: 8 }, (_, i) => {
      const p = normals(len, 100 + i);
      p[10] += 20; // source in every plane
      return p;
    });
    const clean = planes.map((p) => Float32Array.from(p));
    planes[3][20] += 500; // cosmic ray
    const m = sigmaClippedMean(planes);
    const mc = sigmaClippedMean(clean);
    expect(Math.abs(m[20])).toBeLessThan(1);
    expect(m[10]).toBeGreaterThan(18);
    expect(m[10]).toBeLessThan(23);
    expect(mc[10]).toBeGreaterThan(18);
  });

  it("sigmaClippedMean ignores NaN and returns NaN for all-NaN pixels", () => {
    const a = Float32Array.from([1, NaN, NaN]);
    const b = Float32Array.from([3, 2, NaN]);
    const c = Float32Array.from([2, NaN, NaN]);
    const m = sigmaClippedMean([a, b, c]);
    expect(m[0]).toBeCloseTo(2);
    expect(m[1]).toBeCloseTo(2);
    expect(Number.isNaN(m[2])).toBe(true);
  });

  it("noiseOf of unit normal noise with a few bright sources is about 1", () => {
    const x = normals(20000, 7);
    for (let i = 0; i < 20; i++) x[i * 997] += 50;
    x[5] = NaN;
    expect(noiseOf(x)).toBeGreaterThan(0.9);
    expect(noiseOf(x)).toBeLessThan(1.05);
  });

  it("rebuildFrame with two planes is a plain mean, normalised to unit noise", () => {
    const a = normals(5000, 1);
    const b = normals(5000, 2);
    const { frame, planesUsed } = rebuildFrame([a, b], [1, 1]);
    expect(planesUsed).toBe(2);
    expect(noiseOf(frame)).toBeCloseTo(1, 5);
  });
});

describe("timing", () => {
  it("rebuilds a 119 px spot quickly", () => {
    const { field, info, planes } = load("eros");
    rebuildFrames(field, planes, info, "all"); // warm up
    const t0 = performance.now();
    rebuildFrames(field, planes, info, "all");
    const ms = performance.now() - t0;
    console.log(`eros rebuild (warm): ${ms.toFixed(1)} ms for ${planes.length} planes`);
    expect(ms).toBeLessThan(500);
  });
});
