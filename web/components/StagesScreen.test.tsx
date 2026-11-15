// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveGuestSubmission } from "@/lib/auth";
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
const INDEX = [row("eros", "easy"), row("hektor", "medium"), row("cygnus", "medium")];

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
    expect(cards.map((c) => c.getAttribute("data-testid"))).toEqual(["stage-eros", "stage-hektor", "stage-cygnus"]);
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
    for (const slug of ["eros", "hektor", "cygnus"]) {
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
});
