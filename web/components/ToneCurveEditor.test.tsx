// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CURVE, presetCurve } from "@/lib/toneCurve";
import ToneCurveEditor from "./ToneCurveEditor";

afterEach(cleanup);

describe("ToneCurveEditor", () => {
  it("shows one keyboard-reachable Bezier handle and a 3-stop stretch slider", () => {
    render(<ToneCurveEditor value={DEFAULT_CURVE} onChange={() => {}} />);
    const handle = screen.getByRole("slider", { name: "Curve bend" });
    expect(handle.getAttribute("tabindex")).toBe("0");
    expect(handle.getAttribute("aria-valuenow")).toBe("0");
    const stretch = screen.getByRole("slider", { name: "Stretch" }) as HTMLInputElement;
    expect([stretch.min, stretch.max, stretch.step]).toEqual(["0", "2", "1"]);
    expect(stretch.value).toBe("2"); // asinh
    expect(screen.getAllByRole("slider")).toHaveLength(2);
  });
  it("moves the handle with the arrow keys (Shift = big step), clamped to -1..1", () => {
    const onChange = vi.fn();
    const { rerender } = render(<ToneCurveEditor value={DEFAULT_CURVE} onChange={onChange} />);
    const handle = () => screen.getByRole("slider", { name: "Curve bend" });
    fireEvent.keyDown(handle(), { key: "ArrowUp" });
    expect(onChange.mock.calls[0][0]).toEqual({ bend: 0.05 });
    fireEvent.keyDown(handle(), { key: "ArrowDown", shiftKey: true });
    expect(onChange.mock.calls[1][0].bend).toBeCloseTo(-0.2, 9);
    rerender(<ToneCurveEditor value={{ bend: 0.95 }} onChange={onChange} />);
    fireEvent.keyDown(handle(), { key: "ArrowUp", shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith({ bend: 1 });
  });
  it("the stretch slider sets the curve itself: each stop replaces any custom bend", () => {
    // Start from a custom bend whose nearest stop is a different one, so each move is a real change.
    for (const [v, key, start] of [["0", "linear", 0.9], ["1", "log", -0.9], ["2", "asinh", 0.9]] as const) {
      const onChange = vi.fn();
      render(<ToneCurveEditor value={{ bend: start }} onChange={onChange} />);
      fireEvent.change(screen.getByRole("slider", { name: "Stretch" }), { target: { value: v } });
      expect(onChange).toHaveBeenLastCalledWith(presetCurve(key));
      cleanup();
    }
    expect(presetCurve("asinh")).toEqual(DEFAULT_CURVE);
  });
  it("the curve shows its stop, or Custom after the handle moves off; no Straighten button", () => {
    const { rerender } = render(<ToneCurveEditor value={presetCurve("log")} onChange={() => {}} />);
    const stretch = () => screen.getByRole("slider", { name: "Stretch" }) as HTMLInputElement;
    expect(stretch().value).toBe("1");
    expect(stretch().getAttribute("aria-valuetext")).toBe("Log");
    expect(screen.queryByText(/Stretch:/)).toBeNull();
    expect(screen.getByRole("slider", { name: "Curve bend" }).getAttribute("aria-valuenow")).toBe("54");
    rerender(<ToneCurveEditor value={{ bend: 0.6 }} onChange={() => {}} />);
    expect(stretch().getAttribute("aria-valuetext")).toBe("Custom");
    expect(stretch().value).toBe("1"); // nearest stop
    expect(screen.queryByRole("button", { name: "Straighten" })).toBeNull();
  });
  it("keeps detail in the (i) popup with before/after example images", () => {
    render(<ToneCurveEditor value={DEFAULT_CURVE} onChange={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "About Light curve" }));
    expect(screen.getByRole("dialog").textContent).toMatch(/brightness/i);
    expect(screen.getByRole("img", { name: /before/i })).toBeTruthy();
    expect(screen.getByRole("img", { name: /after/i })).toBeTruthy();
  });
});
