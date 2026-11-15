// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordFind, resetGuest } from "@/lib/guest";
import * as supa from "@/lib/supabase";
import ProfileScreen from "./ProfileScreen";

vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const INDEX = ["a", "b", "c"].map((slug) => ({ slug, title: "Field", ra: 1, dec: 2, fov_deg: 0.1, difficulty: "easy", kind: "spot", thumbnail: `${slug}/t.webp` }));
const ACH = {
  source: "account",
  unlocked: 1,
  total: 2,
  achievements: [
    { id: "first-light", title: "First light", description: "Solve a stage.", progress: 1, goal: 1, unlocked: true, unlockedAt: "2026-03-05T10:00:00Z" },
    { id: "boss", title: "Boss slayer", description: "Solve the boss.", progress: 0, goal: 1, unlocked: false, unlockedAt: null },
  ],
};
const signOut = vi.fn(async () => ({}));

const updateUser = vi.fn(async () => ({}));
const update = vi.fn();
const insert = vi.fn();

type FindRow = { spot_slug: string; verdict?: string; points?: number; created_at?: string };
const row = (r: FindRow) => ({ verdict: "known", points: 100, created_at: "2026-03-05T10:00:00Z", ...r });

function fakeClient(user: unknown, display: string | null, finds: FindRow[] | null = []) {
  const read = (table: string) => ({
    eq: () =>
      table === "finds"
        ? { neq: () => Promise.resolve(finds ? { data: finds.map(row), error: null } : { data: null, error: { message: "x" } }) }
        : { maybeSingle: async () => ({ data: display ? { display_name: display, created_at: "2026-01-02T12:00:00Z" } : null }) },
  });
  return {
    auth: { getSession: async () => ({ data: { session: user ? { user } : null } }), signOut, updateUser },
    from: (table: string) => ({ select: () => read(table), update: (v: unknown) => ({ eq: () => update(v) }), insert }),
  } as unknown as ReturnType<typeof supa.getSupabaseBrowser>;
}

