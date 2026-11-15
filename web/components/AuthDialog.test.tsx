// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sbMock = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase", () => ({
  getSupabaseBrowser: () => sbMock.client,
  authHeader: async () => ({}),
}));

import { AuthDialog } from "./AuthDialog";

beforeEach(() => {
  // jsdom has no modal dialog support.
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sbMock.client = null;
});

function fakeClient(over: Record<string, unknown> = {}) {
  return {
    auth: {
      signUp: vi.fn(async () => ({ data: { session: null, user: { id: "u" } }, error: null })),
      signInWithPassword: vi.fn(async () => ({ data: { user: { id: "u1" } }, error: null })),
      getSession: async () => ({ data: { session: null } }),
    },
    rpc: vi.fn(async () => ({ data: true, error: null })),
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { display_name: "Vega" }, error: null }) }) }),
    }),
    ...over,
  };
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("AuthDialog", () => {
  it("without a database shows only the guest option", () => {
    sbMock.client = null;
    render(<AuthDialog open onClose={() => {}} />);
    expect(screen.getByText(/Accounts are not available/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Play as guest" })).toBeTruthy();
    expect(screen.queryByLabelText("Email")).toBeNull();
  });

  it("focuses the email field when it opens", () => {
    sbMock.client = fakeClient();
    render(<AuthDialog open onClose={() => {}} />);
    expect(document.activeElement).toBe(screen.getByLabelText("Email"));
  });

  it("sign-up without a session switches to Log in and keeps the notice", async () => {
    sbMock.client = fakeClient();
    render(<AuthDialog open onClose={() => {}} initialMode="signup" />);
    fill("Email", "a@b.co");
    fill("Password", "longenough1");
    fill("Display name", "Vega");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Log in" })).toBeTruthy());
    expect(screen.getByRole("status").textContent).toBe("Check your email to confirm your account, then log in.");
  });

  it("ties an invalid display name error to that field only", async () => {
    sbMock.client = fakeClient();
    render(<AuthDialog open onClose={() => {}} initialMode="signup" />);
    fill("Email", "a@b.co");
    fill("Password", "longenough1");
    fill("Display name", "x");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).not.toBe(""));
    expect(screen.getByLabelText("Display name").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Email").getAttribute("aria-invalid")).toBeNull();
    expect(screen.getByLabelText("Password").getAttribute("aria-invalid")).toBeNull();
  });

  it("log-in success calls onSignedIn", async () => {
    sbMock.client = fakeClient();
    const onSignedIn = vi.fn();
    render(<AuthDialog open onClose={() => {}} onSignedIn={onSignedIn} />);
    fill("Email", "a@b.co");
    fill("Password", "secret123");
    fireEvent.submit(screen.getByLabelText("Email").closest("form") as HTMLFormElement);
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith("Vega"));
  });
});
