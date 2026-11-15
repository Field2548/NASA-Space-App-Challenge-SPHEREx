"use client";
// Morphology control (PNL-06): operation, kernel shape and size, iterations for erosion and
// dilation. Off by default. The explanation and the before/after example live in the (i) popup.
//
// Props: { value: MorphSettings; onChange(v: MorphSettings): void; id?: string }

import { type ReactNode, useId } from "react";
import { morphFrame, type MorphOp, type MorphSettings, type MorphShape, type MorphSize } from "@/lib/morphology";
import HelpImage from "./HelpImage";
import InfoPopover from "./InfoPopover";

const OPS: { value: MorphOp; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "erode", label: "Erosion" },
  { value: "dilate", label: "Dilation" },
  { value: "open", label: "Opening" },
  { value: "close", label: "Closing" },
  { value: "gradient", label: "Morphological gradient" },
  { value: "tophat", label: "Top hat" },
  { value: "blackhat", label: "Black hat" },
];
const SHAPES: MorphShape[] = ["rect", "ellipse", "cross"];
const SIZES: MorphSize[] = [3, 5, 7];

const EXPLAIN: Record<Exclude<MorphOp, "off">, ReactNode> = {
  erode: (
    <p>
      <b>Erosion</b> replaces every pixel by the dimmest pixel under the kernel (a small window). Bright things shrink and
      single bright pixels (hot pixels, cosmic-ray hits) disappear. Stars shrink too, so a big kernel can erase a faint dot.
    </p>
  ),
  dilate: (
    <p>
      <b>Dilation</b> replaces every pixel by the brightest pixel under the kernel. Bright things grow and small dark gaps
      fill in. A single hot pixel grows into a bright square, so use it mainly to help the eye find faint dots, not to clean up.
    </p>
  ),
  open: (
    <p>
      <b>Opening</b> is erosion followed by dilation. It removes single hot pixels and cosmic rays that are smaller than the
      kernel, then grows the survivors back to their size, so stars stay. A moving dot is a star-sized blob, so too large a
      kernel erases it too: start with 3.
    </p>
  ),
  close: (
    <p>
      <b>Closing</b> is dilation followed by erosion. It fills small dark gaps and holes inside bright things and leaves
      their outline alone.
    </p>
  ),
  gradient: (
    <p>
      <b>Morphological gradient</b> is dilation minus erosion: only the edges of bright things stay lit.
    </p>
  ),
  tophat: (
    <p>
      <b>Top hat</b> is the picture minus its opening: only small bright things (hot pixels, tiny stars) remain.
    </p>
  ),
  blackhat: (
    <p>
      <b>Black hat</b> is the closing minus the picture: only small dark gaps remain.
    </p>
  ),
};

/** 12 x 12 sky patch: background, one star-sized blob with a small dark gap, one hot pixel. */
export function exampleScene(): { data: Float32Array; w: number; h: number } {
  const w = 12;
  const h = 12;
  const data = new Float32Array(w * h).fill(0.08);
  const cx = 4;
  const cy = 6;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= 2.3) data[y * w + x] = Math.max(0.08, 1 - 0.25 * d);
    }
  data[(cy - 1) * w + cx + 1] = 0.08; // a small dark gap in the star
  data[2 * w + 10] = 1; // hot pixel
  return { data, w, h };
}

export interface MorphologyControlProps {
  value: MorphSettings;
  onChange(v: MorphSettings): void;
  id?: string;
}

export default function MorphologyControl({ value, onChange, id }: MorphologyControlProps) {
  const auto = useId();
  const base = id ?? `morph-${auto}`;
  const off = value.op === "off";
  const itersOn = value.op === "erode" || value.op === "dilate";
  const set = (p: Partial<MorphSettings>) => onChange({ ...value, ...p });

  const shown: MorphSettings = off ? { ...value, op: "open" } : value;
  const sc = exampleScene();
  const after = morphFrame(sc.data, sc.w, sc.h, shown);
  const opName = OPS.find((o) => o.value === shown.op)?.label ?? "";

  return (
    <div style={{ display: "grid", gap: "var(--space-2)", fontSize: 12 }}>
      <div>
        <label htmlFor={`${base}-op`}>Morphology</label>{" "}
        <select id={`${base}-op`} value={value.op} onChange={(e) => set({ op: e.target.value as MorphOp })}>
          {OPS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>{" "}
        <InfoPopover label="Morphology" title="Morphology: clean up or grow bright spots">
          <p>
            Morphology reshapes bright spots using a small window, the kernel, that slides over every pixel of every frame. It
            runs on the data before the brightness stretch, the same way on all frames.
          </p>
          {EXPLAIN[shown.op as Exclude<MorphOp, "off">]}
          <p>
            Kernel shape: square, round or plus-shaped window. Kernel size: 3, 5 or 7 pixels across; bigger changes more.
            {off ? " The example below uses Opening with a 3 pixel square." : ` The example uses your settings (${opName}, ${shown.shape}, ${shown.size}).`}
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <HelpImage data={sc.data} w={sc.w} h={sc.h} label="Before: a star with a small dark gap and one hot pixel" caption="Before" />
            <HelpImage data={after} w={sc.w} h={sc.h} label={`After ${opName}`} caption={`After ${opName}`} />
          </div>
          <p>Too large a kernel erases a moving dot, because a dot is about the size of a star.</p>
        </InfoPopover>
      </div>
      {!off && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <label>
            Kernel shape{" "}
            <select value={value.shape} onChange={(e) => set({ shape: e.target.value as MorphShape })}>
              {SHAPES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            Kernel size{" "}
            <select value={value.size} onChange={(e) => set({ size: Number(e.target.value) as MorphSize })}>
              {SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          {itersOn && (
            <label>
              Iterations{" "}
              <select value={value.iterations} onChange={(e) => set({ iterations: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
    </div>
  );
}
