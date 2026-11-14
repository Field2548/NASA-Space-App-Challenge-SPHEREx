// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatDec, formatRA } from "@/lib/coords";
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

describe("PlayScreen round mode", () => {
  it("hides the title and slug until the verdict, then shows the title", async () => {
    const docTitle = document.title;
    const canvas = await loadGame({ fetcher: vi.fn(async () => new Response(JSON.stringify(known), { status: 200 })) as unknown as typeof fetch });
    const h1 = screen.getByRole("heading", { level: 1 });
    const f = makeField();
    expect(h1.textContent).toBe(neutralTitle(f));
    expect(h1.textContent).toContain(formatRA(f.ra));
    expect(h1.textContent).toContain(formatDec(f.dec));
    expect(document.body.textContent).not.toContain("Test spot");
    expect(document.body.textContent).not.toContain("fixture");
    expect(document.title).toBe(docTitle);
    fireEvent.click(canvas, { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Next frame" }));
    fireEvent.click(canvas, { clientX: 15, clientY: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByTestId("verdict");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Test spot");
  });

  it("the tutorial shows the title from the start", async () => {
    await loadGame({ showTitle: true });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Test spot");
  });

  it("does not echo the slug while loading", () => {
    stubFetch(true);
    render(<PlayScreen spot="fixture" />);
    expect(screen.getByRole("status").textContent).not.toContain("fixture");
  });
});
