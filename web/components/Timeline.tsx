"use client";
// Timeline v1 (BP 8.8): Track 1 frame clips with thumbnails and time-coloured borders, date/time
// and "+gap" labels, a playhead with scrubbing, optional ONION range track, Track 2 "My marks".
// Keyboard: focus the frames track, then Left/Right step, Home/End jump, Space plays or pauses.
//
// Props:
//   field: Field; frames: Float32Array[] (decoded S/N)
//   index: number; onIndexChange(i: number): void      array index (0-based)
//   marks?: Mark[]                                      shown on Track 2
//   colors?: RGB[]                                      time colours (default timeColors(n, vision))
//   vision?: Vision                                     colour-vision mode for the default colours
//   brightness?: number                                 black point for the fallback thumbnails (S/N)
//   playing?: boolean; onTogglePlay?(): void            blink control (from useBlink)
//   reducedMotion?: boolean                             shows that auto-play is off
//   controlsSlot?: ReactNode                            "Frames & spacing" controls at the left
//   loopMode?: "loop" | "pingpong"; onLoopModeChange?(m)  Loop / Ping-pong toggle shown when the callback is
//                                                          given (PlayScreen passes the same mode to useBlink)
//   onionRange?: [a, b]; onOnionRangeChange?(r)         inclusive array indices for Color by time (2..7 frames);
//                                                          the ONION track shows when onionRange is given;
//                                                          FieldViewer overlayFrames = onionRangeFrames(range)
//   realSpacing?: boolean; onRealSpacingChange?(v)      true gaps from mjd (log scale when max/min gap > 10);
//                                                          the checkbox shows when the callback is given
//
// Thumbnails: field.thumbs (one 48x48 WebP per frame, via loadThumbs) when there are as many as
// frames; otherwise, while loading, and on error, the frame-derived canvas at `brightness`.

