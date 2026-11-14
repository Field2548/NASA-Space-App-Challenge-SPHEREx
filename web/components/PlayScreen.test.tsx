// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckResponse, Field } from "@/lib/types";
import { blackToSlider } from "./BrightnessSlider";
import { findTarget } from "./CoachMark";
import PlayScreen, { neutralTitle, upsertMark } from "./PlayScreen";
import { makeField, mockCanvas } from "./testFixtures";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  mockCanvas();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubFetch(ok: boolean, over: Partial<Field> = {}) {
  const field = makeField({ slug: "fixture", ...over }, 3, 4, 2);
  const bytes = new Uint16Array(3 * 4 * 2).fill(1000).buffer;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (!ok) return new Response("nope", { status: 404 });
      if (url.endsWith("field.json")) return new Response(JSON.stringify(field), { status: 200 });
      return new Response(bytes, { status: 200 });
    }),
  );
}

describe("upsertMark", () => {
  it("keeps one mark per frame, sorted", () => {
    const a = { frame: 2, x: 1, y: 1, tDays: 1 };
    const b = { frame: 1, x: 0, y: 0, tDays: 0 };
    const c = { frame: 2, x: 3, y: 1, tDays: 1 };
    expect(upsertMark(upsertMark(upsertMark([], a), b), c)).toEqual([b, c]);
  });
});

describe("PlayScreen", () => {
  it("shows an empty state without a spot", () => {
    render(<PlayScreen />);
    expect(screen.getByRole("status").textContent).toContain("NO SPOT SELECTED");
  });

  it("renders a loading fallback for the Suspense boundary", () => {
    render(<PlayScreen loading />);
    expect(screen.getByRole("status").textContent).toContain("LOADING");
  });

  it("shows an error state, not a crash, when the spot is missing", async () => {
    stubFetch(false);
    render(<PlayScreen spot="fixture" />);
    expect(await screen.findByText(/Could not load spot/)).toBeTruthy();
    expect(screen.getByRole("status").textContent).not.toContain("fixture");
  });

  it("loads a spot, marks on click and lays out the slots", async () => {
    stubFetch(true);
    render(<PlayScreen spot="fixture" />);
    const canvas = (await screen.findByTestId("field-canvas")) as HTMLCanvasElement;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 40, height: 20 } as DOMRect);
    fireEvent.click(canvas, { clientX: 35, clientY: 15 });
    expect(screen.getByText("1 mark in 3 frames. Mark the mover in at least 2 frames.")).toBeTruthy();
    for (const s of ["submit", "nothing-moved", "scoreboard", "auth", "coordinate-box"]) {
      expect(document.querySelector(`[data-slot="${s}"]`)).not.toBeNull();
    }
    fireEvent.keyDown(window, { key: "i" });
    expect(screen.getByTestId("mode-status").textContent).toMatch(/INSPECT/);
  });

  it("has exactly one h1 in every state", async () => {
    const { unmount } = render(<PlayScreen />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    unmount();
    stubFetch(true);
    render(<PlayScreen spot="fixture" />);
    await screen.findByTestId("field-canvas");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("marks by keyboard: focus the viewer, arrows move the crosshair, Enter marks", async () => {
    stubFetch(true);
    const onEvent = vi.fn();
    render(<PlayScreen spot="fixture" onEvent={onEvent} />);
    await screen.findByTestId("field-canvas");
    const viewer = screen.getByRole("group", { name: /Field viewer/ });
    act(() => viewer.focus());
    expect(screen.getByText(/Crosshair x 2 y 1\./)).toBeTruthy(); // centre of a 4 x 2 grid
    fireEvent.keyDown(viewer, { key: "ArrowRight" });
    fireEvent.keyDown(viewer, { key: "ArrowRight", shiftKey: true }); // clamps at x 3
    fireEvent.keyDown(viewer, { key: "ArrowUp" });
    expect(screen.getByText(/Crosshair x 3 y 0\./)).toBeTruthy();
    fireEvent.keyDown(viewer, { key: "Enter" });
    expect(screen.getByText("1 mark in 3 frames. Mark the mover in at least 2 frames.")).toBeTruthy();
    expect(document.querySelector('svg [data-frame="1"]')).not.toBeNull();
    expect(onEvent).toHaveBeenCalledWith("mark-placed", { markedFrames: 1 });
  });

  it("refuses marks outside markFrames with the hint", async () => {
    stubFetch(true);
    render(<PlayScreen spot="fixture" markFrames={[2, 3]} markHint="Mark frames 2 or 3 only." />);
    await screen.findByTestId("field-canvas");
    const viewer = screen.getByRole("group", { name: /Field viewer/ });
    act(() => viewer.focus());
    fireEvent.keyDown(viewer, { key: "Enter" });
    expect(screen.getByText("0 marks in 3 frames. Mark the mover in at least 2 frames.")).toBeTruthy();
    expect(screen.getAllByText("Mark frames 2 or 3 only.").length).toBeGreaterThan(1); // panel hint + notice
  });
});

const known: CheckResponse = {
  verdict: { kind: "known", object_name: "433 Eros", points: 150, message: "Confirmed: 433 Eros, asteroid." },
  first_finder: false,
  already_found: false,
  persisted: false,
  unlocked: true,
  reveal: { frame: 1, x: 1, y: 1 },
  track: { x0: 1, y0: 1, vx: 0, vy: 0, rms: 0.1, rate_arcsec_per_hour: 1 },
  noise_bar_sigma: null,
};

async function loadGame(props: Partial<Parameters<typeof PlayScreen>[0]> = {}, over: Partial<Field> = {}) {
  stubFetch(true, over);
  render(<PlayScreen spot="fixture" {...props} />);
  const canvas = (await screen.findByTestId("field-canvas")) as HTMLCanvasElement;
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 40, height: 20 } as DOMRect);
  return canvas;
}

