// Live catalogue lookups for a sky position outside every ready spot. Server only.
// Contract: docs/contracts/api.md section 6. Build prompt: 8.16 (radii, 8 s timeout, 1 arcsec cache)
// and section 7 (endpoints and tables). Only SIMBAD and Gaia are live here. JPL needs an observation
// time, which this lookup does not have, so it is never asked from here (api.md section 6).
//
// Never throws: each source ends as ok, empty, timeout or error, and partial results are fine.

import { angularSeparationDeg } from "@/components/skymap/geometry";

export const SIMBAD_TAP_URL = "https://simbad.cds.unistra.fr/simbad/sim-tap/sync";
export const GAIA_TAP_URL = "https://gea.esac.esa.int/tap-server/tap/sync";
/** Radii from BUILD_PROMPT 8.16 (api.md section 6). */
export const SIMBAD_RADIUS_ARCSEC = 9;
export const GAIA_RADIUS_ARCSEC = 6;
export const LIVE_TIMEOUT_MS = 8000;
const CACHE_OK_MS = 10 * 60 * 1000;
const CACHE_FAILED_MS = 30 * 1000;
const CACHE_MAX = 500;

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export type LiveSourceStatus = "ok" | "empty" | "timeout" | "error";

export type SimbadRow = {
  name: string;
  otype: string | null;
  sp_type: string | null;
  z: number | null;
  sep_arcsec: number;
  url: string;
};

export type GaiaRow = {
  id: string;
  g_mag: number | null;
  plx: number | null;
  plx_over_err: number | null;
  pmra: number | null;
  pmdec: number | null;
  sep_arcsec: number;
};

export type LiveLookup = {
  simbad: { status: LiveSourceStatus; rows: SimbadRow[] };
  gaia: { status: LiveSourceStatus; row: GaiaRow | null };
};

/** Injectable for tests: the fetch, the clock for the cache, and the per-service timeout. */
export type LiveDeps = { fetchImpl?: FetchLike; now?: () => number; timeoutMs?: number };

// ------------------------------------------------------------------ ADQL

/** A number that goes into ADQL must be finite and in range. Nothing else is ever put in a query. */
function adqlNumber(v: number, lo: number, hi: number, what: string): string {
  if (!Number.isFinite(v) || v < lo || v > hi) throw new RangeError(`${what} is out of range`);
  return v.toFixed(10);
}

function coneArgs(ra: number, dec: number): string {
  return `CIRCLE('ICRS', ${adqlNumber(ra, 0, 360, "ra")}, ${adqlNumber(dec, -90, 90, "dec")}, `;
}

export function simbadAdql(ra: number, dec: number): string {
  const r = (SIMBAD_RADIUS_ARCSEC / 3600).toFixed(10);
  return (
    "SELECT TOP 10 main_id, otype, sp_type, plx_value, rvz_redshift, pmra, pmdec, ra, dec " +
    "FROM basic WHERE CONTAINS(POINT('ICRS', ra, dec), " +
    `${coneArgs(ra, dec)}${r})) = 1`
  );
}

export function gaiaAdql(ra: number, dec: number): string {
  const r = (GAIA_RADIUS_ARCSEC / 3600).toFixed(10);
  // CAST keeps the 64-bit source_id as text: JSON numbers would lose its last digits.
  return (
    "SELECT TOP 5 CAST(source_id AS VARCHAR) AS source_id, ra, dec, parallax, parallax_over_error, " +
    "pmra, pmdec, phot_g_mean_mag FROM gaiadr3.gaia_source " +
    `WHERE 1 = CONTAINS(POINT('ICRS', ra, dec), ${coneArgs(ra, dec)}${r}))`
  );
}

// ------------------------------------------------------------------ TAP call

/** POST a synchronous ADQL query and return the data rows of its JSON answer. Throws on any failure. */
async function tapRows(url: string, adql: string, fetchImpl: FetchLike, signal: AbortSignal): Promise<unknown[][]> {
  const body = new URLSearchParams({ REQUEST: "doQuery", LANG: "ADQL", FORMAT: "json", QUERY: adql });
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal,
  });
  if (!res.ok) throw new Error(`TAP answered HTTP ${res.status}`);
  const json = JSON.parse(await res.text()) as { data?: unknown };
  if (!Array.isArray(json.data) || !json.data.every((r) => Array.isArray(r))) {
    throw new Error("TAP answer has no data rows");
  }
  return json.data as unknown[][];
}

