import { afterEach, describe, expect, it, vi } from "vitest";

const PROPS = "hips_order = 7\nhips_tile_format = png\n";

async function fresh() {
  vi.resetModules();
  return import("./aladin");
}

afterEach(() => vi.unstubAllGlobals());

describe("findHipsUrl", () => {
  it("answers from a known mirror without waiting for the MocServer, and checks once per page", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("MocServer")) return new Promise<Response>(() => {}); // never answers
      if (url.startsWith("https://alasky.cds")) return Promise.resolve(new Response(PROPS));
      return Promise.resolve(new Response("down", { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const { findHipsUrl } = await fresh();
    await expect(findHipsUrl()).resolves.toBe("https://alasky.cds.unistra.fr/SPHEREx/color");
    const calls = fetchMock.mock.calls.length;
    await expect(findHipsUrl(new AbortController().signal)).resolves.toBe("https://alasky.cds.unistra.fr/SPHEREx/color");
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("falls back to the site's own coarse copy when every CDS mirror is down", async () => {
    vi.stubGlobal("window", { location: { origin: "http://site.test" } });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("MocServer")) return new Response("[]");
      return url.startsWith("http://site.test/hips/") ? new Response(PROPS) : new Response("down", { status: 404 });
    }));
    const { findHipsUrl } = await fresh();
    await expect(findHipsUrl()).resolves.toBe("http://site.test/hips/spherex-color");
  });

  it("does not keep a failed check, so a retry looks again", async () => {
    let up = false;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("MocServer")) return new Response("[]");
      return up ? new Response(PROPS) : new Response("down", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { findHipsUrl } = await fresh();
    await expect(findHipsUrl()).resolves.toBeNull();
    up = true;
    await expect(findHipsUrl()).resolves.toMatch(/^https:\/\/alasky/);
  });
});
