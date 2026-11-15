// Zoom prefetch for the sky map: guess the HiPS tiles Aladin will ask for next (lib/hipsPredict.ts) and
// fetch them early at low priority, so the browser cache (the proxy sends max-age=86400) has them when
// the zoom lands. Browser only.
//
// The tile URLs are copied from Aladin's own requests (resource timing): same root (the /api/hips proxy
// or whichever mirror Aladin settled on), same cube slice suffix and extension, and Aladin loads tiles
// with fetch() as well, so the prefetched response is the one it reuses (checked with tmp/probe-zoom.cjs).

import { parseTileUrl, predictTiles, tileUrl, type PredictView, type TileUrlParts } from "@/lib/hipsPredict";
import type { AladinInstance } from "./aladin";

/** Tiles per prediction, requests in flight at once, and the wait for a view change to settle. */
const MAX_TILES = 24;
const MAX_IN_FLIGHT = 4;
const SETTLE_MS = 150;
/** A zoom in is guessed as a halving of the field, which is one HiPS order deeper. */
const ZOOM_STEP = 2;

interface HipsMeta {
  tileWidth: number;
  maxOrder: number;
}

const metaByRoot = new Map<string, Promise<HipsMeta | null>>();

/** hips_order and hips_tile_width from the survey's properties file (cached by the browser and the proxy). */
function hipsMeta(root: string): Promise<HipsMeta | null> {
  let p = metaByRoot.get(root);
  if (!p) {
    p = fetch(`${root}/properties`)
      .then((r) => (r.ok ? r.text() : ""))
      .then((text) => {
        const get = (k: string) => Number(new RegExp(`^${k}\\s*=\\s*(\\d+)`, "m").exec(text)?.[1]);
        const maxOrder = get("hips_order");
        const tileWidth = get("hips_tile_width") || 512;
        return Number.isInteger(maxOrder) ? { tileWidth, maxOrder } : null;
      })
      .catch(() => null);
    metaByRoot.set(root, p);
  }
  return p;
}

export interface HipsPrefetch {
  /** The view changed: predict the next zoom in once it settles. */
  viewChanged(): void;
  /** A zoom in is starting now (wheel, pinch, + button). */
  zoomingIn(): void;
  /** The view will fly to this place and field. */
  flyTo(ra: number, dec: number, fovDeg: number): void;
  stop(): void;
}

export function startHipsPrefetch(a: AladinInstance, el: HTMLElement): HipsPrefetch {
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  let template: Omit<TileUrlParts, "order" | "npix"> | null = null;
  const done = new Set<string>();
  let batch: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  // A fly-to asked for before Aladin's first tile (the map flies as soon as it is ready): replayed
  // when a tile shows the URL pattern, and again if the pattern changes (IRSA's slice suffix is set late).
  let pendingFly: PredictView | null = null;

  // Learn the URL pattern from the tiles Aladin itself requests (and mark those as already loaded).
  let observer: PerformanceObserver | null = null;
  try {
    observer = new PerformanceObserver((list) => {
      let changed = false;
      for (const e of list.getEntries()) {
        const p = parseTileUrl(e.name);
        if (!p) continue;
        const status = (e as PerformanceResourceTiming & { responseStatus?: number }).responseStatus;
        if (status !== undefined && status !== 200) continue; // failed or aborted: may be asked again
        if (!template || template.root !== p.root || template.suffix !== p.suffix || template.ext !== p.ext) changed = true;
        template = { root: p.root, suffix: p.suffix, ext: p.ext };
        done.add(e.name);
      }
      if (changed && pendingFly) void run(null, pendingFly);
    });
    observer.observe({ type: "resource", buffered: true });
  } catch {
    observer = null; // no resource timing: nothing to copy the URLs from, so no prefetch
  }

  const current = (): PredictView | null => {
    try {
      const [ra, dec] = a.getRaDec();
      const [fovX, fovY] = a.getFov();
      const widthPx = el.clientWidth;
      return [ra, dec, fovX, fovY, widthPx].every(Number.isFinite) && widthPx > 0 ? { ra, dec, fovX, fovY, widthPx } : null;
    } catch {
      return null; // view not ready
    }
  };

  // The batch in flight: its first tile (a repeat wheel event predicts the same set and keeps it going)
  // and whether it is a fly-to, which a view change during the flight must not cancel.
  let batchKey = "";
  let batchFly = false;

  const run = async (now: PredictView | null, next: PredictView) => {
    if (stopped || conn?.saveData || !template) return;
    const t = template;
    const meta = await hipsMeta(t.root);
    if (!meta || stopped) return;
    const urls = predictTiles(now, next, meta, MAX_TILES)
      .map(({ order, npix }) => tileUrl({ ...t, order, npix }))
      .filter((u) => !done.has(u));
    const fly = now === null;
    if (!urls.length || (batch && !batch.signal.aborted && (urls[0] === batchKey || (batchFly && !fly)))) return;
    batch?.abort();
    const ctl = new AbortController();
    batch = ctl;
    batchKey = urls[0];
    batchFly = fly;
    let i = 0;
    const worker = async () => {
      while (i < urls.length && !ctl.signal.aborted) {
        const url = urls[i++];
        try {
          const res = await fetch(url, { priority: "low", signal: ctl.signal });
          await res.arrayBuffer(); // read to the end so the cache keeps the whole file
          if (res.ok || res.status === 404) done.add(url);
        } catch {
          /* aborted or offline: Aladin will ask again itself */
        }
      }
    };
    await Promise.all(Array.from({ length: MAX_IN_FLIGHT }, worker));
    if (batch === ctl) batch = null;
  };

  const zoomIn = () => {
    const now = current();
    if (now) void run(now, { ...now, fovX: now.fovX / ZOOM_STEP, fovY: now.fovY / ZOOM_STEP });
  };

  const onWheel = (e: WheelEvent) => {
    if (e.deltaY < 0) zoomIn();
  };
  const onTouch = (e: TouchEvent) => {
    if (e.touches.length >= 2) zoomIn();
  };
  el.addEventListener("wheel", onWheel, { passive: true, capture: true });
  el.addEventListener("touchstart", onTouch, { passive: true, capture: true });

  return {
    viewChanged() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(zoomIn, SETTLE_MS);
    },
    zoomingIn: zoomIn,
    flyTo(ra, dec, fovDeg) {
      const now = current();
      if (!now || !(fovDeg > 0)) return;
      pendingFly = { ra, dec, fovX: fovDeg, fovY: (fovDeg * now.fovY) / now.fovX, widthPx: now.widthPx };
      void run(null, pendingFly);
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      batch?.abort();
      observer?.disconnect();
      el.removeEventListener("wheel", onWheel, { capture: true });
      el.removeEventListener("touchstart", onTouch, { capture: true });
    },
  };
}
