import { describe, expect, it } from "vitest";
import { decodeFrames, loadField, loadFrames } from "./fields";
import type { Field } from "./types";

const meta = (n: number, w: number, h: number) =>
  ({
    slug: "t",
    size: [w, h],
    frames: Array.from({ length: n }, (_, i) => ({ i: i + 1, mjd: 0, utc: "", hours_since_prev: 0, n_bands: 8, detectors: [] })),
    data: { format: "u16", file: "frames.u16", scale: 0.01, offset: -10, units: "S/N", precision: "float", nodata: 65535 },
  }) as unknown as Field;

function u16le(values: number[]): ArrayBuffer {
  const buf = new ArrayBuffer(values.length * 2);
  const v = new DataView(buf);
  values.forEach((x, i) => v.setUint16(i * 2, x, true));
  return buf;
}

describe("decodeFrames", () => {
  it("splits N x H x W planes, applies scale/offset, maps nodata to NaN", () => {
    // 2 frames of 3 wide x 2 tall
    const frames = decodeFrames(meta(2, 3, 2), u16le([1000, 1100, 0, 65535, 2000, 1, 3000, 3000, 3000, 3000, 3000, 65535]));
    expect(frames).toHaveLength(2);
    expect(frames[0][0]).toBeCloseTo(0, 5); // 1000*0.01-10
    expect(frames[0][1]).toBeCloseTo(1, 5);
    expect(frames[0][2]).toBeCloseTo(-10, 5);
    expect(frames[0][3]).toBeNaN();
    expect(frames[0][4]).toBeCloseTo(10, 5);
    expect(frames[1][0]).toBeCloseTo(20, 5);
    expect(frames[1][5]).toBeNaN();
  });

  it("reads little-endian regardless of byte pattern", () => {
    const buf = new Uint8Array([0x34, 0x12]).buffer; // 0x1234 = 4660
    expect(decodeFrames(meta(1, 1, 1), buf)[0][0]).toBeCloseTo(4660 * 0.01 - 10, 4);
  });

  it("rejects a file of the wrong size", () => {
    expect(() => decodeFrames(meta(2, 3, 2), u16le([1, 2, 3]))).toThrow(/expected 24/);
  });
});

describe("loaders", () => {
  it("fetch field.json and frames.u16 under the base path", async () => {
    const urls: string[] = [];
    const fake = (async (url: string) => {
      urls.push(url);
      if (url.endsWith("field.json")) return new Response(JSON.stringify(meta(1, 1, 1)));
      return new Response(u16le([1000]));
    }) as unknown as typeof fetch;
    const field = await loadField("t", fake);
    const frames = await loadFrames(field, fake);
    expect(urls).toEqual(["/fields/t/field.json", "/fields/t/frames.u16"]);
    expect(frames[0][0]).toBeCloseTo(0, 5);
  });

  it("surfaces HTTP errors", async () => {
    const fake = (async () => new Response("no", { status: 404 })) as unknown as typeof fetch;
    await expect(loadField("missing", fake)).rejects.toThrow(/404/);
  });
});
