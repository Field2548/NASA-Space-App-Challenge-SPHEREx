// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FieldSummary } from "@/lib/types";
import MapScreen from "./MapScreen";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
// The CDS HiPS answers 404 (SERVER, issue #12): findHipsUrl finds no mirror.
vi.mock("./skymap/aladin", async (importActual) => ({
  ...(await importActual<typeof import("./skymap/aladin")>()),
  loadAladin: vi.fn(async () => ({})),
  findHipsUrl: vi.fn(async () => null),
}));

const spot: FieldSummary = { slug: "rock1", title: "Field One", ra: 10, dec: 5, fov_deg: 0.1, difficulty: "easy", kind: "asteroid", thumbnail: "" };

beforeEach(() => {
  nav.push.mockReset();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      String(url).endsWith("/fields/index.json") ? new Response(JSON.stringify([spot]), { status: 200 }) : new Response("nope", { status: 404 }),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MapScreen", () => {
  it("has one h1 and, with the HiPS down, lists ready spots that open /play?spot=<slug>", async () => {
    render(<MapScreen />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "← Back" })).toBeTruthy(); // same Back control as the other pages
    expect(screen.queryByText("Back to the start")).toBeNull();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/not answering/);
    fireEvent.click(await screen.findByRole("button", { name: /Play Field One/ }));
    expect(nav.push).toHaveBeenCalledWith("/play?spot=rock1");
  });
});
