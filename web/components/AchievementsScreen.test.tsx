// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordFind, resetGuest } from "@/lib/guest";
import * as supa from "@/lib/supabase";
import AchievementsScreen from "./AchievementsScreen";

vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const body = (source: "account" | "guest") => ({
  source,
  unlocked: 1,
  total: 3,
  achievements: [
    { id: "first-light", title: "First light", description: "Solve your first stage.", progress: 1, goal: 1, unlocked: true, unlockedAt: "2026-03-05T10:00:00Z" },
    { id: "rock-hunter", title: "Rock hunter", description: "Solve 5 stages.", progress: 2, goal: 5, unlocked: false, unlockedAt: null },
    { id: "mystery", title: "Mystery", description: "Something new.", progress: 0, goal: 1, unlocked: false, unlockedAt: null },
  ],
});

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  resetGuest();
  fetchMock = vi.fn(async () => new Response(JSON.stringify(body("guest")), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetGuest();
});

describe("AchievementsScreen", () => {
  it("a guest sends the locally solved spots, sees the guest note, and locked and unlocked badges", async () => {
    vi.spyOn(supa, "authHeader").mockResolvedValue({});
    recordFind("a", "known", 100);
    recordFind("b", "known", 100);
    render(<AchievementsScreen />);
    expect(await screen.findByText("1 of 3 unlocked")).toBeTruthy();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/achievements?solved=a,b");
    expect(screen.getByText(/Playing as a guest: achievements are kept in this browser/)).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "1 of 3 unlocked" }).getAttribute("aria-valuenow")).toBe("1");
    const done = screen.getByTestId("badge-first-light");
    expect(done.getAttribute("data-unlocked")).toBe("true");
    expect(done.textContent).toMatch(/Unlocked \S+/);
    const locked = screen.getByTestId("badge-rock-hunter");
    expect(locked.getAttribute("data-unlocked")).toBe("false");
    expect(locked.textContent).toContain("2 / 5");
    expect(locked.textContent).toContain("Locked");
    expect(screen.getByRole("progressbar", { name: "Rock hunter progress" }).getAttribute("aria-valuenow")).toBe("2");
    expect(screen.getByTestId("badge-mystery").querySelector("svg")).toBeTruthy(); // generic icon
  });

  it("an account sends the auth header, no solved list, and no guest note", async () => {
    vi.spyOn(supa, "authHeader").mockResolvedValue({ Authorization: "Bearer t" });
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body("account")), { status: 200 }));
    recordFind("a", "known", 100);
    render(<AchievementsScreen />);
    await screen.findByText("1 of 3 unlocked");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/achievements");
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toEqual({ Authorization: "Bearer t" });
    expect(screen.queryByText(/Playing as a guest/)).toBeNull();
  });

  it("shows an error and retries", async () => {
    vi.spyOn(supa, "authHeader").mockResolvedValue({});
    fetchMock.mockResolvedValueOnce(new Response("x", { status: 500 }));
    render(<AchievementsScreen />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("1 of 3 unlocked")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});
