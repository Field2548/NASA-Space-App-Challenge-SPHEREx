"use client";
// Field viewer (BP 8.4). Canvas with integer nearest-neighbour upscale, one shared stretch for
// all frames, hover readout (pixel, RA/Dec, S/N), click to mark or inspect, frame info strip,
// "preview quality" badge for png8 data. The image area is neutral black with nothing on top
// except the player's own markers, which always carry the frame number (never colour only).
//
// Props:
//   field: Field                     field.json
//   frames: Float32Array[]           decoded S/N frames, same order as field.frames
//   frameIndex: number               array index into frames (0-based); Mark.frame is field.frames[k].i
//   marks: Mark[]                    the player's marks (all frames)
//   onMark(m: Mark): void            click in "mark" mode; x, y are integer pixels, tDays from frames[0].mjd
//   mode: "mark" | "inspect"         shown in the cursor and the status line
//   onInspect?(x, y): void           click in "inspect" mode
//   overlay?: "none" | "colorByTime" Color by time replaces the single frame
//   overlayFrames?: number[]         array indices for Color by time (default: first 7)
//   brightness?: number              black point in S/N (default field.stretch.black_sigma)
//   scale?: number                   integer upscale (default: fits 640 x 560)
//   colors?: RGB[]                   time colours per frame (default timeColors(n, vision))
//   vision?: Vision                  colour-vision mode for the default colours (default "normal")
//   inspectSlot?: ReactNode          slot drawn beside the image (Inspect popup, SERVER/DATA fill it)
//   crosshair?: [x, y] | null        keyboard crosshair drawn in the marks SVG (data-testid="kb-cursor")
//   known?: KnownOverlay | null      known asteroids (amber diamonds, shown frame only) and stars (teal rings), BP 8.18;
//                                    a diamond's name is the canvas tooltip and sits in a screen-reader list

