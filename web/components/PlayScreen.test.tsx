// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PlayScreen, { upsertMark } from "./PlayScreen";
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

function stubFetch(ok: boolean) {
  const field = makeField({ slug: "fixture" }, 3, 4, 2);
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
