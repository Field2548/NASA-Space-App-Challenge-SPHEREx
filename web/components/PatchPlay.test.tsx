// @vitest-environment jsdom
// The picked-patch screen before any frame is downloaded: the still, the IRSA answer, and the
// honest "nothing to play" states. fetch is faked; no network.
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { patchFromPoint } from "@/lib/patch";
import PatchPlay, { NO_EXPOSURES_TEXT, patchRequest } from "./PatchPlay";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const patch = patchFromPoint(200, -40);
const renderGame = vi.fn(() => <p>game</p>);

function fakeFetch(list: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.startsWith("/api/quicklook/list")
        ? new Response(JSON.stringify(list), { status, headers: { "content-type": "application/json" } })
        : new Response("", { status: 404 }),
    ),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PatchPlay", () => {
  it("draws the still at once and says so plainly when SPHEREx has no exposures here", async () => {
    fakeFetch({ ra: patch.ra, dec: patch.dec, radius_deg: 0, exposures: [], bursts: [], source: {} });
    render(<PatchPlay patch={patch} renderGame={renderGame} />);
    expect(screen.getByRole("img", { name: /still picture/i })).toBeTruthy();
    expect(screen.getByText(/Asking NASA IRSA/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText(NO_EXPOSURES_TEXT)).toBeTruthy());
    expect(screen.getByRole("button", { name: "Try a random patch" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to the map" }).getAttribute("href")).toBe("/map");
    expect(screen.queryByRole("button", { name: /Load the frames/ })).toBeNull();
    expect(renderGame).not.toHaveBeenCalled();
  });

  it("one visit only: says a mover needs 2 visits, no download offered", async () => {
    const exposures = [0, 1, 2, 3].map((k) => ({
      mjd: 60865.75 + k / 720,
      mjd_end: 60865.751 + k / 720,
      url: "https://x/y.fits",
      access_url: "https://x/y.fits",
      source: "s3",
      est_size_bytes: 600000,
      collection: "spherex_qr",
      detector: 1,
      burst: 0,
    }));
    fakeFetch({ ra: patch.ra, dec: patch.dec, radius_deg: 0, exposures, bursts: [{ i: 0, mjd: 60865.75, utc: "", exposures: [0, 1, 2, 3], detectors: [1] }], source: {} });
    render(<PatchPlay patch={patch} renderGame={renderGame} />);
    await waitFor(() => expect(screen.getByText("Too few SPHEREx visits here to see anything move.")).toBeTruthy());
    expect(screen.getByText(/at least 2 visits/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Load the frames/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Try a random patch" })).toBeTruthy();
  });

  it("an IRSA failure keeps the still and offers the way out", async () => {
    fakeFetch({ error: { code: "upstream_failed", message: "IRSA 503" } }, 502);
    render(<PatchPlay patch={patch} renderGame={renderGame} />);
    await waitFor(() => expect(screen.getByText("Could not reach NASA IRSA right now.")).toBeTruthy());
    expect(screen.getByText("IRSA 503")).toBeTruthy();
    expect(screen.getByRole("img", { name: /still picture/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try a random patch" })).toBeTruthy();
  });
});

describe("patchRequest", () => {
  const field = { frames: [{ i: 1, mjd: 60000.1 }, { i: 2, mjd: 60000.2 }] } as never;
  it("sends the patch id, the marks and every frame time, never a name", () => {
    const marks = [{ frame: 1, x: 3, y: 4 }, { frame: 2, x: 5, y: 6 }];
    expect(patchRequest(patch, field, { slug: patch.id, answer: "track", marks } as never)).toEqual({
      patch: patch.id,
      answer: "track",
      marks,
      frames: [{ i: 1, mjd: 60000.1 }, { i: 2, mjd: 60000.2 }],
    });
    expect(patchRequest(patch, field, { slug: patch.id, answer: "nothing" } as never)).toEqual({
      patch: patch.id,
      answer: "nothing",
      frames: [{ i: 1, mjd: 60000.1 }, { i: 2, mjd: 60000.2 }],
    });
  });
});
