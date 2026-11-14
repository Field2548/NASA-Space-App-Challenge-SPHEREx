import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Field } from "./types";

// The BP 6.2 example field.json must satisfy the Field type (compile-time) and its documented invariants.
const example: Field = {
  slug: "eros",
  title: "(433) Eros",
  kind: "asteroid",
  difficulty: "easy",
  ra: 13.2004,
  dec: 14.38,
  fov_deg: 0.2,
  pixel_arcsec: 6.15,
  size: [119, 119],
  wcs: {
    ctype: ["RA---TAN", "DEC--TAN"],
    crval: [13.2004, 14.38],
    crpix: [60, 60],
    cdelt: [-0.0017083, 0.0017083],
    rows: "top-down",
  },
  frames: [{ i: 1, mjd: 0, utc: "2025-07-09T18:04:04", hours_since_prev: 0, n_bands: 8, detectors: [3, 6] }],
  data: { format: "u16", file: "frames.u16", scale: 0.01, offset: -10, units: "S/N", precision: "float", nodata: 65535 },
  thumbs: ["thumbs/1.webp"],
  stretch: { black_sigma: -1, soft_sigma: 2, white: 0 },
  psf_fwhm_px: 1.6,
};

describe("Field contract", () => {
  it("cdelt matches the pixel scale and RA increases to the left", () => {
    expect(Math.abs(example.wcs.cdelt[1]) * 3600).toBeCloseTo(example.pixel_arcsec, 1);
    expect(example.wcs.cdelt[0]).toBeLessThan(0);
  });

  it("every exported type is documented in docs/contracts/types.md", () => {
    const src = readFileSync(new URL("./types.ts", import.meta.url), "utf8");
    const doc = readFileSync(new URL("../../docs/contracts/types.md", import.meta.url), "utf8");
    const names = [...src.matchAll(/^export (?:type|interface) (\w+)/gm)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(10);
    for (const n of names) expect(doc, `${n} missing from types.md`).toContain(`\`${n}\``);
  });
});
