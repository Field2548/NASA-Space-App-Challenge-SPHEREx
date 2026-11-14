// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SiteFooter from "./SiteFooter";

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
});
