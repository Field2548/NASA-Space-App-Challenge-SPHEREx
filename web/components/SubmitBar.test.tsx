// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadGuestSubmissions } from "@/lib/auth";
import { loadGuest,resetGuest } from "@/lib/guest";
import type { CheckResponse, Mark } from "@/lib/types";
import { ApiCallError } from "@/lib/check";
import SubmitBar, { errorText, NOT_FOUND_TEXT, OFFLINE_TEXT, STATIC_HINT } from "./SubmitBar";

const two: Mark[] = [
  { frame: 1, x: 50, y: 60, tDays: 0 },
  { frame: 3, x: 58, y: 57, tDays: 0.2 },
];

const known: CheckResponse = {
  verdict: { kind: "known", object_name: "433 Eros (A898 PA)", points: 150, message: "Confirmed: 433 Eros (A898 PA), asteroid." },
  first_finder: false,
  already_found: false,
  persisted: false,
  unlocked: true,
  reveal: { frame: 1, x: 51.2, y: 63.9 },
  track: { x0: 51, y0: 64, vx: 12.1, vy: -3.4, rms: 0.2, rate_arcsec_per_hour: 3.2 },
  noise_bar_sigma: null,
};

const json = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

beforeEach(() => resetGuest());
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("SubmitBar", () => {
  it("blocks Submit with the player-facing validation message and never calls the server", () => {
    const fetcher = json(known);
    render(<SubmitBar spot="eros" marks={[two[0]]} fetcher={fetcher as unknown as typeof fetch} />);
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(screen.getByRole("alert").textContent).toBe("Mark the object in at least 2 different frames.");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends the marks, renders the verdict with the server rate, and records a guest find", async () => {
    const fetcher = json(known);
    const onResult = vi.fn();
    render(<SubmitBar spot="eros" marks={two} fetcher={fetcher as unknown as typeof fetch} onResult={onResult} />);
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    const v = await screen.findByTestId("verdict");
    expect(v.getAttribute("data-kind")).toBe("known");
    expect(v.textContent).toContain("FOUND IT");
    expect(v.textContent).toContain("+150");
    expect(v.textContent).not.toContain("Confirmed:");
    expect(v.textContent).toContain("3.20″/h");
    expect(v.textContent).toContain("frame 1 at x 51.2, y 63.9");
    const body = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toEqual({ spot: "eros", answer: "track", marks: [{ frame: 1, x: 50, y: 60 }, { frame: 3, x: 58, y: 57 }] });
    expect(onResult).toHaveBeenCalledWith(known);
    expect(loadGuest().finds).toEqual([expect.objectContaining({ spot: "eros", kind: "known", points: 150 })]);
  });

  it("shows a calm message on 404 (route not live) and keeps working", async () => {
    const fetcher = vi.fn(async () => new Response("<html>404</html>", { status: 404 }));
    render(<SubmitBar spot="eros" marks={two} fetcher={fetcher as unknown as typeof fetch} />);
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByText(OFFLINE_TEXT)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement).disabled).toBe(false);
    expect(loadGuest().finds).toEqual([]);
  });

  it("shows the calm message when the network fails", async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    render(<SubmitBar spot="eros" marks={two} fetcher={fetcher as unknown as typeof fetch} />);
    fireEvent.click(screen.getByRole("button", { name: "Nothing moved here" }));
    expect(await screen.findByText(OFFLINE_TEXT)).toBeTruthy();
  });

  it("shows the server's not_found message, not the offline text", async () => {
    const body = { error: { code: "not_found", message: "Unknown spot: eros" } };
    const fetcher = vi.fn(async () => new Response(JSON.stringify(body), { status: 404, headers: { "content-type": "application/json" } }));
    render(<SubmitBar spot="eros" marks={two} fetcher={fetcher as unknown as typeof fetch} />);
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByText(NOT_FOUND_TEXT)).toBeTruthy();
    expect(screen.queryByText(OFFLINE_TEXT)).toBeNull();
    expect((screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("maps errors: JSON codes show their message, bare 5xx and network show offline", () => {
    expect(errorText(new ApiCallError("not_found", "x", 404))).toBe(NOT_FOUND_TEXT);
    expect(errorText(new ApiCallError("db_unavailable", "The database is resting.", 503))).toBe("The database is resting.");
    expect(errorText(new ApiCallError("rate_limited", "slow", 429))).toMatch(/Too many checks/);
    expect(errorText(new ApiCallError("internal", "POST /api/check failed: 503", 503))).toBe(OFFLINE_TEXT);
    expect(errorText(new ApiCallError("internal", "POST /api/check failed: 404", 404))).toBe(OFFLINE_TEXT);
    expect(errorText(new ApiCallError("upstream_failed", "Failed to fetch"))).toBe(OFFLINE_TEXT);
    expect(errorText(new Error("no verdict"))).toBe(OFFLINE_TEXT);
  });

  it("shows the offline text on a bare 503", async () => {
    const fetcher = vi.fn(async () => new Response("down", { status: 503 }));
    render(<SubmitBar spot="eros" marks={two} fetcher={fetcher as unknown as typeof fetch} />);
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByText(OFFLINE_TEXT)).toBeTruthy();
  });

  it("sends answer nothing for 'Nothing moved here', with no marks needed", async () => {
    const res: CheckResponse = {
      ...known,
      verdict: { kind: "nothing_correct", points: 250, message: "Right: nothing moves here." },
      reveal: undefined,
      track: undefined,
    };
    const fetcher = json(res);
    render(<SubmitBar spot="cygnus" marks={[]} fetcher={fetcher as unknown as typeof fetch} />);
    fireEvent.click(screen.getByRole("button", { name: "Nothing moved here" }));
    expect((await screen.findByTestId("verdict")).textContent).toContain("CORRECT");
    const body = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toEqual({ spot: "cygnus", answer: "nothing" });
    expect(loadGuest().finds[0]).toMatchObject({ spot: "cygnus", kind: "nothing_correct" });
  });

  it("only hints for static-looking marks and still submits them", async () => {
    const still: Mark[] = [
      { frame: 1, x: 10, y: 10, tDays: 0 },
      { frame: 2, x: 10, y: 10, tDays: 0.1 },
    ];
    const fetcher = json(known);
    render(<SubmitBar spot="eris" marks={still} fetcher={fetcher as unknown as typeof fetch} />);
    expect(screen.getByText(STATIC_HINT)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByTestId("verdict");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("saves the sent body for guest replay on a guest submit, any verdict kind", async () => {
    const fetcher = json({ ...known, verdict: { kind: "candidate", points: 20, message: "Unconfirmed." } });
    render(<SubmitBar spot="eros" marks={two} fetcher={fetcher as unknown as typeof fetch} />);
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByTestId("verdict");
    const body = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(loadGuestSubmissions()).toEqual([body]);
  });

  it("does not save a replay entry for a persisted submit or a network error", async () => {
    const persisted = json({ ...known, persisted: true });
    render(<SubmitBar spot="eros" marks={two} fetcher={persisted as unknown as typeof fetch} />);
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByTestId("verdict");
    expect(loadGuestSubmissions()).toEqual([]);
    cleanup();
    const failing = vi.fn(async () => {
      throw new TypeError("network");
    });
    render(<SubmitBar spot="eros" marks={two} fetcher={failing as unknown as typeof fetch} />);
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByText(OFFLINE_TEXT);
    expect(loadGuestSubmissions()).toEqual([]);
  });

  it("Escape closes the sheet and leaves a Show result button", async () => {
    render(<SubmitBar spot="eros" marks={two} fetcher={json(known) as unknown as typeof fetch} />);
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByTestId("verdict");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("verdict")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show result" }));
    expect(screen.getByTestId("verdict")).toBeTruthy();
  });

  it("does not record a guest find for a persisted or non-scoring verdict", async () => {
    const fetcher = json({ ...known, verdict: { kind: "static", points: 0, message: "That one didn't move; it's a star." } });
    render(<SubmitBar spot="eros" marks={two} fetcher={fetcher as unknown as typeof fetch} />);
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect((await screen.findByTestId("verdict")).textContent).toContain("NOT QUITE");
    expect(loadGuest().finds).toEqual([]);
  });
});
