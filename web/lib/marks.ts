// Marks, straight-line track fit, and the static / rate rules (BP 8.10, api.md section 3).

import type { Mark, Track } from "./types";

export const PIXEL_ARCSEC = 6.15;

/**
 * Least-squares straight line x(t), y(t) through the marks, in px/day, with x0, y0 at the first
 * mark's time (t0Days = first mark tDays). rms is the RMS residual distance in px.
 */
export function fitTrack(marks: Mark[]): Track {
  if (marks.length < 2) throw new Error("fitTrack needs at least 2 marks");
  const first = marks[0];
  const n = marks.length;
  const dt = marks.map((m) => m.tDays - first.tDays);
  const mt = dt.reduce((a, b) => a + b, 0) / n;
  const mx = marks.reduce((a, m) => a + m.x, 0) / n;
  const my = marks.reduce((a, m) => a + m.y, 0) / n;
  let stt = 0;
  let stx = 0;
  let sty = 0;
  for (let i = 0; i < n; i++) {
    stt += (dt[i] - mt) ** 2;
    stx += (dt[i] - mt) * (marks[i].x - mx);
    sty += (dt[i] - mt) * (marks[i].y - my);
  }
  // All marks at one time: no motion is defined, fit a fixed point.
  const vx = stt > 0 ? stx / stt : 0;
  const vy = stt > 0 ? sty / stt : 0;
  const x0 = mx - vx * mt;
  const y0 = my - vy * mt;
  let ss = 0;
  for (let i = 0; i < n; i++) {
    ss += (marks[i].x - (x0 + vx * dt[i])) ** 2 + (marks[i].y - (y0 + vy * dt[i])) ** 2;
  }
  const rms = n === 2 ? 0 : Math.sqrt(ss / n);
  return { x0, y0, t0Days: first.tDays, vx, vy, rms: rms < 1e-9 ? 0 : rms, marks: marks.slice() };
}

/** True when the fitted motion over the marked time span is under tolPx. */
export function isStatic(t: Track, tolPx = 1): boolean {
  const times = t.marks.map((m) => m.tDays);
  const span = Math.max(...times) - Math.min(...times);
  return Math.hypot(t.vx, t.vy) * span < tolPx;
}

export function rateArcsecPerHour(t: Track, pixelArcsec = PIXEL_ARCSEC): number {
  return (Math.hypot(t.vx, t.vy) * pixelArcsec) / 24;
}

/** Error text for the player, or null when the marks can be submitted. */
export function validateMarks(marks: Mark[]): string | null {
  const frames = new Set<number>();
  for (const m of marks) {
    if (frames.has(m.frame)) return "Only one mark per frame.";
    frames.add(m.frame);
  }
  if (frames.size < 2) return "Mark the object in at least 2 different frames.";
  return null;
}
