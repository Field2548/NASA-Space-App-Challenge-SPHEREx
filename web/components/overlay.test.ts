import { describe, expect, it, vi } from "vitest";
import { asteroidsInFrame, fetchOverlay, parseOverlay } from "./overlay";

const body = {
  asteroids: [{ name: "A", positions: [{ frame: 1, x: 1, y: 2, vmag: 20 }, { frame: 2, x: 3, y: 4 }, { frame: "x", x: 0, y: 0 }] }, { name: 5 }],
  stars: [{ name: "S", source: "gaia", x: 9, y: 8 }, { x: "no", y: 1 }],
};

describe("overlay client", () => {
  it("parses defensively", () => {
    const o = parseOverlay(body);
    expect(o?.asteroids).toEqual([{ name: "A", positions: [{ frame: 1, x: 1, y: 2, vmag: 20 }, { frame: 2, x: 3, y: 4 }] }]);
    expect(o?.stars).toEqual([{ name: "S", source: "gaia", x: 9, y: 8 }]);
    expect(parseOverlay("nope")).toBeNull();
    expect(parseOverlay({})).toEqual({ asteroids: [], stars: [] });
    expect(asteroidsInFrame(o!, 2)).toEqual([{ name: "A", x: 3, y: 4 }]);
  });

  it("GETs the explore overlay and returns null on 404, network error or bad JSON", async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    expect((await fetchOverlay("eros", "explore", ok as unknown as typeof fetch))?.asteroids.length).toBe(1);
    expect(ok).toHaveBeenCalledWith("/api/overlay?spot=eros&mode=explore");
    expect(await fetchOverlay("x", "round", (async () => new Response("", { status: 404 })) as typeof fetch)).toBeNull();
    expect(await fetchOverlay("x", "round", (async () => { throw new Error("down"); }) as typeof fetch)).toBeNull();
    expect(await fetchOverlay("x", "round", (async () => new Response("<html>", { status: 200 })) as typeof fetch)).toBeNull();
  });
});
