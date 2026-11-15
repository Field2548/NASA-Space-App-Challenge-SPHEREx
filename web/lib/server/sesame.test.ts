import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as resolve } from "@/app/api/resolve/route";
import { resetRateLimit } from "@/lib/server/rateLimit";
import { clearSesameCache, parseSesameXml, resolveName } from "@/lib/server/sesame";

const FOUND = `<?xml version="1.0" encoding="UTF-8"?>
<Sesame>
<Target option="SNV"><name>M101</name>
<Resolver name="S=Simbad (CDS, via client/server)">
<INFO>from cache</INFO>
<otype>G</otype>
<jpos>14:03:12.58 +54:20:55.5</jpos>
<jradeg>210.80227</jradeg>
<jdedeg>54.34875</jdedeg>
</Resolver>
</Target>
</Sesame>`;
const NOT_FOUND = `<?xml version="1.0" encoding="UTF-8"?>
<Sesame><Target option="SNV"><name>zzzqqq</name>
<INFO>Nothing found</INFO></Target></Sesame>`;

const ok = (body: string) => new Response(body, { status: 200 });
const req = (qs: string) => new NextRequest(`http://localhost/api/resolve${qs}`);

beforeEach(() => {
  clearSesameCache();
  resetRateLimit();
});

describe("parseSesameXml", () => {
  it("reads the first jradeg and jdedeg", () => {
    expect(parseSesameXml(FOUND)).toEqual({ ra: 210.80227, dec: 54.34875 });
  });
  it("returns null when nothing was found", () => {
    expect(parseSesameXml(NOT_FOUND)).toBeNull();
  });
  it("returns null for garbage and out-of-range values", () => {
    expect(parseSesameXml("not xml at all")).toBeNull();
    expect(parseSesameXml("<jradeg>abc</jradeg><jdedeg>5</jdedeg>")).toBeNull();
    expect(parseSesameXml("<jradeg>10</jradeg>")).toBeNull();
    expect(parseSesameXml("<jradeg>10</jradeg><jdedeg>95</jdedeg>")).toBeNull();
    expect(parseSesameXml("<jradeg>400</jradeg><jdedeg>5</jdedeg>")).toBeNull();
  });
});

describe("resolveName", () => {
  it("resolves a name and encodes it in the URL", async () => {
    const urls: string[] = [];
    const f = async (u: string) => (urls.push(u), ok(FOUND));
    expect(await resolveName(" M101 ", f)).toEqual({ name: "M101", ra: 210.80227, dec: 54.34875 });
    expect(urls[0]).toBe("https://cds.unistra.fr/cgi-bin/nph-sesame/-ox/SNV?M101");
  });
  it("returns null when not found", async () => {
    expect(await resolveName("zzzqqq", async () => ok(NOT_FOUND))).toBeNull();
  });
  it("retries after a 503", async () => {
    let n = 0;
    const f = async () => (++n === 1 ? new Response("busy", { status: 503 }) : ok(FOUND));
    expect((await resolveName("M101", f))?.ra).toBe(210.80227);
    expect(n).toBe(2);
  });
  it("throws upstream_failed when Sesame never answers", async () => {
    let n = 0;
    const f = async () => {
      n++;
      throw new Error("network down");
    };
    await expect(resolveName("M101", f)).rejects.toMatchObject({
      code: "upstream_failed",
      details: { service: "cds_sesame" },
    });
    expect(n).toBe(3);
  });
  it("serves a second call from the cache", async () => {
    let n = 0;
    const f = async () => (n++, ok(FOUND));
    await resolveName("M101", f);
    const again = await resolveName("  m101 ", f);
    expect(n).toBe(1);
    expect(again?.dec).toBe(54.34875);
  });
  it("caches not-found too", async () => {
    let n = 0;
    const f = async () => (n++, ok(NOT_FOUND));
    await resolveName("zzzqqq", f);
    expect(await resolveName("zzzqqq", f)).toBeNull();
    expect(n).toBe(1);
  });
});

describe("GET /api/resolve", () => {
  it("400 when name is missing", async () => {
    const res = await resolve(req(""));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("bad_request");
  });
  it("400 when name is too long", async () => {
    const res = await resolve(req(`?name=${"a".repeat(81)}`));
    expect(res.status).toBe(400);
  });
  it("400 when name is blank", async () => {
    const res = await resolve(req("?name=%20%20"));
    expect(res.status).toBe(400);
  });
});
