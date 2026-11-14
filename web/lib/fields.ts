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

export function loadIndex(fetcher: typeof fetch = fetch, base = FIELDS_BASE): Promise<FieldSummary[]> {
  return getJson<FieldSummary[]>(`${base}/index.json`, fetcher);
}

export function loadField(slug: string, fetcher: typeof fetch = fetch, base = FIELDS_BASE): Promise<Field> {
  return getJson<Field>(`${base}/${encodeURIComponent(slug)}/field.json`, fetcher);
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

export async function loadFrames(field: Field, fetcher: typeof fetch = fetch, base = FIELDS_BASE): Promise<Frame[]> {
  const url = `${base}/${encodeURIComponent(field.slug)}/${field.data.file}`;
  const res = await fetcher(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return decodeFrames(field, await res.arrayBuffer());
}
