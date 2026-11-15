// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetGuest, saveGuest } from "@/lib/guest";
import * as supa from "@/lib/supabase";
import AccountControl from "./AccountControl";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

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

describe("AccountControl", () => {
  it("logged out: a Log in button that opens the sign-in dialog", () => {
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    vi.spyOn(supa, "getSupabaseBrowser").mockReturnValue(fakeClient(null, null));
    render(<AccountControl />);
    expect(document.querySelector("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(document.querySelector("dialog")?.open).toBe(true);
  });

  it("logged in: a round profile icon with the initial, linking to /profile", async () => {
    vi.spyOn(supa, "getSupabaseBrowser").mockReturnValue(fakeClient({ id: "u1" }, "vega"));
    render(<AccountControl />);
    const link = await screen.findByRole("link", { name: "Profile: vega" });
    expect(link.getAttribute("href")).toBe("/profile");
    expect(link.textContent).toBe("V");
    expect(screen.queryByRole("button", { name: "Log in" })).toBeNull();
  });

  it("with no Supabase client, a saved guest name gives the profile icon", async () => {
    vi.spyOn(supa, "getSupabaseBrowser").mockReturnValue(null);
    saveGuest({ name: "Orion" });
    render(<AccountControl />);
    await waitFor(() => expect(screen.getByRole("link", { name: "Profile: Orion" })).toBeTruthy());
  });
});
