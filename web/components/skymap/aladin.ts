// Browser-only loader and minimal types for Aladin Lite v3 (npm aladin-lite 3.8.2, GPL-3.0). Owner: SERVER.
//
// The package ships one ES module (dist/aladin.js, about 2.4 MB with the WASM core inlined as base64)
// and no TypeScript types. Importing it runs `A.init` at once (creates a WebGL2 canvas), so it must
// only ever be imported from a browser effect: never at module top level of a component.
// Every name below was checked in node_modules/aladin-lite/dist/aladin.js (see SkyMap.tsx header).

/** Subset of the Aladin instance API used by SkyMap. */
export interface AladinInstance {
  on(event: AladinEvent, cb: (...args: never[]) => void): void;
  gotoRaDec(ra: number, dec: number): void;
  animateToRaDec(ra: number, dec: number, durationSec: number, complete?: () => void): void;
  setFoV(fovDeg: number): void;
  zoomToFoV(fovDeg: number, durationSec: number, complete?: () => void): void;
  getFov(): [number, number];
  getRaDec(): [number, number];
  increaseZoom(): void;
  decreaseZoom(): void;
  /** Screen pixel to sky; with frame "icrs" the result is ICRS. undefined outside the projection. */
  pix2world(x: number, y: number, frame?: string): [number, number] | undefined;
  addCatalog(cat: AladinCatalog): void;
  addOverlay(overlay: AladinOverlay): void;
  removeOverlay(layer: AladinCatalog | AladinOverlay): void;
}

export type AladinEvent = "mouseMove" | "click" | "zoomChanged" | "objectClicked";

export interface AladinSource<D> {
  ra: number;
  dec: number;
  data: D;
}

export interface AladinCatalog {
  addSources(sources: AladinSource<unknown>[]): void;
}

export interface AladinShape {
  readonly __shape?: never;
}

export interface AladinOverlay {
  addFootprints(shapes: AladinShape[]): void;
}

export interface AladinHiPS {
  readonly id?: string;
  /** Cube HiPS only: which band (0-based) to draw. */
  setSliceNumber?(n: number): void;
}

export interface AladinStatic {
  init: Promise<void>;
  aladin(el: HTMLElement, options: Record<string, unknown>): AladinInstance;
  HiPS(
    id: string,
    options: { url?: string; name?: string; successCallback?: () => void; errorCallback?: (e: unknown) => void },
  ): AladinHiPS;
  catalog(options: {
    name: string;
    shape: HTMLCanvasElement | string;
    sourceSize?: number;
    color?: string;
    onClick?: ((source: AladinSource<unknown>) => void) | "showTable" | "showPopup";
    displayLabel?: boolean;
    labelColumn?: string;
    labelColor?: string;
    labelFont?: string;
  }): AladinCatalog;
  source<D>(ra: number, dec: number, data: D): AladinSource<D>;
  graphicOverlay(options: { name?: string; color?: string; lineWidth?: number }): AladinOverlay;
  polygon(
    raDec: [number, number][],
    options: { color?: string; fill?: boolean; fillColor?: string; opacity?: number; lineWidth?: number },
  ): AladinShape;
}

let loading: Promise<AladinStatic> | null = null;

/** Load Aladin Lite once (lazy chunk) and wait for its WASM core. Rejects without WebGL2. */
export function loadAladin(): Promise<AladinStatic> {
  if (!loading) {
    loading = import("aladin-lite")
      .then(async (mod: { default: unknown }) => {
        const A = mod.default as AladinStatic;
        await A.init;
        return A;
      })
      .catch((e: unknown) => {
        loading = null; // allow a retry
        throw e;
      });
  }
  return loading;
}

// ---- HiPS preflight ----------------------------------------------------------------------------

export const HIPS_ID = "CDS/P/SPHEREx/QR2/color";
export const HIPS_NAME = "SPHEREx QR2 color (CDS)";

/** Mirrors listed in the CDS MocServer record for HIPS_ID (hips_service_url, hips_service_url_1). */
const KNOWN_MIRRORS = ["https://alasky.cds.unistra.fr/SPHEREx/color", "https://alaskybis.cds.unistra.fr/SPHEREx/color"];
const MOCSERVERS = ["https://alasky.cds.unistra.fr/MocServer/query", "https://alaskybis.cds.unistra.fr/MocServer/query"];

/** Abort signal that fires after `ms` (or when `signal` does). Uses setTimeout so fake timers work. */
function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new DOMException("timeout", "TimeoutError")), ms);
  const stop = () => clearTimeout(timer);
  ctl.signal.addEventListener("abort", stop, { once: true });
  if (signal) {
    if (signal.aborted) ctl.abort(signal.reason);
    else
      signal.addEventListener(
        "abort",
        () => {
          stop();
          ctl.abort(signal.reason);
        },
        { once: true },
      );
  }
  return ctl.signal;
}

