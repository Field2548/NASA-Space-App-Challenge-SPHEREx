// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fields from "@/lib/fields";
import { timeColors as libTimeColors } from "@/lib/palettes";
import { timeColors as reTimeColors } from "./timeColors";
import { makeField, makeFrames, mockCanvas } from "./testFixtures";
import { resetArchiveStatus } from "@/lib/archiveStatus";
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
  it("steps and wraps round the ends", () => {
    expect(keyToIndex("ArrowRight", 3, 4)).toBe(0);
    expect(keyToIndex("ArrowRight", 1, 4)).toBe(2);
    expect(keyToIndex("ArrowLeft", 0, 4)).toBe(3);
    expect(keyToIndex("ArrowLeft", 0, 1)).toBe(0);
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
    await user.keyboard("{End}");
    expect(selected()).toBe(3);
    await user.keyboard("{ArrowRight}");
    expect(selected()).toBe(0); // wraps to the first frame
    await user.keyboard("{ArrowLeft}");
    expect(selected()).toBe(3); // and back to the last
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

describe("Timeline Blink range and speed", () => {
  const lane = (el: HTMLElement) => el.closest<HTMLElement>("[data-sync]") as HTMLElement;
  it("has no Real time spacing option and spaces clips evenly", () => {
    render(<Timeline field={field} frames={frames} index={0} onIndexChange={() => {}} />);
    expect(screen.queryByRole("checkbox", { name: /Real time spacing/ })).toBeNull();
    const margins = screen.getAllByRole("option").map((o) => (o as HTMLElement).style.marginLeft);
    expect(margins).toEqual(["0px", "8px", "8px", "8px"]);
  });
  it("shows a labelled Blink range with the frames it covers, not a bare slider", () => {
    render(<Timeline field={field} frames={frames} index={0} onIndexChange={() => {}} loopRange={[1, 2]} onLoopRangeChange={() => {}} />);
    expect(screen.getByRole("group", { name: "Blink frames 2–3" })).toBeTruthy();
    expect(screen.getByText("frames 2–3")).toBeTruthy();
    const s = screen.getByRole("slider", { name: "Blink start frame" });
    const e = screen.getByRole("slider", { name: "Blink end frame" });
    expect(s.getAttribute("aria-valuenow")).toBe("2");
    expect(s.getAttribute("aria-valuemin")).toBe("1");
    expect(s.getAttribute("aria-valuemax")).toBe("4");
    expect(s.getAttribute("aria-valuetext")).toBe("starts at frame 2 of 4");
    expect(e.getAttribute("aria-valuenow")).toBe("3");
    expect(e.getAttribute("aria-valuetext")).toBe("ends at frame 3 of 4");
    expect(s.getAttribute("title")).toMatch(/Drag the ends/);
    expect(s.style.left).toBe("120px"); // aligned to the clip it starts on (frame 2)
  });
  it("arrow keys, Home and End move a thumb and never cross", () => {
    const onRange = vi.fn();
    render(<Timeline field={field} frames={frames} index={0} onIndexChange={() => {}} loopRange={[1, 2]} onLoopRangeChange={onRange} />);
    const s = screen.getByRole("slider", { name: "Blink start frame" });
    const e = screen.getByRole("slider", { name: "Blink end frame" });
    fireEvent.keyDown(e, { key: "ArrowRight" });
    expect(onRange).toHaveBeenLastCalledWith([1, 3]);
    fireEvent.keyDown(s, { key: "Home" });
    expect(onRange).toHaveBeenLastCalledWith([0, 2]);
    fireEvent.keyDown(s, { key: "ArrowLeft" });
    expect(onRange).toHaveBeenLastCalledWith([0, 2]);
    onRange.mockClear();
    fireEvent.keyDown(s, { key: "End" }); // stops at the end thumb
    expect(onRange).toHaveBeenLastCalledWith([2, 2]);
    onRange.mockClear();
    fireEvent.keyDown(e, { key: "Home" }); // stops at the start thumb
    expect(onRange).toHaveBeenLastCalledWith([1, 1]);
    onRange.mockClear();
    fireEvent.keyDown(e, { key: "ArrowLeft" });
    fireEvent.keyDown(s, { key: "ArrowRight" });
    expect(onRange).toHaveBeenCalledTimes(2);
    expect(onRange).toHaveBeenNthCalledWith(1, [1, 1]);
    expect(onRange).toHaveBeenNthCalledWith(2, [2, 2]);
  });
  it("a one-frame range keeps its thumbs from crossing", () => {
    const onRange = vi.fn();
    render(<Timeline field={field} frames={frames} index={0} onIndexChange={() => {}} loopRange={[2, 2]} onLoopRangeChange={onRange} />);
    expect(screen.getByRole("group", { name: "Blink frame 3" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("slider", { name: "Blink end frame" }), { key: "ArrowLeft" });
    fireEvent.keyDown(screen.getByRole("slider", { name: "Blink start frame" }), { key: "ArrowRight" });
    expect(onRange).not.toHaveBeenCalled();
  });
  it("dragging a thumb along its lane snaps to clip boundaries", () => {
    const onRange = vi.fn();
    const onIndex = vi.fn();
    render(<Timeline field={field} frames={frames} index={0} onIndexChange={onIndex} loopRange={[1, 2]} onLoopRangeChange={onRange} />);
    const e = screen.getByRole("slider", { name: "Blink end frame" });
    vi.spyOn(lane(e), "getBoundingClientRect").mockReturnValue({ left: 100, top: 0, right: 600, bottom: 28, width: 500, height: 28, x: 100, y: 0, toJSON() {} });
    // clip k centre = 100 + 2 + 120k + 56
    fireEvent.pointerDown(e, { pointerId: 1, clientX: 400 });
    fireEvent.pointerMove(e, { pointerId: 1, clientX: 100 + 2 + 360 + 56 }); // over clip 3
    expect(onRange).toHaveBeenLastCalledWith([1, 3]);
    fireEvent.pointerUp(e, { pointerId: 1 });
    onRange.mockClear();
    fireEvent.pointerMove(e, { pointerId: 1, clientX: 100 }); // released: no move
    expect(onRange).not.toHaveBeenCalled();
    const s = screen.getByRole("slider", { name: "Blink start frame" });
    fireEvent.pointerDown(s, { pointerId: 1, clientX: 300 });
    fireEvent.pointerMove(s, { pointerId: 1, clientX: 100 + 2 + 56 }); // over clip 0
    expect(onRange).toHaveBeenLastCalledWith([0, 2]);
    fireEvent.pointerMove(s, { pointerId: 1, clientX: 100 + 2 + 360 + 56 }); // past the end: stops at it
    expect(onRange).toHaveBeenLastCalledWith([2, 2]);
    expect(onIndex).not.toHaveBeenCalled(); // thumbs do not scrub
  });
  it("puts the end thumb inside its clip, with a 24px-wide thumb", () => {
    render(<Timeline field={field} frames={frames} index={0} onIndexChange={() => {}} loopRange={[0, 3]} onLoopRangeChange={() => {}} />);
    // The 24px width is in the stylesheet (not applied in jsdom); the end thumb is placed so it ends at the clip edge.
    expect(screen.getByRole("slider", { name: "Blink end frame" }).style.left).toBe(`${3 * 120 + 112 - 24}px`);
  });
  it("dims clips outside the Blink range and still selects a frame by pointer", () => {
    const onIndex = vi.fn();
    render(<Timeline field={field} frames={frames} index={0} onIndexChange={onIndex} loopRange={[1, 2]} onLoopRangeChange={() => {}} />);
    const dim = screen.getAllByRole("option").map((o) => o.getAttribute("data-dimmed"));
    expect(dim).toEqual(["true", null, null, "true"]);
    vi.spyOn(screen.getByRole("listbox", { name: "Frames" }), "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, right: 500, bottom: 90, width: 500, height: 90, x: 0, y: 0, toJSON() {} });
    fireEvent.pointerDown(screen.getAllByRole("option")[3], { pointerId: 1, clientX: 2 + 360 + 56 }); // selection is by position on the strip
    expect(onIndex).toHaveBeenCalledWith(3);
  });
  it("speed is a group of labelled buttons, the current one pressed", () => {
    const onFps = vi.fn();
    render(<Timeline field={field} frames={frames} index={0} onIndexChange={() => {}} fps={1} onFpsChange={onFps} />);
    const group = screen.getByRole("group", { name: "Blink speed" });
    const pressed = within(group).getAllByRole("button").filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed.map((b) => b.getAttribute("aria-label"))).toEqual(["1 frame per second"]);
    fireEvent.click(within(group).getByRole("button", { name: "3 frames per second" }));
    expect(onFps).toHaveBeenLastCalledWith(3);
    fireEvent.click(within(group).getByRole("button", { name: "0.5 frames per second" }));
    expect(onFps).toHaveBeenLastCalledWith(0.5);
  });
  it("hides the range, speed and Frames controls without their callbacks", () => {
    render(<Timeline field={field} frames={frames} index={0} onIndexChange={() => {}} />);
    expect(screen.queryByRole("group", { name: "Blink speed" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Frames shown" })).toBeNull();
    expect(screen.queryByRole("slider")).toBeNull();
  });
  it("the Frames stepper goes from 2 up to the number the spot has", () => {
    const onCount = vi.fn();
    render(<Timeline field={field} frames={frames.slice(0, 3)} index={0} onIndexChange={() => {}} frameMax={4} onFrameCountChange={onCount} />);
    fireEvent.click(screen.getByRole("button", { name: "Show more frames" }));
    expect(onCount).toHaveBeenLastCalledWith(4);
    fireEvent.click(screen.getByRole("button", { name: "Show fewer frames" }));
    expect(onCount).toHaveBeenLastCalledWith(2);
  });
  describe("\"+\" at the limit", () => {
    const health = (sia: string) => ({ ok: true, json: async () => ({ services: [{ id: "irsa_sia", status: sia }, { id: "irsa_s3", status: "green" }] }) });
    const setup = () => render(<Timeline field={field} frames={frames} index={0} onIndexChange={() => {}} frameMax={4} onFrameCountChange={() => {}} />);
    afterEach(() => resetArchiveStatus());
    it("says the archive is not responding when IRSA is down", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => health("red")));
      setup();
      fireEvent.click(screen.getByRole("button", { name: "Show more frames" }));
      expect(await screen.findByText(/IRSA archive is not responding.*4 frames loaded/)).toBeTruthy();
      expect(screen.getByRole("dialog", { name: "No more frames" })).toBeTruthy();
      vi.unstubAllGlobals();
    });
    it("says all frames are shown when IRSA is up, and Escape closes it", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => health("green")));
      setup();
      fireEvent.click(screen.getByRole("button", { name: "Show more frames" }));
      const dlg = await screen.findByRole("dialog", { name: "No more frames" });
      expect(await screen.findByText(/all shown/)).toBeTruthy();
      fireEvent.keyDown(dlg, { key: "Escape" });
      expect(screen.queryByRole("dialog")).toBeNull();
      vi.unstubAllGlobals();
    });
    it("says the status is unknown when the health check fails, and an outside click closes it", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
      setup();
      fireEvent.click(screen.getByRole("button", { name: "Show more frames" }));
      expect(await screen.findByText(/couldn't check/)).toBeTruthy();
      fireEvent.pointerDown(document.body);
      expect(screen.queryByRole("dialog")).toBeNull();
      vi.unstubAllGlobals();
    });
    it("below the limit it just adds a frame, no popup", () => {
      const onCount = vi.fn();
      render(<Timeline field={field} frames={frames.slice(0, 3)} index={0} onIndexChange={() => {}} frameMax={4} onFrameCountChange={onCount} />);
      fireEvent.click(screen.getByRole("button", { name: "Show more frames" }));
      expect(onCount).toHaveBeenCalledWith(4);
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
  it("Previous and Next wrap round and are never disabled with several frames", () => {
    const onIndex = vi.fn();
    const { rerender } = render(<Timeline field={field} frames={frames} index={0} onIndexChange={onIndex} />);
    expect((screen.getByRole("button", { name: "Previous frame" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Previous frame" }));
    expect(onIndex).toHaveBeenLastCalledWith(3);
    rerender(<Timeline field={field} frames={frames} index={3} onIndexChange={onIndex} />);
    fireEvent.click(screen.getByRole("button", { name: "Next frame" }));
    expect(onIndex).toHaveBeenLastCalledWith(0);
  });
  it("reduced motion disables Play and says why in its tooltip, without a note", () => {
    render(<Timeline field={field} frames={frames} index={0} onIndexChange={() => {}} onTogglePlay={() => {}} reducedMotion />);
    const play = screen.getByRole("button", { name: "Play blink" }) as HTMLButtonElement;
    expect(play.disabled).toBe(true);
    expect(play.getAttribute("title")).toMatch(/reduced motion/);
    expect(screen.queryByText(/Max 3 frames/)).toBeNull();
  });
});

describe("onion helpers", () => {
  it("expands and clamps ranges", () => {
    expect(onionRangeFrames([1, 3])).toEqual([1, 2, 3]);
    expect(clampOnion([2, 2], 5)).toEqual([2, 3]);
    expect(clampOnion([4, 4], 5)).toEqual([3, 4]);
    expect(clampOnion([0, 20], 12)).toEqual([0, 6]);
    expect(clampOnion([0, 20], 12, 12)).toEqual([0, 11]); // colour-blind-safe setting off: every frame
  });
});

describe("Timeline v1 completion", () => {
  it("has no ping-pong control", () => {
    render(<Timeline field={field} frames={frames} index={0} onIndexChange={() => {}} onLoopRangeChange={() => {}} onFpsChange={() => {}} />);
    expect(screen.queryByRole("button", { name: /ping-pong|Blink order/i })).toBeNull();
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

  it("Color lane thumbs are keyboard operable and keep 2..7 frames", async () => {
    const user = userEvent.setup();
    const onRange = vi.fn();
    render(<Timeline field={field} frames={frames} index={0} onIndexChange={() => {}} onionRange={[0, 2]} onOnionRangeChange={onRange} />);
    const end = screen.getByRole("slider", { name: "Stack end frame" });
    expect(end.getAttribute("aria-valuenow")).toBe("3");
    end.focus();
    await user.keyboard("{ArrowRight}");
    expect(onRange).toHaveBeenLastCalledWith([0, 3]);
    await user.keyboard("{ArrowRight}");
    expect(onRange).toHaveBeenLastCalledWith([0, 3]); // props are fixed, so the same step repeats
    const start = screen.getByRole("slider", { name: "Stack start frame" });
    start.focus();
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
    expect(onRange).toHaveBeenLastCalledWith([1, 2]);
  });

  it("no Color lane without onionRange, and none while onionActive is false", () => {
    const { rerender } = render(<Timeline field={field} frames={frames} index={0} onIndexChange={() => {}} />);
    expect(screen.queryByRole("group", { name: /^Color/ })).toBeNull();
    rerender(<Timeline field={field} frames={frames} index={0} onIndexChange={() => {}} onionRange={[0, 2]} onOnionRangeChange={() => {}} onionActive={false} />);
    expect(screen.queryByRole("group", { name: /^Color/ })).toBeNull();
    rerender(<Timeline field={field} frames={frames} index={0} onIndexChange={() => {}} onionRange={[0, 2]} onOnionRangeChange={() => {}} />);
    expect(screen.getByRole("group", { name: "Color frames 1–3" })).toBeTruthy();
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
