// Inspect popup for one pixel (BP 8.16, first cut): where it is (x, y, RA, Dec), how bright it
// is in the current frame (S/N in sigma), and when that frame was taken. The object name shows
// only when the caller passes one: after an unlocked verdict, or in the tutorial. field.json has
// no distance from Earth, so this panel says nothing about distance (never invent a value).
//
// Props: { field; frames; frameIndex (array index); x; y; objectName? }

import { formatDec, formatRA } from "@/lib/coords";
import type { Field } from "@/lib/types";
import { pixelToSky } from "@/lib/wcs";
import { formatUtc } from "./FieldViewer";
import styles from "./InspectPanel.module.css";

export interface InspectPanelProps {
  field: Pick<Field, "size" | "wcs" | "frames">;
  frames: Float32Array[];
  frameIndex: number;
  x: number;
  y: number;
  /** Known object's name; omit during a round before an unlocked verdict. */
  objectName?: string | null;
}

/** "3.2σ", or "no data" for a NaN pixel. */
export function formatSigma(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return "no data";
  return `${v.toFixed(1)}σ`;
}

export default function InspectPanel({ field, frames, frameIndex, x, y, objectName }: InspectPanelProps) {
  const [W, H] = field.size;
  const [ra, dec] = pixelToSky(field.wcs, H, x, y);
  const meta = field.frames[frameIndex];
  const value = frames[frameIndex]?.[y * W + x];
  const title = `INSPECT // px ${x},${y}`;
  return (
    <section className={styles.panel} role="region" aria-label={`Inspect pixel ${x}, ${y}`} data-slot="inspect-popup" data-testid="inspect-panel">
      <h2 className={styles.title}>{title}</h2>
      <dl className={styles.list}>
        {objectName ? (
          <>
            {/* The spot's known object, not a claim about this pixel. */}
            <dt>Known object in this spot</dt>
            <dd data-testid="inspect-object">{objectName}</dd>
          </>
        ) : null}
        <dt>Pixel</dt>
        <dd>
          x {x}, y {y}
        </dd>
        <dt>RA</dt>
        <dd>
          {formatRA(ra)} ({ra.toFixed(4)}°)
        </dd>
        <dt>Dec</dt>
        <dd>
          {formatDec(dec)} ({dec.toFixed(4)}°)
        </dd>
        <dt>Signal</dt>
        <dd>{Number.isFinite(value) ? `${formatSigma(value)} (signal-to-noise) in this frame` : "No data in this frame"}</dd>
        {meta ? (
          <>
            <dt>Taken</dt>
            <dd>
              Frame {meta.i}, {formatUtc(meta.utc)}
            </dd>
          </>
        ) : null}
      </dl>
    </section>
  );
}
