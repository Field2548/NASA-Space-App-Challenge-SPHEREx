// Small synthetic spot for component tests (not shipped data).
import { vi } from "vitest";
import type { Field } from "@/lib/types";

export function makeField(over: Partial<Field> = {}, n = 3, w = 20, h = 10): Field {
  return {
    slug: "test",
    title: "Test spot",
    kind: "fixture",
    difficulty: "easy",
    ra: 133.795,
    dec: -7.245,
    fov_deg: 0.1,
    pixel_arcsec: 6.15,
    size: [w, h],
    wcs: { ctype: ["RA---TAN", "DEC--TAN"], crval: [133.795, -7.245], crpix: [w / 2 + 0.5, h / 2 + 0.5], cdelt: [-6.15 / 3600, 6.15 / 3600], rows: "top-down" },
    frames: Array.from({ length: n }, (_, k) => ({
      i: k + 1,
      mjd: 61000 + k * 0.88,
      utc: `2026-01-0${6 + k}T00:47:12.500Z`,
      hours_since_prev: k === 0 ? 0 : 21.1,
      n_bands: 8,
      detectors: [1, 2],
    })),
    data: { format: "u16", file: "frames.u16", scale: 0.01, offset: -10, units: "S/N", precision: "float", nodata: 65535 },
    thumbs: [],
    stretch: { black_sigma: -1, soft_sigma: 2, white: 9 },
    psf_fwhm_px: 1.5,
    ...over,
  };
}

export function makeFrames(field: Field): Float32Array[] {
  const [w, h] = field.size;
  return field.frames.map((_, k) => {
    const f = new Float32Array(w * h).fill(0);
    f[3 * w + 7] = 5 + k; // S/N at x 7, y 3
    f[0] = Number.NaN;
    return f;
  });
}

/** jsdom has no 2D canvas or ImageData: install fakes, return the context spies. */
export function mockCanvas() {
  if (typeof globalThis.ImageData === "undefined") {
    class FakeImageData {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {}
    }
    vi.stubGlobal("ImageData", FakeImageData);
  }
  const ctx = {
    imageSmoothingEnabled: true,
    fillStyle: "",
    putImageData: vi.fn(),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    clearRect: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ctx) as never);
  return ctx;
}
