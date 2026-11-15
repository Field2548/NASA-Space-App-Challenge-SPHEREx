// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetGuest } from "@/lib/guest";
import { loadVision } from "@/lib/settings";
import SettingsScreen from "./SettingsScreen";

vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));
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
  resetGuest();
});

describe("SettingsScreen", () => {
  it("has one h1, a Back control and the Colour vision select", () => {
    render(<SettingsScreen />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("link", { name: /Back/ }).getAttribute("href")).toBe("/");
    expect((screen.getByRole("combobox", { name: "Colour vision" }) as HTMLSelectElement).value).toBe("normal");
  });

  it("saves a new choice and shows the saved one on the next visit", () => {
    render(<SettingsScreen />);
    fireEvent.change(screen.getByRole("combobox", { name: "Colour vision" }), { target: { value: "mono" } });
    expect(loadVision()).toBe("mono");
    cleanup();
    render(<SettingsScreen />);
    expect((screen.getByRole("combobox", { name: "Colour vision" }) as HTMLSelectElement).value).toBe("mono");
  });
});
