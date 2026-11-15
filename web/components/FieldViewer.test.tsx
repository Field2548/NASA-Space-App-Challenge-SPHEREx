// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatDec, formatRA } from "@/lib/coords";
import { makeSharedStretch, toImageData } from "@/lib/imaging";
import { DEFAULT_MORPH } from "@/lib/morphology";
import { DEFAULT_CURVE, presetCurve } from "@/lib/toneCurve";
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

describe("FieldViewer known overlay", () => {
  const known = {
    asteroids: [{ name: "(433) Eros", positions: [{ frame: 1, x: 2, y: 3 }, { frame: 2, x: 7, y: 5 }] }],
    stars: [{ name: "Gaia", x: 1, y: 1 }],
  };
  it("draws the shown frame's diamond at the mark transform, amber fill, and a ring per star", () => {
    setup({ known });
    const d = screen.getAllByTestId("known-diamond");
    expect(d).toHaveLength(1);
    expect(d[0].getAttribute("data-frame")).toBe("2");
    expect(d[0].getAttribute("points")?.split(" ")[0]).toBe(`${(7 + 0.5) * 4},${(5 + 0.5) * 4 - 5}`);
    expect(d[0].getAttribute("fill")).toBe("#E69F00");
    expect(screen.getAllByTestId("known-star")).toHaveLength(1);
  });
  it("names the diamond on hover and in a list; draws nothing without the prop", () => {
    const { canvas } = setup({ known });
    fireEvent.pointerMove(canvas, { clientX: 100 + 4 * 7 + 1, clientY: 50 + 4 * 5 + 1 });
    expect(canvas.getAttribute("title")).toBe("(433) Eros");
    expect(screen.getByRole("list", { name: "Known asteroids in this frame" }).textContent).toBe("(433) Eros");
    cleanup();
    setup();
    expect(screen.queryAllByTestId("known-diamond")).toHaveLength(0);
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

describe("FieldViewer cursor and readout label", () => {
  it("draws the keyboard crosshair and reads it out when the pointer is away", () => {
    setup({ cursor: { x: 7, y: 3 } });
    const g = screen.getByTestId("kb-cursor");
    expect(g.querySelector("rect")?.getAttribute("x")).toBe("28");
    expect(screen.getByTestId("hover-readout").textContent).toContain("S/N 6.0");
  });

  it("draws no crosshair without a cursor or outside the grid", () => {
    setup();
    expect(screen.queryByTestId("kb-cursor")).toBeNull();
    cleanup();
    setup({ cursor: { x: 99, y: 0 } });
    expect(screen.queryByTestId("kb-cursor")).toBeNull();
  });

  it("draws the crosshair tuple prop in the marks SVG; null draws nothing", () => {
    setup({ crosshair: [5, 2] });
    const g = screen.getByTestId("kb-cursor");
    expect(g.closest("svg")).not.toBeNull();
    expect(g.querySelector("rect")?.getAttribute("x")).toBe("20");
    expect(g.querySelector("rect")?.getAttribute("y")).toBe("8");
    cleanup();
    setup({ crosshair: null });
    expect(screen.queryByTestId("kb-cursor")).toBeNull();
  });

  it("labels the hover value as S/N (frame k) under Color by time", () => {
    const { canvas } = setup({ overlay: "colorByTime" });
    fireEvent.pointerMove(canvas, { clientX: 100 + 4 * 7 + 1, clientY: 50 + 4 * 3 + 1 });
    expect(screen.getByTestId("hover-readout").textContent).toContain("S/N (frame 2) 6.0");
  });
});

describe("FieldViewer morphology and tone curve", () => {
  const lastPixels = () => Array.from((ctx.putImageData.mock.calls.at(-1)![0] as ImageData).data);
  const expected = (k: number) => {
    const p = stretchPoints(field, field.stretch.black_sigma).base;
    return Array.from(toImageData(makeSharedStretch(frames, p)(frames[k]), 20, 10).data);
  };

  it("renders the same pixels as the plain stretch when Morphology is Off and the curve is the default", () => {
    setup();
    expect(lastPixels()).toEqual(expected(1));
    cleanup();
    setup({ morphology: [], curve: DEFAULT_CURVE });
    expect(lastPixels()).toEqual(expected(1));
  });

  it("applies the stack first to last: [erode, dilate] is opening, and the order changes the pixels", () => {
    const E = { ...DEFAULT_MORPH, op: "erode" as const };
    const D = { ...DEFAULT_MORPH, op: "dilate" as const };
    setup({ morphology: [{ ...DEFAULT_MORPH, op: "open" }] });
    const opened = lastPixels();
    cleanup();
    setup({ morphology: [E, D] });
    expect(lastPixels()).toEqual(opened);
    cleanup();
    setup({ morphology: [D, E] });
    expect(lastPixels()).not.toEqual(opened);
  });

  it("opening removes the single hot pixel before the stretch; the readout still shows the raw S/N", () => {
    const { canvas } = setup({ morphology: [{ ...DEFAULT_MORPH, op: "open" }] });
    const px = lastPixels();
    const at = (a: number[], x: number) => a.slice(4 * (3 * 20 + x), 4 * (3 * 20 + x) + 3);
    expect(at(px, 7)).toEqual(at(px, 12)); // now background
    expect(at(expected(1), 7)).not.toEqual(at(expected(1), 12)); // was a bright spot
    fireEvent.pointerMove(canvas, { clientX: 100 + 4 * 7 + 1, clientY: 50 + 4 * 3 + 1 });
    expect(screen.getByTestId("hover-readout").textContent).toContain("S/N 6.0");
  });

  it("a non-default curve changes the pixels, the same way for every frame", () => {
    setup({ curve: presetCurve("log") });
    const p = lastPixels();
    const e = expected(1);
    const i = 4 * (3 * 20 + 7);
    expect(p[i]).toBeGreaterThan(e[i]);
  });
});
