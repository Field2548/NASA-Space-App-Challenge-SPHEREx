// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CURVE, presetCurve } from "@/lib/toneCurve";
import ToneCurveEditor from "./ToneCurveEditor";

afterEach(cleanup);

describe("ToneCurveEditor", () => {
  it("shows five keyboard-reachable points", () => {
    render(<ToneCurveEditor value={DEFAULT_CURVE} onChange={() => {}} />);
    const pts = screen.getAllByRole("slider");
    expect(pts).toHaveLength(5);
    pts.forEach((p) => expect(p.getAttribute("tabindex")).toBe("0"));
    expect(pts[2].getAttribute("aria-valuenow")).toBe("50");
  });
  it("moves a point with the arrow keys (Shift = big step) and stays monotone", () => {
    const onChange = vi.fn();
    render(<ToneCurveEditor value={DEFAULT_CURVE} onChange={onChange} />);
    const mid = screen.getAllByRole("slider")[2];
    fireEvent.keyDown(mid, { key: "ArrowUp" });
    expect(onChange.mock.calls[0][0][2]).toBeCloseTo(0.52, 9);
    fireEvent.keyDown(mid, { key: "ArrowDown", shiftKey: true });
    expect(onChange.mock.calls[1][0][2]).toBeCloseTo(0.4, 9);
    fireEvent.keyDown(mid, { key: "ArrowUp", shiftKey: true });
    fireEvent.keyDown(mid, { key: "ArrowUp", shiftKey: true });
    fireEvent.keyDown(mid, { key: "ArrowUp", shiftKey: true });
    // neighbour above is 0.75: clamped
    expect(Math.max(...onChange.mock.calls.slice(2).map((c) => c[0][2]))).toBeLessThanOrEqual(0.75);
  });
  it("preset buttons set the curve; Reset restores the default", () => {
    const onChange = vi.fn();
    render(<ToneCurveEditor value={presetCurve("log")} onChange={onChange} />);
    for (const [name, key] of [["Linear", "linear"], ["asinh", "asinh"], ["Log", "log"], ["Gamma", "gamma"]] as const) {
      fireEvent.click(screen.getByRole("button", { name }));
      expect(onChange).toHaveBeenLastCalledWith(presetCurve(key));
    }
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(onChange).toHaveBeenLastCalledWith(DEFAULT_CURVE);
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
