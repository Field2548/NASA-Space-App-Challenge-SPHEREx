// Pure helpers for the sky map and the coordinate box (no DOM, no Aladin). Owner: SERVER.
// Sky positions are ICRS decimal degrees.

import type { Difficulty, FieldSummary } from "@/lib/types";

const DEG = Math.PI / 180;

/** Great-circle distance between two sky positions, in degrees (haversine; stable at small angles). */
export function angularSeparationDeg(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const p1 = dec1 * DEG;
  const p2 = dec2 * DEG;
  const dp = p2 - p1;
  const dl = (ra2 - ra1) * DEG;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(h)))) / DEG;
}

/**
 * The ready spot whose own picture contains the position (separation < fov_deg / 2),
 * the closest one if several do. null if none.
 */
export function spotCovering(ra: number, dec: number, spots: readonly FieldSummary[]): FieldSummary | null {
  let best: FieldSummary | null = null;
  let bestSep = Infinity;
  for (const s of spots) {
    const sep = angularSeparationDeg(ra, dec, s.ra, s.dec);
    if (sep < s.fov_deg / 2 && sep < bestSep) {
      best = s;
      bestSep = sep;
    }
  }
  return best;
}

/** A random element; rng returns [0, 1) like Math.random. null for an empty list. */
export function pickRandom<T>(items: readonly T[], rng: () => number = Math.random): T | null {
  if (items.length === 0) return null;
  const i = Math.min(items.length - 1, Math.floor(rng() * items.length));
  return items[i];
}

/** Field of view (deg) to fly to for a spot: a few times its picture, so the neighbourhood shows. */
export function flyFovForSpot(spot: Pick<FieldSummary, "fov_deg">): number {
  return Math.max(0.3, spot.fov_deg * 4);
}

// ---- Heat scale for density layers -------------------------------------------------------------

export type Rgb = [number, number, number];

/**
 * Sequential ramp, dark to light, built from the design tokens: --grid navy, --cyan, then near-white.
 * Lightness rises monotonically, so it reads in greyscale and for colour-blind viewers.
 */
export const HEAT_STOPS: readonly Rgb[] = [
  [0x12, 0x30, 0x4d],
  [0x00, 0x7f, 0xa8],
  [0x00, 0xe1, 0xff],
  [0xd7, 0xf6, 0xff],
];

/** value / max clamped to [0, 1]; 0 when max is not positive or a value is not finite. */
export function heatFraction(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.min(1, Math.max(0, value / max));
}

/** Colour of a cell on the heat ramp, linear in value / max. */
export function heatRgb(value: number, max: number): Rgb {
  const t = heatFraction(value, max) * (HEAT_STOPS.length - 1);
  const i = Math.min(HEAT_STOPS.length - 2, Math.floor(t));
  const f = t - i;
  const a = HEAT_STOPS[i];
  const b = HEAT_STOPS[i + 1];
  return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * f)) as Rgb;
}

/** CSS colour string for a heat cell, optionally translucent. */
export function heatColor(value: number, max: number, alpha = 1): string {
  const [r, g, b] = heatRgb(value, max);
  return alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** CSS linear-gradient for the legend bar (left = 0, right = max). */
export function heatGradientCss(): string {
  const n = HEAT_STOPS.length - 1;
  const stops = HEAT_STOPS.map(([r, g, b], i) => `rgb(${r}, ${g}, ${b}) ${Math.round((100 * i) / n)}%`);
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

// ---- Difficulty marker styles ------------------------------------------------------------------

export interface DifficultyStyle {
  /** Plain word shown next to the marker and in lists. */
  word: string;
  /** CSS custom property from globals.css. */
  cssVar: "--cyan" | "--amber" | "--magenta" | "--text" | "--text-dim";
  /** sRGB fallback for canvas drawing if the custom property cannot be read. */
  fallback: string;
  /** Inner glyph as an SVG path in a 24 x 24 box (also used with Path2D on the map canvas). */
  glyph: string;
}

/** Corner brackets shared by every reticle (24 x 24 box). */
export const RETICLE_PATH = "M3 8V3H8M16 3H21V8M21 16V21H16M8 21H3V16";

// Colour is never the only signal: every difficulty also has its own glyph and a word label.
export const DIFFICULTY_STYLE: Record<Difficulty, DifficultyStyle> = {
  easy: { word: "Easy", cssVar: "--cyan", fallback: "#00e1ff", glyph: "M15 12A3 3 0 1 1 9 12A3 3 0 1 1 15 12Z" },
  medium: { word: "Medium", cssVar: "--amber", fallback: "#ffb000", glyph: "M12 8L16 12L12 16L8 12Z" },
  hard: { word: "Hard", cssVar: "--magenta", fallback: "#ff2e88", glyph: "M12 7.5L16.5 15.5H7.5Z" },
  boss: { word: "Boss", cssVar: "--text", fallback: "#d7e3f4", glyph: "M8 8H16V16H8ZM11 11H13V13H11Z" },
  expert: {
    word: "Expert",
    cssVar: "--magenta",
    fallback: "#ff2e88",
    glyph: "M12 7V17M7 12H17M8.5 8.5L15.5 15.5M15.5 8.5L8.5 15.5",
  },
  // A control field must look like any other spot: its label and style must not give away "nothing moves".
  control: { word: "Medium", cssVar: "--amber", fallback: "#ffb000", glyph: "M12 8L16 12L12 16L8 12Z" },
};

export function difficultyStyle(d: Difficulty): DifficultyStyle {
  return DIFFICULTY_STYLE[d] ?? DIFFICULTY_STYLE.easy;
}
