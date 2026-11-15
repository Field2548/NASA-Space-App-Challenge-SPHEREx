// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fields from "@/lib/fields";
import { timeColors as libTimeColors } from "@/lib/palettes";
import { timeColors as reTimeColors } from "./timeColors";
import { makeField, makeFrames, mockCanvas } from "./testFixtures";
import Timeline, { clampOnion, keyToIndex, onionRangeFrames } from "./Timeline";

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

describe("Timeline loop range and speed", () => {
  it("has no Real time spacing option and spaces clips evenly", () => {
    render(<Timeline field={field} frames={frames} index={0} onIndexChange={() => {}} />);
    expect(screen.queryByRole("checkbox", { name: /Real time spacing/ })).toBeNull();
    const margins = screen.getAllByRole("option").map((o) => (o as HTMLElement).style.marginLeft);
    expect(margins).toEqual(["0px", "8px", "8px", "8px"]);
  });
  it("loop range sliders report ordered 0-based ranges and keep one frame at least", () => {
    const onRange = vi.fn();
    render(<Timeline field={field} frames={frames} index={0} onIndexChange={() => {}} loopRange={[1, 2]} onLoopRangeChange={onRange} />);
    expect(screen.getByText("Loop frames 2 to 3")).toBeTruthy();
    fireEvent.change(screen.getByRole("slider", { name: "Loop end frame" }), { target: { value: "4" } });
    expect(onRange).toHaveBeenLastCalledWith([1, 3]);
    fireEvent.change(screen.getByRole("slider", { name: "Loop start frame" }), { target: { value: "1" } });
    expect(onRange).toHaveBeenLastCalledWith([0, 2]);
    fireEvent.change(screen.getByRole("slider", { name: "Loop start frame" }), { target: { value: "4" } });
    expect(onRange).toHaveBeenLastCalledWith([3, 3]); // start passes the end: the end follows
  });
  it("speed slider steps through the rates, with a readable value", () => {
    const onFps = vi.fn();
    render(<Timeline field={field} frames={frames} index={0} onIndexChange={() => {}} fps={1} onFpsChange={onFps} />);
    const s = screen.getByRole("slider", { name: "Blink speed" });
    expect(s.getAttribute("aria-valuetext")).toBe("1 frame per second");
    fireEvent.change(s, { target: { value: "3" } });
    expect(onFps).toHaveBeenLastCalledWith(3);
    fireEvent.change(s, { target: { value: "0" } });
    expect(onFps).toHaveBeenLastCalledWith(0.5);
  });
  it("hides the loop and speed controls without their callbacks", () => {
    render(<Timeline field={field} frames={frames} index={0} onIndexChange={() => {}} />);
    expect(screen.queryByRole("slider", { name: "Blink speed" })).toBeNull();
    expect(screen.queryByRole("slider", { name: "Loop end frame" })).toBeNull();
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

  it("no ONION track without onionRange", () => {
    render(<Timeline field={field} frames={frames} index={0} onIndexChange={() => {}} />);
    expect(screen.queryByText("ONION")).toBeNull();
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
  it("draws from the given frames when thumbsFromFrames is set (band selected)", async () => {
    const spy = vi.spyOn(fields, "loadThumbs").mockResolvedValue(Array.from({ length: 4 }, () => bm()));
    render(<Timeline field={field} frames={frames} index={0} onIndexChange={() => {}} thumbsFromFrames />);
    await waitFor(() => expect(spy).toHaveBeenCalled());
    await Promise.resolve();
    expect(document.querySelectorAll('canvas[data-thumb="webp"]')).toHaveLength(0);
    expect(document.querySelectorAll('canvas[data-thumb="frame"]')).toHaveLength(4);
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
