// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  it("has one h1 with the project name and the three buttons", () => {
    render(<TitleScreen />);
    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe(PROJECT_NAME);
    expect(screen.getByRole("link", { name: "Start training" }).getAttribute("href")).toBe("/tutorial");
    expect(screen.getByRole("link", { name: "Skip to game" }).getAttribute("href")).toBe("/play?spot=eros");
    expect(screen.getByRole("link", { name: "Stages" }).getAttribute("href")).toBe("/stages");
    expect(screen.getByRole("link", { name: "Explore the sky" }).getAttribute("href")).toBe("/map");
    const login = screen.getByRole("button", { name: "Log in" }) as HTMLButtonElement;
    expect(login.disabled).toBe(false);
  });

  it("Log in opens the sign-in dialog", () => {
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    render(<TitleScreen />);
    expect(document.querySelector("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(document.querySelector("dialog")?.open).toBe(true);
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
