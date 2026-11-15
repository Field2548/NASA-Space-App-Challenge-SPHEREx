"use client";

// SpectrumChart: a 102-band spectrum (brightness against wavelength) for Inspect section C.
// BUILD_PROMPT 8.16 "C. Spectrum view", item 1. Pure helpers are exported for the tests.

import { WL_MAX_UM, WL_MIN_UM, wavelengthColor } from "@/lib/spectra";
import type { Vision } from "@/lib/types";

export interface SpectrumPoint {
  wl: number;
  value: number;
  err: number;
  band?: number;
  det?: number;
  date?: string;
}

export interface MoleculeBand {
  name: string;
  label: string;
  center_um: number;
  range_um: [number, number];
}

export interface MoleculeFamily {
  id: string;
  label: string;
  bands: MoleculeBand[];
}

export interface ModelCurve {
  label: string;
  wl: number[];
  value: number[];
}

export interface SpectrumChartProps {
  points: SpectrumPoint[];
  units: "MJy/sr" | "mJy";
  vision?: Vision; // default "normal"; "mono" draws gray dots
  families?: MoleculeFamily[]; // molecule bands to shade; omit for none
  models?: ModelCurve[];
  width?: number; // default 520
  height?: number; // default 260
  csvName?: string; // file name for the download, default "spectrum.csv"
}

export const CHART_MARGIN: { left: number; right: number; top: number; bottom: number } = {
  left: 56,
  right: 12,
  top: 18,
  bottom: 36,
};

const FALSE_COLOR_NOTE = "False color: infrared is invisible, so colors stand in for wavelength.";
const CAVEAT =
  "Built from single images taken over many months. Things that move are not in it. One pixel (6.15″) can mix several objects. A lone spike can be a cosmic-ray hit or a passing asteroid.";

// ---------------------------------------------------------------------------------------------
// Pure helpers

/** Points with finite wl and value inside WL_MIN_UM..WL_MAX_UM; bad err becomes 0; sorted by wl. Never mutates. */
export function validPoints(points: SpectrumPoint[]): SpectrumPoint[] {
  return points
    .filter(
      (p) =>
        Number.isFinite(p.wl) &&
        Number.isFinite(p.value) &&
        p.wl >= WL_MIN_UM &&
        p.wl <= WL_MAX_UM,
    )
    .map((p) => ({ ...p, err: Number.isFinite(p.err) && p.err >= 0 ? p.err : 0 }))
    .sort((a, b) => a.wl - b.wl);
}

/** Brightness range: 0 (or the lowest value minus err) to the highest value plus err, padded by 5%. */
export function yRange(points: SpectrumPoint[]): [number, number] {
  const v = validPoints(points);
  if (v.length === 0) return [0, 1];
  let lo = 0;
  let hi = -Infinity;
  for (const p of v) {
    lo = Math.min(lo, p.value - p.err);
    hi = Math.max(hi, p.value + p.err);
  }
  const pad = 0.05 * (hi - lo);
  hi += pad;
  if (lo === 0) lo = 0; // keeps a 0 floor exactly 0 (and turns -0 into 0)
  else lo -= pad;
  if (hi <= lo) return [lo, lo + 1];
  return [lo, hi];
}

export function xToPx(wl: number, width: number): number {
  const plotWidth = width - CHART_MARGIN.left - CHART_MARGIN.right;
  return CHART_MARGIN.left + ((wl - WL_MIN_UM) / (WL_MAX_UM - WL_MIN_UM)) * plotWidth;
}

export function yToPx(value: number, range: [number, number], height: number): number {
  const [lo, hi] = range;
  const bottom = height - CHART_MARGIN.bottom;
  const top = CHART_MARGIN.top;
  if (hi === lo) return bottom;
  return bottom + ((value - lo) / (hi - lo)) * (top - bottom);
}

/** About `count` round tick values (multiples of 1, 2 or 5 times a power of ten) inside [lo, hi]. */
export function niceTicks(lo: number, hi: number, count = 4): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) return [];
  const e0 = Math.floor(Math.log10((hi - lo) / count));
  let best: number[] = [];
  let bestGap = Infinity;
  for (let e = e0 - 2; e <= e0 + 2; e++) {
    for (const m of [1, 2, 5]) {
      const step = Number(`${m}e${e}`);
      const kMin = Math.ceil(lo / step - 1e-9);
      const kMax = Math.floor(hi / step + 1e-9);
      const n = kMax - kMin + 1;
      if (n < 3 || n > 6) continue;
      const gap = Math.abs(n - count);
      if (gap < bestGap) {
        bestGap = gap;
        best = [];
        for (let k = kMin; k <= kMax; k++) {
          const v = Number((k * step).toPrecision(12));
          best.push(v === 0 ? 0 : v); // no -0
        }
      }
    }
  }
  return best;
}

