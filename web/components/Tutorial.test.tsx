// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REVEAL_INSPECT_ON, TUTORIAL, TUTORIAL_MISS } from "@/lib/copy/tutorial";
import { defaultGuest, GUEST_KEY, loadGuest, resetGuest } from "@/lib/guest";
import { placeCard } from "./CoachMark";
import { makeField, mockCanvas } from "./testFixtures";
import Tutorial, { backPos, EROS_HINT, nextPos, resumePos, toolsAt } from "./Tutorial";

vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));
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

  it("derives the tool set from the position alone", () => {
    expect([...toolsAt(null)]).toEqual([]);
    expect([...toolsAt({ level: 0, step: 1 })]).toEqual([]);
    expect([...toolsAt({ level: 1, step: 0 })].sort()).toEqual(["color-by-time", "mark"]);
    expect([...toolsAt({ level: 1, step: 2 })].sort()).toEqual(["color-by-time", "inspect", "mark"]);
    expect([...toolsAt({ level: 1, step: 4 })].sort()).toEqual(["color-by-time", "inspect", "mark", "overlays"]);
  });

  it("the reveal copy promises only what Inspect shows (no distance)", () => {
    const reveal = TUTORIAL[1].steps.find((s) => s.id === "l1-reveal");
    expect(reveal?.text).not.toMatch(/distance|\bAU\b/);
    expect(REVEAL_INSPECT_ON).not.toMatch(/distance|\bAU\b/);
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
    expect(document.querySelector('[data-testid="known-diamond"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Known asteroids" }));
    // Frame 2 is shown (Next frame clicked above): Eros at its JPL position, no fetch for it.
    const dia = document.querySelectorAll('[data-testid="known-diamond"]');
    expect(dia.length).toBe(1);
    expect(dia[0].getAttribute("data-x")).toBe("54.03");
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

  it("unlocks tools one by one: level 0 has only the viewer, Play and Next frame", async () => {
    stubEros();
    render(<Tutorial />);
    await screen.findByTestId("field-canvas");
    const has = (name: string | RegExp) => screen.queryByRole("button", { name }) !== null;
    expect(has(/Play blink/) && has("Next frame")).toBe(true);
    expect([has(/Inspect/), has("Color by time"), has("Known asteroids"), has("Submit")]).toEqual([false, false, false, false]);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: /Play blink/ }));
    fireEvent.click(screen.getByRole("button", { name: /Pause blink/ }));
    fireEvent.click(screen.getByRole("button", { name: "Start level 1" }));
    expect([has("Submit"), has("Color by time"), has(/Inspect/), has("Known asteroids")]).toEqual([true, true, false, false]);
    fireEvent.keyDown(window, { key: "i" }); // Inspect is still locked: the key does nothing
    expect(screen.queryByRole("button", { name: /Inspect/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Skip step" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip step" }));
    expect([has(/Inspect off/), has("Known asteroids")]).toEqual([true, false]);
    fireEvent.click(screen.getByRole("button", { name: "Skip step" }));
    expect(has("Known asteroids")).toBe(true);
  });

  it("a submit that misses the dot says so in the coach and how to retry; marking again clears it", async () => {
    const field = makeField({ slug: "eros" }, 5, 6, 4);
    const bytes = new Uint16Array(5 * 6 * 4).fill(1000).buffer;
    const miss = { verdict: { kind: "candidate", points: 0, message: "Unconfirmed candidate." }, first_finder: false, already_found: false, persisted: false, unlocked: false, practice: false };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.startsWith("/api/check")
          ? new Response(JSON.stringify(miss), { status: 200 })
          : url.endsWith("field.json")
            ? new Response(JSON.stringify(field), { status: 200 })
            : new Response(bytes, { status: 200 }),
      ),
    );
    window.localStorage.setItem(GUEST_KEY, JSON.stringify({ tutorial: { level: 1, step: 0, done: [0] } }));
    render(<Tutorial />);
    const canvas = await screen.findByTestId("field-canvas");
    fireEvent.click(canvas, { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Next frame" }));
    fireEvent.click(canvas, { clientX: 15, clientY: 5 });
    expect(coach().textContent).toContain(TUTORIAL[1].steps[2].text);
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await vi.waitFor(() => expect(coach().textContent).toContain(TUTORIAL_MISS));
    fireEvent.click(canvas, { clientX: 15, clientY: 15 });
    expect(coach().textContent).not.toContain(TUTORIAL_MISS);
  });

  it("the reveal step never stalls when Inspect is already on", async () => {
    stubEros();
    window.localStorage.setItem(GUEST_KEY, JSON.stringify({ tutorial: { level: 1, step: 3, done: [0] } }));
    render(<Tutorial />);
    await screen.findByTestId("field-canvas");
    fireEvent.click(screen.getByRole("button", { name: /Inspect off/ })); // on during the overlay step
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(coach().textContent).toContain(REVEAL_INSPECT_ON);
    expect(screen.getByRole("button", { name: /Inspect on/ })).toBeTruthy();
    // Turning it off and on again still finishes the step.
    fireEvent.click(screen.getByRole("button", { name: /Inspect on/ }));
    expect(coach().textContent).toContain(TUTORIAL[1].steps[2].text);
    fireEvent.click(screen.getByRole("button", { name: /Inspect off/ }));
    expect(coach().textContent).toContain(TUTORIAL[1].steps[3].text);
    // Or Next finishes it while Inspect stays on.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(coach().textContent).toContain(REVEAL_INSPECT_ON);
    fireEvent.click(within(coach()).getByRole("button", { name: "Next" }));
    expect(coach().textContent).toContain(TUTORIAL[1].steps[3].text);
    expect(screen.getByRole("button", { name: /Inspect on/ })).toBeTruthy();
  });

  it("Inspect names the object from the level copy, not the public field title", async () => {
    stubEros();
    window.localStorage.setItem(GUEST_KEY, JSON.stringify({ tutorial: { level: 1, step: 2, done: [0] } }));
    render(<Tutorial />);
    const canvas = await screen.findByTestId("field-canvas");
    fireEvent.click(screen.getByRole("button", { name: /Inspect off/ }));
    fireEvent.click(canvas, { clientX: 5, clientY: 5 });
    expect(screen.getByTestId("inspect-object").textContent).toBe(TUTORIAL[1].objectName);
    expect(TUTORIAL[1].objectName).toBe("(433) Eros");
  });

  it("resumes saved progress and lets a step be skipped", async () => {
    stubEros();
    window.localStorage.setItem(GUEST_KEY, JSON.stringify({ tutorial: { level: 1, step: 2, done: [0] } }));
    render(<Tutorial />);
    await screen.findByTestId("field-canvas");
    expect(coach().textContent).toContain(TUTORIAL[1].steps[2].text);
    fireEvent.click(screen.getByRole("button", { name: "Skip step" }));
    expect(coach().textContent).toContain(TUTORIAL[1].steps[3].text);
    expect(coach().textContent).not.toContain("Preview");
    expect(loadGuest().tutorial).toMatchObject({ level: 1, step: 3, done: [0] });
  });
});
