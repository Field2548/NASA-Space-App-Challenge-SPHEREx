"use client";
// Timeline (BP 8.8): one toolbar (Previous / Play / Next, the current frame, Frames shown, Speed), the frame
// clips with thumbnails, time-coloured borders and "marked" badges, and one labelled range lane per job under
// the clips: "Blink" (the frames the blink plays) and, while Stack is on, "Color" (the frames mixed
// into the colour picture). Each lane is a two-thumb range aligned to the clips.
// Keyboard: focus the frames track, then Left/Right step (wrapping round the ends), Home/End jump, Space
// plays or pauses. A range thumb moves with Left/Right/Home/End.
//
// Props:
//   field: Field; frames: Float32Array[] (decoded S/N)
//   index: number; onIndexChange(i: number): void      array index (0-based)
//   marks?: Mark[]                                      shown as badges on the clips
//   colors?: RGB[]                                      time colours (default timeColors(n, vision))
//   vision?: Vision                                     colour-vision mode for the default colours
//   brightness?: number                                 black point for the fallback thumbnails (S/N)
//   playing?: boolean; onTogglePlay?(): void            blink control (from useBlink)
//   reducedMotion?: boolean                             auto-play is off; Play is disabled and says why
//   controlsSlot?: ReactNode                            extra controls at the end of the toolbar
//   onionRange?: [a, b]; onOnionRangeChange?(r)         inclusive array indices for Stack (2..7 frames);
//                                                          FieldViewer overlayFrames = onionRangeFrames(range)
//   onionActive?: boolean                               show the Color lane (default true when onionRange is given)
//   loopRange?: [a, b]; onLoopRangeChange?(r)           inclusive array indices the blink plays (default all);
//                                                          the Blink lane shows when the callback is given;
//                                                          clips outside the range are dimmed
//   fps?: number; onFpsChange?(f)                       blink speed, one of BLINK_SPEEDS; the Speed control shows
//                                                          when the callback is given
//   frameMax?: number; onFrameCountChange?(c)           "Frames" stepper (2..frameMax) shown when the callback is
//                                                          given; the parent hands in only the chosen frames
//
// Thumbnails: field.thumbs (one 48x48 WebP per frame, via loadThumbs) when there are as many as
// frames; otherwise, while loading, and on error, the frame-derived canvas at `brightness`.

import { type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { archiveMessage, getArchiveStatus, type ArchiveStatus } from "@/lib/archiveStatus";
import { loadThumbs } from "@/lib/fields";
import { makeSharedStretch, toImageData } from "@/lib/imaging";
import type { Field, Mark, RGB, Vision } from "@/lib/types";
import { BLINK_SPEEDS, wrapIndex } from "@/lib/useBlink";
import { timeColors } from "@/lib/palettes";
import { formatGap, rgbCss, stretchPoints } from "./FieldViewer";
import styles from "./Timeline.module.css";

export const CLIP_W = 112;
export const CLIP_GAP = 8;
export const ONION_MAX = 7;
const STEP = CLIP_W + CLIP_GAP;
const HANDLE_W = 24; // range thumb width: a 24px hit target at least

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
  onionRange?: [number, number];
  onOnionRangeChange?(r: [number, number]): void;
  onionActive?: boolean;
  loopRange?: [number, number];
  onLoopRangeChange?(r: [number, number]): void;
  fps?: number;
  onFpsChange?(f: number): void;
  frameMax?: number;
  onFrameCountChange?(c: number): void;
  /** Draw thumbnails from `frames` (a rebuilt wavelength band) instead of the all-band field.thumbs. */
  thumbsFromFrames?: boolean;
}

