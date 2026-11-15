// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROJECT_NAME } from "@/lib/brand";
import TitleScreen from "./TitleScreen";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

describe("TitleScreen", () => {
  it("has one h1 with the project name and the four menu links in order", () => {
    render(<TitleScreen />);
    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe(PROJECT_NAME);
    expect(h1s[0].querySelector('svg[data-part="brand-mark"][aria-hidden="true"]')).toBeTruthy();
    const links = screen.getAllByRole("link");
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Game stages", "/stages"],
      ["Explore the sky", "/map"],
      ["Leaderboard", "/leaderboard"],
      ["Achievements", "/achievements"],
    ]);
    expect(screen.queryByRole("button", { name: "Log in" })).toBeNull(); // the account control is in the layout
    expect(screen.getByRole("progressbar", { name: "World progress" })).toBeTruthy();
  });

  it("moves focus with ArrowDown and ArrowUp, wrapping at the ends", () => {
    render(<TitleScreen />);
    const links = screen.getAllByRole("link");
    links[0].focus();
    fireEvent.keyDown(links[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(links[1]);
    fireEvent.keyDown(links[1], { key: "ArrowDown" });
    fireEvent.keyDown(links[2], { key: "ArrowDown" });
    expect(document.activeElement).toBe(links[3]);
    fireEvent.keyDown(links[3], { key: "ArrowDown" });
    expect(document.activeElement).toBe(links[0]);
    fireEvent.keyDown(links[0], { key: "ArrowUp" });
    expect(document.activeElement).toBe(links[3]);
  });

  it("draws the real sky, hidden from screen readers: stars, constellation figures and the Milky Way", () => {
    render(<TitleScreen />);
    const sky = screen.getByTestId("starfield");
    expect(sky.getAttribute("aria-hidden")).toBe("true");
    expect(Number(sky.getAttribute("data-stars"))).toBeGreaterThan(900);
    expect(screen.getByTestId("constellations").getAttribute("d")?.startsWith("M")).toBe(true);
    expect(screen.getByTestId("milky-way").querySelectorAll("circle").length).toBeGreaterThan(40);
    expect(sky.querySelectorAll("text").length).toBeGreaterThan(100);
  });

  it("twinkles the bright stars as HTML glyphs, never as SVG text, so a twinkle never repaints the sky", () => {
    render(<TitleScreen />);
    const bright = screen.getAllByTestId("bright-star");
    expect(bright.length).toBeGreaterThan(30);
    for (const s of bright) {
      expect(s.tagName).toBe("SPAN");
      expect(s.closest("svg")).toBeNull();
      expect(s.textContent).toBe("*");
    }
  });

  it("keeps ASCII shooting stars behind the menu", () => {
    render(<TitleScreen />);
    const shooting = screen.getAllByTestId("shooting-star");
    expect(shooting.length).toBeGreaterThanOrEqual(2);
    for (const s of shooting) {
      expect(s.closest("[aria-hidden=true]")).not.toBeNull();
      expect(s.textContent).toMatch(/^[-=~.]+\*$/);
    }
  });
});
