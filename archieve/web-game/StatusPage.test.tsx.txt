// @vitest-environment jsdom
// Test for app/status/page.tsx; it lives here because vitest only collects lib/ and components/.
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import StatusPage from "@/app/status/page";
import { formatRA } from "@/lib/coords";
import type { FieldSummary } from "@/lib/types";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const spots: FieldSummary[] = [
  { slug: "eros", title: "(433) Eros", ra: 13.2004, dec: 14.38, fov_deg: 0.2, difficulty: "easy", kind: "asteroid", thumbnail: "" },
  { slug: "cygnus", title: "Cygnus control", ra: 304.69, dec: 42.44, fov_deg: 0.2, difficulty: "control", kind: "control", thumbnail: "" },
];

function stub(check: () => Promise<Response>) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("index.json")) return new Response(JSON.stringify(spots), { status: 200 });
    expect(init?.method).toBe("GET"); // never POST: no answer is submitted
    return check();
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

describe("/status", () => {
  it("lists the data spots by sky position only, under one h1", async () => {
    stub(async () => new Response("", { status: 404 }));
    render(<StatusPage />);
    await waitFor(() => expect(screen.getByTestId("status-spots").textContent).toBe("2 data spots are ready to play."));
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(document.body.textContent).toContain(formatRA(13.2004));
    expect(document.body.textContent).not.toMatch(/Eros|Cygnus|eros|cygnus|asteroid/);
  });

  it("treats a 404 from /api/check as not live yet", async () => {
    stub(async () => new Response("", { status: 404 }));
    render(<StatusPage />);
    await waitFor(() => expect(screen.getByTestId("status-check").textContent).toMatch(/^Not live yet/));
  });

  it("treats a network error as not live yet", async () => {
    stub(async () => {
      throw new TypeError("offline");
    });
    render(<StatusPage />);
    await waitFor(() => expect(screen.getByTestId("status-check").textContent).toMatch(/^Not live yet/));
  });

  it("treats any other reply (405 for a GET) as live", async () => {
    stub(async () => new Response("", { status: 405 }));
    render(<StatusPage />);
    await waitFor(() => expect(screen.getByTestId("status-check").textContent).toMatch(/^Live/));
  });
});