function csvCell(v: string | number | undefined): string {
  if (v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV of the valid points, in wavelength order. Missing band, detector or date are empty cells. */
export function spectrumCsv(points: SpectrumPoint[], units: string): string {
  const header = [
    "band",
    "wavelength_um",
    `value_${units.replace(/\//g, "_per_")}`,
    "error",
    "detector",
    "date",
  ].join(",");
  const rows = validPoints(points).map((p) =>
    [
      csvCell(p.band),
      csvCell(p.wl),
      csvCell(p.value),
      csvCell(p.err),
      csvCell(p.det),
      csvCell(p.date),
    ].join(","),
  );
  return [header, ...rows].join("\n") + "\n";
}

/** n to d decimals, rounding half up (toFixed alone turns 1.2345 into 1.234). */
function fixedRound(n: number, d: number): string {
  const f = 10 ** d;
  return (Math.round(n * f) / f).toFixed(d);
}

/** n to d significant digits, without trailing zeros. */
function sig(n: number, d: number): string {
  return String(Number(n.toPrecision(d)));
}

function bandTooltip(p: SpectrumPoint, units: string): string {
  const parts: string[] = [];
  if (typeof p.band === "number") parts.push(`Band ${p.band}`);
  parts.push(`${fixedRound(p.wl, 3)} µm`);
  parts.push(`${sig(p.value, 3)} ± ${sig(p.err, 2)} ${units}`);
  if (typeof p.det === "number") parts.push(`detector D${p.det}`);
  if (typeof p.date === "string" && p.date !== "") parts.push(p.date);
  return parts.join(" · ");
}

function tickLabel(t: number): string {
  return String(Number(t.toPrecision(4)));
}

// ---------------------------------------------------------------------------------------------
// Component

const axisText = { fill: "var(--text-dim)" } as const;

export default function SpectrumChart({
  points,
  units,
  vision = "normal",
  families = [],
  models = [],
  width = 520,
  height = 260,
  csvName = "spectrum.csv",
}: SpectrumChartProps) {
  const valid = validPoints(points);
  const hasData = valid.length > 0;
  const [yLo, yHi] = yRange(valid);
  const left = CHART_MARGIN.left;
  const right = width - CHART_MARGIN.right;
  const top = CHART_MARGIN.top;
  const bottom = height - CHART_MARGIN.bottom;
  const xp = (wl: number) => xToPx(wl, width);
  const yp = (v: number) => yToPx(v, [yLo, yHi], height);
  const yTicks = niceTicks(yLo, yHi, 3);
  const xTicks = [1, 2, 3, 4, 5];
  const midY = (top + bottom) / 2;

  const label = hasData
    ? `Spectrum: ${valid.length} bands from ${fixedRound(valid[0].wl, 2)} to ${fixedRound(valid[valid.length - 1].wl, 2)} micron`
    : "Spectrum: no data";

  const downloadCsv = () => {
    const blob = new Blob([spectrumCsv(points, units)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = csvName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ maxWidth: "100%", color: "var(--text)", fontFamily: "var(--font-mono-stack)", fontSize: 12 }}>
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        style={{ display: "block", maxWidth: width, height: "auto", overflow: "hidden" }}
      >
        {/* Molecule bands first, so they sit behind the dots. Clamped to the plot area. */}
        {families.flatMap((fam) =>
          fam.bands.map((b) => {
            const x0 = Math.max(left, xp(b.range_um[0]));
            const x1 = Math.min(right, xp(b.range_um[1]));
            if (!(x1 > x0)) return null;
            const ice = fam.id === "ice";
            return (
              <g key={`${fam.id}-${b.name}-${b.center_um}`}>
                <rect
                  x={x0}
                  y={top}
                  width={x1 - x0}
                  height={bottom - top}
                  data-family={fam.id}
                  style={
                    ice
                      ? { fill: "var(--amber)", fillOpacity: 0.06, stroke: "var(--amber)" }
                      : { fill: "var(--cyan)", fillOpacity: 0.14, stroke: "none" }
                  }
                  strokeDasharray={ice ? "4 3" : undefined}
                />
                <text
                  x={(x0 + x1) / 2}
                  y={ice ? bottom - 4 : top + 10}
                  textAnchor="middle"
                  fontSize={10}
                  style={{ fill: "var(--text)" }}
                >
                  {b.label}
                </text>
              </g>
            );
          }),
        )}

        {/* Grid and axes */}
        {yTicks.map((t) => (
          <g key={`gy-${t}`}>
            <line x1={left} x2={right} y1={yp(t)} y2={yp(t)} style={{ stroke: "var(--grid)" }} />
            <text x={left - 6} y={yp(t) + 3} textAnchor="end" fontSize={10} style={axisText}>
              {tickLabel(t)}
            </text>
          </g>
        ))}
        <line x1={left} x2={left} y1={top} y2={bottom} style={{ stroke: "var(--line)" }} />
        <line x1={left} x2={right} y1={bottom} y2={bottom} style={{ stroke: "var(--line)" }} />
        {xTicks.map((t) => (
          <text key={`gx-${t}`} x={xp(t)} y={bottom + 14} textAnchor="middle" fontSize={10} style={axisText}>
            {t}
          </text>
        ))}
        <text x={(left + right) / 2} y={bottom + 30} textAnchor="middle" fontSize={11} style={axisText}>
          Wavelength (µm)
        </text>
        <text
          x={14}
          y={midY}
          textAnchor="middle"
          fontSize={11}
          style={axisText}
          transform={`rotate(-90 14 ${midY})`}
        >
          {`Brightness (${units})`}
        </text>

        {!hasData ? (
          <text x={(left + right) / 2} y={midY} textAnchor="middle" fontSize={12} style={{ fill: "var(--text-dim)" }}>
            No spectrum here.
          </text>
        ) : null}

        {/* Error bars */}
        {valid.map((p, i) => (
          <line
            key={`e-${i}`}
            x1={xp(p.wl)}
            x2={xp(p.wl)}
            y1={yp(p.value + p.err)}
            y2={yp(p.value - p.err)}
            style={{ stroke: "var(--text-dim)" }}
            strokeWidth={1}
          />
        ))}

        {/* Model curves (dashed, not coloured by wavelength) */}
        {models.map((m) => {
          const pts = m.wl
            .map((w, i) => [w, m.value[i]] as const)
            .filter(([w, v]) => Number.isFinite(w) && Number.isFinite(v) && w >= WL_MIN_UM && w <= WL_MAX_UM)
            .map(([w, v]) => `${xp(w)},${yp(v)}`)
            .join(" ");
          return (
            <polyline
              key={`m-${m.label}`}
              data-model={m.label}
              points={pts}
              fill="none"
              strokeWidth={1}
              strokeDasharray="4 3"
              style={{ stroke: "var(--text-dim)" }}
            />
          );
        })}

        {/* Connecting line through the dots, in wavelength order */}
        {hasData ? (
          <polyline
            fill="none"
            strokeWidth={1}
            style={{ stroke: "var(--text-dim)" }}
            points={valid.map((p) => `${xp(p.wl)},${yp(p.value)}`).join(" ")}
          />
        ) : null}

        {/* One dot per band, with a built-in tooltip */}
        {valid.map((p, i) => {
          const [r, g, b] = wavelengthColor(p.wl, vision);
          return (
            <circle key={`d-${i}`} cx={xp(p.wl)} cy={yp(p.value)} r={3} fill={`rgb(${r},${g},${b})`}>
              <title>{bandTooltip(p, units)}</title>
            </circle>
          );
        })}
      </svg>

      <ul
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "4px 14px",
          listStyle: "none",
          padding: 0,
          margin: "var(--space-2) 0 0",
        }}
      >
        {families.map((fam) => {
          const ice = fam.id === "ice";
          return (
            <li key={`lf-${fam.id}`} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                aria-hidden="true"
                style={
                  ice
                    ? { display: "inline-block", width: 14, height: 10, border: "1px dashed var(--amber)" }
                    : { display: "inline-block", width: 14, height: 10, background: "var(--cyan)", opacity: 0.35 }
                }
              />
              {fam.label}
            </li>
          );
        })}
        {models.map((m) => (
          <li key={`lm-${m.label}`} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              aria-hidden="true"
              style={{ display: "inline-block", width: 16, borderTop: "1px dashed var(--text-dim)" }}
            />
            {m.label}
          </li>
        ))}
      </ul>

      <p style={{ color: "var(--text-dim)", margin: "var(--space-2) 0 0" }}>{FALSE_COLOR_NOTE}</p>
      <p style={{ color: "var(--text-dim)", margin: "var(--space-1) 0 0" }}>{CAVEAT}</p>

      <button
        type="button"
        onClick={downloadCsv}
        style={{
          marginTop: "var(--space-2)",
          padding: "var(--space-1) var(--space-2)",
          fontSize: 12,
          color: "var(--text)",
          background: "var(--bg-1)",
          border: "1px solid var(--line)",
          cursor: "pointer",
        }}
      >
        Download CSV
      </button>
    </div>
  );
}
