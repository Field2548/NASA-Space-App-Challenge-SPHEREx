"use client";
// Timeline v1 (BP 8.8): Track 1 frame clips with thumbnails and time-coloured borders, date/time
// and "+gap" labels, a playhead with scrubbing, Track 2 "My marks". Keyboard: focus the frames
// track, then Left/Right step, Home/End jump, Space plays or pauses the blink.
//
// Props:
//   field: Field; frames: Float32Array[] (decoded S/N)
//   index: number; onIndexChange(i: number): void      array index (0-based)
//   marks?: Mark[]                                      shown on Track 2
//   colors?: RGB[]                                      time colours (default Okabe-Ito)
//   brightness?: number                                 black point for thumbnails (S/N)
//   playing?: boolean; onTogglePlay?(): void            blink control (from useBlink)
//   reducedMotion?: boolean                             shows that auto-play is off
//   controlsSlot?: ReactNode                            "Frames & spacing" controls at the left

import { type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useId, useMemo, useRef } from "react";
import { makeSharedStretch, toImageData } from "@/lib/imaging";
import type { Field, Mark, RGB } from "@/lib/types";
import { formatGap, stretchPoints } from "./FieldViewer";
import styles from "./Timeline.module.css";
import { rgbCss, timeColors } from "./timeColors";

export const CLIP_W = 112;
export const CLIP_GAP = 8;

export interface TimelineProps {
  field: Field;
  frames: Float32Array[];
  index: number;
  onIndexChange(i: number): void;
  marks?: Mark[];
  colors?: RGB[];
  brightness?: number;
  playing?: boolean;
  onTogglePlay?(): void;
  reducedMotion?: boolean;
  controlsSlot?: ReactNode;
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

function shortUtc(utc: string): string {
  return utc.slice(5, 16).replace("T", " ");
}

function Thumb({ gray, w, h }: { gray: Float32Array; w: number; h: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.putImageData(toImageData(gray, w, h), 0, 0);
  }, [gray, w, h]);
  return <canvas ref={ref} width={w} height={h} className={styles.thumb} aria-hidden="true" />;
}

export default function Timeline(props: TimelineProps) {
  const { field, frames, index, onIndexChange, marks = [], playing = false, onTogglePlay, reducedMotion = false, controlsSlot } = props;
  const [W, H] = field.size;
  const n = frames.length;
  const colors = useMemo(() => props.colors ?? timeColors(n), [props.colors, n]);
  const black = props.brightness ?? field.stretch.black_sigma;
  const grays = useMemo(() => {
    const st = makeSharedStretch(frames, stretchPoints(field, black).base);
    return frames.map(st);
  }, [frames, field, black]);
  const uid = useId();
  const clipId = (k: number) => `${uid}-clip-${k}`;
  const scrubbing = useRef(false);

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
    const x = e.clientX - el.getBoundingClientRect().left + el.scrollLeft;
    return Math.min(n - 1, Math.max(0, Math.floor(x / (CLIP_W + CLIP_GAP))));
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
  const playheadLeft = index * (CLIP_W + CLIP_GAP) + CLIP_W / 2;

  return (
    <section className={styles.root} aria-label="Timeline">
      <div className={styles.controls}>
        <div className={styles.buttons}>
          <button type="button" aria-label="Previous frame" onClick={() => onIndexChange(Math.max(0, index - 1))} disabled={index <= 0}>
            ◀
          </button>
          {onTogglePlay && (
            <button type="button" aria-label={playing ? "Pause blink" : "Play blink"} aria-pressed={playing} onClick={onTogglePlay} disabled={reducedMotion || n < 2}>
              {playing ? "Pause" : "Blink"}
            </button>
          )}
          <button type="button" aria-label="Next frame" onClick={() => onIndexChange(Math.min(n - 1, index + 1))} disabled={index >= n - 1}>
            ▶
          </button>
        </div>
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
          aria-orientation="horizontal"
          aria-activedescendant={n ? clipId(index) : undefined}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endScrub}
          onPointerCancel={endScrub}
          style={{ gap: CLIP_GAP }}
        >
          {field.frames.slice(0, n).map((f, k) => (
            <div
              key={f.i}
              id={clipId(k)}
              role="option"
              aria-selected={k === index}
              aria-label={`Frame ${k + 1} of ${n}, ${f.utc}, ${formatGap(f.hours_since_prev, k === 0)}`}
              className={`${styles.clip} ${k === index ? styles.current : ""}`}
              style={{ width: CLIP_W, borderColor: colors[k] ? rgbCss(colors[k]) : undefined }}
            >
              <div className={`science-viewport ${styles.thumbBox}`}>
                <Thumb gray={grays[k]} w={W} h={H} />
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

        <div className={styles.trackLabel}>MY MARKS</div>
        <div className={styles.markRow} style={{ gap: CLIP_GAP }}>
          {field.frames.slice(0, n).map((f, k) => (
            <div key={f.i} style={{ width: CLIP_W }} className={styles.markCell}>
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
