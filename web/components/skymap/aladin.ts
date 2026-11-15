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

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const t = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, t]) : t;
}

async function mirrorsFromMocServer(signal?: AbortSignal): Promise<string[]> {
  for (const base of MOCSERVERS) {
    try {
      const res = await fetch(`${base}?ID=${encodeURIComponent(HIPS_ID)}&fmt=json&get=record`, {
        signal: withTimeout(signal, 4000),
      });
      if (!res.ok) continue;
      const rows = (await res.json()) as Record<string, unknown>[];
      const rec = rows[0] ?? {};
      return Object.keys(rec)
        .filter((k) => k.startsWith("hips_service_url"))
        .sort()
        .map((k) => String(rec[k]))
        .filter((u) => u.startsWith("https://"));
    } catch {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    }
  }
  return [];
}

/**
 * Find a HiPS mirror that actually serves the SPHEREx tiles (its `properties` file answers 200).
 * Returns null if none does. Done before Aladin starts because when the base layer fails, Aladin
 * falls back to its default DSS survey (not allowed here, BP section 7) and can retry forever.
 */
export async function findHipsUrl(signal?: AbortSignal): Promise<string | null> {
  const fromRecord = await mirrorsFromMocServer(signal);
  const candidates = [...new Set([...fromRecord, ...KNOWN_MIRRORS])];
  const probes = candidates.map(async (url) => {
    const res = await fetch(`${url}/properties`, { signal: withTimeout(signal, 6000) });
    const text = res.ok ? await res.text() : "";
    // CDS answers its "Page unavailable" HTML with a 404; a real properties file has hips_ keys.
    if (!res.ok || !/hips_(tile_format|order)/.test(text)) throw new Error(`${url}: HTTP ${res.status}`);
    return url;
  });
  try {
    return await Promise.any(probes);
  } catch {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    return null;
  }
}
