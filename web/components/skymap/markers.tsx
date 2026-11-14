// Spot reticles: the same SVG paths draw the HTML glyph (lists, card) and the canvas marker on the map.
// Owner: SERVER.

import type { Difficulty } from "@/lib/types";
import { difficultyStyle, RETICLE_PATH } from "./geometry";

/** Inline SVG reticle for lists and the preview card. Decorative: always paired with a text label. */
export function SpotGlyph({ difficulty, size = 18 }: { difficulty: Difficulty; size?: number }) {
  const s = difficultyStyle(difficulty);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      style={{ flex: "none", color: `var(${s.cssVar})` }}
    >
      <path d={RETICLE_PATH} fill="none" stroke="currentColor" strokeWidth={1.5} />
      <path d={s.glyph} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

/** The resolved colour of a difficulty's token (P3 or sRGB), for drawing on canvas. Browser only. */
export function difficultyColor(difficulty: Difficulty): string {
  const s = difficultyStyle(difficulty);
  const v = getComputedStyle(document.documentElement).getPropertyValue(s.cssVar).trim();
  return v || s.fallback;
}

/** Canvas image of a reticle for Aladin's catalog `shape` option. Browser only. */
export function reticleCanvas(difficulty: Difficulty, color: string, cssSize = 28): HTMLCanvasElement {
  const s = difficultyStyle(difficulty);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = cssSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const k = cssSize / 24;
  ctx.scale(k, k);
  ctx.lineJoin = "round";
  // Dark halo first so the reticle reads on bright parts of the Milky Way.
  ctx.strokeStyle = "rgba(0, 0, 0, 0.75)";
  ctx.lineWidth = 3.5;
  ctx.stroke(new Path2D(RETICLE_PATH));
  ctx.stroke(new Path2D(s.glyph));
  ctx.strokeStyle = s.fallback;
  ctx.strokeStyle = color; // ignored by the canvas if it cannot parse the token; fallback stays
  ctx.lineWidth = 1.75;
  ctx.stroke(new Path2D(RETICLE_PATH));
  ctx.stroke(new Path2D(s.glyph));
  return canvas;
}
