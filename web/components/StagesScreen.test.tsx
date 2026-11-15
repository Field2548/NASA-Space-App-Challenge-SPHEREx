// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveGuestSubmission } from "@/lib/auth";
import { CELEBRATED_KEY } from "@/lib/celebrated";
import { recordFind, resetGuest } from "@/lib/guest";
import type { FieldSummary } from "@/lib/types";
import StagesScreen from "./StagesScreen";
import { makeField } from "./testFixtures";

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
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      calls.push(u);
      if (u.endsWith("/fields/index.json")) return new Response(JSON.stringify(INDEX), { status: 200 });
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

const card = async (slug: string) => within(await screen.findByTestId(`stage-${slug}`));

describe("StagesScreen", () => {
  it("has one h1, a Back control and one card per spot in index order with number, difficulty, thumbnail and Play", async () => {
    render(<StagesScreen />);
    await screen.findByTestId("stage-eros");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("link", { name: /Back/ }).getAttribute("href")).toBe("/");
    const cards = screen.getAllByTestId(/^stage-/);
    expect(cards.map((c) => c.getAttribute("data-testid"))).toEqual(["stage-eros", "stage-hektor", "stage-cygnus", "stage-makemake", "stage-eris"]);
    const second = await card("hektor");
    expect(second.getByText("Stage 2")).toBeTruthy();
    expect(second.getByText("medium")).toBeTruthy();
    expect(second.getByRole("img").getAttribute("src")).toBe("/fields/hektor/thumbs/1.webp");
    expect(second.getByRole("link", { name: /Play/ }).getAttribute("href")).toBe("/play?spot=hektor");
    expect(second.getByText("Not played")).toBeTruthy();
  });

  it("shows tried when the guest has sent an answer that was not a find", async () => {
    saveGuestSubmission({ spot: "hektor", answer: "nothing" } as never);
    render(<StagesScreen />);
    expect((await card("hektor")).getByText("Tried")).toBeTruthy();
    expect((await card("eros")).getByText("Not played")).toBeTruthy();
  });

  it("keeps the solution locked for an unsolved stage: no object name in the DOM and no explore request, even if the endpoint would answer", async () => {
    render(<StagesScreen />);
    await screen.findByTestId("stage-eros");
    for (const slug of ["eros", "hektor", "cygnus", "makemake", "eris"]) {
      expect((await card(slug)).getByText(/Solution locked/)).toBeTruthy();
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
    const line = document.querySelector('[data-testid="stage-eros"] polyline');
    expect(line?.getAttribute("points")).toBe("5.5,3.5 9.5,4.5");
    expect(document.querySelector('[data-testid="stage-eros"] svg')?.getAttribute("viewBox")).toBe("0 0 20 10");
    expect(eros.getByText(/2026-01-06/)).toBeTruthy();
    expect(eros.getByText(/2026-01-07/)).toBeTruthy();
    // the other stages stay locked and are never asked about
    expect((await card("hektor")).getByText(/Solution locked/)).toBeTruthy();
    expect(calls.filter((u) => u.includes("/api/overlay"))).toEqual(["/api/overlay?spot=eros&mode=explore"]);
    expect(screen.getAllByText("433 Eros")).toHaveLength(1);
  });

  it("stays locked when the server does not honour the unlock (no cookie)", async () => {
    recordFind("eros", "known", 100);
    overlay = { locked: true, asteroids: [], stars: [] };
    render(<StagesScreen />);
    const eros = await card("eros");
    await waitFor(() => expect(calls.some((u) => u.includes("/api/overlay"))).toBe(true));
    expect(eros.getByText(/Solution locked/)).toBeTruthy();
    expect(document.body.innerHTML).not.toMatch(/Eros/);
  });

  it("says nothing moves here for a solved control field", async () => {
    recordFind("cygnus", "nothing_correct", 50);
    overlay = { locked: false, asteroids: [], stars: [] };
    render(<StagesScreen />);
    expect(await (await card("cygnus")).findByText("Nothing moves here.")).toBeTruthy();
  });

  it("groups by difficulty with counts, numbers continue across groups", async () => {
    recordFind("hektor", "known", 100);
    render(<StagesScreen />);
    await screen.findByTestId("stage-eros");
    const heads = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(heads).toEqual(["Easy0/1", "Medium1/2", "Hard0/1", "Boss0/1"]);
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Stage 1", "Stage 2", "Stage 3", "Stage 4", "Stage 5"]);
    expect((await card("cygnus")).getByText("Stage 3")).toBeTruthy();
  });

  it("shows progress as a progressbar with solved count", async () => {
    recordFind("eros", "known", 100);
    render(<StagesScreen />);
    const bar = await screen.findByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("1");
    expect(bar.getAttribute("aria-valuemax")).toBe("5");
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(screen.getByText("1/5 solved")).toBeTruthy();
    expect(bar.querySelectorAll("[data-filled=true]")).toHaveLength(1);
  });

  it("puts NEXT on the first unsolved stage in difficulty order only", async () => {
    recordFind("eros", "known", 100);
    render(<StagesScreen />);
    await screen.findByTestId("stage-eros");
    const next = screen.getAllByText("NEXT");
    expect(next).toHaveLength(1);
    expect(next[0].closest("[data-testid]")?.getAttribute("data-testid")).toBe("stage-hektor");
  });

  it("marks tried stages with a TRIED badge", async () => {
    saveGuestSubmission({ spot: "makemake", answer: "nothing" } as never);
    render(<StagesScreen />);
    expect((await card("makemake")).getByText("TRIED")).toBeTruthy();
  });

  it("expands a card with Enter and Space, one at a time", async () => {
    const user = userEvent.setup();
    render(<StagesScreen />);
    const a = (await card("eros")).getByRole("button");
    const b = (await card("hektor")).getByRole("button");
    expect(a.getAttribute("aria-expanded")).toBe("false");
    a.focus();
    await user.keyboard("{Enter}");
    expect(a.getAttribute("aria-expanded")).toBe("true");
    b.focus();
    await user.keyboard(" ");
    expect(b.getAttribute("aria-expanded")).toBe("true");
    expect(a.getAttribute("aria-expanded")).toBe("false");
    await user.keyboard(" ");
    expect(b.getAttribute("aria-expanded")).toBe("false");
    expect(document.body.innerHTML).not.toMatch(/Eros|Hektor|433/);
  });

  it("expands when the card body is clicked but not when Play is clicked", async () => {
    const user = userEvent.setup();
    render(<StagesScreen />);
    const eros = await card("eros");
    await user.click(eros.getByRole("img"));
    expect(eros.getByRole("button").getAttribute("aria-expanded")).toBe("true");
    await user.click(eros.getByRole("link", { name: /Play/ }));
    expect(eros.getByRole("button").getAttribute("aria-expanded")).toBe("true");
  });

  it("moves focus with arrow keys across groups (roving tabindex)", async () => {
    const user = userEvent.setup();
    render(<StagesScreen />);
    await screen.findByTestId("stage-eros");
    const toggles = screen.getAllByRole("button");
    expect(toggles.map((t) => t.getAttribute("tabindex"))).toEqual(["0", "-1", "-1", "-1", "-1"]);
    toggles[0].focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(toggles[1]);
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(toggles[2]);
    expect(toggles[2].getAttribute("tabindex")).toBe("0");
    expect(toggles[0].getAttribute("tabindex")).toBe("-1");
    await user.keyboard("{ArrowLeft}{ArrowUp}");
    expect(document.activeElement).toBe(toggles[0]);
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(toggles[0]);
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(toggles[4]);
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(toggles[0]);
  });

  it("celebrates a newly solved stage once, then not again", async () => {
    recordFind("eros", "known", 100);
    render(<StagesScreen />);
    await screen.findByTestId("stage-eros");
    const burst = document.querySelector('[data-testid="stage-eros"] [data-burst]');
    expect(burst).toBeTruthy();
    expect(burst?.getAttribute("aria-hidden")).toBe("true");
    expect(document.querySelectorAll("[data-burst]")).toHaveLength(1);
    expect(localStorage.getItem(CELEBRATED_KEY)).toContain("eros");
    cleanup();
    render(<StagesScreen />);
    await screen.findByTestId("stage-eros");
    expect(document.querySelector("[data-burst]")).toBeNull();
  });
});
