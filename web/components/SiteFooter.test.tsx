// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SiteFooter from "./SiteFooter";

const nav = vi.hoisted(() => ({ path: "/play" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  nav.path = "/play";
});

describe("SiteFooter", () => {
  it("puts the status light next to the Credits link", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ overall: "green" }), { status: 200 })));
    render(<SiteFooter />);
    const credits = screen.getByRole("link", { name: "Credits" });
    expect(credits.getAttribute("href")).toBe("/credits");
    const status = await screen.findByRole("link", { name: /All services working/ });
    expect(status.getAttribute("href")).toBe("/status");
    expect(credits.nextElementSibling).toBe(status);
    expect(fetch).toHaveBeenCalledWith("/api/health", expect.anything());
  });

  it("is marked for the body padding rule and keeps one accessible name for the source link", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ overall: "green" }), { status: 200 })));
    const { container } = render(<SiteFooter />);
    expect(container.querySelector("footer[data-site-footer]")).not.toBeNull();
    const source = screen.getByRole("link", { name: "Source code, GPL-3.0 licence" });
    expect(source.textContent).toContain("Source code: GPL-3.0");
    expect(source.textContent).toContain("Source");
  });

  it("renders nothing on /embed", () => {
    nav.path = "/embed";
    vi.stubGlobal("fetch", vi.fn());
    const { container } = render(<SiteFooter />);
    expect(container.innerHTML).toBe("");
    expect(fetch).not.toHaveBeenCalled();
  });
});
