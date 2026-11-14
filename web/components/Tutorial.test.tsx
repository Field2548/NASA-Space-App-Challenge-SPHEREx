// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TUTORIAL } from "@/lib/copy/tutorial";
import { defaultGuest, GUEST_KEY, loadGuest, resetGuest } from "@/lib/guest";
import { placeCard } from "./CoachMark";
import { makeField, mockCanvas } from "./testFixtures";
import Tutorial, { backPos, EROS_HINT, nextPos, resumePos } from "./Tutorial";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// Five frames like the real Eros spot, so frames 4 and 5 exist and must refuse marks.
function stubEros() {
  const field = makeField({ slug: "eros" }, 5, 6, 4);
  const bytes = new Uint16Array(5 * 6 * 4).fill(1000).buffer;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("field.json") ? new Response(JSON.stringify(field), { status: 200 }) : new Response(bytes, { status: 200 }),
    ),
  );
}

beforeEach(() => {
  mockCanvas();
  resetGuest();
  window.localStorage.clear();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const coach = () => screen.getByTestId("coach-mark");

describe("tutorial position helpers", () => {
  it("starts a fresh guest at level 0 even though the default stores level 1", () => {
    expect(defaultGuest().tutorial.level).toBe(1);
    expect(resumePos(defaultGuest().tutorial)).toEqual({ level: 0, step: 0 });
  });

  it("resumes the saved step of the first unfinished level", () => {
    expect(resumePos({ level: 1, step: 2, done: [0] })).toEqual({ level: 1, step: 2 });
    expect(resumePos({ level: 0, step: 1, done: [0] })).toEqual({ level: 1, step: 0 });
    expect(resumePos({ level: 1, step: 0, done: [0, 1] })).toEqual({ level: 1, step: TUTORIAL[1].steps.length });
  });

  it("needs marks in 2 distinct frames for the second mark step", () => {
    const second = { level: 1, step: 1 };
    expect(nextPos(second, "mark-placed", { markedFrames: 1 })).toBeNull();
    expect(nextPos(second, "mark-placed", { markedFrames: 2 })).toEqual({ level: 1, step: 2 });
    expect(nextPos({ level: 1, step: 0 }, "mark-placed", { markedFrames: 1 })).toEqual({ level: 1, step: 1 });
    expect(nextPos({ level: 0, step: 1 }, "mark-placed", { markedFrames: 1 })).toBeNull(); // wrong event
  });

  it("places the coach card beside a target, or docks it when nothing fits", () => {
    expect(placeCard({ left: 100, top: 100, width: 50, height: 20 }, 1440, 900)).toEqual({ left: 100, top: 132 });
    expect(placeCard({ left: 100, top: 800, width: 50, height: 60 }, 1440, 900)).toEqual({ left: 100, top: 608 });
    expect(placeCard({ left: 0, top: 0, width: 1440, height: 900 }, 1440, 900)).toBeNull();
  });

  it("goes back across a level boundary", () => {
    expect(backPos({ level: 1, step: 0 })).toEqual({ level: 0, step: TUTORIAL[0].steps.length - 1 });
    expect(backPos({ level: 0, step: 0 })).toEqual({ level: 0, step: 0 });
  });
});

describe("Tutorial", () => {
  it("runs levels 0 and 1 by events from the screen and saves progress", async () => {
    stubEros();
    render(<Tutorial />);
    await screen.findByTestId("field-canvas");
    expect(coach().textContent).toContain(TUTORIAL[0].steps[0].text);
    expect(coach().getAttribute("data-target")).toBe("frame-viewer");

    // Level 0: intro, then Play.
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(coach().textContent).toContain("Press Play");
    expect(loadGuest().tutorial).toMatchObject({ level: 0, step: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(coach().textContent).toContain(TUTORIAL[0].steps[0].text);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: /Play blink/ }));
    expect(coach().textContent).toContain("Level 0 complete");
    expect(loadGuest().tutorial.done).toEqual([0]);
    fireEvent.click(screen.getByRole("button", { name: /Pause blink/ })); // stop the blink timer

    // Level 1: two marks in frames 1-3 by keyboard, then Inspect, then the overlay toggle.
    fireEvent.click(screen.getByRole("button", { name: "Start level 1" }));
    expect(coach().textContent).toContain(EROS_HINT);
    const viewer = screen.getByRole("group", { name: /Field viewer/ });
    act(() => viewer.focus());
    fireEvent.keyDown(viewer, { key: "Enter" });
    expect(coach().textContent).toContain(TUTORIAL[1].steps[1].text);
    fireEvent.keyDown(viewer, { key: "ArrowLeft" });
    fireEvent.keyDown(viewer, { key: "Enter" }); // same frame: replaces, still 1 frame
    expect(coach().textContent).toContain(TUTORIAL[1].steps[1].text);
    fireEvent.click(screen.getByRole("button", { name: "Next frame" }));
    fireEvent.keyDown(viewer, { key: "Enter" });
    expect(coach().textContent).toContain(TUTORIAL[1].steps[2].text);
    expect(loadGuest().tutorial).toMatchObject({ level: 1, step: 2 });
    fireEvent.keyDown(window, { key: "i" });
    expect(coach().textContent).toContain("Known asteroids");
    fireEvent.click(screen.getByRole("button", { name: "Known asteroids" }));
    expect(coach().textContent).toContain("Training done");
    expect(loadGuest().tutorial.done).toEqual([0, 1]);
  });

  it("refuses Eros marks after frame 3 with the plain hint", async () => {
    stubEros();
    window.localStorage.setItem(GUEST_KEY, JSON.stringify({ tutorial: { level: 1, step: 0, done: [0] } }));
    render(<Tutorial />);
    await screen.findByTestId("field-canvas");
    expect(coach().textContent).toContain(TUTORIAL[1].steps[0].text);
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: "Next frame" }));
    const viewer = screen.getByRole("group", { name: /Field viewer/ });
    act(() => viewer.focus());
    fireEvent.keyDown(viewer, { key: "Enter" }); // frame 4
    expect(coach().textContent).toContain(TUTORIAL[1].steps[0].text);
    expect(screen.getByText(/0 marks in 5 frames/)).toBeTruthy();
  });

  it("resumes saved progress and lets a step be skipped", async () => {
    stubEros();
    window.localStorage.setItem(GUEST_KEY, JSON.stringify({ tutorial: { level: 1, step: 2, done: [0] } }));
    render(<Tutorial />);
    await screen.findByTestId("field-canvas");
    expect(coach().textContent).toContain(TUTORIAL[1].steps[2].text);
    fireEvent.click(screen.getByRole("button", { name: "Skip step" }));
    expect(coach().textContent).toContain(TUTORIAL[1].steps[3].text);
    expect(coach().textContent).toContain("Preview");
    expect(loadGuest().tutorial).toMatchObject({ level: 1, step: 3, done: [0] });
  });
});
