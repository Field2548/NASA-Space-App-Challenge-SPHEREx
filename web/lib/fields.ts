// Load spots from web/public/fields (field-schema.md sections 2, 3, 5).

import type { Field, FieldSummary } from "./types";

export const FIELDS_BASE = "/fields";

/** One decoded frame: S/N floats, row-major top-down, NaN where there is no data. */
export type Frame = Float32Array;

async function getJson<T>(url: string, fetcher: typeof fetch): Promise<T> {
  const res = await fetcher(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return (await res.json()) as T;
}

// Entries are filled only by prefetchField; loaders reuse them and otherwise fetch fresh.
const cache = {
  field: new Map<string, Promise<Field>>(),
  thumbs: new Map<string, Promise<ImageBitmap[]>>(),
  frames: new Map<string, Promise<Frame[]>>(),
};

/** Drop every prefetched entry (tests). */
export function clearFieldCache(): void {
  cache.field.clear();
  cache.thumbs.clear();
  cache.frames.clear();
}

const keyOf = (base: string, slug: string) => `${base}/${slug}`;

export function loadFieldIndex(fetcher: typeof fetch = fetch, base = FIELDS_BASE): Promise<FieldSummary[]> {
  return getJson<FieldSummary[]>(`${base}/index.json`, fetcher);
}

function fetchField(slug: string, fetcher: typeof fetch, base: string): Promise<Field> {
  return getJson<Field>(`${base}/${encodeURIComponent(slug)}/field.json`, fetcher);
}

export function loadField(slug: string, fetcher: typeof fetch = fetch, base = FIELDS_BASE): Promise<Field> {
  return cache.field.get(keyOf(base, slug)) ?? fetchField(slug, fetcher, base);
}

export type BitmapMaker = (blob: Blob) => Promise<ImageBitmap>;

function fetchThumbs(field: Field, fetcher: typeof fetch, base: string, makeBitmap: BitmapMaker): Promise<ImageBitmap[]> {
  return Promise.all(
    field.thumbs.map(async (t) => {
      const url = `${base}/${encodeURIComponent(field.slug)}/${t}`;
      const res = await fetcher(url);
      if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
      return makeBitmap(await res.blob());
    }),
  );
}

/** Thumbnails in field.thumbs order (low detail first); paths are relative to the spot folder. */
export function loadThumbs(
  field: Field,
  fetcher: typeof fetch = fetch,
  base = FIELDS_BASE,
  makeBitmap: BitmapMaker = (b) => createImageBitmap(b),
): Promise<ImageBitmap[]> {
  return cache.thumbs.get(keyOf(base, field.slug)) ?? fetchThumbs(field, fetcher, base, makeBitmap);
}

/** Decode frames.u16 bytes into one Float32Array per frame (frame i is element i - 1). */
export function decodeFrames(field: Pick<Field, "size" | "frames" | "data">, bytes: ArrayBuffer): Frame[] {
  const [w, h] = field.size;
  const n = field.frames.length;
  const plane = w * h;
  if (bytes.byteLength !== 2 * n * plane) {
    throw new Error(`frames.u16 is ${bytes.byteLength} bytes, expected ${2 * n * plane} (${n} x ${h} x ${w})`);
  }
  // Explicit little-endian read; on little-endian hosts a Uint16Array view would give the same values.
  const view = new DataView(bytes);
  const { scale, offset, nodata } = field.data;
  const out: Frame[] = [];
  for (let f = 0; f < n; f++) {
    const frame = new Float32Array(plane);
    const base = f * plane * 2;
    for (let k = 0; k < plane; k++) {
      const v = view.getUint16(base + 2 * k, true);
      frame[k] = v === nodata ? NaN : v * scale + offset;
    }
    out.push(frame);
  }
  return out;
}

async function fetchFrames(field: Field, fetcher: typeof fetch, base: string): Promise<Frame[]> {
  const url = `${base}/${encodeURIComponent(field.slug)}/${field.data.file}`;
  const res = await fetcher(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return decodeFrames(field, await res.arrayBuffer());
}

export function loadFrames(field: Field, fetcher: typeof fetch = fetch, base = FIELDS_BASE): Promise<Frame[]> {
  return cache.frames.get(keyOf(base, field.slug)) ?? fetchFrames(field, fetcher, base);
}

export interface PrefetchOptions {
  fetcher?: typeof fetch;
  base?: string;
  makeBitmap?: BitmapMaker;
  /** Runs fn when idle; default requestIdleCallback with a setTimeout fallback. */
  idle?: (fn: () => void) => void;
  /** Called once the prefetch settles (tests). */
  onDone?: () => void;
}

function whenIdle(fn: () => void): void {
  const g = globalThis as { requestIdleCallback?: (cb: () => void) => number };
  if (typeof g.requestIdleCallback === "function") g.requestIdleCallback(fn);
  else setTimeout(fn, 0);
}

/**
 * Idle-time prefetch of field.json, then thumbs and frames, into the module cache that
 * loadField / loadThumbs / loadFrames reuse. Never throws; a failed step is dropped from the cache.
 */
export function prefetchField(slug: string, opts: PrefetchOptions = {}): void {
  try {
    const { base = FIELDS_BASE, idle = whenIdle, onDone } = opts;
    const fetcher = opts.fetcher ?? globalThis.fetch;
    const makeBitmap = opts.makeBitmap ?? ((b: Blob) => createImageBitmap(b));
    const key = keyOf(base, slug);
    const keep = <T>(m: Map<string, Promise<T>>, p: Promise<T>) => {
      m.set(key, p);
      p.catch(() => {
        if (m.get(key) === p) m.delete(key);
      });
      return p;
    };
    idle(() => {
      void (async () => {
        try {
          const field = await (cache.field.get(key) ?? keep(cache.field, fetchField(slug, fetcher, base)));
          await Promise.allSettled([
            cache.thumbs.get(key) ?? keep(cache.thumbs, fetchThumbs(field, fetcher, base, makeBitmap)),
            cache.frames.get(key) ?? keep(cache.frames, fetchFrames(field, fetcher, base)),
          ]);
        } catch {
          /* prefetch is best effort */
        } finally {
          try {
            onDone?.();
          } catch {
            /* ignore */
          }
        }
      })();
    });
  } catch {
    /* never throws */
  }
}
