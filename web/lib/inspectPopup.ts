// Pure helpers for the Inspect popup (BUILD_PROMPT 8.16): panel placement, galactic coordinates,
// and the distance rules for the /api/info explore response. No React here.

import { parallaxDistance, redshiftDistance, toPlainType } from "./inspect";

// ---------------------------------------------------------------------------------------------
// Panel placement
// ---------------------------------------------------------------------------------------------

/**
 * Place a panel beside a clicked point. Tries right, then left, then below, then above; the first
 * side where the whole panel fits inside the viewport wins, and the panel then sits at least `gap`
 * away from the click point. If no side fits, the panel is clamped into the viewport (as far as its
 * size allows) and may cover the point.
 */
export function placePopup(
  click: { x: number; y: number },
  popup: { w: number; h: number },
  viewport: { w: number; h: number },
  gap = 12,
): { left: number; top: number } {
  const { x, y } = click;
  const { w, h } = popup;
  const vw = viewport.w;
  const vh = viewport.h;
  const clampX = (v: number) => Math.max(0, Math.min(v, vw - w));
  const clampY = (v: number) => Math.max(0, Math.min(v, vh - h));
  const fitsV = h <= vh;
  const fitsH = w <= vw;

  if (fitsV && x + gap + w <= vw) return { left: x + gap, top: clampY(y) };
  if (fitsV && x - gap - w >= 0) return { left: x - gap - w, top: clampY(y) };
  if (fitsH && y + gap + h <= vh) return { left: clampX(x - w / 2), top: y + gap };
  if (fitsH && y - gap - h >= 0) return { left: clampX(x - w / 2), top: y - gap - h };
  return { left: clampX(x + gap), top: clampY(y + gap) };
}

// ---------------------------------------------------------------------------------------------
// Galactic coordinates (J2000 equatorial -> galactic, IAU 1958 pole and node)
// ---------------------------------------------------------------------------------------------

const D2R = Math.PI / 180;
const RA_NGP = 192.85948; // north galactic pole, J2000 (deg)
const DEC_NGP = 27.12825;
const L_NCP = 122.93192; // galactic longitude of the north celestial pole (deg)

/** ICRS/J2000 (ra, dec) in degrees -> galactic (l in [0, 360), b in [-90, 90]) in degrees. */
export function galactic(ra: number, dec: number): { l: number; b: number } {
  const a = (ra - RA_NGP) * D2R;
  const d = dec * D2R;
  const dG = DEC_NGP * D2R;
  const sinB = Math.sin(d) * Math.sin(dG) + Math.cos(d) * Math.cos(dG) * Math.cos(a);
  const b = Math.asin(Math.max(-1, Math.min(1, sinB))) / D2R;
  const y = Math.cos(d) * Math.sin(a);
  const x = Math.cos(dG) * Math.sin(d) - Math.sin(dG) * Math.cos(d) * Math.cos(a);
  const l = (((L_NCP * D2R - Math.atan2(y, x)) / D2R) % 360 + 360) % 360;
  return { l, b };
}

// ---------------------------------------------------------------------------------------------
// Distances (BUILD_PROMPT 8.16 section E)
// ---------------------------------------------------------------------------------------------

/** One plain-text distance line and the source that gives its number. */
export interface DistanceLine {
  text: string;
  source: string;
}

export type SourceStatus = "ok" | "premade" | "empty" | "timeout" | "error" | "skipped";

export interface SimbadObject {
  name: string;
  otype: string;
  sp_type?: string | null;
  z?: number | null;
  sep_arcsec?: number;
  url?: string;
}

export interface GaiaSource {
  id?: string;
  g_mag?: number | null;
  plx?: number | null;
  plx_over_err?: number | null;
  pmra?: number | null;
  pmdec?: number | null;
  sep_arcsec?: number;
}

export interface SolarSystemObject {
  name: string;
  frame?: number;
  sep_px?: number;
  r_au?: number;
  delta_au?: number;
  source?: string;
}

/** The explore response of GET /api/info (docs/contracts/api.md section 6). */
export interface InfoExplore {
  mode: "explore" | "round";
  locked: boolean;
  position?: { ra: number; dec: number; x: number; y: number };
  sources?: Partial<Record<"simbad" | "gaia" | "jpl", SourceStatus>>;
  simbad?: SimbadObject[];
  gaia?: GaiaSource | null;
  solar_system?: SolarSystemObject[];
  links?: { label: string; url: string }[];
}

/**
 * The address back, normalised, only when it parses and its protocol is `https:`; otherwise null.
 * Links in the popup come from API data (SIMBAD names, catalog files), so a `javascript:` or
 * `data:` address must never reach an `href`.
 */
export function safeHttpsUrl(u: unknown): string | null {
  if (typeof u !== "string") return null;
  try {
    const url = new URL(u);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

const KM_PER_AU = 149597870.7;
const LIGHT_MIN_PER_AU = 8.3167;

const fmt = (v: number, maxFrac: number) => v.toLocaleString("en-US", { maximumFractionDigits: maxFrac });
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function auLine(name: string, label: string, au: number, frame: number | undefined): DistanceLine {
  const where = frame === undefined ? "" : ` in frame ${frame}`;
  return {
    text: `${name} is ${fmt(au, 3)} AU ${label} (${fmt(au * KM_PER_AU, 0)} km, ${fmt(au * LIGHT_MIN_PER_AU, 1)} light-minutes)${where}.`,
    source: "JPL Horizons",
  };
}

/**
 * Distance lines for an explore response, by BUILD_PROMPT 8.16 section E:
 * (1) a solar-system object: Earth distance (delta_au) and Sun distance (r_au) in AU, km, light-minutes;
 * (2) a Gaia star: parallax distance, or "Too far or too faint" when parallax_over_error is below 5;
 * (3) a galaxy or quasar with a SIMBAD redshift: approximate light-travel distance (Planck 2018);
 * (5) otherwise, "SPHEREx alone can't measure this object's distance."
 * Rule (4) needs the player's own track, which this response does not carry. Missing values are
 * skipped, never estimated. A locked response has no distances, so it returns [].
 */
export function distanceLines(info: InfoExplore): DistanceLine[] {
  if (info.locked) return [];
  const lines: DistanceLine[] = [];

  for (const obj of info.solar_system ?? []) {
    if (finite(obj.delta_au)) lines.push(auLine(obj.name, "from Earth", obj.delta_au, obj.frame));
    if (finite(obj.r_au)) lines.push(auLine(obj.name, "from the Sun", obj.r_au, obj.frame));
  }

  const g = info.gaia;
  if (g && finite(g.plx) && finite(g.plx_over_err)) {
    const d = parallaxDistance(g.plx, g.plx_over_err);
    lines.push(
      d
        ? {
            text: `About ${fmt(d.pc, 1)} parsecs (${fmt(d.ly, 1)} light-years), from the Gaia parallax.`,
            source: "Gaia DR3",
          }
        : { text: "Too far or too faint for a reliable distance.", source: "Gaia DR3" },
    );
  }

  for (const s of info.simbad ?? []) {
    if (!finite(s.z)) continue;
    if (!/galaxy|quasar|blazar|active nucleus/i.test(toPlainType(s.otype))) continue;
    const r = redshiftDistance(s.z);
    if (!r) continue;
    lines.push({
      text: `${s.name} is about ${fmt(r.lightTravelGly, 2)} billion light-years away (approx., from catalog redshift).`,
      source: "SIMBAD",
    });
  }

  if (lines.length === 0) {
    lines.push({ text: "SPHEREx alone can't measure this object's distance.", source: "SPHEREx" });
  }
  return lines;
}
