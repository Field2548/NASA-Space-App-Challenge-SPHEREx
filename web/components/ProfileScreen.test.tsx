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
const signOut = vi.fn(async () => ({}));

const updateUser = vi.fn(async () => ({}));
const update = vi.fn();
const insert = vi.fn();

function fakeClient(user: unknown, display: string | null, finds: { spot_slug: string }[] | null = []) {
  const read = (table: string) => ({
    eq: () =>
      table === "finds"
        ? { neq: () => Promise.resolve(finds ? { data: finds, error: null } : { data: null, error: { message: "x" } }) }
        : { maybeSingle: async () => ({ data: display ? { display_name: display } : null }) },
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

  async function openForm(display: string | null, finds?: { spot_slug: string }[] | null) {
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

  it("keeps the local count when the finds query fails", async () => {
    recordFind("c", "known", 100);
    await openForm("vega", null);
    expect(await screen.findByText("1 of 3")).toBeTruthy();
  });
});
