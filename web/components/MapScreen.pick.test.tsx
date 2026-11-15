// @vitest-environment jsdom
// Picking a patch on the map: a wide view zooms in on the click, a close view opens Quick look.
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkyMapProps } from "./SkyMap";

const last = vi.hoisted(() => ({ props: null as SkyMapProps | null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./SkyMap", () => ({
  SkyMap: (p: SkyMapProps) => {
    last.props = p;
    return <div data-testid="sky" />;
  },
}));

import MapScreen, { PICK_FOV } from "./MapScreen";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MapScreen patch pick", () => {
  it("zooms in on a click in a wide view and opens no Quick look", () => {
    render(<MapScreen />);
    act(() => last.props?.onClickSky?.({ ra: 40, dec: -10, fov: 60 }));
    expect(last.props?.target).toEqual({ ra: 40, dec: -10, fov: PICK_FOV / 2 });
    expect(screen.queryByRole("region", { name: "Quick look" })).toBeNull();
  });

  it("opens Quick look at the clicked point in a close view", () => {
    render(<MapScreen />);
    act(() => last.props?.onClickSky?.({ ra: 40, dec: -10, fov: 1 }));
    expect(screen.getByRole("region", { name: "Quick look" })).toBeTruthy();
  });
});
