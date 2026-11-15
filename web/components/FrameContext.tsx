"use client";
// The frame before and the frame after the selected one, small and labelled ("−1 frame 2, −1.6 h",
// "+1 frame 4, +21.1 h"), so the player sees what came just before and after. A side that does not
// exist (first or last frame) is left out. Same shared stretch as the Timeline thumbnails.

import { useMemo } from "react";
import { makeSharedStretch } from "@/lib/imaging";
import type { Field } from "@/lib/types";
import { stretchPoints } from "./FieldViewer";
import { Thumb } from "./Timeline";
import styles from "./FrameContext.module.css";

export interface FrameContextProps {
  field: Field;
  frames: Float32Array[];
  index: number;
  brightness?: number; // black point (S/N), default field.stretch.black_sigma
}

export default function FrameContext({ field, frames, index, brightness }: FrameContextProps) {
  const [W, H] = field.size;
  const black = brightness ?? field.stretch.black_sigma;
  const stretch = useMemo(() => makeSharedStretch(frames, stretchPoints(field, black).base), [frames, field, black]);
  const n = frames.length;
  const sides = ([-1, 1] as const)
    .map((d) => ({ d, k: index + d }))
    .filter(({ k }) => k >= 0 && k < n && field.frames[k]);
  if (sides.length === 0) return null;
  return (
    <div className={styles.root} role="group" aria-label="Frames around the selected one">
      {sides.map(({ d, k }) => {
        // Gap between the two frames: the selected frame's own gap before it, the next frame's gap after it.
        const hours = d === -1 ? field.frames[index].hours_since_prev : field.frames[k].hours_since_prev;
        return (
          <figure key={d} className={styles.card} data-side={d === -1 ? "before" : "after"}>
            <div className={`science-viewport ${styles.thumbBox}`}>
              <Thumb gray={stretch(frames[k])} w={W} h={H} />
            </div>
            <figcaption>
              {d === -1 ? "−1" : "+1"} frame {k + 1}, {d === -1 ? "−" : "+"}
              {hours.toFixed(1)} h
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}
