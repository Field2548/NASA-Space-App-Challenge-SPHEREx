// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import WorldProgress from "./WorldProgress";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const stub = (res: () => Response | Promise<Response>) => {
  const f = vi.fn(async () => res());
  vi.stubGlobal("fetch", f);
  return f;
};

describe("WorldProgress", () => {
  it("shows checked boxes out of 3,072 once, with a progressbar", async () => {
    const f = stub(() => new Response(JSON.stringify({ source: "db", cells: [[1, 2], [5, 1], [9, 4]] }), { status: 200 }));
    render(<WorldProgress />);
    expect(await screen.findByText(/3 \/ 3,072 sky boxes checked/)).toBeTruthy();
    expect(screen.getByTestId("world-pct").textContent).toBe("0.1%");
    const bar = screen.getByRole("progressbar", { name: "World progress" });
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("3072");
    expect(bar.getAttribute("aria-valuenow")).toBe("3");
    expect(f).toHaveBeenCalledTimes(1);
    expect(String((f.mock.calls as unknown as string[][])[0][0])).toBe("/api/density?layer=checked&order=4&who=all");
  });

  it("source none shows offline with an empty bar", async () => {
    stub(() => new Response(JSON.stringify({ source: "none", cells: [] }), { status: 200 }));
    render(<WorldProgress />);
    expect(await screen.findByText(/World progress offline/)).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
  });

  it("a failed fetch shows offline", async () => {
    stub(() => new Response("x", { status: 500 }));
    render(<WorldProgress />);
    expect(await screen.findByText(/World progress offline/)).toBeTruthy();
  });

  it("renders its label in server HTML", () => {
    expect(renderToString(<WorldProgress />)).toContain("WORLD PROGRESS");
  });
});
