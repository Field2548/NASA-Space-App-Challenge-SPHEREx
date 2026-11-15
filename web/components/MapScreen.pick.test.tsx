// @vitest-environment jsdom
// Picking a patch on the map: a wide view zooms in on the click, a close view picks that patch,
// the card plays it on /play?patch=<id>, and Random picks a patch anywhere on the sky.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { patchFromPoint } from "@/lib/patch";
import type { SkyMapProps } from "./SkyMap";

const last = vi.hoisted(() => ({ props: null as SkyMapProps | null, push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: last.push }) }));
vi.mock("./SkyMap", () => ({
  PATCH_SHOW_FOV: 3,
  SkyMap: (p: SkyMapProps) => {
    last.props = p;
    return <div data-testid="sky" />;
  },
}));

import MapScreen, { PICK_FOV } from "./MapScreen";

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  last.push.mockReset();
  fetchMock = vi.fn(async (url: string) =>
    String(url).startsWith("/api/patches")
      ? Response.json({ patches: [] })
      : new Response("[]", { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MapScreen patch pick", () => {
  it("hides the ready spots on the map", () => {
    render(<MapScreen />);
    expect(last.props?.showSpots).toBe(false);
  });

  it("zooms in on a click in a wide view and picks nothing", () => {
    render(<MapScreen />);
    act(() => last.props?.onClickSky?.({ ra: 40, dec: -10, fov: 60 }));
    expect(last.props?.target).toEqual({ ra: 40, dec: -10, fov: PICK_FOV / 2 });
    expect(last.props?.picked ?? null).toBeNull();
    expect(screen.queryByRole("button", { name: "Play this patch" })).toBeNull();
  });

  it("picks the patch at the click in a close view and plays it on /play?patch=", () => {
    render(<MapScreen />);
    act(() => last.props?.onClickSky?.({ ra: 40, dec: -10, fov: 1 }));
    const id = patchFromPoint(40, -10).id;
    expect(screen.getByRole("heading", { name: `Patch ${id}` })).toBeTruthy();
    expect(last.props?.picked?.corners).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "Play this patch" }));
    expect(last.push).toHaveBeenCalledWith(`/play?patch=${id}`);
  });

  it("Random patch picks a valid patch and flies there", () => {
    render(<MapScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Random patch" }));
    const heading = screen.getByRole("heading", { name: /^Patch p11-\d+$/ });
    const id = heading.textContent!.replace("Patch ", "");
    const p = patchFromPoint(last.props!.target!.ra, last.props!.target!.dec);
    expect(p.id).toBe(id);
  });

  it("asks for solved patches only when zoomed in, and marks a solved pick", async () => {
    render(<MapScreen />);
    act(() => last.props?.onView?.({ ra: 40, dec: -10, fov: 30 }));
    expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith("/api/patches"))).toBe(false);

    const p = patchFromPoint(40, -10);
    fetchMock.mockImplementation(async () =>
      Response.json({ patches: [{ id: p.id, corners: p.corners, objects: [{ ra: 40, dec: -10 }], reports: [] }] }),
    );
    await act(async () => last.props?.onView?.({ ra: 40, dec: -10, fov: 1 }));
    expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith("/api/patches?"))).toBe(true);
    expect(last.props?.patches).toHaveLength(1);
    act(() => last.props?.onClickSky?.({ ra: 40, dec: -10, fov: 1 }));
    expect(screen.getByText(/Already solved: 1 known object, 0 reports/)).toBeTruthy();
  });

  it("says solved patches are offline when the server has none to give", async () => {
    fetchMock.mockImplementation(async () => Response.json({ patches: [], offline: true }));
    render(<MapScreen />);
    await act(async () => last.props?.onView?.({ ra: 40, dec: -10, fov: 1 }));
    act(() => last.props?.onClickSky?.({ ra: 40, dec: -10, fov: 1 }));
    expect(screen.getByText(/offline/)).toBeTruthy();
  });
});
