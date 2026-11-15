// @vitest-environment jsdom
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InfoExplore } from "@/lib/inspectPopup";
import type { CheckResponse, Field } from "@/lib/types";
import { resetGuest } from "@/lib/guest";
import { timeColors } from "@/lib/palettes";
import { saveVision } from "@/lib/settings";
import { blackToSlider } from "./BrightnessSlider";
import { rgbCss } from "./FieldViewer";
import { findTarget } from "./CoachMark";
import PlayScreen, { neutralTitle, upsertMark } from "./PlayScreen";
import { makeField, mockCanvas } from "./testFixtures";

// The default 1 s findBy/waitFor budget ran out under a busy machine (load ~20) in full parallel runs.
configure({ asyncUtilTimeout: 5000 });

vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));
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
  resetGuest();
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// What the stubbed GET /api/info answers (the server, not the client, decides the lock).
const info = vi.hoisted(() => ({ reply: {} as InfoExplore }));
const overlayReply = vi.hoisted(() => ({ body: null as object | null }));
const overlayCalls = () =>
  (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith("/api/overlay"));
const board = { scope: "spot", slug: null, source: "db", updated_at: "2026-01-01T00:00:00Z", rows: [], me: null };
const infoCalls = () =>
  (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith("/api/info"));
const boardCalls = () =>
  (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith("/api/leaderboard"));

function stubFetch(ok: boolean, over: Partial<Field> = {}, nFrames = 3) {
  const field = makeField({ slug: "fixture", ...over }, nFrames, 4, 2);
  const bytes = new Uint16Array(nFrames * 4 * 2).fill(1000).buffer;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (!ok) return new Response("nope", { status: 404 });
      if (url.startsWith("/api/info")) return new Response(JSON.stringify(info.reply), { status: 200 });
      if (url.startsWith("/api/leaderboard")) return new Response(JSON.stringify(board), { status: 200 });
      if (url.startsWith("/api/overlay")) return overlayReply.body ? new Response(JSON.stringify(overlayReply.body), { status: 200 }) : new Response("no", { status: 404 });
      if (url.endsWith("/index.json")) return new Response(JSON.stringify([{ slug: "fixture", difficulty: "easy" }, { slug: "other", difficulty: "easy" }]), { status: 200 });
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
    for (const s of ["submit", "nothing-moved"]) {
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
        initialView={{ frames: [0, 1], vision: "mono" }}
        onViewChange={(v) => seen.push(v)}
      />,
    );
    await screen.findByTestId("field-canvas");
    await waitFor(() => expect(seen.at(-1)).toEqual({ frames: [0, 1], vision: "mono" }));
    expect(screen.queryByLabelText("Colour vision")).toBeNull(); // moved to /settings
  });

  it("reports the default onion range as null", async () => {
    stubFetch(true);
    const seen: unknown[] = [];
    render(<PlayScreen spot="fixture" onViewChange={(v) => seen.push(v)} />);
    await screen.findByTestId("field-canvas");
    await waitFor(() => expect(seen.at(-1)).toEqual({ frames: null, vision: "normal" }));
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

async function loadGame(props: Partial<Parameters<typeof PlayScreen>[0]> = {}, over: Partial<Field> = {}, nFrames = 3) {
  stubFetch(true, over, nFrames);
  render(<PlayScreen spot="fixture" {...props} />);
  const canvas = (await screen.findByTestId("field-canvas")) as HTMLCanvasElement;
  // Flush pending effects (the window keydown listener) so a key pressed next is never lost under load.
  await act(async () => {});
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 40, height: 20 } as DOMRect);
  return canvas;
}