describe("PlayScreen wiring", () => {
  it("wires loop mode, the onion range and real spacing into the Timeline", async () => {
    await loadGame();
    fireEvent.click(screen.getByRole("button", { name: /Blink order: loop/ }));
    expect(screen.getByRole("button", { name: /Blink order: ping-pong/ })).toBeTruthy();
    const end = screen.getByRole("slider", { name: "Onion range end" });
    expect(end.getAttribute("aria-valuenow")).toBe("3"); // all 3 frames
    fireEvent.click(screen.getByRole("button", { name: "Color by time" }));
    expect(screen.getByText("Color by time: 3 frames")).toBeTruthy();
    fireEvent.keyDown(end, { key: "ArrowLeft" });
    expect(screen.getByText("Color by time: 2 frames")).toBeTruthy();
    const box = screen.getByRole("checkbox", { name: /Real time spacing/ }) as HTMLInputElement;
    fireEvent.click(box);
    expect(box.checked).toBe(true);
    expect(screen.getByRole("button", { name: "Play blink" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next frame" })).toBeTruthy();
  });

  it("coach-mark targets resolve to the play button and the frames track, not the footer", async () => {
    await loadGame();
    expect(findTarget("play-button")).toBe(screen.getByRole("button", { name: "Play blink" }));
    expect(findTarget("frame-picker")).toBe(screen.getByRole("listbox", { name: "Frames" }));
    expect(findTarget("timeline")?.tagName).toBe("FOOTER");
  });

  it("draws the keyboard crosshair in the FieldViewer marks SVG", async () => {
    await loadGame();
    act(() => screen.getByRole("group", { name: /Field viewer/ }).focus());
    const g = screen.getByTestId("kb-cursor");
    expect(g.closest("svg")).not.toBeNull();
    expect(screen.queryByTestId("kbd-crosshair")).toBeNull();
  });

  it("keeps the png8 brightness slider at the 8-bit floor", async () => {
    await loadGame({}, { data: { ...makeField().data, precision: "png8" }, stretch: { black_sigma: 0.5, soft_sigma: 2, white: 9 } });
    const input = screen.getByRole("slider", { name: /Brightness/ }) as HTMLInputElement;
    expect(Number(input.min)).toBeCloseTo(blackToSlider(0.5), 9);
  });
});

// Level 0 keeps the disabled login stub, zoom (part of the viewer) and the frame stepper.
const ALLOWED_AT_LEVEL_0 = ["Log in / Sign up", "Zoom in", "Zoom out", "Previous frame", "Play blink", "Next frame"];

describe("PlayScreen tools", () => {
  it("shows every tool by default", async () => {
    await loadGame();
    for (const name of [/Inspect off/, "Color by time", "Known asteroids", "Submit", /Blink order/]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(screen.getByRole("slider", { name: "Onion range end" })).toBeTruthy();
  });

  it("with no tools shows only the viewer, Play and Next frame; clicks and I do nothing", async () => {
    const onEvent = vi.fn();
    const canvas = await loadGame({ tools: new Set(), onEvent });
    expect(screen.getByRole("button", { name: /Play blink/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next frame" })).toBeTruthy();
    for (const name of [/Inspect/, "Color by time", "Known asteroids", "Submit", "Clear marks", /Blink order/]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.queryByRole("slider", { name: "Onion range end" })).toBeNull();
    expect(screen.queryByRole("complementary", { name: "Scoreboard panel" })).toBeNull();
    expect(document.querySelector('[data-slot="coordinate-box"], [data-slot="show-work"]')).toBeNull();
    const names = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim());
    expect(names).toEqual(ALLOWED_AT_LEVEL_0);
    fireEvent.click(canvas, { clientX: 5, clientY: 5 });
    fireEvent.keyDown(window, { key: "i" });
    expect(document.querySelector("svg [data-frame]")).toBeNull();
    expect(screen.queryByRole("region", { name: /Inspect pixel/ })).toBeNull();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("reports the Inspect state on open and close", async () => {
    const onEvent = vi.fn();
    await loadGame({ onEvent });
    fireEvent.keyDown(window, { key: "i" });
    fireEvent.keyDown(window, { key: "i" });
    expect(onEvent.mock.calls.map((c) => [c[0], c[1].inspectOn])).toEqual([
      ["inspect-opened", true],
      ["inspect-closed", false],
    ]);
  });
});

describe("PlayScreen round mode", () => {
  it("hides the title and slug until the verdict, then shows the title", async () => {
    const docTitle = document.title;
    const canvas = await loadGame({ fetcher: vi.fn(async () => new Response(JSON.stringify(known), { status: 200 })) as unknown as typeof fetch });
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("Field in Test");
    expect(document.body.textContent).not.toContain("433 Eros");
    expect(document.body.textContent).not.toContain("fixture");
    expect(document.title).toBe(docTitle);
    fireEvent.click(canvas, { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Next frame" }));
    fireEvent.click(canvas, { clientX: 15, clientY: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByTestId("verdict");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("433 Eros");
  });

  it("shows spot_reveal.title after an unlocked verdict", async () => {
    const withReveal: CheckResponse = { ...known, spot_reveal: { title: "(1) Revealed Rock", kind: "asteroid", difficulty: "medium" } };
    const canvas = await loadGame({ fetcher: vi.fn(async () => new Response(JSON.stringify(withReveal), { status: 200 })) as unknown as typeof fetch });
    fireEvent.click(canvas, { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Next frame" }));
    fireEvent.click(canvas, { clientX: 15, clientY: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByTestId("verdict");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("(1) Revealed Rock");
    expect(screen.getByTestId("inspect-object").textContent).toBe("(1) Revealed Rock");
  });

  it("keeps the title hidden after a wrong verdict that leaves the spot locked", async () => {
    const wrong: CheckResponse = {
      ...known,
      verdict: { kind: "candidate", points: 0, message: "Not a known object." },
      unlocked: false,
      reveal: undefined,
    };
    const canvas = await loadGame({ fetcher: vi.fn(async () => new Response(JSON.stringify(wrong), { status: 200 })) as unknown as typeof fetch });
    fireEvent.click(canvas, { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Next frame" }));
    fireEvent.click(canvas, { clientX: 15, clientY: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByTestId("verdict");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Field in Test");
    expect(document.body.textContent).not.toContain("433 Eros");
  });

  it("falls back to the sky position when the public title is empty", async () => {
    await loadGame({}, { title: "" });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(neutralTitle(makeField()));
  });

  it("the tutorial shows the object name from the start", async () => {
    await loadGame({ showTitle: true, objectName: "433 Eros" });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("433 Eros");
  });

  it("Inspect shows the pixel but no object name before an unlocked verdict", async () => {
    // A locked reply that still carries a name and a reveal must not leak the name.
    const locked: CheckResponse = { ...known, verdict: { ...known.verdict, kind: "candidate", message: "Not yet." }, unlocked: false };
    const canvas = await loadGame({ fetcher: vi.fn(async () => new Response(JSON.stringify(locked), { status: 200 })) as unknown as typeof fetch });
    fireEvent.click(canvas, { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Next frame" }));
    fireEvent.click(canvas, { clientX: 15, clientY: 5 });
    fireEvent.click(screen.getByRole("button", { name: /Inspect off/ }));
    fireEvent.click(canvas, { clientX: 25, clientY: 15 });
    const region = screen.getByRole("region", { name: "Inspect pixel 2, 1" });
    expect(region.textContent).toContain("RA");
    expect(screen.queryByTestId("inspect-object")).toBeNull();
    expect(document.body.textContent).not.toContain("433 Eros");
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByTestId("verdict");
    expect(screen.getByRole("region", { name: /Inspect pixel/ })).toBeTruthy();
    expect(screen.queryByTestId("inspect-object")).toBeNull();
    expect(document.body.textContent).not.toContain("433 Eros");
  });

  it("an unlocked verdict with reveal opens Inspect on the object with its name", async () => {
    const canvas = await loadGame({ fetcher: vi.fn(async () => new Response(JSON.stringify(known), { status: 200 })) as unknown as typeof fetch });
    fireEvent.click(canvas, { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Next frame" }));
    fireEvent.click(canvas, { clientX: 15, clientY: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByTestId("verdict");
    expect(screen.getByRole("region", { name: "Inspect pixel 1, 1" })).toBeTruthy();
    expect(screen.getByTestId("inspect-object").textContent).toBe("433 Eros");
  });

  it("the tutorial's Inspect names the object from the start", async () => {
    const canvas = await loadGame({ showTitle: true, objectName: "433 Eros" });
    fireEvent.keyDown(window, { key: "i" });
    fireEvent.click(canvas, { clientX: 5, clientY: 5 });
    expect(screen.getByTestId("inspect-object").textContent).toBe("433 Eros");
  });

  it("does not echo the slug while loading", () => {
    stubFetch(true);
    render(<PlayScreen spot="fixture" />);
    expect(screen.getByRole("status").textContent).not.toContain("fixture");
  });
});
