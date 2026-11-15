// Time colours per colour-vision setting, CVD simulation and CIEDE2000 (BP 8.6).

import type { RGB, Vision } from "./types";

const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;

/** Okabe and Ito (2008) order, as OKABE_ITO_TIME in motion_frames.py. */
export const OKABE_ITO: RGB[] = ["#0072B2", "#56B4E9", "#009E73", "#E69F00", "#D55E00", "#CC79A7", "#F0E442"].map(hex);

/** Tritan-safe set: separated by lightness and by the red-green axis, which tritans see normally. */
export const TRITAN: RGB[] = ["#332288", "#E69F00", "#009E73", "#56B4E9", "#D55E00", "#CC79A7", "#F0E442"].map(hex);

/** Same fallback as motion_frames.py time_colors for n > 7: hsv hue 0.62 - 0.62 i/(n-1), s = v = 1. */
function hueRamp(n: number): RGB[] {
  const out: RGB[] = [];
  for (let i = 0; i < n; i++) {
    const h = (0.62 - (0.62 * i) / (n - 1)) * 6;
    const k = Math.floor(h);
    const f = h - k;
    const [r, g, b] = [
      [1, f, 0],
      [1 - f, 1, 0],
      [0, 1, f],
      [0, 1 - f, 1],
      [f, 0, 1],
      [1, 0, 1 - f],
    ][k % 6];
    out.push([Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]);
  }
  return out;
}

/** n distinct time colours (0..255) for the chosen vision. */
export function timeColors(n: number, vision: Vision): RGB[] {
  if (n < 1) return [];
  if (vision === "mono") {
    return Array.from({ length: n }, (_, i) => {
      const g = Math.round(n === 1 ? 255 : 40 + (215 * i) / (n - 1));
      return [g, g, g] as RGB;
    });
  }
  if (n > 7) return hueRamp(n);
  return (vision === "tritan" ? TRITAN : OKABE_ITO).slice(0, n).map((c) => [...c] as RGB);
}

const OUTSIDE: RGB = [128, 128, 128];

/** Per-frame Stack colours for n frames. Up to 7 frames, or when not safe: timeColors(n) (a hue ramp
 * past 7). Safe with more than 7 frames: the colour-blind-safe set laid over the Stack range [a, b]
 * (at most 7 frames) in order, grey outside it. */
export function stackColors(n: number, range: [number, number], vision: Vision, safe: boolean): RGB[] {
  if (!safe || n <= 7) return timeColors(n, vision);
  const [a, b] = range;
  const set = timeColors(Math.min(7, b - a + 1), vision);
  return Array.from({ length: n }, (_, i) => (i >= a && i <= b && set[i - a] ? [...set[i - a]] : [...OUTSIDE]) as RGB);
}

// ---- colour vision deficiency simulation (Machado, Oliveira, Fernandes 2009, severity 1.0)

type M3 = [number, number, number, number, number, number, number, number, number];
const MACHADO: Record<"protan" | "deutan" | "tritan", M3> = {
  protan: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deutan: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritan: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};

const decode = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const encode = (c: number) => {
  const x = Math.min(1, Math.max(0, c));
  return 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
};

/** What a viewer with the given dichromacy sees for an sRGB colour (0..255, unrounded). */
export function simulateCvd(rgb: RGB, type: "protan" | "deutan" | "tritan"): RGB {
  const m = MACHADO[type];
  const [r, g, b] = rgb.map(decode);
  return [
    encode(m[0] * r + m[1] * g + m[2] * b),
    encode(m[3] * r + m[4] * g + m[5] * b),
    encode(m[6] * r + m[7] * g + m[8] * b),
  ];
}

// ---- CIELAB (D65) and CIEDE2000

export type Lab = [number, number, number];

/** sRGB 0..255 to CIELAB, D65 white. */
export function srgbToLab(rgb: RGB): Lab {
  const [r, g, b] = rgb.map(decode);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIEDE2000 colour difference (Sharma, Wu, Dalal 2005), kL = kC = kH = 1. */
export function ciede2000(lab1: Lab, lab2: Lab): number {
  const rad = Math.PI / 180;
  const deg = (r: number) => ((r / rad) % 360 + 360) % 360;
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const ap1 = (1 + G) * a1;
  const ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1);
  const Cp2 = Math.hypot(ap2, b2);
  const hp1 = Cp1 === 0 ? 0 : deg(Math.atan2(b1, ap1));
  const hp2 = Cp2 === 0 ? 0 : deg(Math.atan2(b2, ap2));
  const dLp = L2 - L1;
  const dCp = Cp2 - Cp1;
  let dhp = 0;
  if (Cp1 * Cp2 !== 0) {
    dhp = hp2 - hp1;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dhp * rad) / 2);
  const Lbp = (L1 + L2) / 2;
  const Cbp = (Cp1 + Cp2) / 2;
  let hbp = hp1 + hp2;
  if (Cp1 * Cp2 !== 0) {
    if (Math.abs(hp1 - hp2) <= 180) hbp = (hp1 + hp2) / 2;
    else hbp = (hp1 + hp2 + (hp1 + hp2 < 360 ? 360 : -360)) / 2;
  }
  const T =
    1 -
    0.17 * Math.cos((hbp - 30) * rad) +
    0.24 * Math.cos(2 * hbp * rad) +
    0.32 * Math.cos((3 * hbp + 6) * rad) -
    0.2 * Math.cos((4 * hbp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  const a = dLp / Sl;
  const b = dCp / Sc;
  const c = dHp / Sh;
  return Math.sqrt(a * a + b * b + c * c + Rt * b * c);
}
