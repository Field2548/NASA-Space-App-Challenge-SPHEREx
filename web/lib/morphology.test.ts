import { describe, expect, it } from "vitest";
import { DEFAULT_MORPH, dilate, erode, isMorphOff, kernelOffsets, morphFrame, morphFrames, morphKernel, morphStack } from "./morphology";

const f = (rows: number[][]) => Float32Array.from(rows.flat());
const rows = (a: Float32Array, w: number) => Array.from({ length: a.length / w }, (_, y) => Array.from(a.slice(y * w, (y + 1) * w)));

// 5x5 with a one-pixel hot spot at the centre and a 3x3 block bottom-right
const SPOT = f([
  [0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0],
  [0, 0, 9, 0, 0],
  [0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0],
]);

describe("kernels match cv2.getStructuringElement", () => {
  it("rect, cross and ellipse masks", () => {
    expect(morphKernel("rect", 3).flat().every(Boolean)).toBe(true);
    expect(morphKernel("cross", 3)).toEqual([[0, 1, 0], [1, 1, 1], [0, 1, 0]]);
    expect(morphKernel("ellipse", 5)).toEqual([
      [0, 0, 1, 0, 0],
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
      [0, 0, 1, 0, 0],
    ]);
    expect(morphKernel("ellipse", 7)[1]).toEqual([0, 1, 1, 1, 1, 1, 0]);
    expect(kernelOffsets("cross", 5)).toHaveLength(9);
  });
});

describe("erosion and dilation", () => {
  it("erosion is the min over the kernel; a single hot pixel vanishes", () => {
    expect(Array.from(erode(SPOT, 5, 5, "rect", 3))).toEqual(new Array(25).fill(0));
  });
  it("dilation is the max over the kernel; one pixel grows to the kernel shape", () => {
    expect(rows(dilate(SPOT, 5, 5, "rect", 3), 5)).toEqual([
      [0, 0, 0, 0, 0],
      [0, 9, 9, 9, 0],
      [0, 9, 9, 9, 0],
      [0, 9, 9, 9, 0],
      [0, 0, 0, 0, 0],
    ]);
    expect(rows(dilate(SPOT, 5, 5, "cross", 3), 5)[1]).toEqual([0, 0, 9, 0, 0]);
  });
  it("ignores the border (cv2 +inf / -inf): a bright edge row survives erosion", () => {
    const a = f([
      [5, 5, 5],
      [5, 5, 5],
      [5, 5, 5],
    ]);
    expect(Array.from(erode(a, 3, 3, "rect", 3))).toEqual(new Array(9).fill(5));
    const b = f([
      [-1, -1, -1],
      [-1, -1, -1],
      [-1, -1, -1],
    ]);
    expect(Array.from(dilate(b, 3, 3, "rect", 3))).toEqual(new Array(9).fill(-1));
  });
  it("iterations repeat the operation", () => {
    const one = f([[0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 7, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0]]);
    const d2 = morphFrame(one, 7, 3, { ...DEFAULT_MORPH, op: "dilate", size: 3, shape: "rect", iterations: 2 });
    expect(rows(d2, 7)[1]).toEqual([0, 7, 7, 7, 7, 7, 0]);
  });
});

describe("compound operations", () => {
  const w = 7;
  const img = f([
    [0, 0, 0, 0, 0, 0, 0],
    [0, 4, 4, 4, 0, 0, 0],
    [0, 4, 4, 4, 0, 8, 0],
    [0, 4, 4, 4, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0],
  ]);
  const run = (op: "open" | "close" | "gradient" | "tophat" | "blackhat") => morphFrame(img, w, 5, { op, shape: "rect", size: 3, iterations: 1 });
  const e = erode(img, w, 5, "rect", 3);
  const d = dilate(img, w, 5, "rect", 3);
  it("opening = dilate(erode): removes the hot pixel, keeps the 3x3 blob", () => {
    const o = run("open");
    expect(Array.from(o)).toEqual(Array.from(dilate(e, w, 5, "rect", 3)));
    expect(o[2 * w + 5]).toBe(0);
    expect(o[2 * w + 2]).toBe(4);
  });
  it("closing = erode(dilate)", () => {
    expect(Array.from(run("close"))).toEqual(Array.from(erode(d, w, 5, "rect", 3)));
  });
  it("gradient = dilate - erode, top hat = src - opening, black hat = closing - src", () => {
    const g = run("gradient");
    for (let i = 0; i < g.length; i++) expect(g[i]).toBe(d[i] - e[i]);
    const th = run("tophat");
    expect(th[2 * w + 5]).toBe(8);
    expect(th[2 * w + 2]).toBe(0);
    const open = run("open");
    for (let i = 0; i < th.length; i++) expect(th[i]).toBe(img[i] - open[i]);
    const hole = f([[3, 3, 3], [3, 0, 3], [3, 3, 3]]);
    const bh = morphFrame(hole, 3, 3, { op: "blackhat", shape: "rect", size: 3, iterations: 1 });
    expect(bh[4]).toBe(3);
    expect(bh[0]).toBe(0);
  });
});

