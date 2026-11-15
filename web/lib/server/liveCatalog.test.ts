// Live SIMBAD and Gaia lookups, with an injected fake fetch (no network in tests).
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearLiveCache,
  type FetchLike,
  gaiaAdql,
  lookupLive,
  querySimbad,
  simbadAdql,
} from "@/lib/server/liveCatalog";

const RA = 269.4520769;
const DEC = 4.6933649;

/** A SIMBAD row: main_id, otype, sp_type, plx_value, rvz_redshift, pmra, pmdec, ra, dec. Sits 3.6 arcsec north. */
const SIMBAD_OK = {
  metadata: [],
  data: [["Fake object A", "*", "M0III", null, null, null, null, RA, DEC + 0.001]],
};
/** A Gaia row with the source_id as text (the query CASTs it). Sits on the position. */
const GAIA_OK = {
  metadata: [],
  data: [["4472832130942575872", RA, DEC, 546.975939730948, 13634.737, -801.5509783684709, 10362.394206546573, 8.1939745]],
};
const EMPTY = { metadata: [], data: [] };

type Handler = (url: string, init?: RequestInit) => Promise<Response> | Response;
const json = (body: unknown, status = 200): Handler => () =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Routes by service: SIMBAD's URL contains "simbad", everything else is Gaia. */
function fake(simbad: Handler, gaia: Handler) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return url.includes("simbad") ? simbad(url, init) : gaia(url, init);
  };
  return { fetchImpl, calls };
}

const queryOf = (init?: RequestInit) => new URLSearchParams(String(init?.body)).get("QUERY") ?? "";

beforeEach(() => clearLiveCache());

describe("lookupLive: each source's status", () => {
  it("both sources ok, with the contract's fields and the source_id kept whole", async () => {
    const { fetchImpl } = fake(json(SIMBAD_OK), json(GAIA_OK));
    const r = await lookupLive(RA, DEC, { fetchImpl, now: () => 0 });
    expect(r.simbad.status).toBe("ok");
    expect(r.simbad.rows).toEqual([
      {
        name: "Fake object A",
        otype: "*",
        sp_type: "M0III",
        z: null,
        sep_arcsec: 3.6,
        url: "https://simbad.cds.unistra.fr/simbad/sim-id?Ident=Fake%20object%20A",
      },
    ]);
    expect(r.gaia.status).toBe("ok");
    expect(r.gaia.row).toEqual({
      id: "Gaia DR3 4472832130942575872",
      g_mag: 8.1939745,
      plx: 546.975939730948,
      plx_over_err: 13634.737,
      pmra: -801.5509783684709,
      pmdec: 10362.394206546573,
      sep_arcsec: 0,
    });
  });

  it("SIMBAD HTTP 404 gives error for SIMBAD while the Gaia data still comes back", async () => {
    const { fetchImpl } = fake(() => new Response("<html>Page unavailable</html>", { status: 404 }), json(GAIA_OK));
    const r = await lookupLive(RA, DEC, { fetchImpl, now: () => 0 });
    expect(r.simbad).toEqual({ status: "error", rows: [] });
    expect(r.gaia.status).toBe("ok");
    expect(r.gaia.row?.id).toBe("Gaia DR3 4472832130942575872");
  });

  it("a Gaia fetch that never resolves gives timeout, quickly, and SIMBAD still counts", async () => {
    const { fetchImpl } = fake(json(SIMBAD_OK), () => new Promise<Response>(() => {}));
    const started = Date.now();
    const r = await lookupLive(RA, DEC, { fetchImpl, now: () => 0, timeoutMs: 50 });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(r.gaia).toEqual({ status: "timeout", row: null });
    expect(r.simbad.status).toBe("ok");
  });

  it("a fetch that honours the signal and aborts gives timeout, not error", async () => {
    const abortable: Handler = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const { fetchImpl } = fake(abortable, abortable);
    const r = await lookupLive(RA, DEC, { fetchImpl, now: () => 0, timeoutMs: 50 });
    expect(r.simbad.status).toBe("timeout");
    expect(r.gaia.status).toBe("timeout");
  });

  it("empty result sets give empty, and gaia is null", async () => {
    const { fetchImpl } = fake(json(EMPTY), json(EMPTY));
    const r = await lookupLive(RA, DEC, { fetchImpl, now: () => 0 });
    expect(r.simbad).toEqual({ status: "empty", rows: [] });
    expect(r.gaia).toEqual({ status: "empty", row: null });
  });

  it("a Gaia source_id that arrives as a bare number is refused (its digits would be lost)", async () => {
    const bare = { metadata: [], data: [[4472832130942575872, RA, DEC, 1, 1, 1, 1, 8]] };
    const { fetchImpl } = fake(json(EMPTY), json(bare));
    const r = await lookupLive(RA, DEC, { fetchImpl, now: () => 0 });
    expect(r.gaia).toEqual({ status: "error", row: null });
  });

  it("a network failure gives error for both and never throws", async () => {
    const down: Handler = () => {
      throw new TypeError("fetch failed");
    };
    const { fetchImpl } = fake(down, down);
    const r = await lookupLive(RA, DEC, { fetchImpl, now: () => 0 });
    expect(r.simbad).toEqual({ status: "error", rows: [] });
    expect(r.gaia).toEqual({ status: "error", row: null });
  });

  it("an invalid position never throws and gives error for both", async () => {
    const { fetchImpl } = fake(json(SIMBAD_OK), json(GAIA_OK));
    const r = await lookupLive(Number.NaN, DEC, { fetchImpl, now: () => 0 });
    expect(r.simbad.status).toBe("error");
    expect(r.gaia.status).toBe("error");
  });
});

