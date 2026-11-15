// Contract test over every real spot in public/fields/index.json plus the fixture (field-schema.md).
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeFrames } from "./fields";
import { sharedWhite } from "./imaging";
import type { Field, FieldSummary } from "./types";
import { pixelToSky } from "./wcs";

const FIELDS = join(process.cwd(), "public", "fields");
const index = JSON.parse(readFileSync(join(FIELDS, "index.json"), "utf8")) as FieldSummary[];
const slugs = [...new Set([...index.map((s) => s.slug), "fixture"])];

const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const isPair = (v: unknown, type: (x: unknown) => boolean) => Array.isArray(v) && v.length === 2 && v.every(type);
const isStr = (v: unknown) => typeof v === "string";

/** Angular separation in degrees (small-angle safe haversine). */
function sep(a: [number, number], b: [number, number]): number {
  const r = Math.PI / 180;
  const h =
    Math.sin(((b[1] - a[1]) * r) / 2) ** 2 +
    Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(((b[0] - a[0]) * r) / 2) ** 2;
  return (2 * Math.asin(Math.sqrt(h))) / r;
}

describe.each(slugs)("real spot %s", (slug) => {
  const dir = join(FIELDS, slug);
  const field = JSON.parse(readFileSync(join(dir, "field.json"), "utf8")) as Field;
  const bytes = readFileSync(join(dir, field.data?.file ?? "frames.u16"));
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const [W, H] = field.size;
  const N = field.frames.length;

  it("is listed in the index with matching summary fields (fixture excepted)", () => {
    const row = index.find((s) => s.slug === slug);
    if (!row) return expect(slug).toBe("fixture");
    for (const k of ["title", "ra", "dec", "fov_deg", "difficulty", "kind"] as const) expect(row[k]).toEqual(field[k]);
    expect(existsSync(join(FIELDS, row.thumbnail))).toBe(true);
  });

  it("field.json has every Field key with the right type", () => {
    expect(field.slug).toBe(slug);
    for (const k of ["slug", "title", "kind", "difficulty"] as const) expect(isStr(field[k]), k).toBe(true);
    for (const k of ["ra", "dec", "fov_deg", "pixel_arcsec", "psf_fwhm_px"] as const) expect(isNum(field[k]), k).toBe(true);
    expect(isPair(field.size, (x) => Number.isInteger(x) && (x as number) > 0)).toBe(true);
    expect(field.wcs.ctype).toEqual(["RA---TAN", "DEC--TAN"]);
    expect(isPair(field.wcs.crval, isNum) && isPair(field.wcs.crpix, isNum) && isPair(field.wcs.cdelt, isNum)).toBe(true);
    expect(field.wcs.rows).toBe("top-down");
    expect(Array.isArray(field.frames) && field.frames.length > 0).toBe(true);
    for (const f of field.frames) {
      for (const k of ["i", "mjd", "hours_since_prev", "n_bands"] as const) expect(isNum(f[k]), `frames.${k}`).toBe(true);
      expect(isStr(f.utc)).toBe(true);
      expect(Array.isArray(f.detectors) && f.detectors.every(isNum)).toBe(true);
    }
    const d = field.data;
    expect(d.format).toBe("u16");
    expect(isStr(d.file)).toBe(true);
    expect(isNum(d.scale) && isNum(d.offset)).toBe(true);
    expect(d.units).toBe("S/N");
    expect(["float", "png8"]).toContain(d.precision);
    expect(d.nodata).toBe(65535);
    expect(Array.isArray(field.thumbs) && field.thumbs.every(isStr)).toBe(true);
    const s = field.stretch;
    expect(isNum(s.black_sigma) && isNum(s.soft_sigma) && isNum(s.white)).toBe(true);
    if (field.has !== undefined) for (const v of Object.values(field.has)) expect(typeof v).toBe("boolean");
  });

  it("frames.u16 is 2*N*H*W bytes and decodes", () => {
    expect(statSync(join(dir, field.data.file)).size).toBe(2 * N * H * W);
    const frames = decodeFrames(field, ab);
    expect(frames).toHaveLength(N);
    for (const f of frames) {
      expect(f).toHaveLength(W * H);
      expect(f.some((v) => Number.isFinite(v))).toBe(true);
    }
  });

  it("frames[].i are 1..N in time order", () => {
    expect(field.frames.map((f) => f.i)).toEqual(Array.from({ length: N }, (_, k) => k + 1));
    for (let k = 1; k < N; k++) expect(field.frames[k].mjd).toBeGreaterThan(field.frames[k - 1].mjd);
    expect(field.frames[0].hours_since_prev).toBe(0);
  });

  it("WCS: reference pixel maps to crval, centre pixel to ra/dec within 0.5 px", () => {
    const ref = pixelToSky(field.wcs, H, field.wcs.crpix[0] - 1, H - field.wcs.crpix[1]);
    expect(ref[0]).toBeCloseTo(field.wcs.crval[0], 9);
    expect(ref[1]).toBeCloseTo(field.wcs.crval[1], 9);
    const c = pixelToSky(field.wcs, H, (W - 1) / 2, (H - 1) / 2);
    const errPx = (sep(c, [field.ra, field.dec]) * 3600) / field.pixel_arcsec;
    console.log(`SPOT ${slug} centre error ${errPx.toFixed(4)} px`);
    // Real spots are odd-sized and centred. The even-sized fixture keeps its reference at (15, 16)
    // (field-schema.md section 1), so its geometric centre is half a pixel on each axis away (0.707 px).
    expect(errPx).toBeLessThan(W % 2 === 1 && H % 2 === 1 ? 0.5 : 0.75);
  });

  it("thumbs: one per frame and each file exists", () => {
    expect(field.thumbs).toHaveLength(N);
    for (const t of field.thumbs) expect(existsSync(join(dir, t)), t).toBe(true);
  });

  it("stretch.white matches sharedWhite within 1% (float precision only)", () => {
    const w = sharedWhite(decodeFrames(field, ab), -1);
    const rel = (w - field.stretch.white) / field.stretch.white;
    console.log(
      `SPOT ${slug} precision ${field.data.precision} white measured ${w.toFixed(4)} stored ${field.stretch.white} rel ${(100 * rel).toFixed(3)}%`,
    );
    if (field.data.precision === "float") expect(Math.abs(rel)).toBeLessThan(0.01);
  });
});
