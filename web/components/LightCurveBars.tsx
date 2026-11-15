"use client";

/*
 * LightCurveBars: section "B. Over time" of the Inspect popup. One bar per frame, showing the
 * signal at the clicked pixel, so the player can see whether something appeared in one frame only.
 */

import type { JSX } from "react";
import type { FrameMeta, RGB } from "@/lib/types";

export interface LightCurveBarsProps {
  frames: FrameMeta[]; // metadata of the frames shown, in order
  snr: number[]; // one value per frame (from lightCurveAt)
  verdict: "steady" | "changed" | "faint";
  changedFrame?: number; // frame number (from 1) for the "changed" verdict
  colors: RGB[]; // one time colour per frame
  mono?: boolean; // true in "No color" vision: all bars gray
  width?: number; // SVG width in px, default 280
  height?: number; // SVG height in px, default 120
}

const GAP = 4;
const PAD_TOP = 14; // room for the value label
const PAD_BOTTOM = 14; // room for the frame number
const GRAY: RGB = [160, 160, 160];

export function verdictText(
  verdict: "steady" | "changed" | "faint",
  changedFrame?: number,
): string {
  if (verdict === "steady") return "Steady: about the same in every frame.";
  if (verdict === "changed") {
    return changedFrame === undefined
      ? "Changed in one frame."
      : `Changed in frame ${changedFrame}.`;
  }
  return "Too faint to tell.";
}

export function barGeometry(
  snr: number[],
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number; value: number | null }[] {
  const n = snr.length;
  if (n === 0) return [];

  const barW = Math.max(0, (width - 2 * GAP - GAP * (n - 1)) / n);
  const plotH = Math.max(0, height - PAD_TOP - PAD_BOTTOM);
  const baseline = height - PAD_BOTTOM;

  let max = 0;
  for (const v of snr) {
    if (Number.isFinite(v) && v > max) max = v;
  }
  const scale = max > 0 ? plotH / max : 0;

  return snr.map((raw, k) => {
    const finite = Number.isFinite(raw);
    const value = finite ? raw : null;
    const h = finite && raw > 0 ? Math.min(plotH, raw * scale) : 0;
    return {
      x: GAP + k * (barW + GAP),
      y: baseline - h,
      w: barW,
      h,
      value,
    };
  });
}

function formatValue(v: number | null): string {
  return v === null ? "no data" : v.toFixed(1);
}

export default function LightCurveBars({
  frames,
  snr,
  verdict,
  changedFrame,
  colors,
  mono = false,
  width = 280,
  height = 120,
}: LightCurveBarsProps): JSX.Element {
  const m = Math.min(frames.length, snr.length);
  const shownFrames = frames.slice(0, m);
  const shownSnr = snr.slice(0, m);
  const geometry = barGeometry(shownSnr, width, height);

  const ariaLabel =
    "Signal at this pixel in each frame: " +
    shownFrames
      .map((f, k) => `frame ${f.i}: ${formatValue(geometry[k].value)}`)
      .join(", ");

  return (
    <div style={{ display: "grid", gap: "var(--space-2)", fontFamily: "var(--font-mono-stack)" }}>
      <svg
        role="img"
        aria-label={ariaLabel}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ display: "block", maxWidth: "100%" }}
      >
        {geometry.map((g, k) => {
          const frame = shownFrames[k];
          const color = colors[k];
          const fill =
            mono || !color ? `rgb(${GRAY.join(",")})` : `rgb(${color[0]},${color[1]},${color[2]})`;
          const isChanged =
            verdict === "changed" && changedFrame !== undefined && frame.i === changedFrame;
          return (
            <g key={k}>
              <rect
                x={g.x}
                y={g.y}
                width={g.w}
                height={g.h}
                fill={fill}
                strokeWidth={isChanged ? 2 : 0}
                style={isChanged ? { stroke: "var(--amber)" } : undefined}
              />
              <text
                x={g.x + g.w / 2}
                y={Math.max(10, g.y - 3)}
                textAnchor="middle"
                fontSize={10}
                style={{ fill: "var(--text)" }}
              >
                {g.value === null ? "–" : g.value.toFixed(1)}
              </text>
              <text
                x={g.x + g.w / 2}
                y={height - 3}
                textAnchor="middle"
                fontSize={10}
                style={{ fill: "var(--text-dim)" }}
              >
                {frame.i}
              </text>
            </g>
          );
        })}
      </svg>
      <p style={{ margin: 0, color: "var(--text)" }}>{verdictText(verdict, changedFrame)}</p>
      <ul style={{ margin: 0, paddingLeft: "var(--space-3)", color: "var(--text-dim)", fontSize: 12 }}>
        {shownFrames.map((f, k) => (
          <li key={k}>
            {`Frame ${f.i}: ${f.utc.replace("T", " ")} UTC, detectors ${f.detectors
              .map((d) => `D${d}`)
              .join(", ")}`}
          </li>
        ))}
      </ul>
    </div>
  );
}