import { type MouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { formatDec, formatRA } from "@/lib/coords";
import { colorByTime, makeSharedStretch, toImageData } from "@/lib/imaging";
import type { Field, Mark, RGB, Vision } from "@/lib/types";
import { pixelToSky } from "@/lib/wcs";
import { timeColors } from "@/lib/palettes";
import styles from "./FieldViewer.module.css";
import { asteroidsInFrame, type KnownOverlay } from "./overlay";

export const rgbCss = ([r, g, b]: RGB) => `rgb(${r} ${g} ${b})`;

export type ViewerMode = "mark" | "inspect";
export type ViewerOverlay = "none" | "colorByTime";

export interface FieldViewerProps {
  field: Field;
  frames: Float32Array[];
  frameIndex: number;
  marks: Mark[];
  onMark(m: Mark): void;
  mode: ViewerMode;
  onInspect?(x: number, y: number): void;
  overlay?: ViewerOverlay;
  overlayFrames?: number[];
  brightness?: number;
  scale?: number;
  colors?: RGB[];
  vision?: Vision;
  inspectSlot?: ReactNode;
  /** Keyboard crosshair at a native pixel; also feeds the readout when the pointer is away. */
  cursor?: { x: number; y: number };
  /** Same as cursor as an [x, y] tuple (PlayScreen's keyboard crosshair); wins over cursor. */
  crosshair?: [number, number] | null;
  /** Known-asteroid overlay; diamonds are drawn for the shown frame only. */
  known?: KnownOverlay | null;
}

/** Largest integer scale that fits the box, at least 1. */
export function fitScale(w: number, h: number, boxW = 640, boxH = 560): number {
  return Math.max(1, Math.floor(Math.min(boxW / w, boxH / h)));
}

/** Display pixel -> native pixel (0-based, top-down), clamped to the grid. */
export function clientToPixel(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  w: number,
  h: number,
): [number, number] {
  const x = Math.floor(((clientX - rect.left) * w) / rect.width);
  const y = Math.floor(((clientY - rect.top) * h) / rect.height);
  return [Math.min(w - 1, Math.max(0, x)), Math.min(h - 1, Math.max(0, y))];
}

export function formatUtc(utc: string): string {
  return `${utc.replace("T", " ").replace(/\.\d+/, "").replace(/Z$/, "")} UTC`;
}

export function formatGap(hours: number, first: boolean): string {
  if (first) return "first frame";
  const h = `+${hours.toFixed(1)} h`;
  return hours >= 48 ? `${h} (${(hours / 24).toFixed(1)} d)` : h;
}

/** Black and white of the base and overlay stretches (Python floors white at black + 10). */
export function stretchPoints(field: Field, black: number) {
  const overlayBlack = black + 2; // -1 sigma -> +1 sigma, motion_frames st_on
  return {
    base: { blackSigma: black, softSigma: field.stretch.soft_sigma, white: Math.max(field.stretch.white, black + 10) },
    overlay: { blackSigma: overlayBlack, softSigma: field.stretch.soft_sigma, white: Math.max(field.stretch.white, overlayBlack + 10) },
  };
}

const MODE_TEXT: Record<ViewerMode, string> = {
  mark: "MARK: click the mover to mark it in this frame",
  inspect: "INSPECT: click any pixel for details",
};

export default function FieldViewer(props: FieldViewerProps) {
  const { field, frames, frameIndex, marks, onMark, mode, onInspect, overlay = "none", inspectSlot } = props;
  const [W, H] = field.size;
  const black = props.brightness ?? field.stretch.black_sigma;
  const scale = Math.max(1, Math.round(props.scale ?? fitScale(W, H)));
  const n = frames.length;
  const k = Math.min(Math.max(0, frameIndex), Math.max(0, n - 1));
  const meta = field.frames[k];
  const vision = props.vision ?? "normal";
  const colors = useMemo(() => props.colors ?? timeColors(n, vision), [props.colors, n, vision]);
  const overlayFrames = useMemo(
    () => (props.overlayFrames ?? Array.from({ length: Math.min(n, 7) }, (_, i) => i)).filter((i) => i >= 0 && i < n),
    [props.overlayFrames, n],
  );

  const points = useMemo(() => stretchPoints(field, black), [field, black]);
  const baseGrays = useMemo(() => {
    const st = makeSharedStretch(frames, points.base);
    return frames.map(st);
  }, [frames, points]);
  const overlayRgba = useMemo(() => {
    if (overlay !== "colorByTime" || overlayFrames.length === 0) return null;
    const st = makeSharedStretch(frames, points.overlay);
    return colorByTime(
      overlayFrames.map((i) => st(frames[i])),
      overlayFrames.map((i) => colors[i]),
    );
  }, [overlay, overlayFrames, frames, points, colors]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || n === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const src = document.createElement("canvas");
    src.width = W;
    src.height = H;
    const sctx = src.getContext("2d");
    if (!sctx) return;
    sctx.putImageData(toImageData(overlayRgba ?? baseGrays[k], W, H), 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(src, 0, 0, W * scale, H * scale);
  }, [overlayRgba, baseGrays, k, W, H, scale, n]);

  const [hover, setHover] = useState<[number, number] | null>(null);
  const toPixel = (e: MouseEvent<HTMLCanvasElement>) =>
    clientToPixel(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect(), W, H);

  const known = props.known;
  const diamonds = useMemo(() => (known && meta ? asteroidsInFrame(known, meta.i) : []), [known, meta]);
  const hoverName = hover ? diamonds.find((d) => Math.abs(d.x - hover[0]) <= 1.5 && Math.abs(d.y - hover[1]) <= 1.5)?.name : undefined;

  const onPointerMove = (e: MouseEvent<HTMLCanvasElement>) => {
    const p = toPixel(e);
    setHover((h) => (h && h[0] === p[0] && h[1] === p[1] ? h : p));
  };
  const onClick = (e: MouseEvent<HTMLCanvasElement>) => {
    if (n === 0) return;
    const [x, y] = toPixel(e);
    if (mode === "inspect") {
      onInspect?.(x, y);
      return;
    }
    onMark({ frame: meta.i, x, y, tDays: meta.mjd - field.frames[0].mjd });
  };

  let readout = "move the pointer over the image";
  const want = props.crosshair ? { x: props.crosshair[0], y: props.crosshair[1] } : props.cursor;
  const cur = want && want.x >= 0 && want.x < W && want.y >= 0 && want.y < H ? want : null;  const probe = hover ?? (cur ? ([cur.x, cur.y] as [number, number]) : null);
  if (probe) {
    const [x, y] = probe;
    const [ra, dec] = pixelToSky(field.wcs, H, x, y);
    const v = frames[k]?.[y * W + x];
    const snr = v === undefined || !Number.isFinite(v) ? "no data" : v.toFixed(1);
    const snrLabel = overlay === "colorByTime" ? `S/N (frame ${k + 1})` : "S/N";
    readout = `x ${x}  y ${y}  RA ${formatRA(ra)}  Dec ${formatDec(dec)}  ${snrLabel} ${snr}`;
  }

  const frameNo = (i: number) => field.frames.findIndex((f) => f.i === i);
  const label = `Frame ${k + 1} of ${n}, ${meta ? formatUtc(meta.utc) : ""}${overlay === "colorByTime" ? ", Color by time" : ""}`;

  return (
    <div className={styles.root} data-mode={mode}>
      <div className={styles.strip} aria-label="Frame info">
        {meta ? (
          <>
            <span>
              FRAME {k + 1}/{n}
            </span>
            <span>{formatUtc(meta.utc)}</span>
            <span>{formatGap(meta.hours_since_prev, k === 0)}</span>
            <span>{meta.n_bands} bands</span>
            <span>det {meta.detectors.join(", ") || "n/a"}</span>
          </>
        ) : (
          <span>no frames</span>
        )}
        {field.data.precision === "png8" && <span className={styles.badge}>preview quality</span>}
        {overlay === "colorByTime" && <span>Color by time: {overlayFrames.length} frames</span>}
      </div>

      <div className={styles.stage}>
        <div className={`science-viewport ${styles.image}`} style={{ width: W * scale, height: H * scale }}>
          <canvas
            ref={canvasRef}
            width={W * scale}
            height={H * scale}
            role="img"
            aria-label={label}
            className={styles.canvas}
            style={{ cursor: mode === "inspect" ? "help" : "crosshair" }}
            data-testid="field-canvas"
            title={hoverName}
            onPointerMove={onPointerMove}
            onPointerLeave={() => setHover(null)}
            onClick={onClick}
          />
          <svg className={styles.marks} width={W * scale} height={H * scale} aria-hidden="true">
            {marks.map((m) => {
              const j = frameNo(m.frame);
              const cx = (m.x + 0.5) * scale;
              const cy = (m.y + 0.5) * scale;
              const r = Math.max(4, scale * 1.5);
              const current = overlay === "colorByTime" || j === k;
              const c = j >= 0 && colors[j] ? rgbCss(colors[j]) : "var(--cyan)";
              return (
                <g key={`${m.frame}-${m.x}-${m.y}`} opacity={current ? 1 : 0.55} data-frame={m.frame}>
                  <circle cx={cx} cy={cy} r={r} fill="none" stroke={c} strokeWidth={1.5} strokeDasharray={current ? undefined : "3 2"} />
                  <text x={cx + r + 2} y={cy - r} fill={c} fontSize={11} className={styles.markLabel}>
                    {j >= 0 ? j + 1 : m.frame}
                  </text>
                </g>
              );
            })}
            {known?.stars.map((s, i) => (
              <circle key={`star-${i}`} data-testid="known-star" cx={(s.x + 0.5) * scale} cy={(s.y + 0.5) * scale} r={Math.max(5, scale * 1.2)} fill="none" stroke="#00B3A4" strokeWidth={1.5} />
            ))}
            {diamonds.map((d, i) => {
              const cx = (d.x + 0.5) * scale;
              const cy = (d.y + 0.5) * scale;
              const r = Math.max(5, scale * 1.2);
              return (
                <polygon
                  key={`ast-${i}`}
                  data-testid="known-diamond"
                  data-frame={meta?.i}
                  data-x={d.x}
                  data-y={d.y}
                  points={`${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`}
                  fill="#E69F00"
                  fillOpacity={0.35}
                  stroke={colors[k] ? rgbCss(colors[k]) : "#E69F00"}
                  strokeWidth={2}
                />
              );
            })}
            {cur && (
              <g data-testid="kb-cursor" stroke="var(--text, #fff)" strokeWidth={1} fill="none">
                <path d={`M${(cur.x + 0.5) * scale} 0V${H * scale}M0 ${(cur.y + 0.5) * scale}H${W * scale}`} opacity={0.6} />
                <rect x={cur.x * scale} y={cur.y * scale} width={scale} height={scale} />
              </g>
            )}
          </svg>
        </div>
        {inspectSlot}
      </div>
      {diamonds.length > 0 && (
        <ul className="sr-only" aria-label="Known asteroids in this frame">
          {diamonds.map((d, i) => (
            <li key={i}>{d.name}</li>
          ))}
        </ul>
      )}

      <div className={styles.status}>
        <span className={styles.mode} data-testid="mode-status" aria-live="polite">
          MODE {MODE_TEXT[mode]}
        </span>
        <span className={styles.readout} data-testid="hover-readout">
          {readout}
        </span>
        <span className={styles.dim}>ICRS J2000 · {marks.length} marks</span>
      </div>
    </div>
  );
}
