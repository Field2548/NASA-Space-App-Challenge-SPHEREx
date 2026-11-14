// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatDec, formatRA } from "@/lib/coords";
import { pixelToSky } from "@/lib/wcs";
import FieldViewer, { clientToPixel, fitScale, formatGap, stretchPoints } from "./FieldViewer";
import { makeField, makeFrames, mockCanvas } from "./testFixtures";

let ctx: ReturnType<typeof mockCanvas>;
beforeEach(() => {
  ctx = mockCanvas();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const field = makeField();
const frames = makeFrames(field);
// Canvas at scale 4: 80 x 40 CSS px, placed at (100, 50).
const RECT = { left: 100, top: 50, width: 80, height: 40, right: 180, bottom: 90, x: 100, y: 50, toJSON: () => ({}) };

function setup(over: Partial<Parameters<typeof FieldViewer>[0]> = {}) {
  const onMark = vi.fn();
  const onInspect = vi.fn();
  render(<FieldViewer field={field} frames={frames} frameIndex={1} marks={[]} onMark={onMark} onInspect={onInspect} mode="mark" scale={4} {...over} />);
  const canvas = screen.getByTestId("field-canvas") as HTMLCanvasElement;
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(RECT as DOMRect);
  return { onMark, onInspect, canvas };
}

describe("helpers", () => {
  it("maps display pixels to native pixels under integer upscale", () => {
    expect(clientToPixel(100, 50, RECT, 20, 10)).toEqual([0, 0]);
    expect(clientToPixel(103.9, 53.9, RECT, 20, 10)).toEqual([0, 0]);
    expect(clientToPixel(104, 54, RECT, 20, 10)).toEqual([1, 1]);
    expect(clientToPixel(500, 500, RECT, 20, 10)).toEqual([19, 9]);
    expect(fitScale(20, 10, 640, 560)).toBe(32);
    expect(fitScale(1000, 1000, 640, 560)).toBe(1);
  });

  it("uses black +1 sigma and white >= 11 for the overlay stretch", () => {
    const p = stretchPoints(field, -1);
    expect(p.base).toEqual({ blackSigma: -1, softSigma: 2, white: 9 });
    expect(p.overlay).toEqual({ blackSigma: 1, softSigma: 2, white: 11 });
    expect(formatGap(21.1, false)).toBe("+21.1 h");
  });
});

describe("FieldViewer", () => {
  it("click marks the native pixel under the pointer with frame and tDays", () => {
    const { onMark, onInspect, canvas } = setup();
    fireEvent.click(canvas, { clientX: 100 + 4 * 7 + 2, clientY: 50 + 4 * 3 + 1 });
    expect(onMark).toHaveBeenCalledTimes(1);
    const m = onMark.mock.calls[0][0];
    expect(m).toMatchObject({ frame: 2, x: 7, y: 3 });
    expect(m.tDays).toBeCloseTo(0.88, 9);
    expect(onInspect).not.toHaveBeenCalled();
  });

  it("inspect mode calls onInspect instead of onMark and shows the mode", () => {
    const { onMark, onInspect, canvas } = setup({ mode: "inspect" });
    fireEvent.click(canvas, { clientX: 100 + 4 * 19 + 3, clientY: 50 });
    expect(onInspect).toHaveBeenCalledWith(19, 0);
    expect(onMark).not.toHaveBeenCalled();
    expect(screen.getByTestId("mode-status").textContent).toMatch(/INSPECT/);
    expect(canvas.style.cursor).toBe("help");
  });

  it("shows the mark mode in the cursor and status line", () => {
    const { canvas } = setup();
    expect(screen.getByTestId("mode-status").textContent).toMatch(/MARK/);
    expect(canvas.style.cursor).toBe("crosshair");
  });

  it("hover shows pixel, RA/Dec and S/N of the current frame", () => {
    const { canvas } = setup();
    fireEvent.pointerMove(canvas, { clientX: 100 + 4 * 7 + 1, clientY: 50 + 4 * 3 + 1 });
    const [ra, dec] = pixelToSky(field.wcs, 10, 7, 3);
    const text = screen.getByTestId("hover-readout").textContent ?? "";
    expect(text).toContain("x 7");
    expect(text).toContain("y 3");
    expect(text).toContain(formatRA(ra));
    expect(text).toContain(formatDec(dec));
    expect(text).toContain("S/N 6.0"); // frame index 1 has 5 + 1
    fireEvent.pointerMove(canvas, { clientX: 100, clientY: 50 });
    expect(screen.getByTestId("hover-readout").textContent).toContain("S/N no data");
  });

  it("draws nearest-neighbour at integer scale and labels marks with frame numbers", () => {
    setup({ marks: [{ frame: 1, x: 7, y: 3, tDays: 0 }, { frame: 3, x: 9, y: 3, tDays: 1.76 }] });
    expect(ctx.imageSmoothingEnabled).toBe(false);
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 80, 40);
    const labels = Array.from(document.querySelectorAll("svg text")).map((t) => t.textContent);
    expect(labels).toEqual(["1", "3"]);
  });

  it("shows the frame info strip and the png8 badge", () => {
    render(<FieldViewer field={makeField({ data: { ...field.data, precision: "png8" } })} frames={frames} frameIndex={1} marks={[]} onMark={() => {}} mode="mark" />);
    expect(screen.getByText("preview quality")).toBeTruthy();
    expect(screen.getByText("+21.1 h")).toBeTruthy();
    expect(screen.getByText("2026-01-07 00:47:12 UTC")).toBeTruthy();
    expect(screen.getByText("8 bands")).toBeTruthy();
    expect(screen.getByText("det 1, 2")).toBeTruthy();
  });

  it("has no badge for float data", () => {
    setup();
    expect(screen.queryByText("preview quality")).toBeNull();
  });
});
