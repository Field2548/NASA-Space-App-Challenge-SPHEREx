"use client";
// Morphology control (PNL-05): an ordered stack of steps, applied first to last to every frame.
// Each step is a card: operation, kernel shape and size, iterations for erosion and dilation.
// An empty stack is Off. Cards reorder by dragging the handle (pointer events: mouse, touch, pen)
// or with the Move up / Move down buttons. The explanation and the before/after example live in
// the (i) popups.
//
// Props: { value: MorphSettings[]; onChange(v: MorphSettings[]): void; id?: string }

import { type PointerEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { MAX_MORPH_STEPS, morphFrame, type MorphOp, type MorphSettings, type MorphShape, type MorphSize, NEW_MORPH_STEP } from "@/lib/morphology";
import HelpImage from "./HelpImage";
import InfoPopover from "./InfoPopover";

type StepOp = Exclude<MorphOp, "off">;

const OPS: { value: StepOp; label: string }[] = [
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

const EXPLAIN: Record<StepOp, ReactNode> = {
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

const moved = <T,>(a: T[], from: number, to: number): T[] => {
  const out = [...a];
  out.splice(to, 0, out.splice(from, 1)[0]);
  return out;
};

let nextId = 0;
const newId = () => `s${nextId++}`;

export interface MorphologyControlProps {
  value: MorphSettings[];
  onChange(v: MorphSettings[]): void;
  id?: string;
}

export default function MorphologyControl({ value, onChange, id }: MorphologyControlProps) {
  const auto = useId();
  const base = id ?? `morph-${auto}`;
  const listRef = useRef<HTMLOListElement>(null);
  // one stable id per card so React (and focus) follow a card when it moves
  const [ids, setIds] = useState<string[]>(() => value.map(newId));
  const [dragId, setDragId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const refocus = useRef<{ id: string; dir: "up" | "down" } | null>(null);
  const stepIds = value.map((_, i) => ids[i] ?? `i${i}`);

  useEffect(() => {
    const r = refocus.current;
    if (!r) return;
    refocus.current = null;
    const card = listRef.current?.querySelector(`[data-step-id="${r.id}"]`);
    const pick = (d: string) => card?.querySelector<HTMLButtonElement>(`[data-move="${d}"]`);
    const want = pick(r.dir);
    (want && !want.disabled ? want : pick(r.dir === "up" ? "down" : "up"))?.focus();
  });

  const commit = (next: MorphSettings[], nextIds: string[]) => {
    setIds(nextIds);
    onChange(next);
  };
  const set = (i: number, p: Partial<MorphSettings>) => onChange(value.map((s, k) => (k === i ? { ...s, ...p } : s)));
  const move = (from: number, to: number, keyboard = false) => {
    if (from === to || to < 0 || to >= value.length) return;
    commit(moved(value, from, to), moved(stepIds, from, to));
    setNote(`Step ${from + 1} moved to position ${to + 1} of ${value.length}`);
    if (keyboard) refocus.current = { id: stepIds[from], dir: to < from ? "up" : "down" };
  };
  const add = () => {
    if (value.length >= MAX_MORPH_STEPS) return;
    commit([...value, { ...NEW_MORPH_STEP }], [...stepIds, newId()]);
    setNote(`Step ${value.length + 1} added`);
  };
  const remove = (i: number) => {
    commit(value.filter((_, k) => k !== i), stepIds.filter((_, k) => k !== i));
    setNote(`Step ${i + 1} removed`);
  };

  // Dragging a handle: the card follows the pointer; it swaps with a neighbour once the pointer
  // passes that neighbour's centre. touch-action: none on the handle keeps touch from scrolling.
  const onHandleDown = (sid: string) => (e: PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragId(sid);
  };
  const onHandleMove = (sid: string) => (e: PointerEvent<HTMLButtonElement>) => {
    if (dragId !== sid) return;
    const cards = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-step-id]") ?? []);
    const from = stepIds.indexOf(sid);
    let to = 0;
    cards.forEach((c, k) => {
      if (k === from) return;
      const r = c.getBoundingClientRect();
      if (e.clientY > r.top + r.height / 2) to++;
    });
    if (to !== from) move(from, to);
  };
  const endDrag = () => setDragId(null);

  const open = OPS.find((o) => o.value === "open")!;

  return (
    <div style={{ display: "grid", gap: "var(--space-2)", fontSize: 12 }}>
      <div>
        Morphology{" "}
        <InfoPopover label="Morphology" title="Morphology: clean up or grow bright spots">
          <p>
            Morphology reshapes bright spots using a small window, the kernel, that slides over every pixel of every frame. It
            runs on the data before the brightness stretch, the same way on all frames.
          </p>
          <p>
            You can stack several steps. They run from the top card to the bottom card, and each step works on the result of the
            one above it, so the order matters: erosion then dilation is not the same as dilation then erosion. Drag a card by its
            handle, or use Move up and Move down. With no steps, morphology is off.
          </p>
        </InfoPopover>
      </div>
      {value.length > 0 && (
        <ol ref={listRef} style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--space-2)" }}>
          {value.map((step, i) => {
            const sid = stepIds[i];
            const n = i + 1;
            const itersOn = step.op === "erode" || step.op === "dilate";
            const shown: MorphSettings = step.op === "off" ? { ...step, op: open.value } : step;
            const sc = exampleScene();
            const after = morphFrame(sc.data, sc.w, sc.h, shown);
            const opName = OPS.find((o) => o.value === shown.op)?.label ?? "";
            return (
              <li
                key={sid}
                className="panel"
                data-step-id={sid}
                aria-label={`Morphology step ${n}`}
                style={{ opacity: dragId === sid ? 0.7 : 1, outline: dragId === sid ? "1px solid var(--cyan, #0ff)" : undefined }}
              >
                <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    aria-label={`Drag step ${n} to reorder`}
                    title="Drag to reorder"
                    data-handle
                    style={{ cursor: "grab", touchAction: "none" }}
                    onPointerDown={onHandleDown(sid)}
                    onPointerMove={onHandleMove(sid)}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                  >
                    ⠿
                  </button>
                  <b>Step {n}</b>
                  <InfoPopover label={`Morphology step ${n}`} title={`Morphology step ${n}: ${opName}`}>
                    {EXPLAIN[shown.op as StepOp]}
                    <p>
                      Kernel shape: square, round or plus-shaped window. Kernel size: 3, 5 or 7 pixels across; bigger changes more.
                      {` The example uses this step (${opName}, ${shown.shape}, ${shown.size}) on its own.`}
                    </p>
                    <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
                      <HelpImage data={sc.data} w={sc.w} h={sc.h} label="Before: a star with a small dark gap and one hot pixel" caption="Before" />
                      <HelpImage data={after} w={sc.w} h={sc.h} label={`After ${opName}`} caption={`After ${opName}`} />
                    </div>
                    <p>Too large a kernel erases a moving dot, because a dot is about the size of a star.</p>
                  </InfoPopover>
                  <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                    <button type="button" data-move="up" aria-label={`Move step ${n} up`} disabled={i === 0} onClick={() => move(i, i - 1, true)}>
                      ↑
                    </button>
                    <button
                      type="button"
                      data-move="down"
                      aria-label={`Move step ${n} down`}
                      disabled={i === value.length - 1}
                      onClick={() => move(i, i + 1, true)}
                    >
                      ↓
                    </button>
                    <button type="button" aria-label={`Remove step ${n}`} onClick={() => remove(i)}>
                      Remove
                    </button>
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <label>
                    Operation{" "}
                    <select aria-label={`Step ${n} operation`} value={step.op} onChange={(e) => set(i, { op: e.target.value as MorphOp })}>
                      {OPS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Kernel shape{" "}
                    <select aria-label={`Step ${n} kernel shape`} value={step.shape} onChange={(e) => set(i, { shape: e.target.value as MorphShape })}>
                      {SHAPES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Kernel size{" "}
                    <select aria-label={`Step ${n} kernel size`} value={step.size} onChange={(e) => set(i, { size: Number(e.target.value) as MorphSize })}>
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
                      <select aria-label={`Step ${n} iterations`} value={step.iterations} onChange={(e) => set(i, { iterations: Number(e.target.value) })}>
                        {[1, 2, 3, 4, 5].map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <div>
        <button type="button" id={`${base}-add`} onClick={add} disabled={value.length >= MAX_MORPH_STEPS}>
          Add step
        </button>{" "}
        {value.length >= MAX_MORPH_STEPS && <span>Up to {MAX_MORPH_STEPS} steps.</span>}
      </div>
      <div role="status" aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
        {note}
      </div>
    </div>
  );
}
