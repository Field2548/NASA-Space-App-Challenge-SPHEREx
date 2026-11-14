// Time colours for frames, same order as motion_frames.time_colors (BP 8.6, normal vision).
// Stand-in until a shared timeColors(n, vision) palette module exists; vision variants are not here.

import type { RGB } from "@/lib/types";

export const OKABE_ITO_TIME = ["#0072B2", "#56B4E9", "#009E73", "#E69F00", "#D55E00", "#CC79A7", "#F0E442"];

function hexToRgb(h: string): RGB {
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
}

function hsvToRgb(h: number, s: number, v: number): RGB {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const [r, g, b] = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ][((i % 6) + 6) % 6];
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/** n colours: Okabe-Ito for n <= 7, otherwise evenly spaced hues as in Python. */
export function timeColors(n: number): RGB[] {
  if (n <= OKABE_ITO_TIME.length) return OKABE_ITO_TIME.slice(0, n).map(hexToRgb);
  return Array.from({ length: n }, (_, i) => hsvToRgb(0.62 - (0.62 * i) / (n - 1), 1, 1));
}

export const rgbCss = ([r, g, b]: RGB) => `rgb(${r} ${g} ${b})`;
