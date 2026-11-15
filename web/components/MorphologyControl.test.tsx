// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MORPH, MAX_MORPH_STEPS, type MorphSettings, NEW_MORPH_STEP } from "@/lib/morphology";
import MorphologyControl, { exampleScene } from "./MorphologyControl";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const E: MorphSettings = { ...DEFAULT_MORPH, op: "erode" };
const D: MorphSettings = { ...DEFAULT_MORPH, op: "dilate", size: 5 };
const O: MorphSettings = { ...DEFAULT_MORPH, op: "open", shape: "cross" };

/** Stateful host that also records every value the control reports. */
function setup(initial: MorphSettings[]) {
  const seen: MorphSettings[][] = [];
  function Host() {
    const [v, setV] = useState(initial);
    return (
      <MorphologyControl
        value={v}
        onChange={(n) => {
          seen.push(n);
          setV(n);
        }}
      />
    );
  }
  render(<Host />);
  return seen;
}
const ops = (v: MorphSettings[]) => v.map((s) => s.op);
const cardOps = () => screen.getAllByRole("listitem").map((li) => (within(li).getByLabelText(/operation/) as HTMLSelectElement).value);

describe("MorphologyControl stack", () => {
  it("an empty stack shows no cards and only Add step", () => {
    setup([]);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Add step" })).toBeTruthy();
  });
  it("Add step appends Erosion 3x3 rect; no Off option inside a card", () => {
    const seen = setup([]);
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
    expect(seen.at(-1)).toEqual([NEW_MORPH_STEP]);
    expect(NEW_MORPH_STEP).toEqual({ op: "erode", shape: "rect", size: 3, iterations: 1 });
    const opts = Array.from((screen.getByLabelText("Step 1 operation") as HTMLSelectElement).options).map((o) => o.textContent);
    expect(opts).toEqual(["Erosion", "Dilation", "Opening", "Closing", "Morphological gradient", "Top hat", "Black hat"]);
  });
  it("Remove drops that card; removing the last one is Off", () => {
    const seen = setup([E, D]);
    fireEvent.click(screen.getByRole("button", { name: "Remove step 1" }));
    expect(seen.at(-1)).toEqual([D]);
    fireEvent.click(screen.getByRole("button", { name: "Remove step 1" }));
    expect(seen.at(-1)).toEqual([]);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
  it("edits one step without touching the others; iterations only for erosion and dilation", () => {
    const seen = setup([E, O]);
    fireEvent.change(screen.getByLabelText("Step 2 kernel size"), { target: { value: "7" } });
    expect(seen.at(-1)).toEqual([E, { ...O, size: 7 }]);
    expect(screen.queryByLabelText("Step 2 iterations")).toBeNull();
    fireEvent.change(screen.getByLabelText("Step 1 iterations"), { target: { value: "3" } });
    expect(seen.at(-1)).toEqual([{ ...E, iterations: 3 }, { ...O, size: 7 }]);
    fireEvent.change(screen.getByLabelText("Step 2 operation"), { target: { value: "erode" } });
    expect(ops(seen.at(-1)!)).toEqual(["erode", "erode"]);
    expect(screen.getByLabelText("Step 2 iterations")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Step 1 kernel shape"), { target: { value: "ellipse" } });
    expect(seen.at(-1)![0].shape).toBe("ellipse");
  });
  it("Move up / Move down reorder the stack; the ends are disabled", () => {
    const seen = setup([E, D, O]);
    expect((screen.getByRole("button", { name: "Move step 1 up" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Move step 3 down" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Move step 2 up" }));
    expect(seen.at(-1)).toEqual([D, E, O]);
    expect(cardOps()).toEqual(["dilate", "erode", "open"]);
    fireEvent.click(screen.getByRole("button", { name: "Move step 2 down" }));
    expect(seen.at(-1)).toEqual([D, O, E]);
    expect(cardOps()).toEqual(["dilate", "open", "erode"]);
  });
  it("keeps keyboard focus on the moved card's move button and announces politely", () => {
    setup([E, D, O]);
    const up = screen.getByRole("button", { name: "Move step 3 up" });
    up.focus();
    fireEvent.click(up);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move step 2 up" }));
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
    expect(screen.getByRole("status").textContent).toMatch(/Step 3 moved to position 2 of 3/);
  });
  it("drag handle reorders: pointer down, move past a neighbour's centre, up", () => {
    // card k sits at y = 100 k .. 100 k + 100 by its place in the list
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const k = this.closest("li") ? Array.from(this.closest("ol")!.children).indexOf(this.closest("li")!) : 0;
      return { top: 100 * k, height: 100, bottom: 100 * k + 100, left: 0, right: 10, width: 10, x: 0, y: 100 * k, toJSON: () => ({}) } as DOMRect;
    });
    const seen = setup([E, D, O]);
    const handle = screen.getByRole("button", { name: "Drag step 1 to reorder" });
    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 50 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 60 });
    expect(seen).toHaveLength(0); // still above the neighbour's centre
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 160 });
    expect(seen.at(-1)).toEqual([D, E, O]);
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 260 });
    expect(seen.at(-1)).toEqual([D, O, E]);
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 260 });
    const n = seen.length;
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 0 });
    expect(seen).toHaveLength(n); // no drag after release
    expect(cardOps()).toEqual(["dilate", "open", "erode"]);
    // drag the last card back to the top
    const last = screen.getByRole("button", { name: "Drag step 3 to reorder" });
    fireEvent.pointerDown(last, { pointerId: 2, clientY: 250 });
    fireEvent.pointerMove(last, { pointerId: 2, clientY: 5 });
    fireEvent.pointerUp(last, { pointerId: 2 });
    expect(seen.at(-1)).toEqual([E, D, O]);
  });
  it("the drag handle does not scroll on touch", () => {
    setup([E]);
    expect(screen.getByRole("button", { name: "Drag step 1 to reorder" }).style.touchAction).toBe("none");
  });
  it(`caps the stack at ${MAX_MORPH_STEPS} steps`, () => {
    const seen = setup([]);
    const add = screen.getByRole("button", { name: "Add step" }) as HTMLButtonElement;
    for (let i = 0; i < MAX_MORPH_STEPS + 2; i++) act(() => add.click());
    expect(MAX_MORPH_STEPS).toBe(6);
    expect(seen.at(-1)).toHaveLength(6);
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(add.disabled).toBe(true);
  });
  it("each card is a panel and has its own (i) popup with an example image", () => {
    setup([{ ...DEFAULT_MORPH, op: "open" }]);
    expect(screen.getByRole("listitem").className).toContain("panel");
    expect(screen.queryByText(/cosmic ray/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "About Morphology step 1" }));
    const dlg = screen.getByRole("dialog");
    expect(dlg.textContent).toMatch(/cosmic ray/i);
    expect(dlg.textContent).toMatch(/too large a kernel/i);
    expect(screen.getByRole("img", { name: /before/i })).toBeTruthy();
    expect(screen.getByRole("img", { name: /after/i })).toBeTruthy();
  });
  it("the example scene has a hot pixel and a star blob", () => {
    const s = exampleScene();
    expect(s.data.length).toBe(s.w * s.h);
    expect(Math.max(...s.data)).toBeGreaterThan(0.9);
  });
});
