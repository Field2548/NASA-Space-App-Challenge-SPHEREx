// Known-asteroid overlay (BP 8.18): client for GET /api/overlay (issue #14 shape, api.md section 12).
// Positions are pixel-grid coordinates of the spot; `frame` is 1-based and equals FrameMeta.i.

export interface OverlayPosition {
  frame: number;
  x: number;
  y: number;
  vmag?: number;
}
export interface OverlayAsteroid {
  name: string;
  positions: OverlayPosition[];
}
export interface OverlayStar {
  name: string;
  source?: string;
  x: number;
  y: number;
}
export interface KnownOverlay {
  asteroids: OverlayAsteroid[];
  stars: OverlayStar[];
}

export const OVERLAY_UNAVAILABLE = "Known asteroids are not available for this spot right now.";

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const rec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Keep only well-formed entries; null when the body is not an overlay object at all. */
export function parseOverlay(body: unknown): KnownOverlay | null {
  if (!rec(body)) return null;
  const asteroids: OverlayAsteroid[] = [];
  for (const a of Array.isArray(body.asteroids) ? body.asteroids : []) {
    if (!rec(a) || typeof a.name !== "string" || !Array.isArray(a.positions)) continue;
    const positions: OverlayPosition[] = [];
    for (const p of a.positions) {
      if (rec(p) && num(p.frame) && num(p.x) && num(p.y)) positions.push({ frame: p.frame, x: p.x, y: p.y, ...(num(p.vmag) ? { vmag: p.vmag } : {}) });
    }
    asteroids.push({ name: a.name, positions });
  }
  const stars: OverlayStar[] = [];
  for (const s of Array.isArray(body.stars) ? body.stars : []) {
    if (!rec(s) || !num(s.x) || !num(s.y)) continue;
    stars.push({ name: typeof s.name === "string" ? s.name : "star", ...(typeof s.source === "string" ? { source: s.source } : {}), x: s.x, y: s.y });
  }
  return { asteroids, stars };
}

/** GET /api/overlay; null on 404, a network error or an unreadable body. */
export async function fetchOverlay(slug: string, mode: "round" | "explore", fetcher: typeof fetch = fetch): Promise<KnownOverlay | null> {
  try {
    const res = await fetcher(`/api/overlay?spot=${encodeURIComponent(slug)}&mode=${mode}`);
    if (!res.ok) return null;
    return parseOverlay(await res.json());
  } catch {
    return null;
  }
}

/** Asteroids drawn in frame number `frame` (1-based), nearest-first lookup helper for hover. */
export function asteroidsInFrame(o: KnownOverlay, frame: number): { name: string; x: number; y: number }[] {
  const out: { name: string; x: number; y: number }[] = [];
  for (const a of o.asteroids) for (const p of a.positions) if (p.frame === frame) out.push({ name: a.name, x: p.x, y: p.y });
  return out;
}
