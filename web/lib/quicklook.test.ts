// Quick look: burst grouping vs motion_frames.group_bursts on the real Eros list, the planner's
// budget and detector filter, and a full runQuickLook over synthetic FITS files served through an
// injected Range fetch (no network).

import { beforeEach, describe, expect, it } from "vitest";
import type { FetchLike, RangeResponse } from "./fits";
import {
  DEFAULT_GRID_PX,
  QUICKLOOK_LABEL,
  bilinear,
  clearQuickLookCache,
  combineBurst,
  estimateExposureBytes,
  groupBursts,
  mjdToUtc,
  pickBurstIndices,
  planQuickLook,
  rebuildFrames,
  runQuickLook,
  uniqueImages,
  type QuickLookExposure,
  type QuickLookPlan,
} from "./quicklook";
import { sipWorldToPixel } from "./sipwcs";
import ref from "./testdata/quicklook_ref.json";

// ---------------------------------------------------------------- helpers

function exposure(over: Partial<QuickLookExposure> & { mjd: number; detector: number }): QuickLookExposure {
  return {
    obs_id: `obs${over.mjd}`,
    utc: mjdToUtc(over.mjd),
    path: "k",
    url: `https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/f${over.mjd}_${over.detector}.fits`,
    access_url: "https://irsa.ipac.caltech.edu/x.fits",
    source: "s3",
    collection: "spherex_dr1",
    mjd_end: null,
    est_size_bytes: null,
    naxis1: 2040,
    naxis2: 2040,
    covers_field: true,
    burst: 0,
    ...over,
  };
}

/** n bursts of 4 exposures (2 min apart, detectors cycling 1..6), bursts `hours` apart. */
function fakeList(n: number, hours: number): QuickLookExposure[] {
  const out: QuickLookExposure[] = [];
  for (let b = 0; b < n; b++) {
    for (let k = 0; k < 4; k++) {
      out.push(exposure({ mjd: 61000 + (b * hours) / 24 + (k * 2) / 1440, detector: ((b * 4 + k) % 6) + 1, burst: b }));
    }
  }
  return out;
}

// ---------------------------------------------------------------- grouping (real Eros list)

describe("uniqueImages + groupBursts vs Python on the real Eros SIA list", () => {
  it("gives exactly motion_frames.group_bursts(unique_images(...), 15)", () => {
    const rows = ref.rows as { obs_id: string; detector: number; collection: string; t_min: number }[];
    const unique = uniqueImages(rows).map((r) => ({ ...r, mjd: r.t_min }));
    expect(unique.length).toBe(ref.unique_count);
    const bursts = groupBursts(unique, ref.gap_min).map((b) => b.map((r) => `${r.obs_id}|${r.detector}`));
    expect(bursts).toEqual(ref.bursts);
  });

  it("prefers DR1 over QR3 for the same exposure and detector", () => {
    const rows = [
      { obs_id: "a", detector: 1, collection: "spherex_qr3", t_min: 1 },
      { obs_id: "a", detector: 1, collection: "spherex_dr1", t_min: 1 },
      { obs_id: "a", detector: 4, collection: "spherex_qr3", t_min: 1 },
    ];
    expect(uniqueImages(rows).map((r) => r.collection)).toEqual(["spherex_dr1", "spherex_qr3"]);
  });
});

// ---------------------------------------------------------------- planning

