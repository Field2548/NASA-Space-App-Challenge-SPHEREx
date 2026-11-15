"use client";
// Light intensity curve editor (PNL-06): input brightness (what the picture shows now) on the
// horizontal axis, output brightness on the vertical. Five points move up and down (drag or
// arrow keys, Shift for big steps); presets Linear, Log, asinh (the default look and the reset).
//
// Props: { value: Curve; onChange(c: Curve): void }

import { type KeyboardEvent, type PointerEvent, useRef } from "react";
import { applyCurve, CURVE_X, type Curve, curveAt, DEFAULT_CURVE, movePoint, type CurvePreset, presetCurve } from "@/lib/toneCurve";
import HelpImage from "./HelpImage";
import InfoPopover from "./InfoPopover";

const PRESETS: { key: CurvePreset; label: string }[] = [
  { key: "linear", label: "Linear" },
  { key: "log", label: "Log" },
  { key: "asinh", label: "asinh" },
];
const SIZE = 140;
const PAD = 8;
const sx = (x: number) => PAD + x * (SIZE - 2 * PAD);
const sy = (y: number) => SIZE - PAD - y * (SIZE - 2 * PAD);

/** 12 x 6 patch: a left-to-right ramp with a faint blob, to show what a curve does to tones. */
function rampScene(): { data: Float32Array; w: number; h: number } {
  const w = 12;
  const h = 6;
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = x / (w - 1);
  for (let y = 2; y < 4; y++) for (let x = 1; x < 3; x++) data[y * w + x] = 0.3;
  return { data, w, h };
}

export interface ToneCurveEditorProps {
  value: Curve;
  onChange(c: Curve): void;
}

export default function ToneCurveEditor({ value, onChange }: ToneCurveEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);

  const path = Array.from({ length: 41 }, (_, i) => `${i ? "L" : "M"}${sx(i / 40).toFixed(1)} ${sy(curveAt(value, i / 40)).toFixed(1)}`).join("");

  const onKey = (i: number) => (e: KeyboardEvent<SVGCircleElement>) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const dir = e.key === "ArrowUp" || e.key === "ArrowRight" ? 1 : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    onChange(movePoint(value, i, value[i] + dir * step));
  };
  const dragTo = (e: PointerEvent<SVGElement>) => {
    const i = drag.current;
    const r = svgRef.current?.getBoundingClientRect();
    if (i === null || !r || !r.height) return;
    const y = 1 - ((e.clientY - r.top) / r.height * SIZE - PAD) / (SIZE - 2 * PAD);
    onChange(movePoint(value, i, y));
  };

  const demo = value.every((y, i) => Math.abs(y - DEFAULT_CURVE[i]) < 1e-9) ? presetCurve("log") : value;
  const sc = rampScene();

  return (
    <div style={{ display: "grid", gap: "var(--space-2)", fontSize: 12 }}>
      <div>
        Light curve{" "}
        <InfoPopover label="Light curve" title="Light curve: how bright each level is drawn">
          <p>
            The picture is first stretched so faint things show (the asinh look). This curve then decides how bright each level is
            drawn: the left-right position is the brightness the picture has now, the height is the brightness it gets. Raise the
            middle of the curve to brighten faint things, lower it to darken them. Everything stays in order, brighter never turns
            darker than dimmer.
          </p>
          <p>
            Drag a dot up or down, or focus it and press the arrow keys (Shift for bigger steps). Presets: asinh is the default
            look and the reset, Linear is brightness proportional to the signal, Log lifts the faint end.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <HelpImage data={sc.data} w={sc.w} h={sc.h} label="Before: a plain ramp from dark to bright with a faint blob" caption="Before" />
            <HelpImage data={applyCurve(sc.data, demo)} w={sc.w} h={sc.h} label="After the curve: the faint blob is easier to see" caption="After" />
          </div>
        </InfoPopover>
      </div>
      <svg
        ref={svgRef}
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        style={{ touchAction: "none", border: "1px solid #666" }}
        onPointerMove={dragTo}
        onPointerUp={() => (drag.current = null)}
        onPointerLeave={() => (drag.current = null)}
      >
        <path d={`M${sx(0)} ${sy(0)}L${sx(1)} ${sy(1)}`} stroke="#666" strokeDasharray="3 3" fill="none" />
        <path d={path} stroke="var(--cyan, #0ff)" strokeWidth={2} fill="none" />
        {CURVE_X.map((x, i) => (
          <circle
            key={i}
            role="slider"
            tabIndex={0}
            aria-label={`Curve point ${i + 1} of ${CURVE_X.length}, input ${Math.round(x * 100)} percent`}
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(value[i] * 100)}
            cx={sx(x)}
            cy={sy(value[i])}
            r={6}
            fill="var(--bg, #000)"
            stroke="var(--cyan, #0ff)"
            strokeWidth={2}
            style={{ cursor: "ns-resize" }}
            onKeyDown={onKey(i)}
            onPointerDown={(e) => {
              drag.current = i;
              e.currentTarget.setPointerCapture?.(e.pointerId);
            }}
          />
        ))}
      </svg>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {PRESETS.map((p) => (
          <button key={p.key} type="button" onClick={() => onChange(presetCurve(p.key))}>
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
