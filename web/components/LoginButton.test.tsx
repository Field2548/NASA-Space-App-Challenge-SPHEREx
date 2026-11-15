// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as supa from "@/lib/supabase";
import { resetGuest, saveGuest } from "@/lib/guest";
import LoginButton from "./LoginButton";

beforeEach(() => resetGuest());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function fakeClient(user: unknown, display: string | null) {
  return {
    auth: { getSession: async () => ({ data: { session: user ? { user } : null } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: display ? { display_name: display } : null }) }) }) }),
  } as unknown as ReturnType<typeof supa.getSupabaseBrowser>;
}

describe("LoginButton", () => {
  it("shows the session display name after a remount", async () => {
    vi.spyOn(supa, "getSupabaseBrowser").mockReturnValue(fakeClient({ id: "u1" }, "Vega"));
    const a = render(<LoginButton />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Vega" })).toBeTruthy());
    a.unmount();
    render(<LoginButton />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Vega" })).toBeTruthy());
  });
  it("stays on the label with a client but no session", async () => {
    vi.spyOn(supa, "getSupabaseBrowser").mockReturnValue(fakeClient(null, null));
    saveGuest({ name: "Old" });
    render(<LoginButton />);
    await Promise.resolve();
    expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
  });
  it("falls back to the guest name when there is no Supabase client", async () => {
    vi.spyOn(supa, "getSupabaseBrowser").mockReturnValue(null);
    saveGuest({ name: "Orion" });
    render(<LoginButton />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Orion" })).toBeTruthy());
  });
});
