// JPL Small-Body Identification API client (owner: SERVER). Server only.
// Docs: https://ssd-api.jpl.nasa.gov/doc/sb_ident.html (read 2026-11-15).
//
// Observer: the Earth's centre as a zero geocentric state vector, `xobs=0,0,0,0,0,0`. The API
// refuses MPC code 500 ("never 500 'geocentric'", the docs say), and pipeline/catalog_facts.py does
// the same. SPHEREx flies about 650 km up (at most ~7000 km from the Earth's centre): for a
// main-belt asteroid at 1 au or more that parallax is under 2 arcsec, under a third of a 6.15 arcsec
// pixel, so the 2 px match radius absorbs it. Only a very close near-Earth object would be off.
//
// Two-pass mode (numerical propagation) is used: the first pass is a two-body guess with errors of
// hundreds of arcsec and RA in whole seconds of time, useless at 2 px. Measured 2026-11-15: one
// two-pass call over a 0.12 deg box took 35 s, later 84 and 108 s, so callers run one call per frame in
// parallel under one deadline. Same never-throw pattern as liveCatalog.ts: a failure is a status.

export const SB_IDENT_URL = "https://ssd-api.jpl.nasa.gov/sb_ident.api";
/** Per-call timeout. Calls took 84 and 108 s on 2026-11-15; the route's maxDuration is 180 s. */
export const SB_IDENT_TIMEOUT_MS = 150_000;
const OK_TTL_MS = 60 * 60_000; // orbits do not change within an hour

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export type SbStatus = "ok" | "empty" | "timeout" | "error";
export interface SbObject {
  name: string;
  ra: number;
  dec: number;
  vmag: number | null;
}
export interface SbResult {
  status: SbStatus;
  objects: SbObject[];
}
export interface SbDeps {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  now?: () => number;
}

/** Degrees -> the API's `hh-mm-ss.ss` / `dd-mm-ss.ss`, `M` for minus (as catalog_facts._sexa). */
export function sexa(deg: number, hours = false): string {
  const hund = Math.round((Math.abs(deg) / (hours ? 15 : 1)) * 360000);
  const a = Math.floor(hund / 360000);
  const rest = hund - a * 360000;
  const b = Math.floor(rest / 6000);
  const c = (rest - b * 6000) / 100;
  const p2 = (v: number) => String(v).padStart(2, "0");
  return `${deg < 0 ? "M" : ""}${p2(a)}-${p2(b)}-${c.toFixed(2).padStart(5, "0")}`;
}

/** `00:52:37.70` (hours) or `+14 20'46.8"` / `-05 01'02"` (degrees) -> degrees. NaN if unreadable. */
export function parseSexa(text: string, hours = false): number {
  const parts = (text.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  if (parts.length < 3 || parts.some((v) => !Number.isFinite(v))) return NaN;
  const v = (parts[0] + parts[1] / 60 + parts[2] / 3600) * (hours ? 15 : 1);
  return text.trim().startsWith("-") ? -v : v;
}

/** MJD -> `YYYY-MM-DD_HH:MM:SS` UTC, the API's obs-time. */
export function obsTime(mjd: number): string {
  return new Date(Math.round((mjd - 40587) * 86400000)).toISOString().slice(0, 19).replace("T", "_");
}

/** The request URL for a square box of half-width `halfDeg` (on the sky) around (ra, dec) at `mjd`. */
export function sbIdentUrl(ra: number, dec: number, halfDeg: number, mjd: number): string {
  // The RA half-width is in RA degrees: widen it by 1/cos(dec) so the box covers the field on the sky.
  const raHalf = Math.min(10, halfDeg / Math.max(0.05, Math.cos((dec * Math.PI) / 180)));
  const q = new URLSearchParams({
    xobs: "0,0,0,0,0,0",
    "obs-time": obsTime(mjd),
    "fov-ra-center": sexa(ra, true),
    "fov-dec-center": sexa(dec),
    "fov-ra-hwidth": raHalf.toFixed(4),
    "fov-dec-hwidth": halfDeg.toFixed(4),
    "two-pass": "true",
    "suppress-first-pass": "true",
    "mag-required": "false",
    "req-elem": "false",
  });
  return `${SB_IDENT_URL}?${q.toString()}`;
}

/** Rows of a two-pass answer. Throws on a shape it cannot read. "no matching records" gives []. */
export function parseSbIdent(body: unknown): SbObject[] {
  if (typeof body !== "object" || body === null) throw new Error("not an object");
  const b = body as { fields_second?: unknown; data_second_pass?: unknown; signature?: unknown };
  if (b.data_second_pass === undefined) {
    if (b.signature === undefined) throw new Error("not an sb_ident answer");
    return []; // the API answers {"warning": "no matching records"} with no data block
  }
  if (!Array.isArray(b.fields_second) || !Array.isArray(b.data_second_pass)) throw new Error("bad tables");
  const cols = b.fields_second.map(String);
  const at = (prefix: string) => cols.findIndex((c) => c.startsWith(prefix));
  const iName = at("Object name");
  const iRa = at("Astrometric RA");
  const iDec = at("Astrometric Dec");
  const iMag = at("Visual magnitude");
  if (iName < 0 || iRa < 0 || iDec < 0) throw new Error("missing columns");
  const out: SbObject[] = [];
  for (const row of b.data_second_pass) {
    if (!Array.isArray(row)) continue;
    const ra = parseSexa(String(row[iRa] ?? ""), true);
    const dec = parseSexa(String(row[iDec] ?? ""));
    if (!Number.isFinite(ra) || !Number.isFinite(dec)) continue;
    const mag = iMag >= 0 ? Number.parseFloat(String(row[iMag])) : NaN;
    out.push({ name: String(row[iName]).trim(), ra, dec, vmag: Number.isFinite(mag) ? mag : null });
  }
  return out;
}

const cache = new Map<string, { at: number; value: SbResult }>();
const MAX_CACHE = 500;

export function clearSbIdentCache(): void {
  cache.clear();
}

/** Known small bodies in the box at one time. Never throws. Cached for an hour when it answered. */
export async function querySbIdent(ra: number, dec: number, halfDeg: number, mjd: number, deps: SbDeps = {}): Promise<SbResult> {
  const url = sbIdentUrl(ra, dec, halfDeg, mjd);
  const now = deps.now ?? Date.now;
  const hit = cache.get(url);
  if (hit && now() - hit.at < OK_TTL_MS) return hit.value;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), deps.timeoutMs ?? SB_IDENT_TIMEOUT_MS);
  let value: SbResult;
  try {
    const res = await fetchImpl(url, { signal: ctl.signal, headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const objects = parseSbIdent(await res.json());
    value = { status: objects.length ? "ok" : "empty", objects };
  } catch (e) {
    const timedOut = ctl.signal.aborted;
    console.error(`[sb_ident] ${timedOut ? "timeout" : "error"}:`, e instanceof Error ? e.message : e);
    return { status: timedOut ? "timeout" : "error", objects: [] };
  } finally {
    clearTimeout(timer);
  }
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
  cache.set(url, { at: now(), value });
  return value;
}