const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/** A SIMBAD row as the service gave it: with its own coordinates and no separation yet. */
type SimbadFound = Omit<SimbadRow, "sep_arcsec"> & { ra: number; dec: number };
/** A Gaia row as the service gave it: with its own coordinates and no separation yet. */
type GaiaFound = Omit<GaiaRow, "sep_arcsec"> & { ra: number; dec: number };

/** SIMBAD objects of the cone, with their coordinates. Throws when SIMBAD does not answer. */
async function fetchSimbad(ra: number, dec: number, fetchImpl: FetchLike, signal?: AbortSignal): Promise<SimbadFound[]> {
  const rows = await tapRows(SIMBAD_TAP_URL, simbadAdql(ra, dec), fetchImpl, signal ?? AbortSignal.timeout(LIVE_TIMEOUT_MS));
  const out: SimbadFound[] = [];
  for (const r of rows) {
    const [mainId, otype, spType, , rvz, , , rowRa, rowDec] = r;
    const name = strOrNull(mainId);
    const rRa = numOrNull(rowRa);
    const rDec = numOrNull(rowDec);
    if (!name || rRa === null || rDec === null) continue;
    out.push({
      name,
      otype: strOrNull(otype),
      sp_type: strOrNull(spType),
      z: numOrNull(rvz),
      ra: rRa,
      dec: rDec,
      url: `https://simbad.cds.unistra.fr/simbad/sim-id?Ident=${encodeURIComponent(name)}`,
    });
  }
  return out;
}

/** The rows with their separation from THIS caller's position, nearest first. */
function simbadFor(found: SimbadFound[], ra: number, dec: number): SimbadRow[] {
  return found
    .map(({ ra: rRa, dec: rDec, ...row }) => ({
      ...row,
      sep_arcsec: round(angularSeparationDeg(ra, dec, rRa, rDec) * 3600, 2),
    }))
    .sort((a, b) => a.sep_arcsec - b.sep_arcsec);
}