describe("lookupLive: cache", () => {
  it("a second call at the same position (to 1 arcsec) makes no second fetch", async () => {
    const { fetchImpl, calls } = fake(json(SIMBAD_OK), json(GAIA_OK));
    await lookupLive(RA, DEC, { fetchImpl, now: () => 0 });
    expect(calls).toHaveLength(2);
    const again = await lookupLive(RA + 0.0000001, DEC, { fetchImpl, now: () => 1000 });
    expect(calls).toHaveLength(2);
    expect(again.gaia.row?.id).toBe("Gaia DR3 4472832130942575872");
  });

  it("a successful result is served for 10 minutes and then fetched again", async () => {
    const { fetchImpl, calls } = fake(json(SIMBAD_OK), json(GAIA_OK));
    await lookupLive(RA, DEC, { fetchImpl, now: () => 0 });
    await lookupLive(RA, DEC, { fetchImpl, now: () => 10 * 60 * 1000 - 1 });
    expect(calls).toHaveLength(2);
    await lookupLive(RA, DEC, { fetchImpl, now: () => 10 * 60 * 1000 + 1 });
    expect(calls).toHaveLength(4);
  });

  it("a result where a source failed is not served from the cache after 30 seconds", async () => {
    let simbadUp = false;
    const { fetchImpl, calls } = fake(
      () => (simbadUp ? new Response(JSON.stringify(SIMBAD_OK), { status: 200 }) : new Response("gone", { status: 404 })),
      json(GAIA_OK),
    );
    const first = await lookupLive(RA, DEC, { fetchImpl, now: () => 0 });
    expect(first.simbad.status).toBe("error");
    expect(calls).toHaveLength(2);

    // Still inside 30 s: the failure is served from the cache.
    await lookupLive(RA, DEC, { fetchImpl, now: () => 29_000 });
    expect(calls).toHaveLength(2);

    // After 30 s: CDS is back, so both sources are asked again and SIMBAD's answer is used.
    simbadUp = true;
    const later = await lookupLive(RA, DEC, { fetchImpl, now: () => 31_000 });
    expect(later.simbad.status).toBe("ok");
    expect(calls).toHaveLength(4);
  });
});

