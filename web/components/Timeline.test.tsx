// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fields from "@/lib/fields";
import { timeColors as libTimeColors } from "@/lib/palettes";
import { timeColors as reTimeColors } from "./timeColors";
import { makeField, makeFrames, mockCanvas } from "./testFixtures";
import Timeline, { clampOnion, clipOffsets, keyToIndex, onionRangeFrames } from "./Timeline";

beforeEach(() => {
  mockCanvas();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const field = makeField({}, 4);
const frames = makeFrames(field);

function Harness({ onToggle }: { onToggle?: () => void }) {
  const [i, setI] = useState(0);
  return <Timeline field={field} frames={frames} index={i} onIndexChange={setI} marks={[{ frame: 2, x: 1, y: 1, tDays: 0.88 }]} onTogglePlay={onToggle} />;
}

describe("keyToIndex", () => {
  it("steps and clamps", () => {
    expect(keyToIndex("ArrowRight", 3, 4)).toBe(3);
    expect(keyToIndex("ArrowLeft", 0, 4)).toBe(0);
    expect(keyToIndex("End", 0, 4)).toBe(3);
    expect(keyToIndex("a", 0, 4)).toBeNull();
  });
});

describe("Timeline", () => {
  it("steps frames with the arrow keys on the focused track", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const list = screen.getByRole("listbox", { name: "Frames" });
    const selected = () => screen.getAllByRole("option").findIndex((o) => o.getAttribute("aria-selected") === "true");
    expect(selected()).toBe(0);
    await user.click(screen.getAllByRole("option")[0]);
    list.focus();
    expect(document.activeElement).toBe(list);
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(selected()).toBe(2);
    expect(list.getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[2].id);
    await user.keyboard("{ArrowLeft}");
    expect(selected()).toBe(1);
    await user.keyboard("{End}{ArrowRight}");
    expect(selected()).toBe(3);
  });

  it("labels clips with time and gap, shows my marks, Space toggles blink", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<Harness onToggle={onToggle} />);
    const opts = screen.getAllByRole("option");
    expect(opts).toHaveLength(4);
    expect(opts[1].getAttribute("aria-label")).toContain("+21.1 h");
    expect(opts[0].style.borderColor).not.toBe("");
    screen.getByRole("listbox").focus();
    await user.keyboard(" ");
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Play blink" })).toBeTruthy();
  });
});

describe("clipOffsets", () => {
  const mk = (mjds: number[]) => ({ frames: mjds.map((mjd, k) => ({ i: k + 1, mjd })) }) as never;
  it("is even unless real spacing is asked for", () => {
    expect(clipOffsets(mk([0, 1, 5]), 3, false).left).toEqual([0, 120, 240]);
  });
  it("scales true gaps linearly when max/min <= 10", () => {
    const { left, log } = clipOffsets(mk([0, 1, 4]), 3, true);
    expect(log).toBe(false);
    expect(left).toEqual([0, 120, 480]);
  });
  it("goes logarithmic when max/min > 10", () => {
    const { left, log } = clipOffsets(mk([0, 1, 17]), 3, true);
    expect(log).toBe(true);
    expect(left[2] - left[1]).toBeCloseTo(120 * (1 + Math.log2(16)), 9);
  });
  it("falls back to even for non-increasing times", () => {
    expect(clipOffsets(mk([0, 0, 1]), 3, true).left).toEqual([0, 120, 240]);
  });
});

describe("onion helpers", () => {
  it("expands and clamps ranges", () => {
    expect(onionRangeFrames([1, 3])).toEqual([1, 2, 3]);
    expect(clampOnion([2, 2], 5)).toEqual([2, 3]);
    expect(clampOnion([4, 4], 5)).toEqual([3, 4]);
    expect(clampOnion([0, 20], 12)).toEqual([0, 6]);
  });
});

