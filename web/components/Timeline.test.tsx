// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeField, makeFrames, mockCanvas } from "./testFixtures";
import Timeline, { keyToIndex } from "./Timeline";

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
