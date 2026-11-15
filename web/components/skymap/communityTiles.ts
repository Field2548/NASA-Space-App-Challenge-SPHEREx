// Fetching community tiles from /api/patch-tiles: a keyed LRU cache, at most a few requests in
// flight, and stale requests aborted when the view moves on.

import { LruCache } from "./tileCache";

export interface TileSpec {
  mode: "density" | "patches";
  /** Order of the drawn cells (density only; patches are always order 11). */
  order: number;
  tileOrder: number;
  tile: number;
}
export interface TilePatchInfo {
  id: string;
  solved: boolean;
  reported: boolean;
}
export type TileData =
  | { kind: "density"; cells: [number, number, number][] }
  | { kind: "patches"; patches: TilePatchInfo[]; truncated: boolean }
  | { kind: "offline" };

export const TILES_URL = "/api/patch-tiles";
export const MAX_CONCURRENT = 4;
export const CACHE_ENTRIES = 300;
export const CACHE_TTL_MS = 60_000;

export const tileKey = (s: TileSpec): string => `${s.mode}:${s.mode === "density" ? s.order : 11}:${s.tileOrder}:${s.tile}`;

export function tileUrl(s: TileSpec): string {
  const q = new URLSearchParams({ tileOrder: String(s.tileOrder), tile: String(s.tile) });
  if (s.mode === "patches") q.set("mode", "patches");
  else q.set("order", String(s.order));
  return `${TILES_URL}?${q}`;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Read an API body; anything unexpected is treated as offline. */
export function parseTile(mode: TileSpec["mode"], body: unknown): TileData {
  if (typeof body !== "object" || body === null) return { kind: "offline" };
  const b = body as { offline?: unknown; cells?: unknown; patches?: unknown; truncated?: unknown };
  if (b.offline) return { kind: "offline" };
  if (mode === "density") {
    if (!Array.isArray(b.cells)) return { kind: "offline" };
    const cells = b.cells.filter(
      (c): c is [number, number, number] => Array.isArray(c) && c.length >= 3 && isNum(c[0]) && isNum(c[1]) && isNum(c[2]),
    );
    return { kind: "density", cells: cells.map((c) => [c[0], c[1], c[2]]) };
  }
  if (!Array.isArray(b.patches)) return { kind: "offline" };
  const patches = b.patches
    .filter((p): p is TilePatchInfo => !!p && typeof p === "object" && typeof (p as TilePatchInfo).id === "string")
    .map((p) => ({ id: p.id, solved: Boolean(p.solved), reported: Boolean(p.reported) }));
  return { kind: "patches", patches, truncated: Boolean(b.truncated) };
}

export interface TileLoaderOptions {
  /** Called when a tile has arrived. */
  onTile: () => void;
  fetcher?: typeof fetch;
  cache?: LruCache<TileData>;
  maxConcurrent?: number;
}

export class TileLoader {
  private readonly cache: LruCache<TileData>;
  private readonly fetcher: typeof fetch;
  private readonly maxConcurrent: number;
  private readonly inflight = new Map<string, AbortController>();
  private queue: TileSpec[] = [];
  private dead = false;

  constructor(private readonly opts: TileLoaderOptions) {
    this.cache = opts.cache ?? new LruCache<TileData>(CACHE_ENTRIES, CACHE_TTL_MS);
    this.fetcher = opts.fetcher ?? ((...a) => fetch(...a));
    this.maxConcurrent = opts.maxConcurrent ?? MAX_CONCURRENT;
  }

  get(spec: TileSpec): TileData | undefined {
    return this.cache.get(tileKey(spec));
  }

  /** Number of requests running now. */
  get active(): number {
    return this.inflight.size;
  }

  /** Ask for these tiles (nearest first). Requests for tiles no longer wanted are aborted. */
  request(specs: TileSpec[]): void {
    if (this.dead) return;
    const wanted = new Set(specs.map(tileKey));
    for (const [key, ctl] of this.inflight) {
      if (!wanted.has(key)) {
        ctl.abort();
        this.inflight.delete(key);
      }
    }
    this.queue = specs.filter((s) => !this.cache.has(tileKey(s)) && !this.inflight.has(tileKey(s)));
    this.pump();
  }

  destroy(): void {
    this.dead = true;
    this.queue = [];
    for (const ctl of this.inflight.values()) ctl.abort();
    this.inflight.clear();
  }

  private pump(): void {
    while (!this.dead && this.inflight.size < this.maxConcurrent && this.queue.length) {
      const spec = this.queue.shift();
      if (spec) void this.run(spec);
    }
  }

  private async run(spec: TileSpec): Promise<void> {
    const key = tileKey(spec);
    const ctl = new AbortController();
    this.inflight.set(key, ctl);
    try {
      const res = await this.fetcher(tileUrl(spec), { signal: ctl.signal });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = parseTile(spec.mode, await res.json());
      if (ctl.signal.aborted) return;
      this.cache.set(key, data);
      this.opts.onTile();
    } catch {
      /* aborted or failed: the tile stays missing and is asked for again on the next view change */
    } finally {
      if (this.inflight.get(key) === ctl) this.inflight.delete(key);
      this.pump();
    }
  }
}
