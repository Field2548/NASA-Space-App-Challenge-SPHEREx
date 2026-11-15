// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetNavStack, trackPath } from "@/lib/navStack";
import BackLink from "./BackLink";

const nav = vi.hoisted(() => ({ back: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const setReferrer = (value: string) => Object.defineProperty(document, "referrer", { value, configurable: true });

beforeEach(() => {
  nav.back.mockReset();
  nav.push.mockReset();
  resetNavStack();
  Object.defineProperty(window.history, "length", { value: 3, configurable: true });
});
afterEach(() => {
  cleanup();
  setReferrer("");
});

describe("BackLink", () => {
  it("links to / and does not go back when the visitor came from outside", () => {
    setReferrer("https://example.org/somewhere");
    render(<BackLink />);
    const link = screen.getByRole("link", { name: /Back/ });
    expect(link.getAttribute("href")).toBe("/");
    fireEvent.click(link);
    expect(nav.back).not.toHaveBeenCalled();
  });

  it("links to / when there is no referrer at all (direct visit)", () => {
    render(<BackLink />);
    fireEvent.click(screen.getByRole("link", { name: /Back/ }));
    expect(nav.back).not.toHaveBeenCalled();
  });

  it("goes back in history when the previous page is on this site", () => {
    setReferrer(`${window.location.origin}/play?spot=eros`);
    render(<BackLink />);
    const link = screen.getByRole("link", { name: /Back/ });
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(nav.back).toHaveBeenCalledTimes(1);
  });

  // document.referrer is not updated by client-side <Link> navigation, so in-app moves are tracked.
  it("goes back after a client-side move from another page of this site", () => {
    trackPath("/stages");
    trackPath("/about");
    render(<BackLink />);
    fireEvent.click(screen.getByRole("link", { name: /Back/ }));
    expect(nav.back).toHaveBeenCalledTimes(1);
  });

  it("does not leave the site once back on the first page of the visit", () => {
    trackPath("/stages");
    trackPath("/about");
    trackPath("/stages"); // the Back itself
    render(<BackLink />);
    fireEvent.click(screen.getByRole("link", { name: /Back/ }));
    expect(nav.back).not.toHaveBeenCalled();
  });
});