let calls: string[];
beforeEach(() => {
  resetGuest();
  signOut.mockClear();
  updateUser.mockClear();
  update.mockReset().mockResolvedValue({ error: null });
  insert.mockReset().mockResolvedValue({ error: null });
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      calls.push(u);
      if (u.endsWith("/fields/index.json")) return new Response(JSON.stringify(INDEX), { status: 200 });
      if (u.startsWith("/api/leaderboard")) {
        return new Response(JSON.stringify({ scope: "all", slug: null, source: "db", updated_at: "x", rows: [], me: { rank: 14, name: "vega", score: 350, accuracy: 0.5 } }), { status: 200 });
      }
      if (u.startsWith("/api/achievements")) return new Response(JSON.stringify(ACH), { status: 200 });
      return new Response("nope", { status: 404 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetGuest();
});

describe("ProfileScreen", () => {
  it("a guest sees Not logged in, a Log in button and guest progress, and never asks for a rank", async () => {
    vi.spyOn(supa, "getSupabaseBrowser").mockReturnValue(fakeClient(null, null));
    recordFind("a", "known", 100);
    render(<ProfileScreen />);
    expect(await screen.findByText("Not logged in")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Back/ })).toBeTruthy();
    await waitFor(() => expect(screen.getByText("1 of 3")).toBeTruthy());
    expect(screen.queryByText("Rank")).toBeNull();
    expect(calls.some((c) => c.startsWith("/api/leaderboard"))).toBe(false);
  });

  it("a logged-in player sees name, points, rank and can log out", async () => {
    vi.spyOn(supa, "getSupabaseBrowser").mockReturnValue(fakeClient({ id: "u1" }, "vega"));
    render(<ProfileScreen />);
    expect(await screen.findByText("vega")).toBeTruthy();
    expect(await screen.findByText("#14")).toBeTruthy();
    expect(screen.getByText("350")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(await screen.findByText("Not logged in")).toBeTruthy();
  });

  async function openForm(display: string | null, finds?: FindRow[] | null) {
    vi.spyOn(supa, "getSupabaseBrowser").mockReturnValue(fakeClient({ id: "u1" }, display, finds));
    render(<ProfileScreen />);
    return (await screen.findByLabelText("Display name")) as HTMLInputElement;
  }
  const save = (input: HTMLInputElement, value: string) => {
    fireEvent.change(input, { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  };

  it("saves a new display name and updates the session metadata", async () => {
    const input = await openForm("vega");
    await waitFor(() => expect(input.value).toBe("vega"));
    save(input, "  Nova  ");
    await screen.findByText("Saved.");
    expect(update).toHaveBeenCalledWith({ display_name: "Nova" });
    expect(updateUser).toHaveBeenCalledWith({ data: { display_name: "Nova" } });
    expect(insert).not.toHaveBeenCalled();
  });

  it("says when the name is taken", async () => {
    update.mockResolvedValue({ error: { code: "23505" } });
    save(await openForm("vega"), "Nova");
    expect(await screen.findByText("That name is taken. Pick another.")).toBeTruthy();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("rejects an invalid name without calling the database", async () => {
    save(await openForm("vega"), "x");
    expect(await screen.findByText("Use at least 3 characters.")).toBeTruthy();
    expect(update).not.toHaveBeenCalled();
  });

  it("asks a user without a profile row to pick a name, and inserts it", async () => {
    const input = await openForm(null);
    expect(await screen.findByText("Pick a display name so you appear on the scoreboard.")).toBeTruthy();
    save(input, "Nova");
    await screen.findByText("Saved.");
    expect(insert).toHaveBeenCalledWith({ id: "u1", display_name: "Nova" });
  });

  it("counts distinct solved stages from the database for a logged-in user", async () => {
    await openForm("vega", [{ spot_slug: "a" }, { spot_slug: "a" }, { spot_slug: "b" }]);
    expect(await screen.findByText("2 of 3")).toBeTruthy();
  });

  it("does not count wrong answers as solved", async () => {
    await openForm("vega", [{ spot_slug: "a", verdict: "candidate" }, { spot_slug: "b", verdict: "nothing_wrong" }, { spot_slug: "c", verdict: "nothing_correct" }]);
    expect(await screen.findByText("1 of 3")).toBeTruthy();
    expect(screen.getAllByText(/^Solved /)).toHaveLength(1);
    expect(screen.getAllByText("Not solved")).toHaveLength(2);
  });

  it("marks solved stages in the grid, links to play, and lists recent finds", async () => {
    await openForm("vega", [{ spot_slug: "b", points: 250 }, { spot_slug: "a", verdict: "static", points: 0 }]);
    expect(await screen.findByText("1 of 3")).toBeTruthy();
    const links = screen.getAllByRole("link").filter((l) => l.getAttribute("href")?.startsWith("/play?spot="));
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/play?spot=a", "/play?spot=b", "/play?spot=c"]);
    expect(links[1].textContent).toMatch(/Solved/);
    expect(links[0].textContent).toMatch(/Not solved/);
    expect(screen.getByRole("heading", { name: "Recent activity" })).toBeTruthy();
    expect(screen.getByText("+250 points")).toBeTruthy();
    expect(screen.queryByText("+0 points")).toBeNull();
    expect(screen.getByText(/Explorer since/)).toBeTruthy();
  });

  it("shows an achievements strip and the unlocked count", async () => {
    await openForm("vega");
    expect(await screen.findByText("1 of 2")).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Recent achievements" })).toBeTruthy();
    expect(screen.getByText("First light")).toBeTruthy();
    expect(screen.getByRole("link", { name: "All achievements" }).getAttribute("href")).toBe("/achievements");
  });

  it("shows a dash for achievements when the fetch fails", async () => {
    vi.spyOn(supa, "getSupabaseBrowser").mockReturnValue(fakeClient(null, null));
    const orig = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (u: string) => (String(u).startsWith("/api/achievements") ? new Response("x", { status: 500 }) : orig(u))));
    render(<ProfileScreen />);
    await screen.findByText("Not logged in");
    await waitFor(() => expect(screen.getByText("Achievements").nextElementSibling?.textContent).toBe("–"));
  });

  it("keeps the local count when the finds query fails", async () => {
    recordFind("c", "known", 100);
    await openForm("vega", null);
    expect(await screen.findByText("1 of 3")).toBeTruthy();
  });
});
