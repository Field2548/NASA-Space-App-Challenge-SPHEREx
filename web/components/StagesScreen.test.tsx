// @vitest-environment jsdom
// /stages is the all-sky map: only a stage marker (SkyMap onSpot) selects, empty sky selects nothing.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveGuestSubmission } from "@/lib/auth";
import { CELEBRATED_KEY } from "@/lib/celebrated";
import { TUTORIAL } from "@/lib/copy/tutorial";
import { recordFind, resetGuest, saveGuest } from "@/lib/guest";
import type { FieldSummary } from "@/lib/types";
import type { SkyMapProps } from "./SkyMap";
import StagesScreen from "./StagesScreen";
import { makeField } from "./testFixtures";

const last = vi.hoisted(() => ({ props: null as SkyMapProps | null }));
vi.mock("./SkyMap", () => ({
  PATCH_SHOW_FOV: 3,
  SkyMap: (p: SkyMapProps) => {
    last.props = p;
    return <div data-testid="sky" />;
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const row = (slug: string, difficulty: FieldSummary["difficulty"]): FieldSummary => ({
  slug,
  title: "Field in Somewhere",
  ra: 1,
  dec: 2,
  fov_deg: 0.1,
  difficulty,
  kind: "spot",
  thumbnail: `${slug}/thumbs/1.webp`,
});
const INDEX = [row("eros", "easy"), row("hektor", "medium"), row("makemake", "hard"), row("eris", "boss"), row("cygnus", "medium")];
let served: FieldSummary[] = INDEX;

const overlayBody = {
  locked: false,
  asteroids: [
    { name: "433 Eros", positions: [{ frame: 1, x: 5.5, y: 3.5, vmag: 20 }, { frame: 2, x: 9.5, y: 4.5, vmag: 20 }] },
  ],
  stars: [],
};

let overlay: unknown;
let calls: string[];

beforeEach(() => {
  resetGuest();
  localStorage.removeItem("onion-sky:guest-replay");
  localStorage.removeItem(CELEBRATED_KEY);
  overlay = overlayBody;
  served = INDEX;
  calls = [];
  last.props = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      calls.push(u);
      if (u.endsWith("/fields/index.json")) return new Response(JSON.stringify(served), { status: 200 });
      if (u.endsWith("/field.json")) return new Response(JSON.stringify(makeField({ slug: u.split("/").at(-2) })), { status: 200 });
      if (u.startsWith("/api/overlay")) return new Response(JSON.stringify(overlay), { status: 200 });
      return new Response("nope", { status: 404 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetGuest();
  localStorage.removeItem("onion-sky:guest-replay");
});

const pickSpot = (slug: string) => act(() => last.props?.onSpot?.(slug));
const ready = async () => {
  await screen.findByRole("progressbar");
  await waitFor(() => expect(last.props?.spotMarks).toBeTruthy());
};
const card = async (slug: string) => {
  await ready();
  pickSpot(slug);
  return within(await screen.findByTestId(`stage-${slug}`));
};

describe("StagesScreen", () => {
  it("is the sky map: one h1, a Back control, spots on, the map's own list and card off", async () => {
    render(<StagesScreen />);
    await ready();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("link", { name: /Back/ }).getAttribute("href")).toBe("/");
    expect(last.props?.showSpots).toBe(true);
    expect(typeof last.props?.onSpot).toBe("function");
    expect(screen.queryByTestId(/^stage-/)).toBeNull();
  });

  it("selects a stage only from a marker: the card has number, difficulty, thumbnail, status and Play", async () => {
    render(<StagesScreen />);
    const second = await card("hektor");
    expect(second.getByRole("heading", { name: "Stage 2" })).toBeTruthy();
    expect(second.getByText("medium")).toBeTruthy();
    expect(second.getByRole("img").getAttribute("src")).toBe("/fields/hektor/thumbs/1.webp");
    expect(second.getByRole("link", { name: /Play/ }).getAttribute("href")).toBe("/play?spot=hektor");
    expect(second.getByText("Not played")).toBeTruthy();
    expect(screen.getAllByTestId(/^stage-/)).toHaveLength(1);
  });

  it("a click on empty sky selects nothing and leaves the open card alone", async () => {
    render(<StagesScreen />);
    await ready();
    act(() => last.props?.onClickSky?.({ ra: 10, dec: 10, fov: 5 }));
    expect(screen.queryByTestId(/^stage-/)).toBeNull();
    expect(screen.queryByTestId("training-card")).toBeNull();
    pickSpot("eros");
    await screen.findByTestId("stage-eros");
    act(() => last.props?.onClickSky?.({ ra: 10, dec: 10, fov: 5 }));
    expect(screen.getByTestId("stage-eros")).toBeTruthy();
  });

  it("Close drops the card", async () => {
    render(<StagesScreen />);
    const eros = await card("eros");
    fireEvent.click(eros.getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("stage-eros")).toBeNull();
  });

  it("shows tried when the guest has sent an answer that was not a find, and labels the marker", async () => {
    saveGuestSubmission({ spot: "hektor", answer: "nothing" } as never);
    render(<StagesScreen />);
    expect((await card("hektor")).getByText("Tried")).toBeTruthy();
    expect((await card("eros")).getByText("Not played")).toBeTruthy();
    expect(last.props?.spotMarks).toEqual({ hektor: "Tried" });
  });

  it("keeps the solution locked for an unsolved stage: no object name in the DOM and no explore request", async () => {
    render(<StagesScreen />);
    for (const slug of ["eros", "hektor", "cygnus", "makemake", "eris"]) {
      const c = await card(slug);
      fireEvent.click(c.getByRole("button", { name: "Solution" }));
      expect(c.getByText(/Solution locked/)).toBeTruthy();
    }
    expect(document.body.innerHTML).not.toMatch(/Eros|Hektor|Makemake|Eris|433/);
    expect(calls.filter((u) => u.includes("/api/overlay") || u.includes("mode=explore"))).toEqual([]);
    expect(calls.filter((u) => u.endsWith("/field.json"))).toEqual([]);
  });

  it("shows Solved and the solution (name, track on the thumbnail, frame times) only for the solved stage", async () => {
    recordFind("eros", "known", 100);
    render(<StagesScreen />);
    const eros = await card("eros");
    expect(await eros.findByText("433 Eros")).toBeTruthy();
    expect(eros.getByText("Solved")).toBeTruthy();
    expect(eros.getByRole("link", { name: "Play again" }).getAttribute("href")).toBe("/play?spot=eros");
    const line = document.querySelector('[data-testid="stage-eros"] polyline');
    expect(line?.getAttribute("points")).toBe("5.5,3.5 9.5,4.5");
    expect(document.querySelector('[data-testid="stage-eros"] svg')?.getAttribute("viewBox")).toBe("0 0 20 10");
    expect(eros.getByText(/2026-01-06/)).toBeTruthy();
    expect(eros.getByText(/2026-01-07/)).toBeTruthy();
    expect(calls.filter((u) => u.includes("/api/overlay"))).toEqual(["/api/overlay?spot=eros&mode=explore"]);
  });

  it("stays locked when the server does not honour the unlock (no cookie)", async () => {
    recordFind("eros", "known", 100);
    overlay = { locked: true, asteroids: [], stars: [] };
    render(<StagesScreen />);
    const eros = await card("eros");
    await waitFor(() => expect(calls.some((u) => u.includes("/api/overlay"))).toBe(true));
    await waitFor(() => expect(eros.getByText(/Solution locked/)).toBeTruthy());
    expect(document.body.innerHTML).not.toMatch(/Eros/);
  });

  it("says nothing moves here for a solved control field", async () => {
    recordFind("cygnus", "nothing_correct", 50);
    overlay = { locked: false, asteroids: [], stars: [] };
    render(<StagesScreen />);
    expect(await (await card("cygnus")).findByText("Nothing moves here.")).toBeTruthy();
  });

  it("numbers stages Easy to Boss with tool tests after, and counts per group in the list", async () => {
    served = [...INDEX, row("barnard", "tool")];
    recordFind("hektor", "known", 100);
    render(<StagesScreen />);
    await ready();
    const heads = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(heads).toEqual(["Easy0/1", "Medium1/2", "Hard0/1", "Boss0/1", "Tool tests0/1"]);
    expect((await card("cygnus")).getByRole("heading", { name: "Stage 3" })).toBeTruthy();
    expect((await card("barnard")).getByRole("heading", { name: "Stage 6" })).toBeTruthy();
  });

  it("shows progress as a progressbar with solved count", async () => {
    recordFind("eros", "known", 100);
    render(<StagesScreen />);
    const bar = await screen.findByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("1");
    expect(bar.getAttribute("aria-valuemax")).toBe("5");
    expect(screen.getByText("1/5 solved")).toBeTruthy();
    expect(bar.querySelectorAll("[data-filled=true]")).toHaveLength(1);
  });

  it("Training is a button over the map: NEXT until the tutorial is done, card links to /tutorial", async () => {
    render(<StagesScreen />);
    await ready();
    const btn = screen.getByTestId("training-button");
    expect(within(btn).getByText("NEXT")).toBeTruthy();
    expect(last.props?.spotMarks?.eros).toBeUndefined();
    fireEvent.click(btn);
    const t = within(screen.getByTestId("training-card"));
    expect(t.getByRole("heading", { name: "Stage 0" })).toBeTruthy();
    expect(t.getByRole("link", { name: "Play" }).getAttribute("href")).toBe("/tutorial");
    expect(t.getByText("NEXT")).toBeTruthy();
  });

  it("marks Training solved once every tutorial level is done, and NEXT moves to the first spot", async () => {
    saveGuest({ tutorial: { done: TUTORIAL.map((l) => l.id) } });
    render(<StagesScreen />);
    await ready();
    const btn = screen.getByTestId("training-button");
    expect(btn.getAttribute("data-status")).toBe("solved");
    expect(within(btn).queryByText("NEXT")).toBeNull();
    fireEvent.click(btn);
    expect(within(screen.getByTestId("training-card")).getByRole("link", { name: "Play again" })).toBeTruthy();
    expect(last.props?.spotMarks).toEqual({ eros: "NEXT" });
    expect((await card("eros")).getByText("NEXT")).toBeTruthy();
  });

  it("puts NEXT on the first unsolved stage in difficulty order only, Solved on the finished one", async () => {
    saveGuest({ tutorial: { done: TUTORIAL.map((l) => l.id) } });
    recordFind("eros", "known", 100);
    render(<StagesScreen />);
    await ready();
    expect(last.props?.spotMarks).toEqual({ eros: "Solved", hektor: "NEXT" });
    expect((await card("hektor")).getByText("NEXT")).toBeTruthy();
    expect((await card("eros")).queryByText("NEXT")).toBeNull();
  });

  it("the collapsible list reaches every stage with the keyboard, selects it and flies the map there", async () => {
    render(<StagesScreen />);
    await ready();
    expect(document.querySelector("details")?.hasAttribute("open")).toBe(false);
    expect(screen.getByText("All stages (6)")).toBeTruthy();
    const b = screen.getByTestId("list-makemake");
    // Not played yet: no label, the row is dimmed (data-status="new") in its difficulty colour.
    expect(b.textContent).toBe("Stage 4, Field in Somewhere.");
    expect(b.getAttribute("data-status")).toBe("new");
    expect(b.style.getPropertyValue("--diff-color")).toMatch(/^var\(--/);
    fireEvent.click(b);
    expect(await screen.findByTestId("stage-makemake")).toBeTruthy();
    expect(last.props?.target).toMatchObject({ ra: 1, dec: 2 });
  });

  it("shows the celebration burst once for a newly solved stage", async () => {
    recordFind("eros", "known", 100);
    render(<StagesScreen />);
    await card("eros");
    expect(document.querySelector("[data-burst]")).toBeTruthy();
    cleanup();
    render(<StagesScreen />);
    await card("eros");
    expect(document.querySelector("[data-burst]")).toBeNull();
  });
});
