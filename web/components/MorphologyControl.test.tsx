// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MORPH } from "@/lib/morphology";
import MorphologyControl, { exampleScene } from "./MorphologyControl";

afterEach(cleanup);

describe("MorphologyControl", () => {
  it("is Off by default and hides the detail controls", () => {
    render(<MorphologyControl value={DEFAULT_MORPH} onChange={() => {}} />);
    expect((screen.getByLabelText("Morphology") as HTMLSelectElement).value).toBe("off");
    expect(screen.queryByLabelText("Kernel shape")).toBeNull();
  });
  it("offers all seven operations", () => {
    render(<MorphologyControl value={DEFAULT_MORPH} onChange={() => {}} />);
    const opts = Array.from((screen.getByLabelText("Morphology") as HTMLSelectElement).options).map((o) => o.textContent);
    expect(opts).toEqual(["Off", "Erosion", "Dilation", "Opening", "Closing", "Morphological gradient", "Top hat", "Black hat"]);
  });
  it("reports changes; iterations only for erosion and dilation", () => {
    const onChange = vi.fn();
    const { rerender } = render(<MorphologyControl value={DEFAULT_MORPH} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Morphology"), { target: { value: "open" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_MORPH, op: "open" });
    rerender(<MorphologyControl value={{ ...DEFAULT_MORPH, op: "open" }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Kernel shape"), { target: { value: "ellipse" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_MORPH, op: "open", shape: "ellipse" });
    fireEvent.change(screen.getByLabelText("Kernel size"), { target: { value: "7" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_MORPH, op: "open", size: 7 });
    expect(screen.queryByLabelText("Iterations")).toBeNull();
    rerender(<MorphologyControl value={{ ...DEFAULT_MORPH, op: "erode" }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Iterations"), { target: { value: "3" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_MORPH, op: "erode", iterations: 3 });
  });
  it("keeps the panel short and puts the detail in the (i) popup with an example image", () => {
    render(<MorphologyControl value={{ ...DEFAULT_MORPH, op: "open" }} onChange={() => {}} />);
    expect(screen.queryByText(/cosmic ray/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "About Morphology" }));
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