describe("planQuickLook", () => {
  const list = fakeList(12, 6);

  it("respects the detector filter and takes 3-4 exposures per burst", () => {
    const plan = planQuickLook(list, { ra: 10, dec: 20, frames: 4, spacing: "even", minGapHours: 6, detectors: [2, 5] });
    expect(plan.exposures.length).toBeGreaterThan(0);
    expect(plan.exposures.every((e) => e.detector === 2 || e.detector === 5)).toBe(true);
    const all = planQuickLook(list, { ra: 10, dec: 20, frames: 4, spacing: "even", minGapHours: 6, detectors: [] });
    expect(all.bursts.length).toBe(4);
    for (const b of all.bursts) expect(b.length === 3 || b.length === 4).toBe(true);
  });

  it("stays under a byte budget, and its estimate is the sum per exposure", () => {
    const free = planQuickLook(list, { ra: 10, dec: 20, frames: 6, spacing: "even", minGapHours: 6, detectors: [] });
    expect(free.bytes).toBe(free.exposures.reduce((s, e) => s + estimateExposureBytes(e, DEFAULT_GRID_PX), 0));
    for (const budget of [2e6, 5e6, 8e6]) {
      const p = planQuickLook(list, { ra: 10, dec: 20, frames: 6, spacing: "even", minGapHours: 6, detectors: [], maxBytes: budget });
      expect(p.bytes).toBeLessThanOrEqual(budget);
      expect(p.exposures.length).toBeGreaterThan(0);
      expect(p.notes.join(" ")).toMatch(/Trimmed/);
    }
    // 41 px grid on a 2040-px-wide image: 49152 + 61 rows * 2040 * 4 bytes.
    expect(estimateExposureBytes({ naxis1: 2040, naxis2: 2040 })).toBe(49152 + 61 * 2040 * 4);
  });

  it("skips exposures the browser cannot read (no S3 copy) unless a proxy is used", () => {
    const l = list.map((e) => (e.detector === 1 ? { ...e, url: null, source: "irsa" as const } : e));
    const p = planQuickLook(l, { ra: 10, dec: 20, frames: 3, spacing: "even", minGapHours: 0, detectors: [] });
    expect(p.exposures.some((e) => e.url === null)).toBe(false);
  });

  it("pickBurstIndices: even and growing spacing snap to real bursts, minimum gap held", () => {
    const t = Array.from({ length: 40 }, (_, k) => 61000 + k * 0.25); // every 6 h
    expect(pickBurstIndices(t, { count: 4, spacing: "even", minGapHours: 12 })).toEqual([0, 2, 4, 6]);
    expect(pickBurstIndices(t, { count: 4, spacing: "growing", minGapHours: 6 })).toEqual([0, 1, 3, 7]);
    expect(pickBurstIndices(t, { count: 3, spacing: "even", minGapHours: 0 })).toEqual([0, 1, 2]);
    expect(pickBurstIndices(t.slice(0, 3), { count: 5, spacing: "even", minGapHours: 6 })).toEqual([0, 1, 2]);
  });
});

// ---------------------------------------------------------------- math helpers

describe("combineBurst and bilinear", () => {
  it("clips a cosmic-ray hit present in one of 4 planes", () => {
    const planes = [0, 1, 2, 3].map(() => Float32Array.from({ length: 400 }, (_, k) => Math.sin(k * 1.7) * 1.0));
    planes[2][5] = 500;
    const f = combineBurst(planes);
    expect(Math.abs(f[5])).toBeLessThan(5);
  });
  it("uses a plain mean below 3 planes", () => {
    const a = Float32Array.from({ length: 100 }, (_, k) => Math.cos(k));
    const b = Float32Array.from({ length: 100 }, (_, k) => Math.cos(k));
    b[3] = 100;
    expect(combineBurst([a, b])[3]).toBeGreaterThan(5);
  });
  it("bilinear interpolates and is NaN outside", () => {
    const rows = Float32Array.from([0, 1, 2, 3]); // 2 x 2
    expect(bilinear(rows, 2, 10, 2, 0.5, 10.5)).toBeCloseTo(1.5, 6);
    expect(Number.isNaN(bilinear(rows, 2, 10, 2, 1.01, 10))).toBe(true);
    expect(Number.isNaN(bilinear(rows, 2, 10, 2, 0, 9.9))).toBe(true);
  });
});

// ---------------------------------------------------------------- end to end on synthetic files

const BLOCK = 2880;
function card(key: string, value: string): string {
  return `${key.padEnd(8)}= ${value.padStart(20)}`.padEnd(80).slice(0, 80);
}
function headerBytes(cards: string[]): Uint8Array {
  const text = [...cards, "END".padEnd(80)].join("");
  const out = new Uint8Array(Math.ceil(text.length / BLOCK) * BLOCK).fill(0x20);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
}
function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.byteLength, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}

const RA = 13.2004;
const DEC = 14.38;
const W = 300;

