// @vitest-environment jsdom
// Picking a patch on the map: a click picks that patch without zooming (street-map style), Enter
// picks the typed place, the card plays it on /play?patch=<id>, and the dice picks anywhere.
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

import { resetQuickLookListCache } from "@/lib/quicklookPrefetch";
import MapScreen from "./MapScreen";

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  last.push.mockReset();
  resetQuickLookListCache();
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

  it("a click at any zoom shows the patch card with its still, never moves the view, and starts the IRSA query", () => {
    render(<MapScreen />);
    act(() => last.props?.onClickSky?.({ ra: 40, dec: -10, fov: 360 }));
    const p = patchFromPoint(40, -10);
    expect(screen.getByRole("heading", { name: `Patch ${p.id}` })).toBeTruthy();
    expect(screen.getByRole("img", { name: /Still picture of this patch/ })).toBeTruthy();
    expect(last.props?.target ?? null).toBeNull();
    expect(fetchMock.mock.calls.some(([u]) => String(u) === `/api/quicklook/list?ra=${p.ra}&dec=${p.dec}`)).toBe(true);
  });

  it("Enter in the coordinate box flies to the place and picks its patch; no Pick this patch button", () => {
    render(<MapScreen />);
    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "40 -10" } });
    expect(screen.queryByRole("button", { name: "Pick this patch" })).toBeNull();
    fireEvent.submit(screen.getByRole("search"));
    const p = patchFromPoint(40, -10);
    expect(screen.getByRole("heading", { name: `Patch ${p.id}` })).toBeTruthy();
    expect(last.props?.target).toMatchObject({ ra: p.ra, dec: p.dec });
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

  it("the dice picks a patch at a random place on the sky and flies there; no Random patch button", () => {
    render(<MapScreen />);
    expect(screen.queryByRole("button", { name: "Random patch" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Jump to a random place on the sky" }));
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

  it("shows no offline note when the server has no solved patches to give", async () => {
    fetchMock.mockImplementation(async () => Response.json({ patches: [], offline: true }));
    render(<MapScreen />);
    await act(async () => last.props?.onView?.({ ra: 40, dec: -10, fov: 1 }));
    act(() => last.props?.onClickSky?.({ ra: 40, dec: -10, fov: 1 }));
    expect(screen.queryByText(/offline/)).toBeNull();
    expect(screen.getByText("Nobody has solved this patch yet.")).toBeTruthy();
  });
});
