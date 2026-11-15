// /api/quicklook/list logic: VOTable parsing (shape copied from a real IRSA SIA answer of
// 2026-11-14), S3 URLs from cloud_access, footprint test, retries, cache, error shape. No network.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as listRoute } from "@/app/api/quicklook/list/route";
import { ApiFail } from "@/lib/server/http";
import { resetRateLimit } from "@/lib/server/rateLimit";
import {
  buildList,
  clearQuickLookListCache,
  coversField,
  listQuickLook,
  parseVoTable,
  s3UrlFromCloudAccess,
  siaQueryUrl,
} from "./quicklookList";

const FIELDS = ["s_ra", "energy_bandpassname", "obs_id", "access_url", "access_estsize", "s_region", "obs_collection", "s_xel1", "s_xel2", "t_min", "t_max", "cloud_access"];
const REGION = "POLYGON ICRS 14.62223599347911 13.142692929022587 11.33782095123302 11.835648761156765 9.938729681713909 15.043322126159646 13.288964655697093 16.379522221333726 14.62223599347911 13.142692929022587";
const cloud = (key: string, bucket = "nasa-irsa-spherex") =>
  `{&quot;aws&quot;: {&quot;bucket_name&quot;: &quot;${bucket}&quot;, &quot;key&quot;:&quot;${key}&quot;, &quot;region&quot;: &quot;us-east-1&quot;}}`;

function row(obs: string, det: number, coll: string, tmin: number, withCloud = true): string {
  const key = `qr3/level2/x/${obs}D${det}.fits`;
  const cells = [
    "12.3", `SPHEREx-D${det}`, obs, `https://irsa.ipac.caltech.edu/ibe/data/spherex/${key}`, "65071", REGION, coll, "2040", "2040",
    String(tmin), String(tmin + 0.00133),
  ];
  const tds = cells.map((c) => `<TD>${c}</TD>`).join("\n");
  return `<TR>\n${tds}\n${withCloud ? `<TD>${cloud(key)}</TD>` : "<TD/>"}\n</TR>`;
}

function votable(rows: string[], status = "OK"): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<VOTABLE version="1.3">
  <RESOURCE type="meta" utype="adhoc:this">
    <GROUP name="inputParams"><PARAM name="COLLECTION" datatype="char" arraysize="*" value=""/></GROUP>
  </RESOURCE>
  <RESOURCE type="results">
    <INFO name="QUERY_STATUS" value="${status}"/>
    <TABLE>
${FIELDS.map((f, k) => `      <FIELD name="${f}" datatype="char" arraysize="*" ID="col_${k}"/>`).join("\n")}
      <DATA><TABLEDATA>
${rows.join("\n")}
      </TABLEDATA></DATA>
    </TABLE>
  </RESOURCE>
