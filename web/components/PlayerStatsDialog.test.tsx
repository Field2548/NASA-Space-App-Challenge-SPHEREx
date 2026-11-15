// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ authHeader: async () => ({}) }));

import PlayerStatsDialog from "./PlayerStatsDialog";

const PLAYER = {
  name: "nova",
  is_bot: false,
  is_me: true,
  country: "TH",
  member_since: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  last_active: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  points: 1850,
  points_week: 600,
  rank_all: 1,
  rank_week: null,
  classifications: 14,
  correct: 11,
  accuracy: 0.786,
  stages_completed: 6,
  stages_total: 11,
  by_difficulty: { easy: { done: 1, total: 1 }, medium: { done: 1, total: 2 }, boss: { done: 0, total: 1 }, tool: { done: 3, total: 6 } },
  first_finds: 2,
  patches_solved: 5,
  active_days: 2,
};
const BOT = { name: "Shift-and-stack bot", is_bot: true, is_me: false, points: 1750, about: "An automatic search that plays every stage." };

let calls: string[];
function reply(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(String(url));
      return new Response(JSON.stringify(body), { status });
    }),
  );
}

beforeEach(() => {
  calls = [];
  // jsdom has no modal dialog support. Like a browser, close() fires the close event.
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PlayerStatsDialog", () => {
  it("opens as a modal labelled by its heading and shows loading, then the stats", async () => {
    reply(PLAYER);
    render(<PlayerStatsDialog name="nova" onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: /nova/ });
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(screen.getByRole("status").textContent).toMatch(/Loading/);
    expect(await screen.findByText("#1")).toBeTruthy();
    expect(calls).toEqual(["/api/player?name=nova"]);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toMatch(/\(you\)/);
    expect(screen.getByText("Thailand")).toBeTruthy();
    expect(screen.getByText("Not ranked")).toBeTruthy(); // rank_week is null
    expect(screen.getByText("1850")).toBeTruthy();
    expect(screen.getByText("79%")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3 }).textContent).toMatch(/6 \/ 11/);
    expect(screen.getByText("Easy")).toBeTruthy();
    expect(screen.getByText("Tool tests")).toBeTruthy();
    expect(screen.getByText("3 / 6")).toBeTruthy();
    expect(screen.getByText("3 hours ago").getAttribute("title")).toMatch(/UTC$/);
    expect(screen.getByText("3 days ago")).toBeTruthy();
  });

  it("shows only points and the description for the bot, with no stage bars", async () => {
    reply(BOT);
    render(<PlayerStatsDialog name="Shift-and-stack bot" onClose={vi.fn()} />);
    expect(await screen.findByText(/plays every stage/)).toBeTruthy();
    expect(screen.getByText("1750")).toBeTruthy();
    expect(screen.queryByText(/Stages completed/)).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByText("Accuracy")).toBeNull();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toMatch(/\(bot\)/);
  });

  it.each([
    [503, /Player stats are not available right now\./],
    [404, /could not find that player/],
    [500, /could not be loaded/],
  ])("shows a message for HTTP %i", async (status, text) => {
    reply({ error: { code: "x", message: "y" } }, status);
    render(<PlayerStatsDialog name="nova" onClose={vi.fn()} />);
    expect((await screen.findByRole("alert")).textContent).toMatch(text);
  });

  it("calls onClose from the Close button, from a close event (Esc) and from a backdrop click", async () => {
    reply(PLAYER);
    const onClose = vi.fn();
    render(<PlayerStatsDialog name="nova" onClose={onClose} />);
    await screen.findByText("#1");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    // A real browser turns Esc into a close event on the dialog; jsdom has no Esc handling.
    fireEvent(screen.getByRole("dialog", { hidden: true }), new Event("close"));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("dialog", { hidden: true }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(3));
  });

  it("never shows object names", async () => {
    reply(PLAYER);
    render(<PlayerStatsDialog name="nova" onClose={vi.fn()} />);
    await screen.findByText("#1");
    expect(document.body.textContent).not.toMatch(/eros|hektor|eris|makemake/i);
  });
});
