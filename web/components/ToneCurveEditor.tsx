"use client";
// Light intensity curve editor (PNL-06). One one-handle Bezier curve; the handle slides along the
// anti-diagonal (drag, or arrow keys with Shift for big steps). The 3-stop Stretch slider (Linear,
// Log, asinh; asinh is the default look and the reset) sets that same curve to a preset shape.
//
// Props: { value: Curve; onChange(c: Curve): void }

import { type KeyboardEvent, type PointerEvent, useRef } from "react";
import { applyCurve, bezierAt, clampBend, CURVE_PRESETS, type Curve, type CurvePreset, handleOf, isDefaultCurve, PRESET_BEND, presetCurve, presetOf } from "@/lib/toneCurve";
import HelpImage from "./HelpImage";
import InfoPopover from "./InfoPopover";

const PRESET_LABEL: Record<CurvePreset, string> = { linear: "Linear", log: "Log", asinh: "asinh" };
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
  const dragging = useRef(false);
  const setBend = (b: number) => onChange({ bend: clampBend(b) });

  const path = Array.from({ length: 41 }, (_, i) => `${i ? "L" : "M"}${sx(i / 40).toFixed(1)} ${sy(bezierAt(value.bend, i / 40)).toFixed(1)}`).join("");
  const h = handleOf(value.bend);

  const onKey = (e: KeyboardEvent<SVGCircleElement>) => {
    const step = e.shiftKey ? 0.2 : 0.05;
    const dir = e.key === "ArrowUp" || e.key === "ArrowRight" ? 1 : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    setBend(Math.round((value.bend + dir * step) * 100) / 100);
  };
  const dragTo = (e: PointerEvent<SVGElement>) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!dragging.current || !r || !r.width || !r.height) return;
    const x = ((e.clientX - r.left) / r.width * SIZE - PAD) / (SIZE - 2 * PAD);
    const y = 1 - ((e.clientY - r.top) / r.height * SIZE - PAD) / (SIZE - 2 * PAD);
    setBend(y - x); // projection onto the anti-diagonal
  };

  // The slider sits on the matching stop, or on the nearest one when the handle was dragged off.
  const preset = presetOf(value);
  const nearest = CURVE_PRESETS.reduce((a, p) => (Math.abs(PRESET_BEND[p] - value.bend) < Math.abs(PRESET_BEND[a] - value.bend) ? p : a));
  const presetIdx = CURVE_PRESETS.indexOf(preset ?? nearest);
  const stretchText = preset ? PRESET_LABEL[preset] : "Custom";
  const demo = isDefaultCurve(value) ? presetCurve("log") : value;
  const sc = rampScene();

  return (
    <div style={{ display: "grid", gap: "var(--space-2)", fontSize: 12 }}>
      <div>
        Light curve{" "}
        <InfoPopover label="Light curve" title="Light curve: how bright each level is drawn">
          <p>
            The Stretch slider sets the curve to a ready shape: asinh is the default look and the reset, Linear is brightness
            proportional to the signal, Log lifts the faint end. Moving the dot off a shape shows Custom.
          </p>
          <p>
            On the curve, left-right is the brightness the picture has now, the height is the brightness it gets.
            Drag the dot up-left to brighten faint things, down-right to darken them, or focus it and press the arrow keys (Shift for
            bigger steps). Everything stays in order, brighter never turns darker than dimmer.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <HelpImage data={sc.data} w={sc.w} h={sc.h} label="Before: a plain ramp from dark to bright with a faint blob" caption="Before" />
            <HelpImage data={applyCurve(sc.data, demo)} w={sc.w} h={sc.h} label="After the curve: the faint blob is easier to see" caption="After" />
          </div>
        </InfoPopover>
      </div>
      <label style={{ display: "grid", gap: 2 }}>
        <span>Stretch: {stretchText}</span>
        <input
          type="range"
          min={0}
          max={CURVE_PRESETS.length - 1}
          step={1}
          list="tone-presets"
          value={presetIdx}
          aria-label="Stretch"
          aria-valuetext={stretchText}
          onChange={(e) => onChange(presetCurve(CURVE_PRESETS[Number(e.target.value)] ?? "asinh"))}
        />
        <datalist id="tone-presets">
          {CURVE_PRESETS.map((p, i) => (
            <option key={p} value={i} label={PRESET_LABEL[p]} />
          ))}
        </datalist>
        <span style={{ display: "flex", justifyContent: "space-between", opacity: 0.8 }} aria-hidden="true">
          {CURVE_PRESETS.map((p) => (
            <span key={p}>{PRESET_LABEL[p]}</span>
          ))}
        </span>
      </label>
      <svg
        ref={svgRef}
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        style={{ touchAction: "none", border: "1px solid #666" }}
        onPointerMove={dragTo}
        onPointerUp={() => (dragging.current = false)}
        onPointerLeave={() => (dragging.current = false)}
      >
        <path d={`M${sx(0)} ${sy(0)}L${sx(1)} ${sy(1)}`} stroke="#666" strokeDasharray="3 3" fill="none" />
        <path d={`M${sx(0)} ${sy(1)}L${sx(1)} ${sy(0)}`} stroke="#444" strokeDasharray="1 3" fill="none" />
        <path d={`M${sx(0)} ${sy(0)}L${sx(h.x)} ${sy(h.y)}L${sx(1)} ${sy(1)}`} stroke="#888" strokeWidth={1} fill="none" />
        <path d={path} stroke="var(--cyan, #0ff)" strokeWidth={2} fill="none" />
        <circle
          role="slider"
          tabIndex={0}
          aria-label="Curve bend"
          aria-valuemin={-100}
          aria-valuemax={100}
          aria-valuenow={Math.round(value.bend * 100)}
          aria-valuetext={value.bend > 0 ? `brighter faint end, ${Math.round(value.bend * 100)}` : value.bend < 0 ? `darker faint end, ${Math.round(-value.bend * 100)}` : "straight"}
          cx={sx(h.x)}
          cy={sy(h.y)}
          r={6}
          fill="var(--bg, #000)"
          stroke="var(--cyan, #0ff)"
          strokeWidth={2}
          style={{ cursor: "move" }}
          onKeyDown={onKey}
          onPointerDown={(e) => {
            dragging.current = true;
            e.currentTarget.setPointerCapture?.(e.pointerId);
          }}
        />
      </svg>
    </div>
  );
}