</VOTABLE>`;
}

const ERROR_VOTABLE = `<?xml version="1.0" encoding="utf-8"?>
<VOTABLE version="1.3"><RESOURCE type="results">
<INFO name="QUERY_STATUS" value="ERROR">TransientFault: INTERNAL_SERVER_ERROR: INTERNAL ERROR</INFO>
</RESOURCE></VOTABLE>`;

const GOOD = votable([
  row("2026W32_1A_0829_1", 2, "spherex_qr3", 61258.489678),
  row("2026W32_1A_0829_1", 2, "spherex_dr1", 61258.489678), // same exposure in DR1: wins
  row("2026W32_1A_0829_1", 5, "spherex_qr3", 61258.489678),
  row("2026W32_1A_0829_2", 2, "spherex_qr3", 61258.4912),
  row("2026W33_1A_0001_1", 3, "spherex_qr3", 61259.0, false), // no cloud_access
]);

const ok = (body: string) => new Response(body, { status: 200 });
const noSleep = async () => {};

beforeEach(() => {
  clearQuickLookListCache();
  resetRateLimit();
});

describe("parseVoTable + buildList", () => {
  it("reads fields, cells, entities and empty cells", () => {
    const t = parseVoTable(GOOD);
    expect(t.status).toBe("OK");
    expect(t.fields).toEqual(FIELDS);
    expect(t.rows.length).toBe(5);
    expect(t.rows[0][11]).toContain('"bucket_name": "nasa-irsa-spherex"');
    expect(t.rows[4][11]).toBe("");
  });

  it("dedupes, groups into bursts, and gives S3 URLs (IRSA only as provenance)", () => {
    const l = buildList(parseVoTable(GOOD), 13.2004, 14.38, "2026-11-15T00:00:00");
    expect(l.exposures.length).toBe(4);
    expect(l.bursts.map((b) => b.exposures)).toEqual([[0, 1, 2], [3]]);
    const e = l.exposures[0];
    expect(e.collection).toBe("spherex_dr1");
    expect(e.url).toBe("https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/qr3/level2/x/2026W32_1A_0829_1D2.fits");
    expect(e.access_url).toMatch(/^https:\/\/irsa\.ipac\.caltech\.edu\//);
    expect(e.source).toBe("s3");
    expect(e.est_size_bytes).toBe(65071000);
    expect(e.naxis1).toBe(2040);
    expect(e.covers_field).toBe(true);
    expect(e.utc).toBe("2026-08-06T11:45:08");
    const noS3 = l.exposures[3];
    expect(noS3.url).toBeNull();
    expect(noS3.source).toBe("irsa");
    expect(l.bursts[0].detectors).toEqual([2, 5]);
  });

  it("only trusts the SPHEREx bucket", () => {
    expect(s3UrlFromCloudAccess('{"aws": {"bucket_name": "evil", "key": "a.fits"}}')).toBeNull();
    expect(s3UrlFromCloudAccess('{"aws": {"bucket_name": "nasa-irsa-spherex", "key": "../a"}}')).toBeNull();
    expect(s3UrlFromCloudAccess("not json")).toBeNull();
  });

  it("coversField: inside, near an edge, unreadable", () => {
    expect(coversField(REGION, 12.3, 14.1, 0.05)).toBe(true);
    expect(coversField(REGION, 14.6, 13.15, 0.05)).toBe(false);
    expect(coversField("nothing", 0, 0, 0.1)).toBeNull();
  });

  it("asks IRSA for both collections in VOTable", () => {
    expect(siaQueryUrl(13.2004, 14.38)).toBe(
      "https://irsa.ipac.caltech.edu/SIA?COLLECTION=spherex_dr1&COLLECTION=spherex_qr3&POS=circle+13.2004+14.38+0.000277778&RESPONSEFORMAT=votable",
    );
  });
});

describe("listQuickLook: retries, cache, errors", () => {
  it("retries a 502 and an IRSA TransientFault, then caches the answer for a day", async () => {
    const answers = [new Response("bad gateway", { status: 502 }), ok(ERROR_VOTABLE), ok(GOOD)];
    let calls = 0;
    const f = async () => answers[calls++];
    const l = await listQuickLook(13.2004, 14.38, { fetch: f, sleep: noSleep });
    expect(calls).toBe(3);
    expect(l.exposures.length).toBe(4);
    await listQuickLook(13.2004, 14.38, { fetch: f, sleep: noSleep });
    expect(calls).toBe(3);
  });

  it("gives up after about 45 s with upstream_failed / irsa_sia", async () => {
    let t = 0;
    const waits: number[] = [];
    const deps = {
      fetch: async () => new Response("busy", { status: 503 }),
      sleep: async (ms: number) => {
        waits.push(ms);
        t += ms;
      },
      now: () => t,
    };
    const err = await listQuickLook(1, 2, deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiFail);
    expect((err as ApiFail).code).toBe("upstream_failed");
    expect((err as ApiFail).details?.service).toBe("irsa_sia");
    expect(t).toBeLessThanOrEqual(45_000);
    expect(waits.slice(0, 3)).toEqual([2000, 4000, 8000]);
  });

  it("does not retry a 400", async () => {
    let calls = 0;
    const err = await listQuickLook(1, 2, { fetch: async () => (calls++, new Response("no", { status: 400 })), sleep: noSleep }).catch((e: unknown) => e);
    expect(calls).toBe(1);
    expect((err as ApiFail).code).toBe("upstream_failed");
  });
});

describe("GET /api/quicklook/list validation", () => {
  it("answers 400 in the contract's shape for a bad position", async () => {
    const res = await listRoute(new NextRequest("http://localhost/api/quicklook/list?ra=400&dec=0"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; details: { issues: unknown[] } } };
    expect(body.error.code).toBe("bad_request");
    expect(body.error.details.issues.length).toBeGreaterThan(0);
    const missing = await listRoute(new NextRequest("http://localhost/api/quicklook/list?ra=&dec=1"));
    expect(missing.status).toBe(400);
  });
});