describe("PlayScreen wiring", () => {
  it("Stack stops a playing blink", async () => {
    await loadGame();
    fireEvent.click(screen.getByRole("button", { name: "Play blink" }));
    expect(screen.getByRole("button", { name: "Pause blink" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stack" }));
    expect(screen.getByRole("button", { name: "Play blink" })).toBeTruthy();
  });

  it("Shift is opt-in beside Stack: turns Stack on, shows the motion pad, and goes away with Stack", async () => {
    await loadGame();
    expect(screen.queryByTestId("motion-pad")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Shift" }));
    expect(screen.getByRole("button", { name: "Stack" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("slider", { name: "Shift motion" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("slider", { name: "Shift motion" }), { key: "ArrowRight" });
    expect(screen.getByText(/^Shift \d+\.\d px\/day$/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stack" }));
    expect(screen.queryByTestId("motion-pad")).toBeNull();
  });

  it("wires the Stack range into the Timeline (only while Stack is on), with no Real time spacing", async () => {
    await loadGame();
    expect(screen.queryByRole("slider", { name: "Stack end frame" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stack" }));
    const end = screen.getByRole("slider", { name: "Stack end frame" });
    expect(end.getAttribute("aria-valuenow")).toBe("3"); // all 3 frames
    expect(screen.getByRole("group", { name: "Color frames 1–3" })).toBeTruthy();
    expect(screen.getByText("Stack: 3 frames")).toBeTruthy();
    fireEvent.keyDown(end, { key: "ArrowLeft" });
    expect(screen.getByText("Stack: 2 frames")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Color frames 1–2" })).toBeTruthy();
    expect(screen.queryByText(/Real time spacing/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Blink order|ping-pong/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Play blink" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next frame" })).toBeTruthy();
  });

  it("Previous on the first frame goes to the last, and Next on the last goes to the first", async () => {
    await loadGame();
    const readout = () => screen.getByText(/^Frame \d+ \/ \d+$/).textContent;
    expect(readout()).toBe("Frame 1 / 3");
    const prev = screen.getByRole("button", { name: "Previous frame" }) as HTMLButtonElement;
    const next = screen.getByRole("button", { name: "Next frame" }) as HTMLButtonElement;
    expect(prev.disabled).toBe(false);
    fireEvent.click(prev);
    expect(readout()).toBe("Frame 3 / 3");
    expect(next.disabled).toBe(false);
    fireEvent.click(next);
    expect(readout()).toBe("Frame 1 / 3");
    const list = screen.getByRole("listbox", { name: "Frames" });
    fireEvent.keyDown(list, { key: "ArrowLeft" });
    expect(readout()).toBe("Frame 3 / 3");
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(readout()).toBe("Frame 1 / 3");
  });

  it("the Frames control shows an even subset, keeps original frame numbers and keeps marks on hidden frames", async () => {
    const canvas = await loadGame({}, {}, 5);
    const clipLabels = () => screen.getAllByRole("option").map((o) => o.getAttribute("aria-label") ?? "");
    expect(clipLabels()).toHaveLength(5);
    expect(screen.getByText("5 of 5")).toBeTruthy();
    // Mark original frame 2 (second clip).
    fireEvent.click(screen.getByRole("button", { name: "Next frame" }));
    fireEvent.click(canvas, { clientX: 35, clientY: 15 });
    expect(screen.getByText(/^1 mark in 5 frames/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show fewer frames" }));
    fireEvent.click(screen.getByRole("button", { name: "Show fewer frames" })); // 3 frames: originals 1, 3, 5
    expect(screen.getByText("3 of 5")).toBeTruthy();
    const labels = clipLabels();
    expect(labels).toHaveLength(3);
    expect(labels[1]).toContain("2026-01-08"); // original frame 3 (days 06, 07, 08, ...)
    expect(labels[2]).toContain("2026-01-010"); // original frame 5 (the fixture writes its day as "0" + 10)
    expect(labels[2]).toContain("+42.2 h"); // the gap is measured from the previous shown frame
    expect(labels.some((l) => l.endsWith("marked"))).toBe(false); // frame 2 is hidden, not deleted
    expect(screen.getByText(/^1 mark in 5 frames/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Show fewer frames" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Show more frames" }));
    fireEvent.click(screen.getByRole("button", { name: "Show more frames" }));
    expect(clipLabels()).toHaveLength(5);
    expect(clipLabels()[1].endsWith("marked")).toBe(true); // the mark was kept
  });

  it("the speed control is a labelled set of buttons within the 3 frames per second cap", async () => {
    await loadGame();
    const group = screen.getByRole("group", { name: "Blink speed" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["0.5/s", "1/s", "2/s", "3/s"]);
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false", "false", "true"]);
    fireEvent.click(within(group).getByRole("button", { name: "1 frame per second" }));
    expect(within(group).getByRole("button", { name: "1 frame per second" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(group).getByRole("button", { name: "3 frames per second" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("shows the frame before and after the selected one, beside the viewer", async () => {
    await loadGame();
    const ctx = screen.getByRole("group", { name: "Frames around the selected one" });
    expect(within(ctx).queryByText(/^−1/)).toBeNull(); // frame 1 has no frame before it
    expect(within(ctx).getByText(/\+1 frame 2/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next frame" }));
    expect(within(ctx).getByText(/−1 frame 1/)).toBeTruthy();
    expect(within(ctx).getByText(/\+1 frame 3/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next frame" }));
    expect(within(ctx).queryByText(/^\+1/)).toBeNull(); // last frame has none after it
  });

  it("limits the blink to the Blink range, labelled with the frames it covers", async () => {
    await loadGame();
    const end = screen.getByRole("slider", { name: "Blink end frame" });
    expect(end.getAttribute("aria-valuenow")).toBe("3"); // default: all frames
    expect(screen.getByRole("group", { name: "Blink frames 1–3" })).toBeTruthy();
    fireEvent.keyDown(end, { key: "ArrowLeft" });
    expect(screen.getByRole("group", { name: "Blink frames 1–2" })).toBeTruthy();
    expect(screen.getByText("frames 1–2")).toBeTruthy();
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
const ALLOWED_AT_LEVEL_0 = ["Zoom in", "Zoom out", "Previous frame", "Play blink", "Next frame"];

describe("PlayScreen tools", () => {
  it("shows every built tool by default; Known asteroids is there but locked during a round", async () => {
    await loadGame();
    for (const name of [/Inspect off/, "Stack", "Submit", "1 frame per second"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(screen.getByRole("slider", { name: "Blink end frame" })).toBeTruthy();
    expect(screen.queryByRole("slider", { name: "Stack end frame" })).toBeNull(); // until Stack is on
    expect(screen.queryByRole("combobox", { name: "Colour vision" })).toBeNull(); // moved to /settings
    expect((screen.getByRole("button", { name: "Known asteroids" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows Known asteroids only when tools include overlays", async () => {
    await loadGame({ tools: new Set(["overlays"]) });
    expect(screen.getByRole("button", { name: "Known asteroids" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Colour vision" })).toBeNull();
  });
});

describe("Known asteroids overlay", () => {
  const body = {
    asteroids: [{ name: "(2015 HT246)", positions: [{ frame: 1, x: 5.5, y: 3.5, vmag: 22 }, { frame: 2, x: 9.5, y: 4.5, vmag: 22 }] }],
    stars: [{ name: "Gaia DR3 1", source: "gaia", x: 2, y: 2 }],
  };
  const submitMarks = async (canvas: HTMLCanvasElement) => {
    fireEvent.click(canvas, { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Next frame" }));
    fireEvent.click(canvas, { clientX: 15, clientY: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  };

  it("fetches nothing and names nothing before a verdict; a locked verdict keeps it locked", async () => {
    overlayReply.body = body;
    const locked: CheckResponse = { ...known, verdict: { ...known.verdict, kind: "candidate", message: "Not yet." }, unlocked: false, reveal: undefined };
    const canvas = await loadGame({ fetcher: vi.fn(async () => new Response(JSON.stringify(locked), { status: 200 })) as unknown as typeof fetch });
    const toggle = screen.getByRole("button", { name: "Known asteroids" }) as HTMLButtonElement;
    fireEvent.click(toggle);
    expect(overlayCalls()).toEqual([]);
    expect(document.body.textContent).not.toContain("HT246");
    await submitMarks(canvas);
    await screen.findByTestId("verdict");
    expect(toggle.disabled).toBe(true);
    expect(overlayCalls()).toEqual([]);
    expect(document.querySelector('[data-testid="known-diamond"]')).toBeNull();
    expect(document.body.textContent).not.toContain("HT246");
  });

  it("after an unlocked verdict the toggle fetches explore once and draws diamonds at the shown frame", async () => {
    overlayReply.body = body;
    const canvas = await loadGame({ fetcher: vi.fn(async () => new Response(JSON.stringify(known), { status: 200 })) as unknown as typeof fetch });
    await submitMarks(canvas);
    await screen.findByTestId("verdict");
    const toggle = screen.getByRole("button", { name: "Known asteroids" }) as HTMLButtonElement;
    await vi.waitFor(() => expect(toggle.disabled).toBe(false));
    fireEvent.click(toggle);
    await vi.waitFor(() => expect(document.querySelector('[data-testid="known-diamond"]')).not.toBeNull());
    expect(overlayCalls()).toEqual(["/api/overlay?spot=fixture&mode=explore"]);
    const d = document.querySelectorAll('[data-testid="known-diamond"]');
    expect(d.length).toBe(1);
    const frame = Number(d[0].getAttribute("data-frame"));
    expect(d[0].getAttribute("data-x")).toBe(frame === 1 ? "5.5" : "9.5");
    expect(document.querySelectorAll('[data-testid="known-star"]').length).toBe(1);
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(overlayCalls().length).toBe(1);
  });

  it("an unavailable overlay shows the plain message", async () => {
    overlayReply.body = null;
    const canvas = await loadGame({ fetcher: vi.fn(async () => new Response(JSON.stringify(known), { status: 200 })) as unknown as typeof fetch });
    await submitMarks(canvas);
    await screen.findByTestId("verdict");
    const toggle = screen.getByRole("button", { name: "Known asteroids" }) as HTMLButtonElement;
    await vi.waitFor(() => expect(toggle.disabled).toBe(false));
    fireEvent.click(toggle);
    await screen.findByText("Known asteroids are not available for this spot right now.");
    expect(document.querySelector('[data-testid="known-diamond"]')).toBeNull();
  });
});

describe("PlayScreen tools (more)", () => {

  it("shows no placeholder and names no object in round mode", async () => {
    await loadGame();
    const html = document.body.innerHTML;
    expect(html).not.toMatch(/\b(Eros|Hektor|Makemake|Eris)\b/i);
    const text = document.body.textContent ?? "";
    for (const p of ["more tools", "wavelength switch", "vision picker", "coordinate box", "others' work", "not drawn yet"]) {
      expect(text.toLowerCase()).not.toContain(p);
    }
    for (const s of ["image-tools", "wavelength", "color-vision", "coordinate-box", "show-work", "scoreboard"]) {
      expect(document.querySelector(`[data-slot="${s}"]`)).toBeNull();
    }
    expect(document.querySelectorAll("h1")).toHaveLength(1);
  });

  it("uses the colour vision saved on /settings for the FieldViewer mark colours", async () => {
    saveVision("mono");
    const canvas = await loadGame();
    fireEvent.click(canvas, { clientX: 5, clientY: 5 });
    const stroke = () => document.querySelector("svg [data-frame] circle")?.getAttribute("stroke");
    expect(stroke()).toBe(rgbCss(timeColors(3, "mono")[0]));
    expect(stroke()).not.toBe(rgbCss(timeColors(3, "normal")[0]));
  });

  it("lets a ?vision= URL value win over the saved setting", async () => {
    saveVision("mono");
    stubFetch(true);
    render(<PlayScreen spot="fixture" initialView={{ frames: null, vision: "tritan" }} />);
    const canvas = await screen.findByTestId("field-canvas");
    fireEvent.click(canvas, { clientX: 5, clientY: 5 });
    expect(document.querySelector("svg [data-frame] circle")?.getAttribute("stroke")).toBe(rgbCss(timeColors(3, "tritan")[0]));
  });

  it("links to the stage list from the header", async () => {
    await loadGame();
    expect(screen.getByRole("link", { name: "Stages" }).getAttribute("href")).toBe("/stages");
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
    for (const name of [/Inspect/, "Stack", "Known asteroids", "Submit", "Clear marks", /frames? per second/]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.queryByRole("slider", { name: "Blink end frame" })).toBeNull();
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
    info.reply = { mode: "explore", locked: false, sources: { jpl: "ok" }, solar_system: [{ name: "433 Eros", r_au: 1.2 }] };
    const before = infoCalls().length;
    expect(infoCalls().every((u) => u.includes("mode=round"))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByTestId("verdict");
    expect(screen.getByRole("dialog", { name: "INSPECT // px 1,1" })).toBeTruthy();
    expect((await screen.findAllByText(/433 Eros/)).length).toBeGreaterThan(0);
    expect(infoCalls().length).toBeGreaterThan(before);
    // After a correct answer the popup asks for explore (api.md 2); the server still decides.
    expect(infoCalls().slice(before).every((u) => u.includes("mode=explore"))).toBe(true);
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

  it("draws the spectrum circle on the viewer and the radius control resizes it", async () => {
    const canvas = await loadGame({}, { has: { spectrum: true } });
    fireEvent.keyDown(window, { key: "i" });
    fireEvent.click(canvas, { clientX: 25, clientY: 15 });
    const r0 = Number(screen.getByTestId("aperture").querySelector("circle")!.getAttribute("r"));
    fireEvent.click(await screen.findByRole("button", { name: "Larger circle" }));
    const r1 = Number(screen.getByTestId("aperture").querySelector("circle")!.getAttribute("r"));
    expect(r1 / r0).toBeCloseTo(3 / 2, 9);
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

  it("has no login button of its own (the layout's account control is top right)", async () => {
    await loadGame();
    expect(screen.queryByRole("button", { name: /Log in/ })).toBeNull();
  });

  it("the tutorial gets no next-stage link (the coach leads on)", async () => {
    const canvas = await loadGame({ showTitle: true, fetcher: vi.fn(async () => new Response(JSON.stringify(known), { status: 200 })) as unknown as typeof fetch });
    fireEvent.click(canvas, { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Next frame" }));
    fireEvent.click(canvas, { clientX: 15, clientY: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByTestId("verdict");
    expect(screen.queryByRole("link", { name: /NEXT STAGE|Next spot/ })).toBeNull();
  });

  it("the tutorial shows no scoreboard", async () => {
    await loadGame({ showTitle: true, objectName: "433 Eros" });
    expect(screen.getByRole("complementary", { name: "Scoreboard panel" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Scoreboard/ })).toBeNull();
  });

  it("after a verdict a result sheet offers NEXT STAGE; the old Next spot row and the mark prompt are gone", async () => {
    const canvas = await loadGame({ fetcher: vi.fn(async () => new Response(JSON.stringify(known), { status: 200 })) as unknown as typeof fetch });
    expect(screen.queryByRole("link", { name: /Next spot/ })).toBeNull();
    fireEvent.click(canvas, { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Next frame" }));
    fireEvent.click(canvas, { clientX: 15, clientY: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByTestId("verdict");
    const next = await screen.findByRole("link", { name: /NEXT STAGE/ });
    expect(next.getAttribute("href")).toBe("/play?spot=other");
    expect(screen.queryByRole("link", { name: /Next spot/ })).toBeNull();
    expect(document.body.textContent).not.toContain("Mark the mover in at least 2 frames");
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
