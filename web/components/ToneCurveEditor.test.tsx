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
    expect(onChange.mock.calls[0][0]).toEqual({ preset: "asinh", bend: 0.05 });
    fireEvent.keyDown(handle(), { key: "ArrowDown", shiftKey: true });
    expect(onChange.mock.calls[1][0].bend).toBeCloseTo(-0.2, 9);
    rerender(<ToneCurveEditor value={{ preset: "asinh", bend: 0.95 }} onChange={onChange} />);
    fireEvent.keyDown(handle(), { key: "ArrowUp", shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith({ preset: "asinh", bend: 1 });
  });
  it("the stretch slider stops at Linear, Log and asinh and keeps the bend", () => {
    const onChange = vi.fn();
    render(<ToneCurveEditor value={{ preset: "asinh", bend: 0.3 }} onChange={onChange} />);
    const stretch = screen.getByRole("slider", { name: "Stretch" });
    for (const [v, key] of [["0", "linear"], ["1", "log"], ["2", "asinh"]] as const) {
      fireEvent.change(stretch, { target: { value: v } });
      if (key !== "asinh") expect(onChange).toHaveBeenLastCalledWith({ preset: key, bend: 0.3 });
    }
    expect(screen.queryByRole("button", { name: "Linear" })).toBeNull();
    expect(presetCurve("asinh")).toEqual(DEFAULT_CURVE);
  });
  it("Straighten resets the bend only", () => {
    const onChange = vi.fn();
    render(<ToneCurveEditor value={{ preset: "log", bend: -0.4 }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Straighten" }));
    expect(onChange).toHaveBeenLastCalledWith({ preset: "log", bend: 0 });
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