describe("lookupLive: shared in-flight lookups and per-caller separations", () => {
  it("two concurrent calls for one cache key make one pair of outbound requests", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { fetchImpl, calls } = fake(
      async () => (await gate, new Response(JSON.stringify(SIMBAD_OK), { status: 200 })),
      async () => (await gate, new Response(JSON.stringify(GAIA_OK), { status: 200 })),
    );
    const a = lookupLive(RA, DEC, { fetchImpl, now: () => 0 });
    const b = lookupLive(RA, DEC, { fetchImpl, now: () => 0 });
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(calls).toHaveLength(2);
    expect(rb).toEqual(ra);
    expect(ra.simbad.status).toBe("ok");
  });

  it("a different cache key is not held back by an in-flight one", async () => {
    const { fetchImpl, calls } = fake(json(SIMBAD_OK), json(GAIA_OK));
    await Promise.all([lookupLive(RA, DEC, { fetchImpl, now: () => 0 }), lookupLive(RA, DEC + 0.01, { fetchImpl, now: () => 0 })]);
    expect(calls).toHaveLength(4);
  });

  it("callers 0.3 arcsec apart share a key but each gets separations from their own position", async () => {
    const { fetchImpl, calls } = fake(json(SIMBAD_OK), json(GAIA_OK));
    const first = await lookupLive(RA, DEC, { fetchImpl, now: () => 0 });
    const second = await lookupLive(RA, DEC + 0.3 / 3600, { fetchImpl, now: () => 1000 });
    expect(calls).toHaveLength(2); // the second came from the cache
    expect(first.simbad.rows[0].sep_arcsec).toBe(3.6);
    expect(second.simbad.rows[0].sep_arcsec).toBe(3.3);
    expect(first.gaia.row?.sep_arcsec).toBe(0);
    expect(second.gaia.row?.sep_arcsec).toBe(0.3);
  });
});

describe("lookupLive: cache key across the RA wrap", () => {
  it("359.99999 and 0.00001 (within 1 arcsec, across 0 degrees) share one cache entry", async () => {
    const { fetchImpl, calls } = fake(json(EMPTY), json(EMPTY));
    await lookupLive(359.99999, DEC, { fetchImpl, now: () => 0 });
    expect(calls).toHaveLength(2);
    await lookupLive(0.00001, DEC, { fetchImpl, now: () => 1000 });
    expect(calls).toHaveLength(2);
  });

  it("positions 4 arcsec apart across the wrap do not share an entry", async () => {
    const { fetchImpl, calls } = fake(json(EMPTY), json(EMPTY));
    await lookupLive(359.99944, DEC, { fetchImpl, now: () => 0 });
    await lookupLive(0.00056, DEC, { fetchImpl, now: () => 0 });
    expect(calls).toHaveLength(4);
  });
});

describe("ADQL", () => {
  it("SIMBAD: basic table, 9 arcsec cone, exact text", () => {
    expect(simbadAdql(RA, DEC)).toBe(
      "SELECT TOP 10 main_id, otype, sp_type, plx_value, rvz_redshift, pmra, pmdec, ra, dec " +
        "FROM basic WHERE CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', 269.4520769000, 4.6933649000, 0.0025000000)) = 1",
    );
  });

  it("Gaia: gaiadr3.gaia_source, 6 arcsec cone, source_id as text", () => {
    const q = gaiaAdql(RA, DEC);
    expect(q).toContain("FROM gaiadr3.gaia_source");
    expect(q).toContain("CAST(source_id AS VARCHAR) AS source_id");
    expect(q).toContain("WHERE 1 = CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', 269.4520769000, 4.6933649000, 0.0016666667))");
  });

  it("the requests are POSTs with the TAP form fields, and carry those queries", async () => {
    const { fetchImpl, calls } = fake(json(EMPTY), json(EMPTY));
    await lookupLive(RA, DEC, { fetchImpl, now: () => 0 });
    const sim = calls.find((c) => c.url.includes("simbad"))!;
    const gaia = calls.find((c) => c.url.includes("gea.esac.esa.int"))!;
    expect(sim.url).toBe("https://simbad.cds.unistra.fr/simbad/sim-tap/sync");
    expect(gaia.url).toBe("https://gea.esac.esa.int/tap-server/tap/sync");
    for (const c of [sim, gaia]) {
      expect(c.init?.method).toBe("POST");
      const form = new URLSearchParams(String(c.init?.body));
      expect(form.get("REQUEST")).toBe("doQuery");
      expect(form.get("LANG")).toBe("ADQL");
      expect(form.get("FORMAT")).toBe("json");
    }
    expect(queryOf(sim.init)).toBe(simbadAdql(RA, DEC));
    expect(queryOf(gaia.init)).toBe(gaiaAdql(RA, DEC));
  });

  it("querySimbad refuses an out-of-range position before any fetch", async () => {
    let calls = 0;
    const f: FetchLike = async () => {
      calls++;
      return new Response(JSON.stringify(EMPTY));
    };
    await expect(querySimbad(400, 0, f)).rejects.toThrow();
    expect(calls).toBe(0);
  });
});