/** A SPHEREx-like file: PRIMARY + IMAGE (rotated TAN with SIP terms), a star at (RA, DEC), noise. */
function makeExposure(rotDeg: number, seed: number, mjd: number, extraStar = false): Uint8Array {
  const s = 6.15 / 3600;
  const r = (rotDeg * Math.PI) / 180;
  const hdrCards = [
    card("XTENSION", "'IMAGE   '"),
    card("BITPIX", "-32"),
    card("NAXIS", "2"),
    card("NAXIS1", String(W)),
    card("NAXIS2", String(W)),
    card("PCOUNT", "0"),
    card("GCOUNT", "1"),
    card("EXTNAME", "'IMAGE   '"),
    card("CTYPE1", "'RA---TAN'"), // no -SIP suffix on purpose, like older SPHEREx headers
    card("CTYPE2", "'DEC--TAN'"),
    card("CRPIX1", "140.5"),
    card("CRPIX2", "160.5"),
    card("CRVAL1", String(RA + 0.02)),
    card("CRVAL2", String(DEC - 0.03)),
    card("CD1_1", String(-s * Math.cos(r))),
    card("CD1_2", String(s * Math.sin(r))),
    card("CD2_1", String(s * Math.sin(r))),
    card("CD2_2", String(s * Math.cos(r))),
    card("A_ORDER", "2"),
    card("A_0_0", "-0.4"),
    card("A_2_0", "2.0E-6"),
    card("B_ORDER", "2"),
    card("B_0_0", "0.7"),
    card("B_0_2", "-3.0E-6"),
    card("MJD-OBS", String(mjd)),
    card("PSF_FWHM", "9.0"),
  ];
  const header = headerBytes(hdrCards);
  // Parse back our own cards for the star position (same code path the run uses).
  const h: Record<string, number | string> = {
    CTYPE1: "RA---TAN", CTYPE2: "DEC--TAN", CRPIX1: 140.5, CRPIX2: 160.5, CRVAL1: RA + 0.02, CRVAL2: DEC - 0.03,
    CD1_1: -s * Math.cos(r), CD1_2: s * Math.sin(r), CD2_1: s * Math.sin(r), CD2_2: s * Math.cos(r),
    A_ORDER: 2, A_0_0: -0.4, A_2_0: 2e-6, B_ORDER: 2, B_0_0: 0.7, B_0_2: -3e-6,
  };
  const star = sipWorldToPixel(h, RA, DEC);
  const data = new Uint8Array(W * W * 4);
  const dv = new DataView(data.buffer);
  let st = seed;
  const rnd = () => ((st = (st * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const noise = (rnd() + rnd() + rnd() - 1.5) * 0.2;
      const d2 = (x - star.x) ** 2 + (y - star.y) ** 2;
      let v = 3 + noise + 40 * Math.exp(-d2 / (2 * 0.8 ** 2));
      if (extraStar && x === Math.round(star.x) + 5 && y === Math.round(star.y)) v += 300; // "cosmic ray"
      dv.setFloat32((y * W + x) * 4, v, false);
    }
  }
  const primary = headerBytes([card("SIMPLE", "T"), card("BITPIX", "8"), card("NAXIS", "0"), card("EXTEND", "T")]);
  const pad = new Uint8Array(Math.ceil(data.byteLength / BLOCK) * BLOCK);
  pad.set(data);
  return concat([primary, header, pad]);
}

function serve(files: Map<string, Uint8Array>, stats: { inFlight: number; maxInFlight: number; bytes: number; calls: number }, delayMs = 2): FetchLike {
  return async (url, init) => {
    const file = files.get(url);
    if (!file) throw new Error(`no file ${url}`);
    const m = /^bytes=(\d+)-(\d+)$/.exec(init?.headers?.Range ?? "");
    if (!m) throw new Error("Range required");
    stats.inFlight++;
    stats.calls++;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    try {
      await new Promise((r) => setTimeout(r, delayMs));
      if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
      const a = Number(m[1]);
      const b = Number(m[2]);
      const res: RangeResponse = a >= file.byteLength
        ? { status: 416, ok: false, arrayBuffer: async () => new ArrayBuffer(0) }
        : { status: 206, ok: true, arrayBuffer: async () => file.slice(a, Math.min(b + 1, file.byteLength)).buffer as ArrayBuffer };
      stats.bytes += Math.max(0, Math.min(b + 1, file.byteLength) - a);
      return res;
    } finally {
      stats.inFlight--;
    }
  };
}

function syntheticPlan(): { plan: QuickLookPlan; files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  const list: QuickLookExposure[] = [];
  const rots = [0, 25, 50, 80, 110, 140, 170, 200];
  rots.forEach((rot, k) => {
    const burst = k < 4 ? 0 : 1;
    const mjd = 61000 + burst * 0.5 + (k % 4) * (2 / 1440);
    const e = exposure({ mjd, detector: (k % 6) + 1, naxis1: W, naxis2: W, burst });
    files.set(e.url as string, makeExposure(rot, 17 + k, mjd, k === 1));
    list.push(e);
  });
  const plan = planQuickLook(list, { ra: RA, dec: DEC, frames: 2, spacing: "even", minGapHours: 6, detectors: [] });
  return { plan, files };
}

describe("runQuickLook on synthetic exposures", () => {
  beforeEach(() => clearQuickLookCache());

  it("puts the star in the centre pixel, clips the cosmic ray, reads only the needed rows, <= 4 at a time", async () => {
    const { plan, files } = syntheticPlan();
    expect(plan.bursts.length).toBe(2);
    expect(plan.exposures.length).toBe(8);
    const stats = { inFlight: 0, maxInFlight: 0, bytes: 0, calls: 0 };
    const progress: number[] = [];
    const field = await runQuickLook(plan, (p) => progress.push(p), new AbortController().signal, { fetch: serve(files, stats) });
    expect(field.kind).toBe("quicklook");
    expect(field.label).toBe(QUICKLOOK_LABEL);
    expect(field.size).toEqual([41, 41]);
    expect(field.wcs.crpix).toEqual([21, 21]);
    expect(field.frames.map((f) => f.i)).toEqual([1, 2]);
    expect(field.frames[0].n_bands).toBe(4);
    expect(field.frames[1].hours_since_prev).toBeCloseTo(12, 1);
    expect(field.exposures.every((e) => !e.skipped)).toBe(true);
    for (const plane of field.planes) {
      let best = -Infinity;
      let at = -1;
      plane.forEach((v, k) => {
        if (v > best) {
          best = v;
          at = k;
        }
      });
      expect([at % 41, Math.floor(at / 41)]).toEqual([20, 20]); // target = centre pixel (x, y), rows top-down
      expect(best).toBeGreaterThan(20);
    }
    // The "cosmic ray" 5 px east of the star in one exposure of burst 1: east is LEFT on our grid.
    const f1 = field.planes[0];
    expect(Math.abs(f1[20 * 41 + 15])).toBeLessThan(5);
    expect(stats.maxInFlight).toBeLessThanOrEqual(4);
    // Header (49152) + about 60 rows of 1200 bytes per file, far less than the whole 360 KB image.
    expect(stats.bytes).toBeLessThan(8 * (49152 + 70 * W * 4));
    expect(field.bytesDownloaded).toBeLessThanOrEqual(plan.bytes);
    expect(progress[progress.length - 1]).toBe(1);
    expect(field.psf_fwhm_px).toBeCloseTo(Math.hypot(9 / 6.15, 1), 2);
    expect(field.stretch.black_sigma).toBe(-1);

    // Second run over the same plan: everything comes from the in-memory cache.
    const before = stats.calls;
    await runQuickLook(plan, () => {}, new AbortController().signal, { fetch: serve(files, stats) });
    expect(stats.calls).toBe(before);

    // Wavelength switch: frames rebuilt from the per-exposure planes for one detector set.
    const only = rebuildFrames(field, plan, [1, 2]);
    expect(only.frames.every((f) => f.detectors.every((d) => d === 1 || d === 2))).toBe(true);
  });

  it("rewriteUrl sends every read through a proxy", async () => {
    const { plan, files } = syntheticPlan();
    const proxied = new Map<string, Uint8Array>();
    for (const [u, b] of files) proxied.set(`/api/s3range?url=${encodeURIComponent(u)}`, b);
    const stats = { inFlight: 0, maxInFlight: 0, bytes: 0, calls: 0 };
    const field = await runQuickLook(plan, () => {}, new AbortController().signal, {
      fetch: serve(proxied, stats),
      rewriteUrl: (u) => `/api/s3range?url=${encodeURIComponent(u)}`,
    });
    expect(field.frames.length).toBe(2);
  });

  it("cancels cleanly with an AbortError", async () => {
    const { plan, files } = syntheticPlan();
    const ac = new AbortController();
    const stats = { inFlight: 0, maxInFlight: 0, bytes: 0, calls: 0 };
    const run = runQuickLook(plan, () => {}, ac.signal, { fetch: serve(files, stats, 20) });
    setTimeout(() => ac.abort(), 5);
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(stats.calls).toBeLessThanOrEqual(4);
  });

  it("a run started right after cancelling another over the same files is not cancelled too", async () => {
    // The worker aborts the old run and starts the new one in the same tick (settings changed).
    // The new run must not pick up the old run's in-flight (soon aborted) cached reads.
    const { plan, files } = syntheticPlan();
    const stats = { inFlight: 0, maxInFlight: 0, bytes: 0, calls: 0 };
    const ac = new AbortController();
    const first = runQuickLook(plan, () => {}, ac.signal, { fetch: serve(files, stats, 20) });
    first.catch(() => {});
    await new Promise((r) => setTimeout(r, 5)); // first run's header reads are in flight
    ac.abort();
    const second = await runQuickLook(plan, () => {}, new AbortController().signal, { fetch: serve(files, stats) });
    expect(second.frames.length).toBe(2);
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    // The first run's late rejections must not evict the second run's cache entries.
    const before = stats.calls;
    await runQuickLook(plan, () => {}, new AbortController().signal, { fetch: serve(files, stats) });
    expect(stats.calls).toBe(before);
  });

  it("skips an unreadable exposure and fails only when nothing is left", async () => {
    const { plan, files } = syntheticPlan();
    const broken = new Map(files);
    broken.delete(plan.exposures[0].url as string);
    const stats = { inFlight: 0, maxInFlight: 0, bytes: 0, calls: 0 };
    const field = await runQuickLook(plan, () => {}, new AbortController().signal, { fetch: serve(broken, stats) });
    expect(field.exposures[0].skipped).toMatch(/no file/);
    expect(field.frames[0].n_bands).toBe(3);
    clearQuickLookCache();
    await expect(
      runQuickLook(plan, () => {}, new AbortController().signal, { fetch: serve(new Map(), stats) }),
    ).rejects.toThrow(/No exposure could be read/);
  });
});
