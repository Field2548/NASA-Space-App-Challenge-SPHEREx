import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/hips/[src]/[...path]/route";
import { CACHE_NONE, CACHE_OK, edgeUrl, HIPS_SOURCES, upstreamUrl } from "./hipsProxy";

const IRSA = HIPS_SOURCES.irsa;

describe("upstreamUrl", () => {
  it("allows properties, all-sky previews and tiles with a cube slice", () => {
    expect(upstreamUrl("irsa", ["properties"])).toBe(`${IRSA}/properties`);
    expect(upstreamUrl("irsa", ["Norder3", "Allsky_3.png"])).toBe(`${IRSA}/Norder3/Allsky_3.png`);
    expect(upstreamUrl("cds", ["Norder5", "Dir0", "Npix1234.jpg"])).toBe(`${HIPS_SOURCES.cds}/Norder5/Dir0/Npix1234.jpg`);
    expect(upstreamUrl("irsa", ["Norder0", "Dir0", "Npix0_3.png"])).toBe(`${IRSA}/Norder0/Dir0/Npix0_3.png`);
  });

  it("refuses other hosts, path tricks and other files", () => {
    expect(upstreamUrl("evil", ["properties"])).toBeNull();
    expect(upstreamUrl("toString", ["properties"])).toBeNull();
    expect(upstreamUrl("irsa", ["..", "secret"])).toBeNull();
    expect(upstreamUrl("irsa", ["Norder3", "Dir0", "Npix1.fits"])).toBeNull();
    expect(upstreamUrl("irsa", ["Norder3", "Dir0", "Npix1.png?x=1"])).toBeNull();
    expect(upstreamUrl("irsa", ["index.html"])).toBeNull();
  });
});

describe("edgeUrl", () => {
  it("maps allowlisted bases to the proxy and leaves others alone", () => {
    expect(edgeUrl(IRSA, "https://site.test")).toBe("https://site.test/api/hips/irsa");
    expect(edgeUrl("https://site.test/hips/spherex-color", "https://site.test")).toBe("https://site.test/hips/spherex-color");
  });
});

describe("GET /api/hips", () => {
  afterEach(() => vi.unstubAllGlobals());
  const call = (src: string, path: string[]) =>
    GET(new Request("http://x/api/hips"), { params: Promise.resolve({ src, path }) });

  it("passes a tile through with a long CDN cache", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("PNG", { headers: { "content-type": "image/png" } })));
    const res = await call("irsa", ["Norder0", "Dir0", "Npix0_3.png"]);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(CACHE_OK);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(await res.text()).toBe("PNG");
  });

  it("never caches an upstream error or timeout", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("busy", { status: 503 })));
    const bad = await call("irsa", ["properties"]);
    expect(bad.status).toBe(502);
    expect(bad.headers.get("cache-control")).toBe(CACHE_NONE);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("timeout"))));
    const slow = await call("irsa", ["properties"]);
    expect(slow.status).toBe(504);
    expect(slow.headers.get("cache-control")).toBe(CACHE_NONE);
  });

  it("does not follow a redirect and does not fetch a refused path", async () => {
    const f = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://elsewhere.test/" } }));
    vi.stubGlobal("fetch", f);
    expect((await call("irsa", ["properties"])).status).toBe(502);
    expect(f.mock.calls[0]).toEqual([`${IRSA}/properties`, expect.objectContaining({ redirect: "manual" })]);
    f.mockClear();
    expect((await call("irsa", ["..", "x"])).status).toBe(404);
    expect(f).not.toHaveBeenCalled();
  });
});
