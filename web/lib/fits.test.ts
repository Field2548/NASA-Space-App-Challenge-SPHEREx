// FITS Range reader: a synthetic multi-HDU file built here, plus one real SPHEREx cutout checked
// against astropy (lib/testdata/sip_ref.json `block`, made by gen_sip_ref.py). No network.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BLOCK,
  decodeImageBytes,
  findHdu,
  parseCard,
  readHeaders,
  readRows,
  type FetchLike,
  type RangeResponse,
} from "./fits";
import ref from "./testdata/sip_ref.json";

// ---------------------------------------------------------------- a tiny FITS writer for tests

function card(key: string, value: string, comment = ""): string {
  const k = key.padEnd(8);
  const body = `${k}= ${value.padStart(20)}${comment ? ` / ${comment}` : ""}`;
  return body.padEnd(80).slice(0, 80);
}
const str = (s: string) => `'${s.replace(/'/g, "''").padEnd(8)}'`;
const raw = (text: string) => text.padEnd(80).slice(0, 80);

function headerBytes(cards: string[]): Uint8Array {
  const text = [...cards, raw("END")].join("");
  const len = Math.ceil(text.length / BLOCK) * BLOCK;
  const out = new Uint8Array(len).fill(0x20);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
}

function padData(bytes: Uint8Array): Uint8Array {
  const len = Math.ceil(bytes.byteLength / BLOCK) * BLOCK;
  const out = new Uint8Array(len); // data padding is zeros
  out.set(bytes);
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

type Writer = (dv: DataView, offset: number, v: number) => void;

function imageHdu(
  extname: string,
  bitpix: number,
  w: number,
  h: number,
  value: (x: number, y: number) => number,
  extra: string[] = [],
): Uint8Array {
  const size = Math.abs(bitpix) / 8;
  const data = new Uint8Array(w * h * size);
  const dv = new DataView(data.buffer);
  const write: Record<number, Writer> = {
    [-32]: (d, o, v) => d.setFloat32(o, v, false),
    [-64]: (d, o, v) => d.setFloat64(o, v, false),
    [16]: (d, o, v) => d.setInt16(o, v, false),
    [32]: (d, o, v) => d.setInt32(o, v, false),
    [8]: (d, o, v) => d.setUint8(o, v),
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) write[bitpix](dv, (y * w + x) * size, value(x, y));
  const hdr = headerBytes([
    card("XTENSION", str("IMAGE")),
    card("BITPIX", String(bitpix)),
    card("NAXIS", "2"),
    card("NAXIS1", String(w)),
    card("NAXIS2", String(h)),
    card("PCOUNT", "0"),
    card("GCOUNT", "1"),
    card("EXTNAME", str(extname)),
    ...extra,
  ]);
  return concat([hdr, padData(data)]);
}

// Values chosen so float32 holds them exactly.
const f32 = (x: number, y: number) => (y === 2 && x === 3 ? NaN : -100 + y * 16 + x * 0.25);
const i16 = (x: number, y: number) => (x === 0 && y === 0 ? -32768 : x * 100 - y * 7);
const f64 = (x: number, y: number) => x * 1e-3 + y * 1e3 + 0.125;
const i32 = (x: number, y: number) => (x + 1) * 1000000 + y;

function buildFile() {
  // Many filler cards so the primary header takes 3 blocks (tests multi-block headers).
  const filler = Array.from({ length: 80 }, (_, i) => card(`FILL${i}`, String(i)));
  const primary = headerBytes([
    card("SIMPLE", "T", "conforms to FITS standard"),
    card("BITPIX", "8"),
    card("NAXIS", "0"),
    card("EXTEND", "T"),
    card("ORIGIN", str("O'Brien lab"), "quote inside / and a slash"),
    card("LEADSP", "'  two leading'"),
    card("EMPTY", "''"),
    card("DEXP", "1.5D-3"),
    card("NEGINT", "-42"),
    card("FLAGF", "F"),
    raw("HIERARCH L2 N_HALO = 48518 / number of flagged transient halo pixels"),
    raw("COMMENT this is a comment card = not a value"),
    raw("HISTORY made by fits.test.ts"),
    card("NEGINT", "999", "duplicate: the first one wins"),
    ...filler,
  ]);
  const w = 7;
  const h = 5;
  const img = imageHdu("IMAGE", -32, w, h, f32);
  const ints = imageHdu("INTS", 16, w, h, i16, [card("BSCALE", "2.0"), card("BZERO", "100.0"), card("BLANK", "-32768")]);
  const dbl = imageHdu("DOUBLES", -64, 3, 4, f64);
  const longs = imageHdu("LONGS", 32, 4, 3, i32);
  // A tile-compressed image looks like a BINTABLE with ZIMAGE = T and a heap (PCOUNT).
  const comp = concat([
    headerBytes([
      card("XTENSION", str("BINTABLE")),
      card("BITPIX", "8"),
      card("NAXIS", "2"),
      card("NAXIS1", "8"),
      card("NAXIS2", "3"),
      card("PCOUNT", "100"),
      card("GCOUNT", "1"),
      card("TFIELDS", "1"),
      card("ZIMAGE", "T"),
      card("ZBITPIX", "-32"),
      card("EXTNAME", str("COMPRESSED")),
    ]),
    padData(new Uint8Array(8 * 3 + 100).fill(7)),
  ]);
  const parts = [primary, img, ints, dbl, longs, comp];
  const starts: number[] = [];
  let o = 0;
  for (const p of parts) {
    starts.push(o);
    o += p.byteLength;
  }
  return { bytes: concat(parts), starts, primaryHeaderLen: primary.byteLength, w, h };
}

/** A fetch that serves `bytes` like S3: 206 for a Range, short at the end, 416 past the end. */
function rangeFetch(bytes: Uint8Array, log: string[] = []): FetchLike {
  return async (_url, init) => {
    const r = init?.headers?.Range ?? "";
    log.push(r);
    const m = /^bytes=(\d+)-(\d+)$/.exec(r);
    if (!m) throw new Error(`test fetch needs a simple Range, got ${JSON.stringify(r)}`);
    const a = Number(m[1]);
    const b = Number(m[2]);
    const res = (status: number, body: Uint8Array): RangeResponse => ({
      status,
      ok: status >= 200 && status < 300,
      arrayBuffer: async () => body.slice().buffer as ArrayBuffer,
    });
    if (a >= bytes.byteLength) return res(416, new Uint8Array(0));
    return res(206, bytes.subarray(a, Math.min(b + 1, bytes.byteLength)));
  };
}

// ---------------------------------------------------------------- synthetic file

describe("parseCard", () => {
  it("parses strings, numbers, logicals and HIERARCH", () => {
    expect(parseCard(card("A", "'it''s'"))).toEqual(["A", "it's"]);
    expect(parseCard(card("B", "1.0E-05", "c"))).toEqual(["B", 1e-5]);
    expect(parseCard(card("C", "T"))).toEqual(["C", true]);
    expect(parseCard(card("D", ""))).toEqual(["D", null]);
    expect(parseCard(raw("HIERARCH SGT_LAT_MIDPT = 27.778816 / [deg] x"))).toEqual(["SGT_LAT_MIDPT", 27.778816]);
    expect(parseCard(raw("COMMENT   x = 1"))).toBeNull();
    expect(parseCard(raw("NOVALUE  just text"))).toBeNull();
  });
});

describe("readHeaders + readRows on a synthetic multi-HDU file", () => {
  const f = buildFile();

  it("finds every HDU with the right offsets and padded lengths", async () => {
    const log: string[] = [];
    const { hdus } = await readHeaders("mem://test.fits", { fetch: rangeFetch(f.bytes, log) });
    expect(hdus.map((h) => h.name)).toEqual(["PRIMARY", "IMAGE", "INTS", "DOUBLES", "LONGS", "COMPRESSED"]);
    expect(hdus.map((h) => h.headerStart)).toEqual(f.starts);
    expect(hdus[0].dataStart).toBe(f.primaryHeaderLen);
    expect(hdus[0].dataBytes).toBe(0);
    expect(hdus[1].dataStart).toBe(f.starts[1] + BLOCK);
    expect(hdus[1].dataBytes).toBe(7 * 5 * 4);
    expect(hdus[1].paddedDataBytes).toBe(BLOCK);
    expect(hdus[5].dataBytes).toBe(8 * 3 + 100); // PCOUNT counts
    expect(hdus[5].compressed).toBe(true);
    expect(hdus.slice(0, 5).every((h) => !h.compressed)).toBe(true);
    // The whole file is smaller than the first 49152-byte read: one request, then a 416 probe.
    expect(log.length).toBeLessThanOrEqual(2);
  });

  it("parses header values properly", async () => {
    const { hdus } = await readHeaders("mem://test.fits", { fetch: rangeFetch(f.bytes) });
    const p = hdus[0].header;
    expect(p.SIMPLE).toBe(true);
    expect(p.ORIGIN).toBe("O'Brien lab");
    expect(p.LEADSP).toBe("  two leading");
    expect(p.EMPTY).toBe("");
    expect(p.DEXP).toBeCloseTo(1.5e-3, 15);
    expect(p.NEGINT).toBe(-42);
    expect(p.FLAGF).toBe(false);
    expect(p["L2 N_HALO"]).toBe(48518);
    expect(p.FILL79).toBe(79);
    expect("COMMENT" in p).toBe(false);
    expect(hdus[2].bscale).toBe(2);
    expect(hdus[2].bzero).toBe(100);
    expect(hdus[2].blank).toBe(-32768);
  });

  it("works with small reads and stops early when asked", async () => {
    const log: string[] = [];
    const { hdus } = await readHeaders("mem://test.fits", {
      fetch: rangeFetch(f.bytes, log),
      firstChunk: BLOCK,
      stopAfter: "IMAGE",
    });
    expect(hdus.map((h) => h.name)).toEqual(["PRIMARY", "IMAGE"]);
    expect(log[0]).toBe("bytes=0-2879");
  });

  it("reads rows in FITS order, big-endian, with BSCALE/BZERO/BLANK", async () => {
    const fetch = rangeFetch(f.bytes);
    const { hdus } = await readHeaders("mem://test.fits", { fetch });
    const img = findHdu(hdus, "IMAGE")!;
    const rows = await readRows("mem://test.fits", img, 1, 3, { fetch });
    expect(rows.length).toBe(3 * f.w);
    for (let y = 1; y <= 3; y++) {
      for (let x = 0; x < f.w; x++) {
        const want = f32(x, y);
        const got = rows[(y - 1) * f.w + x];
        if (Number.isNaN(want)) expect(Number.isNaN(got)).toBe(true);
        else expect(got).toBe(want);
      }
    }
    const ints = await readRows("mem://test.fits", findHdu(hdus, "INTS")!, 0, 4, { fetch });
    expect(Number.isNaN(ints[0])).toBe(true); // BLANK
    expect(ints[1 * f.w + 3]).toBe((3 * 100 - 7) * 2 + 100);
    const dbl = await readRows("mem://test.fits", findHdu(hdus, "DOUBLES")!, 3, 3, { fetch });
    expect(Array.from(dbl)).toEqual([0, 1, 2].map((x) => Math.fround(f64(x, 3))));
    const longs = await readRows("mem://test.fits", findHdu(hdus, "LONGS")!, 0, 2, { fetch });
    expect(longs[2 * 4 + 3]).toBe(Math.fround(i32(3, 2)));
    await expect(readRows("mem://test.fits", findHdu(hdus, "COMPRESSED")!, 0, 0, { fetch })).rejects.toThrow(/compressed/);
    await expect(readRows("mem://test.fits", img, 0, 5, { fetch })).rejects.toThrow(/outside/);
  });

  it("decodeImageBytes converts big-endian float32", () => {
    const b = new Uint8Array([0x3f, 0x80, 0x00, 0x00, 0xc0, 0x00, 0x00, 0x00]); // 1.0, -2.0
    expect(Array.from(decodeImageBytes(b, { bitpix: -32, bscale: 1, bzero: 0, blank: null }))).toEqual([1, -2]);
  });

  it("refuses a server that ignores Range", async () => {
    const whole: FetchLike = async () => ({ status: 200, ok: true, arrayBuffer: async () => f.bytes.slice().buffer as ArrayBuffer });
    await expect(readHeaders("mem://x", { fetch: whole })).rejects.toThrow(/206/);
  });

  it("cancels with an AbortError", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(readHeaders("mem://x", { fetch: rangeFetch(f.bytes), signal: ac.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});

// ---------------------------------------------------------------- real SPHEREx cutout vs astropy

interface BlockHdu {
  name: string;
  bitpix: number;
  naxis1: number;
  naxis2: number;
  header_start: number;
  data_start: number;
  data_span: number;
  values: (number | null)[][];
}
const block = ref.block as unknown as { file: string; x0: number; y0: number; n: number; hdu_names: string[]; hdus: BlockHdu[] };
const realPath = resolve(__dirname, "..", "..", block.file);
const haveReal = existsSync(realPath);

describe("real SPHEREx cutout (same bytes astropy read)", () => {
  it.skipIf(!haveReal)(`${block.file}: offsets and a 5x5 block equal astropy's`, async () => {
    const bytes = new Uint8Array(readFileSync(realPath));
    const fetch = rangeFetch(bytes);
    const { hdus } = await readHeaders("file://cutout", { fetch });
    expect(hdus.map((h) => h.name)).toEqual(block.hdu_names);
    for (const b of block.hdus) {
      const h = findHdu(hdus, b.name)!;
      expect(h.headerStart).toBe(b.header_start);
      expect(h.dataStart).toBe(b.data_start);
      expect(h.paddedDataBytes).toBe(b.data_span);
      expect(h.naxis).toEqual([b.naxis1, b.naxis2]);
      expect(h.bitpix).toBe(b.bitpix);
      const rows = await readRows("file://cutout", h, block.y0, block.y0 + block.n - 1, { fetch });
      for (let j = 0; j < block.n; j++) {
        for (let i = 0; i < block.n; i++) {
          const want = b.values[j][i];
          const got = rows[j * b.naxis1 + block.x0 + i];
          if (want === null) expect(Number.isNaN(got)).toBe(true);
          else expect(got).toBe(want);
        }
      }
    }
    // The header keys the WCS needs come through, HIERARCH cards included.
    const img = findHdu(hdus, "IMAGE")!.header;
    expect(img.CTYPE1).toBe("RA---TAN-SIP");
    expect(typeof img.AP_0_0).toBe("number");
    expect(img.DETECTOR).toBe(3);
    expect(typeof img["L2 N_HALO"]).toBe("number");
  });
});
