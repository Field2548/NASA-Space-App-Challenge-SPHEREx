// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EmbedViewer, { playHref } from "./EmbedViewer";
import { makeField, mockCanvas } from "./testFixtures";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => mockCanvas());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubFetch() {
  const field = makeField({ slug: "fixture" }, 3, 4, 2);
  const bytes = new Uint16Array(3 * 4 * 2).fill(1000).buffer;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => (url.endsWith("field.json") ? new Response(JSON.stringify(field), { status: 200 }) : new Response(bytes, { status: 200 }))),
  );
}

describe("EmbedViewer", () => {
  it("builds the /play link with the same view params", () => {
    expect(playHref("fixture", { spot: "fixture", frames: "0-2", vision: "mono", spacing: "real", junk: "x" })).toBe(
      "/play?spot=fixture&frames=0-2&spacing=real&vision=mono",
    );
  });

  it("shows only the viewer, play and next, one h1, and the open link", async () => {
    stubFetch();
    render(<EmbedViewer spot="fixture" params={{ spot: "fixture", frames: "0-2" }} />);
    expect(await screen.findByTestId("field-canvas")).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Play blink" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next frame" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /submit/i })).toBeNull();
    expect(screen.queryByText(/log in/i)).toBeNull();
    expect(screen.queryByTestId("verdict")).toBeNull();
    expect(screen.getByRole("link", { name: "Open in Onion Sky" }).getAttribute("href")).toBe("/play?spot=fixture&frames=0-2");
  });

  it("has one h1 and a hint with no spot, and on a load error", async () => {
    render(<EmbedViewer params={{}} />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toMatch(/No spot/);
    cleanup();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 404 })));
    render(<EmbedViewer spot="nope" params={{}} />);
    expect(await screen.findByText("Could not load this spot.")).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});