/** New index for a key press, or null if the key is not ours. Left/Right wrap round the ends. */
export function keyToIndex(key: string, i: number, n: number): number | null {
  if (n === 0) return null;
  if (key === "ArrowRight") return wrapIndex(i, 1, n);
  if (key === "ArrowLeft") return wrapIndex(i, -1, n);
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

/** "frames 2–4", or "frame 3" for one frame. */
function spanText(r: [number, number]): string {
  return r[0] === r[1] ? `frame ${r[0] + 1}` : `frames ${r[0] + 1}–${r[1] + 1}`;
}

export function Thumb({ gray, w, h, bitmap }: { gray: Float32Array | null; w: number; h: number; bitmap?: ImageBitmap }) {
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

interface LaneProps {
  name: string;
  hint: string;
  range: [number, number];
  n: number;
  left: number[];
  total: number;
  minSpan: number;
  maxSpan: number;
  tone: "blink" | "color";
  onChange(r: [number, number]): void;
  startName: string;
  endName: string;
}

/** A labelled two-thumb range under the clips. Thumbs snap to clip boundaries and never cross. */
function RangeLane({ name, hint, range, n, left, total, minSpan, maxSpan, tone, onChange, startName, endName }: LaneProps) {
  const [a, b] = range;
  const move = (which: 0 | 1, k: number) => {
    const next: [number, number] =
      which === 0
        ? [Math.min(b - (minSpan - 1), Math.max(Math.max(0, b - (maxSpan - 1)), k)), b]
        : [a, Math.max(a + (minSpan - 1), Math.min(Math.min(n - 1, a + (maxSpan - 1)), k))];
    if (next[0] !== a || next[1] !== b) onChange(next);
  };
  const onKey = (which: 0 | 1) => (e: KeyboardEvent<HTMLDivElement>) => {
    const cur = range[which];
    let next: number | null = null;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = cur - 1;
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") next = cur + 1;
    else if (e.key === "Home") next = which === 0 ? 0 : a + (minSpan - 1);
    else if (e.key === "End") next = which === 0 ? b - (minSpan - 1) : n - 1;
    if (next === null) return;
    e.preventDefault();
    move(which, next);
  };
  const drag = (which: 0 | 1) => ({
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      e.currentTarget.dataset.drag = "1";
    },
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
      const row = e.currentTarget.closest<HTMLElement>("[data-sync]");
      if (e.currentTarget.dataset.drag !== "1" || !row) return;
      move(which, nearestClip(e.clientX - row.getBoundingClientRect().left + row.scrollLeft - 2, left));
    },
    onPointerUp: (e: PointerEvent<HTMLDivElement>) => {
      delete e.currentTarget.dataset.drag;
    },
    onPointerCancel: (e: PointerEvent<HTMLDivElement>) => {
      delete e.currentTarget.dataset.drag;
    },
  });
  return (
    <>
      <div className={styles.laneLabel} title={hint}>
        <span className={styles.laneName}>{name}</span>
        <span className={styles.laneValue}>{spanText(range)}</span>
      </div>
      <div className={styles.laneRow} data-sync="" data-tone={tone} data-tutorial-target={`${tone}-range`} role="group" aria-label={`${name} ${spanText(range)}`} title={hint}>
        <div className={styles.lane} style={{ width: total }}>
          <div className={styles.rail} />
          <div className={styles.span} style={{ left: left[a], width: left[b] + CLIP_W - left[a] }} />
          {([0, 1] as const).map((which) => (
            <div
              key={which}
              role="slider"
              tabIndex={0}
              aria-label={which === 0 ? startName : endName}
              aria-orientation="horizontal"
              aria-valuemin={1}
              aria-valuemax={n}
              aria-valuenow={range[which] + 1}
              aria-valuetext={`${which === 0 ? "starts" : "ends"} at frame ${range[which] + 1} of ${n}`}
              title={hint}
              className={styles.thumbHandle}
              style={{ left: which === 0 ? left[a] : left[b] + CLIP_W - HANDLE_W }}
              onKeyDown={onKey(which)}
              {...drag(which)}
            />
          ))}
        </div>
      </div>
    </>
  );
}