/** SIMBAD objects within 9 arcsec, nearest first. Throws when SIMBAD does not answer. */
export async function querySimbad(
  ra: number,
  dec: number,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<SimbadRow[]> {
  return simbadFor(await fetchSimbad(ra, dec, fetchImpl, signal), ra, dec);
}

/**
 * Gaia DR3 sources of the cone, with their coordinates. Throws when Gaia does not answer.
 * source_id arrives as a text string (the query CASTs it); a bare JSON number is refused, because
 * JSON.parse would already have dropped its last digits.
 */
async function fetchGaia(ra: number, dec: number, fetchImpl: FetchLike, signal?: AbortSignal): Promise<GaiaFound[]> {
  const rows = await tapRows(GAIA_TAP_URL, gaiaAdql(ra, dec), fetchImpl, signal ?? AbortSignal.timeout(LIVE_TIMEOUT_MS));
  const out: GaiaFound[] = [];
  for (const r of rows) {
    const [sourceId, rowRa, rowDec, plx, plxErr, pmra, pmdec, g] = r;
    if (typeof sourceId !== "string" || !/^\d+$/.test(sourceId)) throw new Error("Gaia source_id is not text");
    const rRa = numOrNull(rowRa);
    const rDec = numOrNull(rowDec);
    if (rRa === null || rDec === null) continue;
    out.push({
      id: `Gaia DR3 ${sourceId}`,
      g_mag: numOrNull(g),
      plx: numOrNull(plx),
      plx_over_err: numOrNull(plxErr),
      pmra: numOrNull(pmra),
      pmdec: numOrNull(pmdec),
      ra: rRa,
      dec: rDec,
    });
  }
  return out;
}

/** The nearest source within 6 arcsec of THIS caller's position, or null. */
function gaiaFor(found: GaiaFound[], ra: number, dec: number): GaiaRow | null {
  let best: GaiaRow | null = null;
  for (const { ra: rRa, dec: rDec, ...row } of found) {
    const sep = angularSeparationDeg(ra, dec, rRa, rDec) * 3600;
    if (sep > GAIA_RADIUS_ARCSEC) continue;
    if (best && sep >= best.sep_arcsec) continue;
    best = { ...row, sep_arcsec: round(sep, 2) };
  }
  return best;
}

/** The nearest Gaia DR3 source within 6 arcsec, or null. Throws when Gaia does not answer. */
export async function queryGaia(
  ra: number,
  dec: number,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<GaiaRow | null> {
  return gaiaFor(await fetchGaia(ra, dec, fetchImpl, signal), ra, dec);
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

// ------------------------------------------------------------------ timeout

type Failed = { status: "timeout" | "error" };
type Settled<T> = { status: "ok"; value: T } | Failed;

/**
 * Run one source with an 8 s limit. AbortSignal.timeout cancels a fetch that honours it; the race
 * also ends the wait for a fetch that ignores the signal.
 */
async function settle<T>(ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<Settled<T>> {
  const signal = AbortSignal.timeout(ms);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Failed>((resolve) => {
    timer = setTimeout(() => resolve({ status: "timeout" }), ms);
  });
  const run = work(signal).then(
    (value): Settled<T> => ({ status: "ok", value }),
    (): Failed => ({ status: signal.aborted ? "timeout" : "error" }),
  );
  try {
    return await Promise.race([run, late]);
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------ cache

/**
 * What a lookup keeps: the rows with their OWN coordinates, not separations. Two callers 0.3 arcsec
 * apart share a cache key, and each gets separations measured from their own position.
 */
type Found = {
  simbad: { status: LiveSourceStatus; rows: SimbadFound[] };
  gaia: { status: LiveSourceStatus; rows: GaiaFound[] };
};
type CacheEntry = { at: number; ttl: number; value: Found };
const cache = new Map<string, CacheEntry>();
/** Lookups on their way, by cache key: a second caller for the same key waits for the first. */
const inFlight = new Map<string, Promise<Found>>();

/**
 * Positions rounded to 1 arcsec (1/3600 deg). RA is wrapped into [0, 360) after rounding, so
 * 359.99999 and 0.00001 (within 1 arcsec of each other across the 0 degree line) share a key.
 */
function cacheKey(ra: number, dec: number): string {
  const full = 360 * 3600;
  const raArcsec = ((Math.round(ra * 3600) % full) + full) % full;
  return `${raArcsec}:${Math.round(dec * 3600)}`;
}

function cacheGet(key: string, now: number): Found | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (now - hit.at < hit.ttl) return hit.value;
  cache.delete(key);
  return null;
}

function cacheSet(key: string, now: number, value: Found): void {
  const failed = value.simbad.status === "timeout" || value.simbad.status === "error" ||
    value.gaia.status === "timeout" || value.gaia.status === "error";
  cache.delete(key);
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: now, ttl: failed ? CACHE_FAILED_MS : CACHE_OK_MS, value });
}

/** For tests. */
export function clearLiveCache(): void {
  cache.clear();
  inFlight.clear();
}

// ------------------------------------------------------------------ the lookup

/** The statuses and rows for one caller's own position. */
function present(found: Found, ra: number, dec: number): LiveLookup {
  const simbadRows = found.simbad.status === "ok" ? simbadFor(found.simbad.rows, ra, dec) : [];
  const gaiaRow = found.gaia.status === "ok" ? gaiaFor(found.gaia.rows, ra, dec) : null;
  return {
    simbad: {
      status: found.simbad.status === "ok" ? (simbadRows.length ? "ok" : "empty") : found.simbad.status,
      rows: simbadRows,
    },
    gaia: {
      status: found.gaia.status === "ok" ? (gaiaRow ? "ok" : "empty") : found.gaia.status,
      row: gaiaRow,
    },
  };
}

async function fetchBoth(ra: number, dec: number, deps: LiveDeps): Promise<Found> {
  const fetchImpl: FetchLike = deps.fetchImpl ?? ((url, init) => fetch(url, init));
  const timeoutMs = deps.timeoutMs ?? LIVE_TIMEOUT_MS;
  const [simbad, gaia] = await Promise.all([
    settle(timeoutMs, (signal) => fetchSimbad(ra, dec, fetchImpl, signal)),
    settle(timeoutMs, (signal) => fetchGaia(ra, dec, fetchImpl, signal)),
  ]);
  return {
    simbad: simbad.status === "ok" ? { status: "ok", rows: simbad.value } : { status: simbad.status, rows: [] },
    gaia: gaia.status === "ok" ? { status: "ok", rows: gaia.value } : { status: gaia.status, rows: [] },
  };
}

/**
 * SIMBAD and Gaia in parallel, each with its own timeout. Cached by position (1 arcsec): 10 minutes,
 * or 30 seconds when a source failed. Callers that arrive while a lookup for the same key is on its
 * way share it (one pair of outbound requests). Separations are measured from each caller's own
 * position. Never throws.
 */
export async function lookupLive(ra: number, dec: number, deps: LiveDeps = {}): Promise<LiveLookup> {
  const now = deps.now ?? Date.now;
  const key = cacheKey(ra, dec);
  const hit = cacheGet(key, now());
  if (hit) return present(hit, ra, dec);

  let pending = inFlight.get(key);
  if (!pending) {
    pending = fetchBoth(ra, dec, deps)
      .then((value) => {
        cacheSet(key, now(), value);
        return value;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return present(await pending, ra, dec);
}
