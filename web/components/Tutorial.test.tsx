// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REVEAL_INSPECT_ON, TUTORIAL, TUTORIAL_MISS } from "@/lib/copy/tutorial";
import { defaultGuest, GUEST_KEY, loadGuest, resetGuest, TUTORIAL_VERSION } from "@/lib/guest";
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
  const field = makeField({ slug: "eros", has: { exposures: true } }, 5, 6, 4);
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
    expect(defaultGuest().tutorial.level).toBe(0);
    expect(resumePos(defaultGuest().tutorial)).toEqual({ level: 0, step: 0 });
  });

  it("resumes the saved step of the first unfinished level", () => {
    expect(resumePos({ level: 1, step: 2, done: [0] })).toEqual({ level: 1, step: 2 });
    expect(resumePos({ level: 0, step: 1, done: [0] })).toEqual({ level: 1, step: 0 });
    expect(resumePos({ level: 1, step: 0, done: [0, 1] })).toEqual({ level: 2, step: 0 });
    expect(resumePos({ level: 2, step: 0, done: [0, 1, 2] })).toEqual({ level: 2, step: TUTORIAL[2].steps.length });
  });

  it("needs marks in 2 distinct frames for the second mark step", () => {
    const second = { level: 2, step: 1 };
    expect(nextPos(second, "mark-placed", { markedFrames: 1 })).toBeNull();
    expect(nextPos(second, "mark-placed", { markedFrames: 2 })).toEqual({ level: 2, step: 2 });
    expect(nextPos({ level: 2, step: 0 }, "mark-placed", { markedFrames: 1 })).toEqual({ level: 2, step: 1 });
    expect(nextPos({ level: 0, step: 1 }, "mark-placed", { markedFrames: 1 })).toBeNull(); // wrong event
  });

  it("a submit finishes its step only when it found the dot", () => {
    const submit = { level: 2, step: TUTORIAL[2].steps.findIndex((s) => s.doneWhen === "submitted") };
    expect(nextPos(submit, "submitted", { markedFrames: 2, unlocked: false })).toBeNull();
    expect(nextPos(submit, "submitted", { markedFrames: 2, unlocked: true })).toEqual({ level: 2, step: submit.step + 1 });
  });

  it("places the coach card beside a target, or docks it when nothing fits", () => {
    expect(placeCard({ left: 100, top: 100, width: 50, height: 20 }, 1440, 900)).toEqual({ left: 100, top: 132 });
    expect(placeCard({ left: 100, top: 800, width: 50, height: 60 }, 1440, 900)).toEqual({ left: 100, top: 608 });
    expect(placeCard({ left: 0, top: 0, width: 1440, height: 900 }, 1440, 900)).toBeNull();
  });

  it("keeps the card off its target, above a target in the lower half, inside the viewport", () => {
    const vw = 1600;
    const vh = 900;
    const boxes = [
      { left: 8, top: 820, width: 900, height: 60 }, // bottom bar, left edge
      { left: 300, top: 780, width: 40, height: 40 },
      { left: 700, top: 100, width: 120, height: 40 },
      { left: 1500, top: 400, width: 90, height: 200 },
      { left: 0, top: 60, width: 1000, height: 700 },
    ];
    const low = placeCard(boxes[0], vw, vh);
    expect(low).not.toBeNull();
    expect(low!.top + 180).toBeLessThanOrEqual(boxes[0].top); // above the bottom bar
    for (const b of boxes) {
      const p = placeCard(b, vw, vh, 320, 200);
      if (!p) continue;
      const apart = p.left + 320 <= b.left || p.left >= b.left + b.width || p.top + 200 <= b.top || p.top >= b.top + b.height;
      expect(apart, JSON.stringify(b)).toBe(true);
      expect(p.left).toBeGreaterThanOrEqual(0);
      expect(p.top).toBeGreaterThanOrEqual(0);
      expect(p.left + 320).toBeLessThanOrEqual(vw);
      expect(p.top + 200).toBeLessThanOrEqual(vh);
    }
    // A phone-sized viewport: below a target in the upper half, above one in the lower half.
    expect(placeCard({ left: 20, top: 100, width: 350, height: 200 }, 390, 844, 320, 200)!.top).toBeGreaterThanOrEqual(312);
    expect(placeCard({ left: 20, top: 560, width: 350, height: 200 }, 390, 844, 320, 200)!.top + 200).toBeLessThanOrEqual(560);
  });

  it("derives the tool set from the position alone", () => {
    expect([...toolsAt(null)]).toEqual([]);
    expect([...toolsAt({ level: 0, step: 1 })]).toEqual([]);
    expect([...toolsAt({ level: 0, step: 2 })]).toEqual(["frames-spacing"]);
    expect([...toolsAt({ level: 1, step: 0 })].sort()).toEqual(["color-by-time", "frames-spacing"]);
    expect([...toolsAt({ level: 1, step: 3 })].sort()).toEqual(["brightness", "color-by-time", "frames-spacing", "wavelength"]);
    expect([...toolsAt({ level: 2, step: 0 })]).toContain("mark");
    expect([...toolsAt({ level: 2, step: 0 })]).not.toContain("inspect");
    const last = TUTORIAL[2].steps.length - 1;
    expect([...toolsAt({ level: 2, step: last })].sort()).toEqual(
      ["brightness", "color-by-time", "frames-spacing", "inspect", "mark", "overlays", "wavelength"],
    );
  });

  it("the reveal copy promises only what Inspect shows (no distance)", () => {
    const reveal = TUTORIAL[2].steps.find((s) => s.id === "l2-reveal");
    expect(reveal?.text).not.toMatch(/distance|\bAU\b/);
    expect(REVEAL_INSPECT_ON).not.toMatch(/distance|\bAU\b/);
  });

  it("goes back across a level boundary", () => {
    expect(backPos({ level: 1, step: 0 })).toEqual({ level: 0, step: TUTORIAL[0].steps.length - 1 });
    expect(backPos({ level: 2, step: 0 })).toEqual({ level: 1, step: TUTORIAL[1].steps.length - 1 });
    expect(backPos({ level: 0, step: 0 })).toEqual({ level: 0, step: 0 });
  });
});