export default function Timeline(props: TimelineProps) {
  const { field, frames, index, onIndexChange, marks = [], playing = false, onTogglePlay, reducedMotion = false, controlsSlot } = props;
  const { onOnionRangeChange, onLoopRangeChange, onFpsChange, onFrameCountChange } = props;
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
  // "+" at the limit opens a note about why there are no more frames (is NASA's IRSA archive down?).
  const [limit, setLimit] = useState<ArchiveStatus | "checking" | null>(null);
  const limitRef = useRef<HTMLDivElement>(null);
  const plusRef = useRef<HTMLButtonElement>(null);
  const closeLimit = () => {
    setLimit(null);
    plusRef.current?.focus();
  };
  useEffect(() => {
    if (limit === null) return;
    const onDown = (e: Event) => {
      if (!limitRef.current?.contains(e.target as Node) && !plusRef.current?.contains(e.target as Node)) setLimit(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [limit]);
  const openLimit = () => {
    setLimit("checking");
    getArchiveStatus().then((st) => setLimit((cur) => (cur === "checking" ? st : cur)));
    window.setTimeout(() => limitRef.current?.focus(), 0);
  };
  const clipId = (k: number) => `${uid}-clip-${k}`;
  const scrubbing = useRef(false);
  const tracksRef = useRef<HTMLDivElement>(null);

  const left = useMemo(() => Array.from({ length: n }, (_, k) => k * STEP), [n]);
  const total = n > 0 ? left[n - 1] + CLIP_W + 4 : 0;
  const margin = (k: number) => (k === 0 ? 0 : left[k] - left[k - 1] - CLIP_W);
  const onion = props.onionRange && props.onionActive !== false ? clampOnion(props.onionRange, n) : null;
  const fps = props.fps ?? BLINK_SPEEDS[BLINK_SPEEDS.length - 1];
  const loop: [number, number] | null = n > 0 ? [Math.min(n - 1, Math.max(0, props.loopRange?.[0] ?? 0)), Math.min(n - 1, Math.max(0, props.loopRange?.[1] ?? n - 1))] : null;
  const frameMax = Math.max(n, props.frameMax ?? n);

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

  const marked = new Set(marks.map((m) => m.frame));
  const playheadLeft = (left[index] ?? 0) + CLIP_W / 2;
  const cur = field.frames[index];
  const canStep = n > 1;
  const step = (d: number) => onIndexChange(wrapIndex(index, d, n));
  const playTitle = reducedMotion
    ? "Auto-play is off because your device asks for reduced motion. Step through the frames with the arrow buttons."
    : n < 2
      ? "Needs at least two frames."
      : undefined;

  return (
    <section className={styles.root} aria-label="Timeline">
      <div className={styles.bar}>
        <div className={styles.transport} role="group" aria-label="Frame controls" data-tutorial-target="frame-controls">
          <button type="button" className={styles.step} aria-label="Previous frame" title="Previous frame (←)" onClick={() => step(-1)} disabled={!canStep}>
            ◀
          </button>
          {onTogglePlay && (
            <button
              type="button"
              className={styles.play}
              aria-label={playing ? "Pause blink" : "Play blink"}
              aria-pressed={playing}
              title={playTitle}
              onClick={onTogglePlay}
              disabled={reducedMotion || n < 2}
              data-tutorial-target="play-button"
            >
              {playing ? "Pause" : "Blink"}
            </button>
          )}
          <button type="button" className={styles.step} aria-label="Next frame" title="Next frame (→)" onClick={() => step(1)} disabled={!canStep}>
            ▶
          </button>
          {cur && (
            <p className={styles.readout}>
              <b>
                Frame {index + 1} / {n}
              </b>
              <span>{shortUtc(cur.utc)} UTC</span>
            </p>
          )}
        </div>
        <div className={styles.options}>
          {onFrameCountChange && n >= 1 && frameMax > 2 && (
            <div className={styles.field} role="group" aria-label="Frames shown" data-tutorial-target="frames-count" title="How many of this spot's frames to use, spread evenly across the time span. Marks on hidden frames are kept.">
              <span className={styles.fieldName}>Frames</span>
              <div className={styles.stepper}>
                <button type="button" aria-label="Show fewer frames" onClick={() => onFrameCountChange(Math.max(2, n - 1))} disabled={n <= 2}>
                  −
                </button>
                <output aria-live="polite">
                  {n} of {frameMax}
                </output>
                <button
                  ref={plusRef}
                  type="button"
                  aria-label="Show more frames"
                  aria-disabled={n >= frameMax ? true : undefined}
                  aria-haspopup={n >= frameMax ? "dialog" : undefined}
                  aria-expanded={n >= frameMax ? limit !== null : undefined}
                  className={n >= frameMax ? styles.atLimit : undefined}
                  onClick={() => (n >= frameMax ? (limit === null ? openLimit() : closeLimit()) : onFrameCountChange(Math.min(frameMax, n + 1)))}
                >
                  +
                </button>
              </div>
              {limit !== null && n >= frameMax && (
                <div
                  ref={limitRef}
                  role="dialog"
                  aria-label="No more frames"
                  tabIndex={-1}
                  className={styles.limitNote}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      closeLimit();
                    }
                  }}
                >
                  <p aria-live="polite">{archiveMessage(limit, n)}</p>
                  <button type="button" onClick={closeLimit}>
                    Close
                  </button>
                </div>
              )}
            </div>
          )}
          {onFpsChange && (
            <div className={styles.field} role="group" aria-label="Blink speed" data-tutorial-target="blink-speed" title="How fast the blink steps through the frames (3 a second at most).">
              <span className={styles.fieldName}>Speed</span>
              <div className={styles.segments}>
                {BLINK_SPEEDS.map((f) => (
                  <button key={f} type="button" aria-pressed={fps === f} aria-label={`${f} ${f === 1 ? "frame" : "frames"} per second`} onClick={() => onFpsChange(f)}>
                    {f}/s
                  </button>
                ))}
              </div>
            </div>
          )}
          {controlsSlot}
        </div>
      </div>

      <div className={styles.tracks} ref={tracksRef}>
        <div className={styles.laneLabel}>
          <span className={styles.laneName}>Frames</span>
          <span className={styles.laneValue}>{n} shown</span>
        </div>
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
            tracksRef.current?.querySelectorAll<HTMLElement>("[data-sync]").forEach((el) => {
              el.scrollLeft = x;
            });
          }}
        >
          {field.frames.slice(0, n).map((f, k) => (
            <div
              key={f.i}
              id={clipId(k)}
              role="option"
              aria-selected={k === index}
              aria-label={`Frame ${k + 1} of ${n}, ${f.utc}, ${formatGap(f.hours_since_prev, k === 0)}${marked.has(f.i) ? ", marked" : ""}`}
              className={`${styles.clip} ${k === index ? styles.current : ""} ${onion && k >= onion[0] && k <= onion[1] ? styles.inOnion : ""}`}
              data-dimmed={loop && onLoopRangeChange && (k < loop[0] || k > loop[1]) ? "true" : undefined}
              style={{ width: CLIP_W, marginLeft: margin(k), borderColor: colors[k] ? rgbCss(colors[k]) : undefined }}
            >
              <div className={`science-viewport ${styles.thumbBox}`}>
                <Thumb gray={grays ? grays[k] : null} w={W} h={H} bitmap={useWebp && thumbs ? thumbs[k] : undefined} />
                {marked.has(f.i) && (
                  <span className={styles.markBadge} aria-hidden="true">
                    marked
                  </span>
                )}
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

        {onLoopRangeChange && loop && n > 1 && (
          <RangeLane
            name="Blink"
            hint="Drag the ends to choose which frames the blink plays. Frames outside it are dimmed."
            range={loop}
            n={n}
            left={left}
            total={total}
            minSpan={1}
            maxSpan={n}
            tone="blink"
            onChange={onLoopRangeChange}
            startName="Blink start frame"
            endName="Blink end frame"
          />
        )}
        {onion && onOnionRangeChange && n > 1 && (
          <RangeLane
            name="Color"
            hint={`Drag the ends to choose which frames Stack mixes (2 to ${ONION_MAX}).`}
            range={onion}
            n={n}
            left={left}
            total={total}
            minSpan={2}
            maxSpan={ONION_MAX}
            tone="color"
            onChange={onOnionRangeChange}
            startName="Stack start frame"
            endName="Stack end frame"
          />
        )}
      </div>
    </section>
  );
}
