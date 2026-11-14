// Read small pieces of big FITS files over HTTP Range requests (BUILD_PROMPT 8.20, quick look).
//
// Why: a full SPHEREx exposure is about 65 MB, but quick look only needs the headers (about 30 KB)
// and the few dozen image rows that cover a 41 x 41 px grid. This mirrors spectral_bands.py
// (`fetch(url, byte_range)` + `scan_one`), which reads the PRIMARY and IMAGE headers the same way.
//
// FITS facts used here (FITS Standard 4.0):
//   - The file is a sequence of 2880-byte blocks. Each HDU is a header (80-char ASCII cards,
//     ending with the END card, padded to whole blocks) followed by its data, padded to whole blocks.
//   - Data size in bytes = |BITPIX| / 8 * GCOUNT * (PCOUNT + NAXIS1 * NAXIS2 * ...), or 0 if NAXIS = 0.
//   - Image data is big-endian, with NAXIS1 (x, columns) varying fastest. The first row in the file
//     is FITS row y = 1, which is the BOTTOM row when the image is shown the usual way.
//
// Runs in the browser (inside workers/quicklook.ts) and in node (tests inject a fetch).

/** One header value as written in the card: string, number, logical, or null for an empty value. */
export type FitsValue = string | number | boolean | null;

/**
 * A parsed header: keyword -> value. Keywords are as written (upper case, trailing blanks removed);
 * HIERARCH cards are stored under the text after "HIERARCH " (e.g. "L2 N_HALO", as astropy does).
 * COMMENT, HISTORY and blank cards are not stored. If a keyword repeats, the first one wins (astropy's
 * `header[key]` behaviour). A plain object, so it survives structuredClone/postMessage and JSON.
 */
export type FitsHeader = Record<string, FitsValue>;

export interface HduInfo {
  /** 0 = primary HDU. */
  index: number;
  /** EXTNAME, or "PRIMARY" for HDU 0 without one. */
  name: string;
  /** XTENSION value ("IMAGE", "BINTABLE", ...), null for the primary HDU. */
  xtension: string | null;
  header: FitsHeader;
  /** Byte offset of the first header block. */
  headerStart: number;
  /** Byte offset where the data starts (= headerStart + padded header length). */
  dataStart: number;
  /** Data length without padding. */
  dataBytes: number;
  /** Data length padded to whole 2880-byte blocks: the next HDU starts at dataStart + paddedDataBytes. */
  paddedDataBytes: number;
  bitpix: number;
  /** [NAXIS1, NAXIS2, ...]; empty when NAXIS = 0. */
  naxis: number[];
  /** True for a tile-compressed image (ZIMAGE = T). Its rows cannot be read with readRows: skip it. */
  compressed: boolean;
  bscale: number;
  bzero: number;
  /** BLANK for integer images (raw value that means "no data"), else null. */
  blank: number | null;
}