describe("Tutorial", () => {
  it("ignores progress saved by the old tutorial and starts at level 0, keeping other saved data", async () => {
    stubEros();
    window.localStorage.setItem(
      GUEST_KEY,
      JSON.stringify({ tutorial: { level: 2, step: 0, done: [0, 1] }, finds: [{ spot: "eros", kind: "known", points: 100, at: "t" }], name: "Ada" }),
    );
    render(<Tutorial />);
    await screen.findByTestId("field-canvas");
    expect(coach().textContent).toContain(TUTORIAL[0].steps[0].text);
    expect(resumePos(loadGuest().tutorial)).toEqual({ level: 0, step: 0 });
    expect(loadGuest().finds).toHaveLength(1);
    expect(loadGuest().name).toBe("Ada");
  });

  it("runs the three levels by events from the screen and saves progress", async () => {
    stubEros();
    render(<Tutorial />);
    await screen.findByTestId("field-canvas");
    expect(coach().textContent).toContain(TUTORIAL[0].steps[0].text);
    expect(coach().getAttribute("data-target")).toBe("frame-viewer");

    // Level 0: intro, Blink, Speed (Next), step with the arrow, Frames (Next), Blink bar (Next).
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(coach().textContent).toContain("Press Blink");
    expect(loadGuest().tutorial).toMatchObject({ level: 0, step: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(coach().textContent).toContain(TUTORIAL[0].steps[0].text);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: /Play blink/ }));
    fireEvent.click(screen.getByRole("button", { name: /Pause blink/ })); // stop the blink timer
    expect(coach().textContent).toContain(TUTORIAL[0].steps[2].text);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(coach().textContent).toContain(TUTORIAL[0].steps[3].text);
    fireEvent.click(screen.getByRole("button", { name: "Next frame" }));
    expect(coach().textContent).toContain(TUTORIAL[0].steps[4].text);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(coach().textContent).toContain(TUTORIAL[0].steps[5].text);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(coach().textContent).toContain("Level 0 complete");
    expect(loadGuest().tutorial.done).toEqual([0]);

    // Level 1: Color by time on, then off again; then Brightness, Wavelength, Morphology, zoom.
    fireEvent.click(screen.getByRole("button", { name: "Start level 1" }));
    expect(coach().textContent).toContain(TUTORIAL[1].steps[0].text);
    fireEvent.click(screen.getByRole("button", { name: "Color by time" }));
    expect(coach().textContent).toContain(TUTORIAL[1].steps[1].text);
    expect(document.querySelector('[data-tutorial-target="color-range"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Color by time" }));
    for (const s of TUTORIAL[1].steps.slice(2)) {
      expect(coach().textContent).toContain(s.text);
      fireEvent.click(within(coach()).getByRole("button", { name: "Next" }));
    }
    expect(coach().textContent).toContain("Level 1 complete");
    expect(loadGuest().tutorial.done).toEqual([0, 1]);

    // Level 2: two marks in frames 1-3 by keyboard, the Clear marks note, Submit (skipped: no checker here).
    fireEvent.click(screen.getByRole("button", { name: "Start level 2" }));
    expect(coach().textContent).toContain(EROS_HINT);
    const viewer = screen.getByRole("group", { name: /Field viewer/ });
    act(() => viewer.focus());
    fireEvent.keyDown(viewer, { key: "Enter" });
    expect(coach().textContent).toContain(TUTORIAL[2].steps[1].text);
    fireEvent.keyDown(viewer, { key: "ArrowLeft" });
    fireEvent.keyDown(viewer, { key: "Enter" }); // same frame: replaces, still 1 frame
    expect(coach().textContent).toContain(TUTORIAL[2].steps[1].text);
    fireEvent.click(screen.getByRole("button", { name: "Next frame" }));
    fireEvent.keyDown(viewer, { key: "Enter" });
    expect(coach().textContent).toContain(TUTORIAL[2].steps[2].text);
    expect(loadGuest().tutorial).toMatchObject({ level: 2, step: 2 });
    fireEvent.click(within(coach()).getByRole("button", { name: "Next" }));
    expect(coach().textContent).toContain(TUTORIAL[2].steps[3].text);
    fireEvent.click(screen.getByRole("button", { name: "Skip step" }));
    // Inspect, then the overlay toggle.
    fireEvent.keyDown(window, { key: "i" });
    expect(coach().textContent).toContain("Known asteroids");
    expect(document.querySelector('[data-testid="known-diamond"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Known asteroids" }));
    // Frame 3 is shown (Next frame clicked in levels 0 and 2): Eros at its JPL position, no fetch for it.
    const dia = document.querySelectorAll('[data-testid="known-diamond"]');
    expect(dia.length).toBe(1);
    expect(dia[0].getAttribute("data-x")).toBe("39.53");
    // The last step is the scoreboard / achievements / login note.
    expect(coach().textContent).toContain("Log in");
    fireEvent.click(within(coach()).getByRole("button", { name: "Next" }));
    expect(coach().textContent).toContain("Training done");
    expect(loadGuest().tutorial.done).toEqual([0, 1, 2]);
  });

  it("every step's target exists on the rendered play screen", async () => {
    stubEros();
    const targets: [number, number, string][] = [];
    TUTORIAL.forEach((l, li) => l.steps.forEach((s, si) => s.target && targets.push([li, si, s.target])));
    expect(targets.length).toBeGreaterThan(15);
    for (const [li, si, target] of targets) {
      window.localStorage.setItem(
        GUEST_KEY,
        JSON.stringify({ tutorial: { v: TUTORIAL_VERSION, level: TUTORIAL[li].id, step: si, done: TUTORIAL.slice(0, li).map((l) => l.id) } }),
      );
      const { unmount } = render(<Tutorial />);
      await screen.findByTestId("field-canvas");
      expect(coach().getAttribute("data-target"), `step ${TUTORIAL[li].steps[si].id}`).toBe(target);
      // The Color bar only exists while Color by time is on.
      if (target === "color-range") fireEvent.click(screen.getByRole("button", { name: "Color by time" }));
      expect(document.querySelector(`[data-tutorial-target~="${target}"]`), `target ${target} of ${TUTORIAL[li].steps[si].id}`).not.toBeNull();
      unmount();
      cleanup();
    }
  });

  it("refuses Eros marks after frame 3 with the plain hint", async () => {
    stubEros();
    window.localStorage.setItem(GUEST_KEY, JSON.stringify({ tutorial: { v: TUTORIAL_VERSION, level: 2, step: 0, done: [0, 1] } }));
    render(<Tutorial />);
    await screen.findByTestId("field-canvas");
    expect(coach().textContent).toContain(TUTORIAL[2].steps[0].text);
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: "Next frame" }));
    const viewer = screen.getByRole("group", { name: /Field viewer/ });
    act(() => viewer.focus());
    fireEvent.keyDown(viewer, { key: "Enter" }); // frame 4
    expect(coach().textContent).toContain(TUTORIAL[2].steps[0].text);
    expect(screen.getByText(/0 marks in 5 frames/)).toBeTruthy();
  });

  it("unlocks tools one by one: level 0 starts with only the viewer, Blink and the arrows", async () => {
    stubEros();
    render(<Tutorial />);
    await screen.findByTestId("field-canvas");
    const has = (name: string | RegExp) => screen.queryByRole("button", { name }) !== null;
    expect(has(/Play blink/) && has("Next frame")).toBe(true);
    expect([has(/Inspect/), has("Color by time"), has("Known asteroids"), has("Submit"), has("Show more frames"), has("1 frame per second")]).toEqual([false, false, false, false, false, false]);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: /Play blink/ }));
    fireEvent.click(screen.getByRole("button", { name: /Pause blink/ }));
    // The speed step brings in Speed, the Frames stepper and the Blink bar.
    expect([has("1 frame per second"), has("Show fewer frames"), screen.queryByRole("slider", { name: "Blink start frame" }) !== null]).toEqual([true, true, true]);
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole("button", { name: "Skip step" })); // level 0 complete
    fireEvent.click(screen.getByRole("button", { name: "Start level 1" }));
    expect([has("Color by time"), has("Submit")]).toEqual([true, false]);
    for (let i = 0; i < TUTORIAL[1].steps.length; i++) fireEvent.click(screen.getByRole("button", { name: "Skip step" }));
    fireEvent.click(screen.getByRole("button", { name: "Start level 2" }));
    expect([has("Submit"), has(/Inspect/), has("Known asteroids")]).toEqual([true, false, false]);
    fireEvent.keyDown(window, { key: "i" }); // Inspect is still locked: the key does nothing
    expect(screen.queryByRole("button", { name: /Inspect/ })).toBeNull();
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole("button", { name: "Skip step" }));
    expect([has(/Inspect off/), has("Known asteroids")]).toEqual([true, false]);
    fireEvent.click(screen.getByRole("button", { name: "Skip step" }));
    expect(has("Known asteroids")).toBe(true);
  });

  it("a submit that misses the dot says so and stays on the step; a hit moves on", async () => {
    const field = makeField({ slug: "eros", has: { exposures: true } }, 5, 6, 4);
    const bytes = new Uint16Array(5 * 6 * 4).fill(1000).buffer;
    const miss = { verdict: { kind: "candidate", points: 0, message: "Unconfirmed candidate." }, first_finder: false, already_found: false, persisted: false, unlocked: false, practice: false };
    const hit = { verdict: { kind: "known", points: 100, message: "Found it." }, first_finder: false, already_found: false, persisted: false, unlocked: true, practice: false };
    let answer: object = miss;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.startsWith("/api/check")
          ? new Response(JSON.stringify(answer), { status: 200 })
          : url.endsWith("field.json")
            ? new Response(JSON.stringify(field), { status: 200 })
            : new Response(bytes, { status: 200 }),
      ),
    );
    window.localStorage.setItem(GUEST_KEY, JSON.stringify({ tutorial: { v: TUTORIAL_VERSION, level: 2, step: 0, done: [0, 1] } }));
    render(<Tutorial />);
    const canvas = await screen.findByTestId("field-canvas");
    fireEvent.click(canvas, { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Next frame" }));
    fireEvent.click(canvas, { clientX: 15, clientY: 5 });
    expect(coach().textContent).toContain(TUTORIAL[2].steps[2].text);
    fireEvent.click(within(coach()).getByRole("button", { name: "Next" }));
    const submitText = TUTORIAL[2].steps[3].text;
    expect(coach().textContent).toContain(submitText);
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await vi.waitFor(() => expect(coach().textContent).toContain(TUTORIAL_MISS));
    expect(coach().textContent).toContain(submitText); // still on the submit step
    fireEvent.click(canvas, { clientX: 15, clientY: 15 });
    expect(coach().textContent).not.toContain(TUTORIAL_MISS);
    answer = hit;
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await vi.waitFor(() => expect(coach().textContent).toContain(TUTORIAL[2].steps[4].text));
  });

  it("the reveal step never stalls when Inspect is already on", async () => {
    stubEros();
    window.localStorage.setItem(GUEST_KEY, JSON.stringify({ tutorial: { v: TUTORIAL_VERSION, level: 2, step: 5, done: [0, 1] } }));
    render(<Tutorial />);
    await screen.findByTestId("field-canvas");
    fireEvent.click(screen.getByRole("button", { name: /Inspect off/ })); // on during the overlay step
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(coach().textContent).toContain(REVEAL_INSPECT_ON);
    expect(screen.getByRole("button", { name: /Inspect on/ })).toBeTruthy();
    // Turning it off and on again still finishes the step.
    fireEvent.click(screen.getByRole("button", { name: /Inspect on/ }));
    expect(coach().textContent).toContain(TUTORIAL[2].steps[4].text);
    fireEvent.click(screen.getByRole("button", { name: /Inspect off/ }));
    expect(coach().textContent).toContain(TUTORIAL[2].steps[5].text);
    // Or Next finishes it while Inspect stays on.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(coach().textContent).toContain(REVEAL_INSPECT_ON);
    fireEvent.click(within(coach()).getByRole("button", { name: "Next" }));
    expect(coach().textContent).toContain(TUTORIAL[2].steps[5].text);
    expect(screen.getByRole("button", { name: /Inspect on/ })).toBeTruthy();
  });

  it("Inspect names the object from the level copy, not the public field title", async () => {
    stubEros();
    window.localStorage.setItem(GUEST_KEY, JSON.stringify({ tutorial: { v: TUTORIAL_VERSION, level: 2, step: 4, done: [0, 1] } }));
    render(<Tutorial />);
    const canvas = await screen.findByTestId("field-canvas");
    fireEvent.click(screen.getByRole("button", { name: /Inspect off/ }));
    fireEvent.click(canvas, { clientX: 5, clientY: 5 });
    expect(screen.getByTestId("inspect-object").textContent).toBe(TUTORIAL[2].objectName);
    expect(TUTORIAL[2].objectName).toBe("(433) Eros");
  });

  it("resumes saved progress and lets a step be skipped", async () => {
    stubEros();
    window.localStorage.setItem(GUEST_KEY, JSON.stringify({ tutorial: { v: TUTORIAL_VERSION, level: 2, step: 4, done: [0, 1] } }));
    render(<Tutorial />);
    await screen.findByTestId("field-canvas");
    expect(coach().textContent).toContain(TUTORIAL[2].steps[4].text);
    fireEvent.click(screen.getByRole("button", { name: "Skip step" }));
    expect(coach().textContent).toContain(TUTORIAL[2].steps[5].text);
    expect(coach().textContent).not.toContain("Preview");
    expect(loadGuest().tutorial).toMatchObject({ level: 2, step: 5, done: [0, 1] });
  });

  it("no step mentions things the game no longer has", () => {
    const all = TUTORIAL.flatMap((l) => l.steps.map((s) => s.text)).join(" ");
    expect(all).not.toMatch(/ping-pong|Max 3|My marks|loop handle|Press Play/i);
  });
});
