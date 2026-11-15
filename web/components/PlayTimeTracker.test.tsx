// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ header: {} as Record<string, string>, listeners: [] as (() => void)[] }));
vi.mock("@/lib/supabase", () => ({
  authHeader: async () => auth.header,
  getSupabaseBrowser: () => ({
    auth: {
      onAuthStateChange: (cb: () => void) => {
        auth.listeners.push(cb);
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  }),
}));

import PlayTimeTracker from "./PlayTimeTracker";

let fetchMock: ReturnType<typeof vi.fn>;
let visibility: "visible" | "hidden";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-15T10:00:00Z"));
  auth.header = {};
  auth.listeners = [];
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ credited: 60 }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const settle = () => vi.advanceTimersByTimeAsync(0);
/** Play with an input every 30 s for `s` seconds. */
async function play(s: number) {
  for (let i = 0; i < s; i += 5) {
    if (i % 30 === 0) window.dispatchEvent(new Event("pointermove"));
    await vi.advanceTimersByTimeAsync(5000);
  }
}

describe("PlayTimeTracker", () => {
  it("renders nothing and sets no timers or input listeners for a guest", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const { container } = render(<PlayTimeTracker />);
    await settle();
    expect(container.innerHTML).toBe("");
    expect(vi.getTimerCount()).toBe(0);
    expect(add.mock.calls.map((c) => c[0])).not.toContain("pointermove");
    await play(300);
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pagehide"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports about 60 s with the login header after a minute of play", async () => {
    auth.header = { Authorization: "Bearer tok" };
    render(<PlayTimeTracker />);
    await settle();
    await play(70);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/playtime");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    const seconds = (JSON.parse(String(init.body)) as { seconds: number }).seconds;
    expect(seconds).toBeGreaterThanOrEqual(60);
    expect(seconds).toBeLessThanOrEqual(65);
  });

  it("counts nothing with no input, and nothing while the tab is hidden", async () => {
    auth.header = { Authorization: "Bearer tok" };
    render(<PlayTimeTracker />);
    await settle();
    await vi.advanceTimersByTimeAsync(300_000); // visible but no input
    expect(fetchMock).not.toHaveBeenCalled();
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    await play(300);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("flushes with keepalive when the tab becomes hidden", async () => {
    auth.header = { Authorization: "Bearer tok" };
    render(<PlayTimeTracker />);
    await settle();
    await play(30);
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(String(init.body)).seconds).toBeGreaterThanOrEqual(25);
  });

  it("flushes on pagehide, and stops sending after a 401 for the page view", async () => {
    auth.header = { Authorization: "Bearer tok" };
    fetchMock.mockImplementation(async () => new Response("{}", { status: 401 }));
    render(<PlayTimeTracker />);
    await settle();
    await play(70);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await play(300);
    window.dispatchEvent(new Event("pagehide"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("lifts the 401 halt when the token changes, but not when the same token is announced again", async () => {
    auth.header = { Authorization: "Bearer old" };
    fetchMock.mockImplementation(async () => new Response("{}", { status: 401 }));
    render(<PlayTimeTracker />);
    await settle();
    await play(70);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    // The same token again (for example SIGNED_IN on a tab focus): still halted.
    auth.listeners.forEach((cb) => cb());
    await settle();
    expect(vi.getTimerCount()).toBe(0);
    await play(70);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // A refreshed token: counting and reporting resume.
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ credited: 60 }), { status: 200 }));
    auth.header = { Authorization: "Bearer new" };
    auth.listeners.forEach((cb) => cb());
    await settle();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await play(70);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer new" });
  });

  it("keeps counting after a 503 and does not retry that report", async () => {
    auth.header = { Authorization: "Bearer tok" };
    fetchMock.mockImplementationOnce(async () => new Response("{}", { status: 503 }));
    render(<PlayTimeTracker />);
    await settle();
    await play(70);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await play(70);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body)).seconds).toBeLessThanOrEqual(65);
  });

  it("starts counting when the player logs in during the page view, and stops on logout", async () => {
    render(<PlayTimeTracker />);
    await settle();
    expect(vi.getTimerCount()).toBe(0);
    auth.header = { Authorization: "Bearer tok" };
    auth.listeners.forEach((cb) => cb());
    await settle();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await play(70);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    auth.header = {};
    auth.listeners.forEach((cb) => cb());
    await settle();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports what is counted when it unmounts, and leaves no timer behind", async () => {
    auth.header = { Authorization: "Bearer tok" };
    const { unmount } = render(<PlayTimeTracker />);
    await settle();
    await play(20);
    unmount();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
