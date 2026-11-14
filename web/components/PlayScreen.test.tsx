// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InfoExplore } from "@/lib/inspectPopup";
import type { CheckResponse, Field } from "@/lib/types";
import { timeColors } from "@/lib/palettes";
import { blackToSlider } from "./BrightnessSlider";
import { rgbCss } from "./FieldViewer";
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

// Band rebuild stand-in: plane 0 reads 7.5 everywhere, frame 1 has no exposure on the band.
const wlMock = vi.hoisted(() => ({ fail: false }));
vi.mock("./WavelengthSwitch", async (importActual) => {
  const actual = await importActual<typeof import("./WavelengthSwitch")>();
  return {
    ...actual,
    useWavelengthFrames: (field: Field) => {
      const available = field.has?.exposures === true;
      const ok = available && !wlMock.fail;
      const plane = new Float32Array(field.size[0] * field.size[1]).fill(7.5);
      return {
        frames: ok ? field.frames.map((_, i) => (i === 1 ? null : plane)) : null,
        planesPerFrame: [],
        fewerThanThree: false,
        loading: false,
        error: available && wlMock.fail ? "GET exposures.json failed: 404" : null,
        available,
      };
    },
  };
});

beforeEach(() => {
  mockCanvas();
  wlMock.fail = false;
  info.reply = { mode: "round", locked: true };
  // jsdom has no ResizeObserver; InspectPopup measures itself with one.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// What the stubbed GET /api/info answers (the server, not the client, decides the lock).
const info = vi.hoisted(() => ({ reply: {} as InfoExplore }));
const board = { scope: "spot", slug: null, source: "db", updated_at: "2026-01-01T00:00:00Z", rows: [], me: null };
const infoCalls = () =>
  (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith("/api/info"));
const boardCalls = () =>
  (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith("/api/leaderboard"));

function stubFetch(ok: boolean, over: Partial<Field> = {}) {
  const field = makeField({ slug: "fixture", ...over }, 3, 4, 2);
  const bytes = new Uint16Array(3 * 4 * 2).fill(1000).buffer;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (!ok) return new Response("nope", { status: 404 });
      if (url.startsWith("/api/info")) return new Response(JSON.stringify(info.reply), { status: 200 });
      if (url.startsWith("/api/leaderboard")) return new Response(JSON.stringify(board), { status: 200 });
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
    for (const s of ["submit", "nothing-moved", "auth"]) {
      expect(document.querySelector(`[data-slot="${s}"]`)).not.toBeNull();
    }
    fireEvent.keyDown(window, { key: "i" });
    expect(screen.getByTestId("mode-status").textContent).toMatch(/INSPECT/);
  });

  it("starts from initialView and reports view changes", async () => {
    stubFetch(true);
    const seen: unknown[] = [];
    render(
      <PlayScreen
        spot="fixture"
        initialView={{ frames: [0, 1], realSpacing: true, vision: "mono" }}
        onViewChange={(v) => seen.push(v)}
      />,
    );
    await screen.findByTestId("field-canvas");
    expect(seen.at(-1)).toEqual({ frames: [0, 1], realSpacing: true, vision: "mono" });
    const pick = screen.getByLabelText("Colour vision") as HTMLSelectElement;
    expect(pick.value).toBe("mono");
    fireEvent.change(pick, { target: { value: "deutan" } });
    expect(seen.at(-1)).toEqual({ frames: [0, 1], realSpacing: true, vision: "deutan" });
  });

  it("reports the default onion range as null", async () => {
    stubFetch(true);
    const seen: unknown[] = [];
    render(<PlayScreen spot="fixture" onViewChange={(v) => seen.push(v)} />);
    await screen.findByTestId("field-canvas");
    expect(seen.at(-1)).toEqual({ frames: null, realSpacing: false, vision: "normal" });
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
  it("shows every built tool by default, but not the undrawn Known asteroids toggle", async () => {
    await loadGame();
    for (const name of [/Inspect off/, "Color by time", "Submit", /Blink order/]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(screen.getByRole("slider", { name: "Onion range end" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Colour vision" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Known asteroids" })).toBeNull();
  });

  it("shows Known asteroids only when tools explicitly include overlays", async () => {
    await loadGame({ tools: new Set(["overlays"]) });
    expect(screen.getByRole("button", { name: "Known asteroids" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Colour vision" })).toBeNull();
  });

  it("shows no placeholder and names no object in round mode", async () => {
    await loadGame();
    const html = document.body.innerHTML;
    expect(html).not.toMatch(/\b(Eros|Hektor|Makemake|Eris)\b/i);
    const text = document.body.textContent ?? "";
    for (const p of ["more tools", "wavelength switch", "vision picker", "coordinate box", "others' work", "not drawn yet"]) {
      expect(text.toLowerCase()).not.toContain(p);
    }
    for (const s of ["image-tools", "wavelength", "color-vision", "coordinate-box", "show-work", "scoreboard", "overlays"]) {
      expect(document.querySelector(`[data-slot="${s}"]`)).toBeNull();
    }
    expect(document.querySelectorAll("h1")).toHaveLength(1);
  });

  it("passes the chosen colour vision to the FieldViewer mark colours", async () => {
    const canvas = await loadGame();
    fireEvent.click(canvas, { clientX: 5, clientY: 5 });
    const stroke = () => document.querySelector("svg [data-frame] circle")?.getAttribute("stroke");
    expect(stroke()).toBe(rgbCss(timeColors(3, "normal")[0]));
    fireEvent.change(screen.getByRole("combobox", { name: "Colour vision" }), { target: { value: "mono" } });
    expect(stroke()).toBe(rgbCss(timeColors(3, "mono")[0]));
    fireEvent.change(screen.getByRole("combobox", { name: "Colour vision" }), { target: { value: "tritan" } });
    expect(stroke()).toBe(rgbCss(timeColors(3, "tritan")[0]));
    expect(stroke()).not.toBe(rgbCss(timeColors(3, "normal")[0]));
  });

  it("renders the wavelength switch only for a field with exposures", async () => {
    await loadGame();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    cleanup();
    await loadGame({}, { has: { exposures: true } });
    expect(screen.getByRole("radiogroup")).toBeTruthy();
  });

  it("shows the rebuilt band frames in the viewer, blank where a frame has no exposure", async () => {
    const canvas = await loadGame({}, { has: { exposures: true } });
    const readout = () => screen.getByTestId("hover-readout").textContent ?? "";
    fireEvent.pointerMove(canvas, { clientX: 5, clientY: 5 });
    const original = readout();
    expect(original).not.toContain("S/N 7.5");
    const enabled = screen.getAllByRole("radio").filter((b) => !(b as HTMLButtonElement).disabled && b.textContent !== "All");
    fireEvent.click(enabled[0]);
    expect(readout()).toContain("S/N 7.5");
    fireEvent.click(screen.getByRole("button", { name: "Next frame" }));
    expect(readout()).toContain("S/N no data");
    fireEvent.click(screen.getByRole("radio", { name: "All" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous frame" }));
    expect(readout()).toBe(original);
  });

  it("says so when a band cannot be rebuilt, and keeps the original frames", async () => {
    wlMock.fail = true;
    const canvas = await loadGame({}, { has: { exposures: true } });
    fireEvent.pointerMove(canvas, { clientX: 5, clientY: 5 });
    const original = screen.getByTestId("hover-readout").textContent;
    const enabled = screen.getAllByRole("radio").filter((b) => !(b as HTMLButtonElement).disabled && b.textContent !== "All");
    fireEvent.click(enabled[0]);
    expect(screen.getByTestId("wavelength-status").textContent).toMatch(/showing all bands/);
    expect(screen.getByTestId("hover-readout").textContent).toBe(original);
  });

  it("keeps the marks on screen and shows not_found plainly", async () => {
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ error: { code: "not_found", message: "no" } }), { status: 404 }),
    );
    const canvas = await loadGame({ fetcher: fetcher as unknown as typeof fetch });
    fireEvent.click(canvas, { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Next frame" }));
    fireEvent.click(canvas, { clientX: 25, clientY: 5 });
    expect(document.querySelectorAll("svg [data-frame]")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByText("The server does not know this spot.")).toBeTruthy();
    expect(document.querySelectorAll("svg [data-frame]")).toHaveLength(2);
  });

  it("never names the spot slug in the DOM", async () => {
    stubFetch(true, { slug: "zzslugzz" });
    render(<PlayScreen spot="zzslugzz" />);
    await screen.findByTestId("field-canvas");
    expect(document.body.innerHTML).not.toContain("zzslugzz");
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
    expect(screen.getByRole("dialog", { name: "INSPECT // px 1,1" })).toBeTruthy();
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
    const popup = screen.getByRole("dialog", { name: "INSPECT // px 2,1" });
    expect(popup.textContent).toContain("RA");
    expect((await screen.findAllByText(/\[LOCKED\]/)).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("433 Eros");
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByTestId("verdict");
    expect(screen.getByRole("dialog", { name: /INSPECT/ })).toBeTruthy();
    expect((await screen.findAllByText(/\[LOCKED\]/)).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("433 Eros");
    expect(infoCalls().length).toBeGreaterThan(0);
    expect(infoCalls().every((u) => u.includes("mode=round"))).toBe(true);
  });

  it("an unlocked verdict with reveal opens Inspect on the object; the popup refetches the unlocked facts", async () => {
    const canvas = await loadGame({ fetcher: vi.fn(async () => new Response(JSON.stringify(known), { status: 200 })) as unknown as typeof fetch });
    fireEvent.click(canvas, { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Next frame" }));
    fireEvent.click(canvas, { clientX: 15, clientY: 5 });
    // Inspect is already open on the reveal pixel (1, 1) while locked; only a remount refetches it.
    fireEvent.keyDown(window, { key: "i" });
    fireEvent.click(canvas, { clientX: 15, clientY: 15 });
    expect((await screen.findAllByText(/\[LOCKED\]/)).length).toBeGreaterThan(0);
    info.reply = { mode: "round", locked: false, sources: { jpl: "ok" }, solar_system: [{ name: "433 Eros", r_au: 1.2 }] };
    const before = infoCalls().length;
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByTestId("verdict");
    expect(screen.getByRole("dialog", { name: "INSPECT // px 1,1" })).toBeTruthy();
    expect((await screen.findAllByText(/433 Eros/)).length).toBeGreaterThan(0);
    expect(infoCalls().length).toBeGreaterThan(before);
    expect(infoCalls().every((u) => u.includes("mode=round"))).toBe(true);
  });

  it("anchors the popup at the inspected pixel's centre on screen", async () => {
    const canvas = await loadGame();
    fireEvent.keyDown(window, { key: "i" });
    fireEvent.click(canvas, { clientX: 25, clientY: 15 });
    // 40 x 20 px canvas over a 4 x 2 grid: pixel (2, 1) has its centre at (25, 15). placePopup puts
    // the 380 x 480 panel 12 px right of that point in jsdom's 1024 x 768 window.
    const popup = screen.getByRole("dialog", { name: "INSPECT // px 2,1" });
    expect([popup.style.left, popup.style.top]).toEqual(["37px", "15px"]);
    fireEvent.click(within(popup).getByRole("button", { name: /Close/i }));
    expect(screen.queryByRole("dialog", { name: /INSPECT/ })).toBeNull();
  });

  it("bumps the scoreboard on every verdict", async () => {
    const wrong: CheckResponse = { ...known, verdict: { kind: "candidate", points: 0, message: "No." }, unlocked: false, reveal: undefined };
    const canvas = await loadGame({ fetcher: vi.fn(async () => new Response(JSON.stringify(wrong), { status: 200 })) as unknown as typeof fetch });
    expect(screen.getByRole("button", { name: /Scoreboard/ })).toBeTruthy();
    await vi.waitFor(() => expect(boardCalls().length).toBeGreaterThan(0));
    expect(boardCalls()[0]).toContain("scope=spot");
    fireEvent.click(canvas, { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Next frame" }));
    fireEvent.click(canvas, { clientX: 15, clientY: 5 });
    for (let n = 1; n <= 2; n++) {
      const before = boardCalls().length;
      fireEvent.click(screen.getByRole("button", { name: "Submit" }));
      await screen.findByTestId("verdict");
      await vi.waitFor(() => expect(boardCalls().length).toBeGreaterThan(before));
    }
  });

  it("Log in / Sign up opens the sign-in dialog", async () => {
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    await loadGame();
    expect(document.querySelector("dialog")).toBeNull();
    const login = screen.getByRole("button", { name: "Log in / Sign up" }) as HTMLButtonElement;
    expect(login.disabled).toBe(false);
    fireEvent.click(login);
    expect(document.querySelector("dialog")?.open).toBe(true);
  });

  it("the tutorial shows no scoreboard", async () => {
    await loadGame({ showTitle: true, objectName: "433 Eros" });
    expect(screen.getByRole("complementary", { name: "Scoreboard panel" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Scoreboard/ })).toBeNull();
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