import { type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { loadThumbs } from "@/lib/fields";
import { makeSharedStretch, toImageData } from "@/lib/imaging";
import type { Field, Mark, RGB, Vision } from "@/lib/types";
import type { BlinkMode } from "@/lib/useBlink";
import { timeColors } from "@/lib/palettes";
import { formatGap, rgbCss, stretchPoints } from "./FieldViewer";
import styles from "./Timeline.module.css";

export const CLIP_W = 112;
export const CLIP_GAP = 8;
export const ONION_MAX = 7;
const STEP = CLIP_W + CLIP_GAP;
const HANDLE_W = 10;

export interface TimelineProps {
  field: Field;
  frames: Float32Array[];
  index: number;
  onIndexChange(i: number): void;
  marks?: Mark[];
  colors?: RGB[];
  vision?: Vision;
  brightness?: number;
  playing?: boolean;
  onTogglePlay?(): void;
  reducedMotion?: boolean;
  controlsSlot?: ReactNode;
  loopMode?: BlinkMode;
  onLoopModeChange?(m: BlinkMode): void;
  onionRange?: [number, number];
  onOnionRangeChange?(r: [number, number]): void;
  realSpacing?: boolean;
  onRealSpacingChange?(v: boolean): void;
  /** Draw thumbnails from `frames` (a rebuilt wavelength band) instead of the all-band field.thumbs. */
  thumbsFromFrames?: boolean;
}

/** New index for a key press, or null if the key is not ours. */
export function keyToIndex(key: string, i: number, n: number): number | null {
  if (n === 0) return null;
  if (key === "ArrowRight") return Math.min(n - 1, i + 1);
  if (key === "ArrowLeft") return Math.max(0, i - 1);
  if (key === "Home") return 0;
  if (key === "End") return n - 1;
  return null;
}

/** Frame array indices a..b inclusive, for FieldViewer overlayFrames. */
export function onionRangeFrames(r: [number, number]): number[] {
  const lo = Math.min(r[0], r[1]);
  const hi = Math.max(r[0], r[1]);
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}

/** Clamp a range into 0..n-1, ordered, 2 frames at least when n >= 2, ONION_MAX at most. */
export function clampOnion(r: [number, number], n: number): [number, number] {
  if (n <= 0) return [0, 0];
  let a = Math.min(n - 1, Math.max(0, Math.round(Math.min(r[0], r[1]))));
  let b = Math.min(n - 1, Math.max(0, Math.round(Math.max(r[0], r[1]))));
  if (n >= 2 && a === b) {
    if (b < n - 1) b += 1;
    else a -= 1;
  }
  if (b - a > ONION_MAX - 1) b = a + ONION_MAX - 1;
  return [a, b];
}

/**
 * Left edge of each clip. Even: k * STEP. Real: the smallest mjd gap gets one STEP and the others
 * scale with their gap, linearly, or as 1 + log2(gap / min) when max/min > 10.
 */
export function clipOffsets(field: Pick<Field, "frames">, n: number, real: boolean): { left: number[]; log: boolean } {
  const even = Array.from({ length: n }, (_, k) => k * STEP);
  if (!real || n < 2) return { left: even, log: false };
  const gaps: number[] = [];
  for (let k = 1; k < n; k++) gaps.push(field.frames[k].mjd - field.frames[k - 1].mjd);
  if (gaps.some((g) => !(g > 0))) return { left: even, log: false };
  const min = Math.min(...gaps);
  const log = Math.max(...gaps) / min > 10;
  const left = [0];
  for (const g of gaps) left.push(left[left.length - 1] + STEP * (log ? 1 + Math.log2(g / min) : g / min));
  return { left, log };
}

function nearestClip(x: number, left: number[]): number {
  let best = 0;
  let bd = Number.POSITIVE_INFINITY;
  left.forEach((l, k) => {
    const d = Math.abs(x - (l + CLIP_W / 2));
    if (d < bd) {
      bd = d;
      best = k;
    }
  });
  return best;
}

function shortUtc(utc: string): string {
  return utc.slice(5, 16).replace("T", " ");
}

function Thumb({ gray, w, h, bitmap }: { gray: Float32Array | null; w: number; h: number; bitmap?: ImageBitmap }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const cw = bitmap ? bitmap.width : w;
  const ch = bitmap ? bitmap.height : h;
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    if (bitmap) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bitmap, 0, 0);
    } else if (gray) {
      ctx.putImageData(toImageData(gray, w, h), 0, 0);
    }
  }, [gray, w, h, bitmap]);
  return <canvas ref={ref} width={cw} height={ch} className={styles.thumb} aria-hidden="true" data-thumb={bitmap ? "webp" : "frame"} />;
}

