// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROJECT_NAME } from "@/lib/brand";
import TitleScreen, { LOGIN_TOOLTIP, starfield } from "./TitleScreen";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

describe("TitleScreen", () => {
  it("has one h1 with the project name and the three buttons", () => {
    render(<TitleScreen />);
    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe(PROJECT_NAME);
    expect(screen.getByRole("link", { name: "Start training" }).getAttribute("href")).toBe("/tutorial");
    expect(screen.getByRole("link", { name: "Skip to game" }).getAttribute("href")).toBe("/play?spot=eros");
    const login = screen.getByRole("button", { name: "Log in" }) as HTMLButtonElement;
    expect(login.disabled).toBe(true);
    expect(login.closest("[title]")?.getAttribute("title")).toBe(LOGIN_TOOLTIP);
    expect(screen.getByText(LOGIN_TOOLTIP, { selector: "#login-note" })).toBeTruthy();
  });

  it("draws a deterministic ASCII starfield hidden from screen readers", () => {
    expect(starfield()).toEqual(starfield());
    const stars = starfield().flat().filter((c) => c.ch !== " ").length;
    expect(stars).toBeGreaterThan(50);
    render(<TitleScreen />);
    expect(screen.getByTestId("starfield").getAttribute("aria-hidden")).toBe("true");
  });
});