/** The part of a fetch Response that the reader uses (the global Response satisfies it). */
export interface RangeResponse {
  status: number;
  ok: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** A fetch-like function: the global `fetch`, or a fake in tests that honours the Range header. */
export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<RangeResponse>;

export interface ReadOptions {
  fetch?: FetchLike;
  signal?: AbortSignal;
  /** Attempts per Range request for network errors and HTTP 429/5xx (default 3). */
  tries?: number;
}

export interface ReadHeadersOptions extends ReadOptions {
  /**
   * Stop after this HDU (by EXTNAME, e.g. "IMAGE"). Quick look only needs PRIMARY + IMAGE, and
   * every later header costs one more round trip because it sits behind megabytes of data.
   */
  stopAfter?: string;
  /** Stop after this many HDUs (default: read to the end of the file, or 64 HDUs). */
  maxHdus?: number;
  /** Size of the first read from byte 0 (default 49152, as in spectral_bands.scan_one). */
  firstChunk?: number;
}

export const BLOCK = 2880;
const CARD = 80;
const FIRST_CHUNK = 49152; // the IMAGE header of a SPHEREx file ends at about 29 KB
const SECOND_CHUNK = 196608; // spectral_bands.scan_one's retry size when the header is longer
const LATER_CHUNK = 8 * BLOCK; // a later HDU's header is usually 3-8 blocks (FLAGS: 185 cards)

function abortError(): Error {
  // DOMException exists in browsers and node >= 17; the name lets callers tell cancel from failure.
  return new DOMException("The quick look was cancelled.", "AbortError");
}

export function isAbortError(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { name?: unknown }).name === "AbortError";
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function defaultFetch(): FetchLike {
  if (typeof fetch !== "function") throw new Error("No fetch available; pass one in the options.");
  return (url, init) => fetch(url, init);
}

/**
 * GET bytes start..end (inclusive) with one Range request. Retries network errors and 429/5xx with
 * a short backoff. Requires a 206 answer of exactly the asked length: a 200 would mean the server
 * ignored the Range header and is sending the whole 65 MB file, which we refuse to read.
 *
 * The answer's Content-Range header is deliberately NOT read: the S3 bucket does not list it in
 * Access-Control-Expose-Headers, so browser code cannot see it (checked on 2026-11-14).
 */
export async function rangeGet(url: string, start: number, end: number, o: ReadOptions = {}): Promise<Uint8Array> {
  const f = o.fetch ?? defaultFetch();
  const tries = Math.max(1, o.tries ?? 3);
  const want = end - start + 1;
  if (!(start >= 0) || !(want > 0)) throw new Error(`Bad byte range ${start}-${end}`);
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < tries; attempt++) {
    if (o.signal?.aborted) throw abortError();
    let retryable = false;
    try {
      const res = await f(url, { headers: { Range: `bytes=${start}-${end}` }, signal: o.signal });
      if (res.status === 429 || res.status >= 500) {
        retryable = true;
        throw new Error(`HTTP ${res.status} for bytes ${start}-${end}`);
      }
      // 416 = the range starts at or after the end of the file. That is how readHeaders learns
      // that the last HDU has been read, since Content-Range (the file size) is not readable.
      if (res.status === 416) return new Uint8Array(0);
      if (res.status !== 206) throw new Error(`Expected 206 Partial Content, got HTTP ${res.status} (server ignored Range?)`);
      const buf = new Uint8Array(await res.arrayBuffer());
      // A read that starts inside the file but runs past its end is legal and comes back short.
      if (buf.byteLength > want) throw new Error(`Got ${buf.byteLength} bytes for a ${want}-byte range`);
      return buf;
    } catch (e) {
      if (isAbortError(e) || o.signal?.aborted) throw abortError();
      // fetch() itself throws TypeError on network failure: worth another try.
      if (e instanceof TypeError) retryable = true;
      lastErr = e;
      if (!retryable || attempt === tries - 1) break;
      await sleep(1000 * 2 ** attempt, o.signal);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// ------------------------------------------------------------------------------------------------
// Header cards
// ------------------------------------------------------------------------------------------------

function parseValue(raw: string): FitsValue {
  const s = raw.replace(/^ +/, "");
  if (s.startsWith("'")) {
    // Quoted string: '' inside means one quote; trailing blanks are not significant, leading are.
    let out = "";
    let i = 1;
    while (i < s.length) {
      if (s[i] === "'") {
        if (s[i + 1] === "'") {
          out += "'";
          i += 2;
          continue;
        }
        break;
      }
      out += s[i];
      i++;
    }
    return out.replace(/ +$/, "");
  }
  const slash = s.indexOf("/");
  const v = (slash >= 0 ? s.slice(0, slash) : s).trim();
  if (v === "") return null;
  if (v === "T") return true;
  if (v === "F") return false;
  if (/^[+-]?(\d+\.?\d*|\.\d+)([EeDd][+-]?\d+)?$/.test(v)) return Number(v.replace(/[Dd]/, "E"));
  return v; // complex numbers "(re, im)" and anything unusual stay as text
}

/** Parse one 80-character card. Returns null for commentary cards and cards without a value. */
export function parseCard(card: string): [string, FitsValue] | null {
  const key = card.slice(0, 8).replace(/ +$/, "");
  if (key === "HIERARCH") {
    // ESO convention, used by SPHEREx (e.g. "HIERARCH L2 N_HALO = 48518 / ...").
    const rest = card.slice(8);
    const eq = rest.indexOf("=");
    if (eq < 0) return null;
    return [rest.slice(0, eq).trim(), parseValue(rest.slice(eq + 1))];
  }
  if (key === "" || key === "COMMENT" || key === "HISTORY" || key === "END") return null;
  if (card.slice(8, 10) !== "= ") return null;
  return [key, parseValue(card.slice(10))];
}

function num(h: FitsHeader, key: string, fallback: number): number {
  const v = h[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Bytes of data after a header, unpadded (FITS Standard 4.0, eq. 2 and 4). */
export function dataLength(h: FitsHeader): number {
  const bitpix = num(h, "BITPIX", 0);
  const n = num(h, "NAXIS", 0);
  if (n === 0) return 0;
  let prod = 1;
  // Random groups (primary HDU with NAXIS1 = 0 and GROUPS = T) skip NAXIS1 in the product.
  const groups = h["GROUPS"] === true && num(h, "NAXIS1", -1) === 0;
  for (let k = groups ? 2 : 1; k <= n; k++) prod *= num(h, `NAXIS${k}`, 0);
  return (Math.abs(bitpix) / 8) * num(h, "GCOUNT", 1) * (num(h, "PCOUNT", 0) + prod);
}

const padded = (n: number) => Math.ceil(n / BLOCK) * BLOCK;

/** Turn a parsed header and its position into an HduInfo. */
export function hduFromHeader(index: number, header: FitsHeader, headerStart: number, headerBytes: number): HduInfo {
  const n = num(header, "NAXIS", 0);
  const naxis: number[] = [];
  for (let k = 1; k <= n; k++) naxis.push(num(header, `NAXIS${k}`, 0));
  const dataBytes = dataLength(header);
  const xt = header["XTENSION"];
  const extname = header["EXTNAME"];
  const blank = header["BLANK"];
  return {
    index,
    name: typeof extname === "string" && extname ? extname : index === 0 ? "PRIMARY" : `HDU${index}`,
    xtension: typeof xt === "string" ? xt : null,
    header,
    headerStart,
    dataStart: headerStart + headerBytes,
    dataBytes,
    paddedDataBytes: padded(dataBytes),
    bitpix: num(header, "BITPIX", 0),
    naxis,
    compressed: header["ZIMAGE"] === true,
    bscale: num(header, "BSCALE", 1),
    bzero: num(header, "BZERO", 0),
    blank: typeof blank === "number" ? blank : null,
  };
}

/** A sparse view of a remote file: byte ranges fetched so far, so overlapping reads are not repeated. */
class ByteCache {
  private parts: { start: number; bytes: Uint8Array }[] = [];
  /** True once a read came back short: the file ends at `size`. */
  size: number | null = null;

  constructor(private url: string, private o: ReadOptions) {}

  /** Bytes [start, start + len) if already held in one piece. */
  private held(start: number, len: number): Uint8Array | null {
    for (const p of this.parts) {
      if (start >= p.start && start + len <= p.start + p.bytes.byteLength) {
        return p.bytes.subarray(start - p.start, start - p.start + len);
      }
    }
    return null;
  }

  /** Get bytes [start, start + len), fetching `fetchLen` bytes from `start` if they are not held. */
  async get(start: number, len: number, fetchLen: number): Promise<Uint8Array> {
    const have = this.held(start, len);
    if (have) return have;
    if (this.size !== null && start >= this.size) return new Uint8Array(0);
    const n = Math.max(len, fetchLen);
    const bytes = await rangeGet(this.url, start, start + n - 1, this.o);
    if (bytes.byteLength < n) this.size = start + bytes.byteLength;
    this.parts.push({ start, bytes });
    return bytes.subarray(0, Math.min(len, bytes.byteLength));
  }
}

const decoder = new TextDecoder("latin1");

/**
 * Read every header of a remote FITS file with Range requests (2880-byte blocks until END), and
 * work out where each HDU's data starts and how long it is.
 *
 * Round trips: the first read takes `firstChunk` bytes from byte 0 (enough for PRIMARY + IMAGE of a
 * SPHEREx file); a header that runs past what is held triggers one larger read. Each later HDU sits
 * behind its predecessor's data, so it costs one more read of a few blocks. Use `stopAfter: "IMAGE"`
 * when the later HDUs are not needed.
 */
export async function readHeaders(url: string, o: ReadHeadersOptions = {}): Promise<{ hdus: HduInfo[] }> {
  const cache = new ByteCache(url, o);
  const hdus: HduInfo[] = [];
  const maxHdus = o.maxHdus ?? 64;
  const first = Math.max(BLOCK, padded(o.firstChunk ?? FIRST_CHUNK));
  let pos = 0;
  while (hdus.length < maxHdus) {
    if (cache.size !== null && pos >= cache.size) break; // clean end of file
    const header: FitsHeader = {};
    let blocks = 0;
    let ended = false;
    // How much to fetch when the next block is not held yet: grow the read for long headers.
    let chunk = pos === 0 ? first : LATER_CHUNK;
    while (!ended) {
      const at = pos + blocks * BLOCK;
      const blk = await cache.get(at, BLOCK, chunk);
      if (blk.byteLength === 0) {
        if (blocks === 0 && hdus.length > 0) return { hdus }; // end of file between HDUs
        throw new Error(`File ended inside the header of HDU ${hdus.length} at byte ${at}`);
      }
      if (blk.byteLength < BLOCK) throw new Error(`Truncated header block at byte ${at}`);
      const text = decoder.decode(blk);
      if (blocks === 0) {
        const expect = hdus.length === 0 ? "SIMPLE  =" : "XTENSION=";
        if (!text.startsWith(expect)) {
          throw new Error(`Not a FITS ${hdus.length === 0 ? "file" : "extension"} at byte ${at}: ${JSON.stringify(text.slice(0, 20))}`);
        }
      }
      for (let c = 0; c < BLOCK; c += CARD) {
        const card = text.slice(c, c + CARD);
        if (card.startsWith("END") && card.slice(3).trim() === "") {
          ended = true;
          break;
        }
        const kv = parseCard(card);
        if (kv && !(kv[0] in header)) header[kv[0]] = kv[1];
      }
      blocks++;
      chunk = pos === 0 ? SECOND_CHUNK : chunk * 2;
      if (blocks > 2000) throw new Error("Header has no END card in 2000 blocks");
    }
    const hdu = hduFromHeader(hdus.length, header, pos, blocks * BLOCK);
    hdus.push(hdu);
    if (o.stopAfter && hdu.name === o.stopAfter) break;
    pos = hdu.dataStart + hdu.paddedDataBytes;
  }
  return { hdus };
}

// ------------------------------------------------------------------------------------------------
// Image rows
// ------------------------------------------------------------------------------------------------

/** Byte range (inclusive) of rows y0..y1 of a 2-D image HDU. y is the 0-based FITS row index. */
export function rowByteRange(hdu: HduInfo, y0: number, y1: number): { start: number; end: number } {
  const w = hdu.naxis[0];
  const rowBytes = (Math.abs(hdu.bitpix) / 8) * w;
  return { start: hdu.dataStart + y0 * rowBytes, end: hdu.dataStart + (y1 + 1) * rowBytes - 1 };
}

/**
 * Convert big-endian FITS image bytes to native Float32, applying BSCALE/BZERO and mapping BLANK
 * (integer images) to NaN. Exported for tests.
 */
export function decodeImageBytes(bytes: Uint8Array, hdu: Pick<HduInfo, "bitpix" | "bscale" | "bzero" | "blank">): Float32Array {
  const size = Math.abs(hdu.bitpix) / 8;
  const n = Math.floor(bytes.byteLength / size);
  const out = new Float32Array(n);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { bscale, bzero, blank } = hdu;
  const scaled = bscale !== 1 || bzero !== 0;
  for (let i = 0; i < n; i++) {
    const o = i * size;
    let v: number;
    switch (hdu.bitpix) {
      case -32:
        v = dv.getFloat32(o, false);
        break;
      case -64:
        v = dv.getFloat64(o, false);
        break;
      case 8:
        v = dv.getUint8(o);
        break;
      case 16:
        v = dv.getInt16(o, false);
        break;
      case 32:
        v = dv.getInt32(o, false);
        break;
      case 64:
        v = Number(dv.getBigInt64(o, false));
        break;
      default:
        throw new Error(`Unsupported BITPIX ${hdu.bitpix}`);
    }
    if (hdu.bitpix > 0 && blank !== null && v === blank) {
      out[i] = NaN;
      continue;
    }
    out[i] = scaled ? v * bscale + bzero : v;
  }
  return out;
}

/**
 * Read rows y0..y1 (inclusive, 0-based FITS row indices) of a 2-D image HDU with ONE Range request.
 *
 * Returns a Float32Array of (y1 - y0 + 1) * NAXIS1 values in FITS order: element (y - y0) * NAXIS1 + x
 * is pixel (x, y) in 0-based FITS coordinates, i.e. astropy's `data[y, x]`. Row 0 of the result is the
 * LOWER row y0; nothing is flipped here (quick look flips to top-down when it resamples).
 */
export async function readRows(url: string, hdu: HduInfo, y0: number, y1: number, o: ReadOptions = {}): Promise<Float32Array> {
  if (hdu.compressed) throw new Error(`HDU ${hdu.name} is tile-compressed (ZIMAGE = T); its rows cannot be read directly`);
  if (hdu.naxis.length !== 2) throw new Error(`HDU ${hdu.name} is not a 2-D image (NAXIS = ${hdu.naxis.length})`);
  const h = hdu.naxis[1];
  if (!Number.isInteger(y0) || !Number.isInteger(y1) || y0 < 0 || y1 >= h || y1 < y0) {
    throw new Error(`Rows ${y0}..${y1} are outside 0..${h - 1}`);
  }
  const { start, end } = rowByteRange(hdu, y0, y1);
  const bytes = await rangeGet(url, start, end, o);
  if (bytes.byteLength !== end - start + 1) throw new Error(`Short read: ${bytes.byteLength} of ${end - start + 1} bytes`);
  return decodeImageBytes(bytes, hdu);
}

/** First HDU with this EXTNAME, or undefined. */
export function findHdu(hdus: HduInfo[], name: string): HduInfo | undefined {
  return hdus.find((h) => h.name === name);
}