export default function Timeline(props: TimelineProps) {
  const { field, frames, index, onIndexChange, marks = [], playing = false, onTogglePlay, reducedMotion = false, controlsSlot } = props;
  const { loopMode, onLoopModeChange, realSpacing = false, onRealSpacingChange, onOnionRangeChange } = props;
  const [W, H] = field.size;
  const n = frames.length;
  const vision = props.vision ?? "normal";
  const colors = useMemo(() => props.colors ?? timeColors(n, vision), [props.colors, n, vision]);
  const black = props.brightness ?? field.stretch.black_sigma;

  const [loaded, setLoaded] = useState<{ field: Field; list: ImageBitmap[] } | null>(null);
  const thumbs = loaded && loaded.field === field ? loaded.list : null;
  useEffect(() => {
    let live = true;
    try {
      loadThumbs(field)
        .then((list) => {
          if (live) setLoaded({ field, list });
        })
        .catch(() => {});
    } catch {
      /* the frame-derived thumbnails stay */
    }
    return () => {
      live = false;
    };
  }, [field]);
  const useWebp = !props.thumbsFromFrames && thumbs !== null && n > 0 && thumbs.length === n;

  const grays = useMemo(() => {
    if (useWebp) return null;
    const st = makeSharedStretch(frames, stretchPoints(field, black).base);
    return frames.map(st);
  }, [frames, field, black, useWebp]);
  const uid = useId();
  const clipId = (k: number) => `${uid}-clip-${k}`;
  const scrubbing = useRef(false);

  const { left, log } = useMemo(() => clipOffsets(field, n, realSpacing), [field, n, realSpacing]);
  const total = n > 0 ? left[n - 1] + CLIP_W + 4 : 0;
  const margin = (k: number) => (k === 0 ? 0 : left[k] - left[k - 1] - CLIP_W);
  const onion = props.onionRange ? clampOnion(props.onionRange, n) : null;
  const onionRow = useRef<HTMLDivElement>(null);
  const markRow = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === " " && onTogglePlay) {
      e.preventDefault();
      onTogglePlay();
      return;
    }
    const next = keyToIndex(e.key, index, n);
    if (next === null) return;
    e.preventDefault();
    if (next !== index) onIndexChange(next);
  };

  const indexAt = (e: PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const x = e.clientX - el.getBoundingClientRect().left + el.scrollLeft - 2;
    return nearestClip(x, left);
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (n === 0) return;
    scrubbing.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const k = indexAt(e);
    if (k !== index) onIndexChange(k);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!scrubbing.current || n === 0) return;
    const k = indexAt(e);
    if (k !== index) onIndexChange(k);
  };
  const endScrub = () => {
    scrubbing.current = false;
  };

  const moveOnion = (which: 0 | 1, k: number) => {
    if (!onion || !onOnionRangeChange || n < 2) return;
    let [a, b] = onion;
    if (which === 0) a = Math.max(b - (ONION_MAX - 1), Math.min(b - 1, Math.max(0, k)));
    else b = Math.min(a + (ONION_MAX - 1), Math.max(a + 1, Math.min(n - 1, k)));
    if (a !== onion[0] || b !== onion[1]) onOnionRangeChange([a, b]);
  };
  const onHandleKey = (which: 0 | 1) => (e: KeyboardEvent<HTMLDivElement>) => {
    if (!onion) return;
    const cur = onion[which];
    let next: number | null = null;
    if (e.key === "ArrowLeft") next = cur - 1;
    else if (e.key === "ArrowRight") next = cur + 1;
    else if (e.key === "Home") next = which === 0 ? 0 : onion[0] + 1;
    else if (e.key === "End") next = which === 0 ? onion[1] - 1 : n - 1;
    if (next === null) return;
    e.preventDefault();
    moveOnion(which, next);
  };
  const handleDrag = (which: 0 | 1) => ({
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      e.currentTarget.dataset.drag = "1";
    },
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
      const row = onionRow.current;
      if (e.currentTarget.dataset.drag !== "1" || !row) return;
      moveOnion(which, nearestClip(e.clientX - row.getBoundingClientRect().left + row.scrollLeft - 2, left));
    },
    onPointerUp: (e: PointerEvent<HTMLDivElement>) => {
      delete e.currentTarget.dataset.drag;
    },
    onPointerCancel: (e: PointerEvent<HTMLDivElement>) => {
      delete e.currentTarget.dataset.drag;
    },
  });

  const marked = new Set(marks.map((m) => m.frame));
  const playheadLeft = (left[index] ?? 0) + CLIP_W / 2;

  return (
    <section className={styles.root} aria-label="Timeline">
      <div className={styles.controls}>
        <div className={styles.buttons}>
          <button type="button" aria-label="Previous frame" onClick={() => onIndexChange(Math.max(0, index - 1))} disabled={index <= 0}>
            ◀
          </button>
          {onTogglePlay && (
            <button type="button" aria-label={playing ? "Pause blink" : "Play blink"} aria-pressed={playing} onClick={onTogglePlay} disabled={reducedMotion || n < 2} data-tutorial-target="play-button">
              {playing ? "Pause" : "Blink"}
            </button>
          )}
          <button type="button" aria-label="Next frame" onClick={() => onIndexChange(Math.min(n - 1, index + 1))} disabled={index >= n - 1}>
            ▶
          </button>
          {onLoopModeChange && (
            <button
              type="button"
              aria-label={`Blink order: ${loopMode === "pingpong" ? "ping-pong" : "loop"}. Switch`}
              onClick={() => onLoopModeChange(loopMode === "pingpong" ? "loop" : "pingpong")}
            >
              {loopMode === "pingpong" ? "Ping-pong" : "Loop"}
            </button>
          )}
        </div>
        {onRealSpacingChange && (
          <label className={styles.check}>
            <input type="checkbox" checked={realSpacing} onChange={(e) => onRealSpacingChange(e.target.checked)} />
            Real time spacing{realSpacing && log ? " (log scale)" : ""}
          </label>
        )}
        <p className={styles.note}>{reducedMotion ? "Auto-play off (reduced motion). Step with ← →." : "Max 3 frames/s. Step with ← →."}</p>
        {controlsSlot ?? (
          <div className={styles.slot} data-slot="frames-and-spacing">
            FRAMES &amp; SPACING
          </div>
        )}
      </div>

      <div className={styles.tracks}>
        <div className={styles.trackLabel}>FRAMES</div>
        <div
          className={styles.clips}
          role="listbox"
          aria-label="Frames"
          data-tutorial-target="frame-picker"
          aria-orientation="horizontal"
          aria-activedescendant={n ? clipId(index) : undefined}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endScrub}
          onPointerCancel={endScrub}
          onScroll={(e) => {
            const x = e.currentTarget.scrollLeft;
            if (onionRow.current) onionRow.current.scrollLeft = x;
            if (markRow.current) markRow.current.scrollLeft = x;
          }}
        >
          {field.frames.slice(0, n).map((f, k) => (
            <div
              key={f.i}
              id={clipId(k)}
              role="option"
              aria-selected={k === index}
              aria-label={`Frame ${k + 1} of ${n}, ${f.utc}, ${formatGap(f.hours_since_prev, k === 0)}`}
              className={`${styles.clip} ${k === index ? styles.current : ""} ${onion && k >= onion[0] && k <= onion[1] ? styles.inOnion : ""}`}
              style={{ width: CLIP_W, marginLeft: margin(k), borderColor: colors[k] ? rgbCss(colors[k]) : undefined }}
            >
              <div className={`science-viewport ${styles.thumbBox}`}>
                <Thumb gray={grays ? grays[k] : null} w={W} h={H} bitmap={useWebp && thumbs ? thumbs[k] : undefined} />
              </div>
              <div className={styles.clipText}>
                <span>
                  <b>{k + 1}</b> {shortUtc(f.utc)}
                </span>
                <span>{k === 0 ? "start" : formatGap(f.hours_since_prev, false)}</span>
              </div>
            </div>
          ))}
          {n > 0 && <div className={styles.playhead} style={{ left: playheadLeft }} aria-hidden="true" />}
        </div>

        {onion && (
          <>
            <div className={styles.trackLabel}>ONION</div>
            <div className={styles.onionRow} ref={onionRow}>
              <div className={styles.onionLane} style={{ width: total }}>
                <div className={styles.onionBar} style={{ left: left[onion[0]], width: left[onion[1]] + CLIP_W - left[onion[0]] }} />
                {([0, 1] as const).map((which) => (
                  <div
                    key={which}
                    role="slider"
                    tabIndex={0}
                    aria-label={which === 0 ? "Onion range start" : "Onion range end"}
                    aria-orientation="horizontal"
                    aria-valuemin={1}
                    aria-valuemax={n}
                    aria-valuenow={onion[which] + 1}
                    aria-valuetext={`frame ${onion[which] + 1} of ${n}`}
                    className={styles.handle}
                    style={{ left: which === 0 ? left[onion[0]] : left[onion[1]] + CLIP_W - HANDLE_W }}
                    onKeyDown={onHandleKey(which)}
                    {...handleDrag(which)}
                  />
                ))}
              </div>
            </div>
          </>
        )}

        <div className={styles.trackLabel}>MY MARKS</div>
        <div className={styles.markRow} ref={markRow}>
          {field.frames.slice(0, n).map((f, k) => (
            <div key={f.i} style={{ width: CLIP_W, marginLeft: margin(k) }} className={styles.markCell}>
              {marked.has(f.i) && (
                <span className={styles.markDot} style={{ borderColor: colors[k] ? rgbCss(colors[k]) : undefined }}>
                  {k + 1}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
