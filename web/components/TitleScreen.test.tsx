// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROJECT_NAME } from "@/lib/brand";
import TitleScreen, { starfield } from "./TitleScreen";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

describe("TitleScreen", () => {
  it("has one h1 with the project name, two main buttons and Settings and Leaderboard", () => {
    render(<TitleScreen />);
    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe(PROJECT_NAME);
    expect(screen.getByRole("link", { name: "Game stages" }).getAttribute("href")).toBe("/stages");
    expect(screen.getByRole("link", { name: "Explore the sky" }).getAttribute("href")).toBe("/map");
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/settings");
    expect(screen.getByRole("link", { name: "Leaderboard" }).getAttribute("href")).toBe("/leaderboard");
    expect(screen.queryByRole("link", { name: "Start training" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Log in" })).toBeNull(); // the account control is in the layout
    expect(screen.getAllByRole("link")).toHaveLength(4);
  });

  it("draws a deterministic ASCII starfield hidden from screen readers", () => {
    expect(starfield()).toEqual(starfield());
    const stars = starfield().flat().filter((c) => c.ch !== " ").length;
    expect(stars).toBeGreaterThan(50);
    render(<TitleScreen />);
    expect(screen.getByTestId("starfield").getAttribute("aria-hidden")).toBe("true");
  });

  it("animates the sky: two drifting star layers that tile seamlessly, plus ASCII shooting stars", () => {
    render(<TitleScreen />);
    const far = screen.getByTestId("starfield");
    const near = screen.getByTestId("starfield-near");
    expect(near.getAttribute("aria-hidden")).toBe("true");
    // Each row holds its pattern twice, so a drift of half the width loops without a seam.
    for (const layer of [far, near]) {
      const row = (layer.querySelector("span")?.textContent ?? "").replace(/\n$/, "");
      expect(row.length % 2).toBe(0);
      expect(row.slice(0, row.length / 2)).toBe(row.slice(row.length / 2));
    }
    const shooting = screen.getAllByTestId("shooting-star");
    expect(shooting.length).toBeGreaterThanOrEqual(2);
    for (const s of shooting) {
      expect(s.closest("[aria-hidden=true]")).not.toBeNull();
      expect(s.textContent).toMatch(/^[-=~.]+\*$/);
    }
  });
});
