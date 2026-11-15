// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CURVE, presetCurve } from "@/lib/toneCurve";
import ToneCurveEditor from "./ToneCurveEditor";

afterEach(cleanup);

describe("ToneCurveEditor", () => {
  it("shows one keyboard-reachable Bezier handle and a continuous stretch slider on the bend", () => {
    render(<ToneCurveEditor value={DEFAULT_CURVE} onChange={() => {}} />);
    const handle = screen.getByRole("slider", { name: "Curve bend" });
    expect(handle.getAttribute("tabindex")).toBe("0");
    expect(handle.getAttribute("aria-valuenow")).toBe("0");
    const stretch = screen.getByRole("slider", { name: "Stretch" }) as HTMLInputElement;
    expect([stretch.min, stretch.max, stretch.step]).toEqual(["-1", "1", "0.01"]);
    expect(stretch.value).toBe("0"); // asinh
    expect(screen.getAllByRole("slider")).toHaveLength(2);
  });
  it("shows no stop names and no tick list under the stretch slider (nothing to snap to)", () => {
    const { container } = render(<ToneCurveEditor value={DEFAULT_CURVE} onChange={() => {}} />);
    const stretch = screen.getByRole("slider", { name: "Stretch" });
    expect(stretch.getAttribute("list")).toBeNull();
    expect(container.querySelector("datalist")).toBeNull();
    for (const name of ["Linear", "asinh", "Log"]) expect(screen.queryByText(name)).toBeNull();
  });
  it("the stretch slider moves the bend continuously, not only to the stops", () => {
    const onChange = vi.fn();
    render(<ToneCurveEditor value={DEFAULT_CURVE} onChange={onChange} />);
    fireEvent.change(screen.getByRole("slider", { name: "Stretch" }), { target: { value: "0.3" } });
    expect(onChange).toHaveBeenLastCalledWith({ bend: 0.3 });
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
  it("the stretch slider sets the curve itself: each stop's bend gives that stop", () => {
    for (const [v, key, start] of [["-0.44", "linear", 0.9], ["0.54", "log", -0.9], ["0", "asinh", 0.9]] as const) {
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
    expect(stretch().value).toBe("0.54");
    expect(stretch().getAttribute("aria-valuetext")).toBe("Log");
    expect(screen.queryByText(/Stretch:/)).toBeNull();
    expect(screen.getByRole("slider", { name: "Curve bend" }).getAttribute("aria-valuenow")).toBe("54");
    rerender(<ToneCurveEditor value={{ bend: 0.6 }} onChange={() => {}} />);
    expect(stretch().getAttribute("aria-valuetext")).toBe("Custom");
    expect(stretch().value).toBe("0.6"); // the slider follows the dragged handle
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
