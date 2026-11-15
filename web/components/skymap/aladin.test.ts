// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { findHipsUrl, releaseAladin } from "./aladin";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function fakeCanvas(opts: { lose?: () => void; throws?: boolean } = {}) {
  const c = document.createElement("canvas");
  (c as unknown as { getContext: unknown }).getContext = () => {
    if (opts.throws) throw new Error("boom");
    return { getExtension: () => ({ loseContext: opts.lose ?? (() => {}) }) };
  };
  return c;
}

describe("releaseAladin", () => {
  it("loses every WebGL context and empties the container", () => {
    const a = vi.fn();
    const b = vi.fn();
    const box = document.createElement("div");
    const inner = document.createElement("div");
    inner.append(fakeCanvas({ lose: a }));
    box.append(inner, fakeCanvas({ lose: b }));
    releaseAladin(box);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(box.childNodes.length).toBe(0);
  });
  it("never throws, even on null or a failing context", () => {
    expect(() => releaseAladin(null)).not.toThrow();
    const box = document.createElement("div");
    box.append(fakeCanvas({ throws: true }));
    expect(() => releaseAladin(box)).not.toThrow();
    expect(box.childNodes.length).toBe(0);
  });
});

describe("findHipsUrl", () => {
  it("waits about one timeout, not three, when every server hangs", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener("abort", () => rej(new Error("aborted")));
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    let result: string | null | undefined;
    const p = findHipsUrl().then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(5900);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(200);
    await p;
    expect(result).toBeNull();
  });
  it("uses a mirror that the MocServer record adds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("MocServer")) {
          return new Response(JSON.stringify([{ hips_service_url: "https://other.example/hips" }]), { status: 200 });
        }
        if (url.startsWith("https://other.example/hips")) return new Response("hips_order = 5", { status: 200 });
        return new Response("down", { status: 503 });
      }),
    );
    expect(await findHipsUrl()).toBe("https://other.example/hips");
  });
});

describe("findHipsUrl, shared check and local fallback", () => {
  const PROPS = "hips_order = 7\nhips_tile_format = png\n";
  async function fresh() {
    vi.resetModules();
    return import("./aladin");
  }

  it("answers from a known mirror without waiting for the MocServer, and checks once per page", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("MocServer")) return new Promise<Response>(() => {}); // never answers
      if (url.startsWith("https://alasky.cds")) return Promise.resolve(new Response(PROPS));
      return Promise.resolve(new Response("down", { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const m = await fresh();
    await expect(m.findHipsUrl()).resolves.toBe("https://alasky.cds.unistra.fr/SPHEREx/color");
    const calls = fetchMock.mock.calls.length;
    await expect(m.findHipsUrl(new AbortController().signal)).resolves.toBe("https://alasky.cds.unistra.fr/SPHEREx/color");
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("falls back to the site's own coarse copy when every CDS mirror is down", async () => {
    const local = `${window.location.origin}/hips/spherex-color`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("MocServer")) return new Response("[]");
        return url.startsWith(local) ? new Response(PROPS) : new Response("down", { status: 404 });
      }),
    );
    const m = await fresh();
    await expect(m.findHipsUrl()).resolves.toBe(local);
  });

  it("does not keep a failed check, so a retry looks again", async () => {
    let up = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("MocServer")) return new Response("[]");
        return up && url.startsWith("https://alasky") ? new Response(PROPS) : new Response("down", { status: 404 });
      }),
    );
    const m = await fresh();
    await expect(m.findHipsUrl()).resolves.toBeNull();
    up = true;
    await expect(m.findHipsUrl()).resolves.toMatch(/^https:\/\/alasky/);
  });
});
