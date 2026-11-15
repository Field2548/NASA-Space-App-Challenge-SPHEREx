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

function fakeClient(user: unknown, display: string | null) {
  return {
    auth: { getSession: async () => ({ data: { session: user ? { user } : null } }), signOut },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: display ? { display_name: display } : null }) }) }) }),
  } as unknown as ReturnType<typeof supa.getSupabaseBrowser>;
}

let calls: string[];
beforeEach(() => {
  resetGuest();
  signOut.mockClear();
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
});