describe("Timeline v1 completion", () => {
  it("toggles loop / ping-pong", async () => {
    const user = userEvent.setup();
    const onMode = vi.fn();
    render(<Timeline field={field} frames={frames} index={0} onIndexChange={() => {}} loopMode="loop" onLoopModeChange={onMode} />);
    await user.click(screen.getByRole("button", { name: /Blink order: loop/ }));
    expect(onMode).toHaveBeenCalledWith("pingpong");
  });

  it("scrubs by dragging the pointer over clips", () => {
    const onIndex = vi.fn();
    render(<Timeline field={field} frames={frames} index={0} onIndexChange={onIndex} />);
    const list = screen.getByRole("listbox");
    vi.spyOn(list, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 480, height: 100 } as DOMRect);
    fireEvent.pointerDown(list, { clientX: 2 + 10, pointerId: 1 });
    fireEvent.pointerMove(list, { clientX: 2 + 240 + 50, pointerId: 1 });
    expect(onIndex).toHaveBeenLastCalledWith(2);
    fireEvent.pointerUp(list, { pointerId: 1 });
    fireEvent.pointerMove(list, { clientX: 2 + 360 + 50, pointerId: 1 });
    expect(onIndex).toHaveBeenLastCalledWith(2);
  });

  it("onion handles are keyboard operable and keep 2..7 frames", async () => {
    const user = userEvent.setup();
    const onRange = vi.fn();
    render(<Timeline field={field} frames={frames} index={0} onIndexChange={() => {}} onionRange={[0, 2]} onOnionRangeChange={onRange} />);
    const end = screen.getByRole("slider", { name: "Onion range end" });
    expect(end.getAttribute("aria-valuenow")).toBe("3");
    end.focus();
    await user.keyboard("{ArrowRight}");
    expect(onRange).toHaveBeenLastCalledWith([0, 3]);
    await user.keyboard("{ArrowRight}");
    expect(onRange).toHaveBeenLastCalledWith([0, 3]); // props are fixed, so the same step repeats
    const start = screen.getByRole("slider", { name: "Onion range start" });
    start.focus();
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
    expect(onRange).toHaveBeenLastCalledWith([1, 2]);
  });

  it("no ONION track without onionRange; real spacing checkbox reports", async () => {
    const user = userEvent.setup();
    const onSpacing = vi.fn();
    render(<Timeline field={field} frames={frames} index={0} onIndexChange={() => {}} onRealSpacingChange={onSpacing} />);
    expect(screen.queryByText("ONION")).toBeNull();
    await user.click(screen.getByRole("checkbox", { name: /Real time spacing/ }));
    expect(onSpacing).toHaveBeenCalledWith(true);
  });
});

describe("Timeline tutorial targets and colours", () => {
  it("tags the play button and the frames track for coach marks", () => {
    render(<Timeline field={field} frames={frames} index={0} onIndexChange={() => {}} onTogglePlay={() => {}} />);
    expect(screen.getByRole("button", { name: "Play blink" }).getAttribute("data-tutorial-target")).toBe("play-button");
    expect(screen.getByRole("listbox", { name: "Frames" }).getAttribute("data-tutorial-target")).toBe("frame-picker");
  });

  it("uses the lib/palettes time colours; components/timeColors re-exports them", () => {
    expect(reTimeColors).toBe(libTimeColors);
    render(<Timeline field={field} frames={frames} index={0} onIndexChange={() => {}} />);
    const [r, g, b] = libTimeColors(4, "normal")[0];
    expect((screen.getAllByRole("option")[0] as HTMLElement).style.borderColor).toBe(`rgb(${r}, ${g}, ${b})`);
  });
});

describe("Timeline thumbnails", () => {
  const bm = (w = 48) => ({ width: w, height: w, close() {} }) as unknown as ImageBitmap;
  it("draws field.thumbs when there is one per frame", async () => {
    vi.spyOn(fields, "loadThumbs").mockResolvedValue(Array.from({ length: 4 }, () => bm()));
    render(<Timeline field={field} frames={frames} index={0} onIndexChange={() => {}} />);
    await waitFor(() => expect(document.querySelectorAll('canvas[data-thumb="webp"]')).toHaveLength(4));
  });
  it("keeps the frame canvases on count mismatch and on error", async () => {
    const spy = vi.spyOn(fields, "loadThumbs").mockResolvedValue([bm(), bm()]);
    render(<Timeline field={field} frames={frames} index={0} onIndexChange={() => {}} />);
    await waitFor(() => expect(spy).toHaveBeenCalled());
    await Promise.resolve();
    expect(document.querySelectorAll('canvas[data-thumb="frame"]')).toHaveLength(4);
    cleanup();
    spy.mockRejectedValue(new Error("404"));
    render(<Timeline field={field} frames={frames} index={0} onIndexChange={() => {}} />);
    await Promise.resolve();
    expect(document.querySelectorAll('canvas[data-thumb="frame"]')).toHaveLength(4);
  });
});