async function mirrorsFromOneMocServer(base: string, signal?: AbortSignal): Promise<string[]> {
  const res = await fetch(`${base}?ID=${encodeURIComponent(HIPS_ID)}&fmt=json&get=record`, {
    signal: withTimeout(signal, 4000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = (await res.json()) as Record<string, unknown>[];
  const rec = rows[0] ?? {};
  const urls = Object.keys(rec)
    .filter((k) => k.startsWith("hips_service_url"))
    .sort()
    .map((k) => String(rec[k]))
    .filter((u) => u.startsWith("https://"));
  if (!urls.length) throw new Error("no mirrors");
  return urls;
}

/** Mirrors from the first MocServer that answers (both are asked at once). [] if none does. */
async function mirrorsFromMocServer(signal?: AbortSignal): Promise<string[]> {
  try {
    return await Promise.any(MOCSERVERS.map((base) => mirrorsFromOneMocServer(base, signal)));
  } catch {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    return [];
  }
}

async function probeMirror(url: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`${url}/properties`, { signal: withTimeout(signal, 6000) });
  const text = res.ok ? await res.text() : "";
  // CDS answers its "Page unavailable" HTML with a 404; a real properties file has hips_ keys.
  if (!res.ok || !/hips_(tile_format|order)/.test(text)) throw new Error(`${url}: HTTP ${res.status}`);
  return url;
}

/**
 * Find a HiPS mirror that actually serves the SPHEREx tiles (its `properties` file answers 200).
 * Returns null if none does. Done before Aladin starts because when the base layer fails, Aladin
 * falls back to its default DSS survey (not allowed here, BP section 7) and can retry forever.
 * The MocServer lookup runs at the same time as the probes of the known mirrors, so a dead CDS
 * costs one timeout, not several in a row.
 */
const IRSA_GRACE_MS = 1000;

async function probeMirrors(): Promise<string | null> {
  const known = KNOWN_MIRRORS.map((url) => probeMirror(url));
  const extra = mirrorsFromMocServer().then((urls) => {
    const fresh = urls.filter((u) => !KNOWN_MIRRORS.includes(u));
    if (!fresh.length) throw new Error("no extra mirrors");
    return Promise.any(fresh.map((url) => probeMirror(url)));
  });
  // IRSA's own SPHEREx HiPS, then the site's coarse copy (pipeline/mirror_hips.py). Both are probed at
  // the same time and used only when every CDS mirror fails, so a dead CDS still costs one timeout.
  const irsa = probeMirror(IRSA_HIPS).catch(() => null);
  const local =
    typeof window === "undefined"
      ? Promise.resolve(null)
      : probeMirror(`${window.location.origin}${LOCAL_HIPS}`).catch(() => null);
  // CDS stays first choice, but once IRSA has answered a dead CDS mirror may only cost
  // IRSA_GRACE_MS more, not its whole probe timeout (it was ~6 s before the first tile).
  const irsaAfterGrace = irsa.then((u) =>
    u === null ? Promise.reject(new Error("irsa down")) : new Promise<string>((r) => setTimeout(() => r(u), IRSA_GRACE_MS)),
  );
  try {
    return await Promise.any([...known, extra, irsaAfterGrace]);
  } catch {
    return (await irsa) ?? (await local);
  }
}

/**
 * IRSA's SPHEREx DR1 all-sky HiPS (a 102-band cube with PNG tiles and CORS open; Aladin draws its
 * 0.81 um band, in grey). Not the CDS colour survey, but real SPHEREx data from the archive
 * the game's pictures come from, so it is the fallback when CDS is down.
 */
export const IRSA_HIPS = "https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube";
/** creator_did of IRSA_HIPS (its properties file). */
export const IRSA_HIPS_ID = "IPAC/P/SPHEREx/DR1/cube";
export const IRSA_HIPS_NAME = "SPHEREx DR1 all-sky (IRSA)";
/**
 * Argument for Aladin's setSliceNumber on IRSA_HIPS. Aladin turns it into a frequency and back, which
 * reverses the order for this cube (0 asks for tile suffix _102, none for _50), so the value is set
 * from the tile suffix the browser then requests (checked with tmp/probe-map.cjs).
 */
export const IRSA_SLICE_ARG = 82;

/** Where pipeline/mirror_hips.py puts the coarse copy (web/public/hips/spherex-color). */
export const LOCAL_HIPS = "/hips/spherex-color";

let mirror: Promise<string | null> | null = null;

/**
 * The working mirror, looked up once per page load and shared (the title screen starts it early,
 * see preloadSky). A null result is not kept, so "Try the map again" looks again.
 */
export function findHipsUrl(signal?: AbortSignal): Promise<string | null> {
  if (!mirror) {
    const p = probeMirrors();
    mirror = p;
    void p.then((url) => {
      if (url === null && mirror === p) mirror = null;
    });
  }
  const shared = mirror;
  if (!signal) return shared;
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("aborted", "AbortError"));
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    shared.then(resolve, reject);
  });
}

/** Start the sky map's slow parts (Aladin Lite + WASM, the CDS mirror check) before /map opens. */
export function preloadSky(): void {
  loadAladin().catch(() => {});
  void findHipsUrl();
}

/**
 * Aladin Lite has no destroy method, so free its WebGL contexts ourselves and empty the container.
 * Without this every mount leaks a context and a render loop. Never throws.
 */
export function releaseAladin(container: HTMLElement | null): void {
  if (!container) return;
  try {
    for (const canvas of Array.from(container.querySelectorAll("canvas"))) {
      try {
        const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as
          | WebGL2RenderingContext
          | WebGLRenderingContext
          | null;
        gl?.getExtension("WEBGL_lose_context")?.loseContext();
      } catch {
        /* context already gone */
      }
    }
  } catch {
    /* ignore */
  }
  try {
    container.replaceChildren();
  } catch {
    /* ignore */
  }
}
