// @vitest-environment jsdom
// Panel width handles: arrow keys and Home change the width within limits, and widths persist.
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PanelResizer, { PANEL_DEFAULT, PANEL_MAX, PANEL_MIN, clampPanel, resetPanelWidthsCache, usePanelWidths } from "./PanelResizer";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetPanelWidthsCache();
});

describe("PanelResizer", () => {
  it("arrow keys widen the left panel to the right and the right panel to the left", () => {
    const onLeft = vi.fn();
    const onRight = vi.fn();
    render(
      <>
        <PanelResizer side="left" width={220} onChange={onLeft} />
        <PanelResizer side="right" width={240} onChange={onRight} />
      </>,
    );
    fireEvent.keyDown(screen.getByRole("separator", { name: "Resize the left panel" }), { key: "ArrowRight" });
    fireEvent.keyDown(screen.getByRole("separator", { name: "Resize the right panel" }), { key: "ArrowLeft" });
    expect(onLeft).toHaveBeenCalledWith(236);
    expect(onRight).toHaveBeenCalledWith(256);
  });

  it("Home resets to the default width", () => {
    const on = vi.fn();
    render(<PanelResizer side="right" width={400} onChange={on} />);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "Home" });
    expect(on).toHaveBeenCalledWith(PANEL_DEFAULT.right);
  });

  it("clamps widths and keeps them in localStorage across mounts", () => {
    expect(clampPanel(10)).toBe(PANEL_MIN);
    expect(clampPanel(9999)).toBe(PANEL_MAX);
    const a = renderHook(() => usePanelWidths());
    act(() => a.result.current[1]("left", 9999));
    expect(a.result.current[0].left).toBe(PANEL_MAX);
    a.unmount();
    resetPanelWidthsCache();
    const b = renderHook(() => usePanelWidths());
    expect(b.result.current[0]).toEqual({ left: PANEL_MAX, right: PANEL_DEFAULT.right });
  });
});
