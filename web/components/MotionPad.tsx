"use client";
// Motion pad for Shift (shift-and-stack by hand). Drag the dot to set a motion: direction on the
// image, distance from the centre = rate in px/day on a near-log scale (0 at the centre, RATE_MAX at
// the rim). Stack then moves every frame back along that motion, so a mover with that motion lands
// on one pixel (white) while still stars turn into colour trails. Arrow keys nudge the dot.

import { type KeyboardEvent, type PointerEvent, useRef } from "react";

export type Motion = { vx: number; vy: number };

export const RATE_MIN = 0.5; // px/day where the scale turns from linear to log
export const RATE_MAX = 500; // px/day at the rim (fast near-Earth asteroids)
const ARCSEC_PER_PX = 6.15;
const SIZE = 140;
const R = SIZE / 2 - 8;

/** Pad radius 0..1 -> rate px/day (0 -> 0, 1 -> RATE_MAX). */
export function rateFromRadius(rho: number): number {
  const r = Math.min(1, Math.max(0, rho));
  return RATE_MIN * ((1 + RATE_MAX / RATE_MIN) ** r - 1);
}

/** Inverse of rateFromRadius. */
export function radiusFromRate(rate: number): number {
  return Math.log(1 + Math.max(0, rate) / RATE_MIN) / Math.log(1 + RATE_MAX / RATE_MIN);
}

function motionFromPad(px: number, py: number): Motion {
  const dx = px / R;
  const dy = py / R;
  const rho = Math.hypot(dx, dy);
  if (rho < 0.03) return { vx: 0, vy: 0 };
  const rate = rateFromRadius(rho);
  return { vx: (rate * dx) / rho, vy: (rate * dy) / rho };
}

function padFromMotion(m: Motion): [number, number] {
  const rate = Math.hypot(m.vx, m.vy);
  if (rate === 0) return [0, 0];
  const rho = radiusFromRate(rate) * R;
  return [(rho * m.vx) / rate, (rho * m.vy) / rate];
}

export default function MotionPad({ value, onChange }: { value: Motion; onChange(m: Motion): void }) {
  const svg = useRef<SVGSVGElement>(null);
  const [px, py] = padFromMotion(value);
  const rate = Math.hypot(value.vx, value.vy);

  const fromEvent = (e: PointerEvent<SVGSVGElement>) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return;
    const x = ((e.clientX - box.left) / box.width) * SIZE - SIZE / 2;
    const y = ((e.clientY - box.top) / box.height) * SIZE - SIZE / 2;
    onChange(motionFromPad(x, y));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const step = e.shiftKey ? 1 : 3;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const k = d[e.key];
    if (!k) return;
    e.preventDefault();
    onChange(motionFromPad(px + k[0], py + k[1]));
  };

  return (
    <div data-testid="motion-pad">
      <svg
        ref={svg}
        width={SIZE}
        height={SIZE}
        viewBox={`${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`}
        role="slider"
        tabIndex={0}
        aria-label="Shift motion"
        aria-valuenow={Math.round(rate * 10) / 10}
        aria-valuetext={`${rate.toFixed(1)} pixels per day`}
        style={{ touchAction: "none", cursor: "crosshair", display: "block" }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          fromEvent(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons) fromEvent(e);
        }}
        onKeyDown={onKey}
      >
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <circle key={f} r={R * f} fill="none" stroke="var(--grid, #12304D)" strokeWidth={1} />
        ))}
        <line x1={-R} x2={R} y1={0} y2={0} stroke="var(--grid, #12304D)" />
        <line y1={-R} y2={R} x1={0} x2={0} stroke="var(--grid, #12304D)" />
        <line x1={0} y1={0} x2={px} y2={py} stroke="var(--cyan, #00E1FF)" strokeWidth={1.5} />
        <circle cx={px} cy={py} r={5} fill="var(--cyan, #00E1FF)" />
      </svg>
      <p style={{ margin: "4px 0 0", fontSize: 12 }} data-testid="motion-readout">
        {rate === 0 ? "No shift: drag to set a motion" : `${rate.toFixed(1)} px/day · ${((rate * ARCSEC_PER_PX) / 24).toFixed(2)}″/h`}
      </p>
    </div>
  );
}
