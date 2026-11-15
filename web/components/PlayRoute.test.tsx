// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PlayRoute from "./PlayRoute";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));
const screen = vi.hoisted(() => ({ props: null as null | { initialView: unknown; onViewChange(v: unknown): void } }));
vi.mock("./PlayScreen", () => ({
  default: (p: { initialView: unknown; onViewChange(v: unknown): void }) => {
    screen.props = p;
    return null;
  },
}));

afterEach(() => {
  cleanup();
  nav.replace.mockClear();
  window.history.replaceState(null, "", "/");
});

describe("PlayRoute", () => {
  it("seeds the view from the params", () => {
    render(<PlayRoute spot="fixture" params={{ spot: "fixture", frames: "1-3", spacing: "real", vision: "mono" }} />);
    expect(screen.props?.initialView).toEqual({ frames: [1, 3], realSpacing: true, vision: "mono" });
  });
  it("writes changes to the address without a router navigation (which remounts the game and drops marks)", () => {
    window.history.replaceState(null, "", "/play?spot=fixture&ra=10");
    render(<PlayRoute spot="fixture" params={{ spot: "fixture", ra: "10" }} />);
    screen.props?.onViewChange({ frames: [1, 3], realSpacing: false, vision: "tritan" });
    expect(window.location.pathname + window.location.search).toBe("/play?spot=fixture&ra=10&frames=1-3&vision=tritan");
    expect(nav.replace).not.toHaveBeenCalled();
  });
  it("does not replace when the URL already matches", () => {
    window.history.replaceState(null, "", "/play?spot=fixture&vision=mono");
    render(<PlayRoute spot="fixture" params={{ spot: "fixture", vision: "mono" }} />);
    screen.props?.onViewChange({ frames: null, realSpacing: false, vision: "mono" });
    expect(nav.replace).not.toHaveBeenCalled();
  });
});