describe("non-finite pixels and caching", () => {
  it("NaN is ignored by the window and stays NaN", () => {
    const a = f([[1, NaN, 3]]);
    const e1 = erode(a, 3, 1, "rect", 3);
    expect(e1[0]).toBe(1);
    expect(Number.isNaN(e1[1])).toBe(true);
    expect(e1[2]).toBe(3);
  });
  it("an empty stack returns the very same frames; same stack returns the cached result", () => {
    const frames = [SPOT];
    expect(isMorphOff(DEFAULT_MORPH)).toBe(true);
    expect(morphFrames(frames, 5, 5, [])).toBe(frames);
    expect(morphFrames(frames, 5, 5, [DEFAULT_MORPH])).toBe(frames);
    const s = { ...DEFAULT_MORPH, op: "open" as const };
    const a = morphFrames(frames, 5, 5, [s]);
    expect(morphFrames(frames, 5, 5, [{ ...s }])).toEqual(a);
    expect(morphFrames(frames, 5, 5, [{ ...s }])[0]).toBe(a[0]);
    expect(morphFrames(frames, 5, 5, [{ ...s, size: 5 }])[0]).not.toBe(a[0]);
  });
  it("the cache key holds the whole stack and its order", () => {
    const frames = [SPOT];
    const E = { ...DEFAULT_MORPH, op: "erode" as const };
    const D = { ...DEFAULT_MORPH, op: "dilate" as const };
    const ed = morphFrames(frames, 5, 5, [E, D])[0];
    const de = morphFrames(frames, 5, 5, [D, E])[0];
    expect(de).not.toBe(ed);
    expect(morphFrames(frames, 5, 5, [E, D])[0]).toBe(ed);
    expect(morphFrames(frames, 5, 5, [E])[0]).not.toBe(ed);
  });
  // Alone this takes 25-45 ms; the bound is loose because the full parallel run (and CI) share cores.
  it("a 7x7 kernel on 10 frames of 119x119 stays under 400 ms even on a loaded machine", () => {
    const frames = Array.from({ length: 10 }, (_, k) => Float32Array.from({ length: 119 * 119 }, (_, i) => ((i * 7 + k) % 13) - 3));
    for (const op of ["erode", "open", "gradient"] as const) {
      const t0 = performance.now();
      morphFrames(frames, 119, 119, [{ op, shape: "ellipse", size: 7, iterations: 1 }]);
      expect(performance.now() - t0).toBeLessThan(400);
    }
  });
});

describe("morphology stack", () => {
  const E = { ...DEFAULT_MORPH, op: "erode" as const };
  const D = { ...DEFAULT_MORPH, op: "dilate" as const };
  // two 2x2 blocks one pixel apart plus an isolated pixel: erode and dilate do not commute
  const BAR = f([
    [0, 0, 0, 0, 0, 0, 0],
    [0, 5, 5, 0, 5, 5, 0],
    [0, 5, 5, 0, 5, 5, 0],
    [0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 7],
  ]);
  it("an empty stack is the identity (same array)", () => {
    expect(morphStack(BAR, 7, 5, [])).toBe(BAR);
  });
  it("[erode, dilate] equals open", () => {
    expect(rows(morphStack(BAR, 7, 5, [E, D]), 7)).toEqual(rows(morphFrame(BAR, 7, 5, { ...DEFAULT_MORPH, op: "open" }), 7));
  });
  it("[dilate, erode] equals close", () => {
    expect(rows(morphStack(BAR, 7, 5, [D, E]), 7)).toEqual(rows(morphFrame(BAR, 7, 5, { ...DEFAULT_MORPH, op: "close" }), 7));
  });
  it("order matters", () => {
    expect(rows(morphStack(BAR, 7, 5, [D, E]), 7)).not.toEqual(rows(morphStack(BAR, 7, 5, [E, D]), 7));
  });
  it("the output of step k feeds step k + 1", () => {
    expect(rows(morphStack(BAR, 7, 5, [E, E]), 7)).toEqual(rows(morphFrame(morphFrame(BAR, 7, 5, E), 7, 5, E), 7));
  });
});
