// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LeaderboardScreen from "./LeaderboardScreen";

vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const spot = (slug: string, difficulty: string) => ({ slug, title: "Field", ra: 1, dec: 2, fov_deg: 0.1, difficulty, kind: "spot", thumbnail: `${slug}/t.webp` });
const INDEX = [spot("eros", "easy"), spot("eris", "boss"), spot("hektor", "medium")];
const board = (source: string, rows: unknown[], me?: unknown) => ({ scope: "all", slug: null, source, updated_at: "x", rows, me });
const rowOf = (rank: number, name: string, score: number, is_me = false, is_bot = false) => ({ rank, name, score, accuracy: 0.5, is_bot, is_me });

let respond: (u: string) => Response;
let calls: string[];
beforeEach(() => {
  calls = [];
  respond = () => new Response(JSON.stringify(board("db", [rowOf(1, "nova", 900), rowOf(2, "kt", 350, true)])), { status: 200 });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      calls.push(u);
      if (u.endsWith("/fields/index.json")) return new Response(JSON.stringify(INDEX), { status: 200 });
      return respond(u);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LeaderboardScreen", () => {
  it("shows rank, name and points and highlights my row", async () => {
    render(<LeaderboardScreen />);
    const nova = await screen.findByText("nova");
    expect(within(nova.closest("tr")!).getByText("900")).toBeTruthy();
    expect(nova.closest("tr")?.getAttribute("data-me")).toBe("false");
    expect(screen.getByText("kt").closest("tr")?.getAttribute("data-me")).toBe("true");
    expect(screen.getByRole("link", { name: /Back/ })).toBeTruthy();
    expect(calls.some((c) => c === "/api/leaderboard?scope=all")).toBe(true);
  });

  it("adds my row from `me` when it is outside the top rows, and labels bots and snapshots", async () => {
    respond = () => new Response(JSON.stringify(board("snapshot", [rowOf(1, "Shift-and-stack bot", 1750, false, true)], { rank: 60, name: "kt", score: 5, accuracy: null })), { status: 200 });
    render(<LeaderboardScreen />);
    expect(await screen.findByText(/Showing a saved copy/)).toBeTruthy();
    expect(screen.getByText("(bot)")).toBeTruthy();
    expect(screen.getByText("kt").closest("tr")?.getAttribute("data-me")).toBe("true");
    expect(screen.getByText("60")).toBeTruthy();
  });

  it("per-stage tabs use stage numbers and difficulty, never object names, and fetch scope=spot", async () => {
    render(<LeaderboardScreen />);
    const tab = await screen.findByRole("tab", { name: "Stage 2 (medium)" });
    expect(screen.getByRole("tab", { name: "Stage 3 (boss)" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/eros|hektor|eris/i);
    fireEvent.click(tab);
    await waitFor(() => expect(calls).toContain("/api/leaderboard?scope=spot&slug=hektor"));
  });

  it("shows an error when the leaderboard fails", async () => {
    respond = () => new Response("x", { status: 500 });
    render(<LeaderboardScreen />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/could not be loaded/);
  });
});
