// The logic behind GET /api/quicklook/list?ra=&dec= (BUILD_PROMPT 8.20 step 1). Server only.
//
// Asks IRSA's SIA v2 service for every SPHEREx exposure over a position, keeps one copy per
// (exposure, detector) (DR1 over QR3, like spectral_bands.unique_images), groups them into bursts
// (motion_frames.group_bursts, 15 minutes) and gives each the URL the browser should Range-read:
// the public S3 object from `cloud_access`, else IRSA's `access_url`.
//
// IRSA's SIA answers VOTable TABLEDATA (checked 2026-11-14: no RESPONSEFORMAT and
// RESPONSEFORMAT=votable both work; text/csv and application/x-votable+xml come back as a VOTable
// with QUERY_STATUS=ERROR "Unknown format"). No XML library is added: the parser below reads only
// what this service sends (FIELD names, TR/TD cells, the QUERY_STATUS INFO).
//
// Like lib/server/sesame.ts: retries with backoff and a per-try timeout, an in-memory cache of
// one day per position, and ApiFail("upstream_failed", details.service = "irsa_sia") on failure.

import { ApiFail } from "@/lib/server/http";
import {
  DEFAULT_GRID_PX,
  PIXEL_ARCSEC,
  groupBursts,
  mjdToUtc,
  uniqueImages,
  type QuickLookBurst,
  type QuickLookExposure,
  type QuickLookList,
} from "@/lib/quicklook";

export const SIA_URL = "https://irsa.ipac.caltech.edu/SIA";
export const SIA_COLLECTIONS = ["spherex_dr1", "spherex_qr3"];
/** Search radius: 1 arcsec, as download.search_images (images that cover the position itself). */
export const SIA_RADIUS_DEG = 1 / 3600;
/** The only bucket we hand to browsers (BUILD_PROMPT 9: whitelist nasa-irsa-spherex). */
export const S3_BUCKET = "nasa-irsa-spherex";

const TOTAL_BUDGET_MS = 45_000; // IRSA often answers 502; keep trying for up to ~45 s (8.20)
const TRY_TIMEOUT_MS = 25_000; // one SIA answer for a well-covered spot is ~0.9 MB, ~2 s when healthy
const FIRST_BACKOFF_MS = 2_000;
const CACHE_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 300;

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

export interface ListDeps {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

// ------------------------------------------------------------------------------------------------
// VOTable (TABLEDATA) parsing
// ------------------------------------------------------------------------------------------------

function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|quot|amp|lt|gt|apos);/g, (_m, e: string) => {
    if (e === "quot") return '"';
    if (e === "amp") return "&";
    if (e === "lt") return "<";
    if (e === "gt") return ">";
    if (e === "apos") return "'";
    const code = e.startsWith("#x") ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return String.fromCodePoint(code);
  });
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(tag);
  return m ? unescapeXml(m[2] ?? m[3] ?? "") : null;
}

export interface VoTable {
  status: string | null;
  statusText: string;
  fields: string[];
  rows: string[][];
}

/**
 * Read the results table of a VOTable answer: column names from <FIELD name=...> and cell text
 * from <TR><TD>. Tolerates <TD/>, attributes on TD, CDATA, and entity escapes. Only the
 * RESOURCE type="results" part is read (IRSA also sends a large "meta" self-description first).
 */
export function parseVoTable(xml: string): VoTable {
  const resStart = xml.search(/<RESOURCE[^>]*type\s*=\s*["']results["']/);
  const body = resStart >= 0 ? xml.slice(resStart) : xml;
  const info = /<INFO[^>]*name\s*=\s*["']QUERY_STATUS["'][^>]*?(\/>|>([\s\S]*?)<\/INFO>)/.exec(body);
  const status = info ? attr(info[0], "value") : null;
  const statusText = info?.[2] ? unescapeXml(info[2].trim()) : "";
  const fields: string[] = [];
  for (const m of body.matchAll(/<FIELD\b[^>]*>/g)) fields.push(attr(m[0], "name") ?? `col${fields.length}`);
  const rows: string[][] = [];
  for (const tr of body.matchAll(/<TR\b[^>]*>([\s\S]*?)<\/TR>/g)) {
    const cells: string[] = [];
    for (const td of tr[1].matchAll(/<TD\b[^>]*\/>|<TD\b[^>]*>([\s\S]*?)<\/TD>/g)) {
      let v = td[1] ?? "";
      const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(v);
      v = cdata ? cdata[1] : unescapeXml(v);
      cells.push(v.trim());
    }
    rows.push(cells);
  }
  return { status, statusText, fields, rows };
}

// ------------------------------------------------------------------------------------------------
// Rows -> QuickLookList
// ------------------------------------------------------------------------------------------------

/** `cloud_access` JSON -> https URL of the S3 object, or null if absent or not the SPHEREx bucket. */
export function s3UrlFromCloudAccess(cloud: string): { url: string; key: string } | null {
  if (!cloud) return null;
  try {
    const j = JSON.parse(cloud) as { aws?: { bucket_name?: unknown; key?: unknown; region?: unknown } };
    const b = j.aws?.bucket_name;
    const k = j.aws?.key;
    const r = j.aws?.region;
    if (b !== S3_BUCKET || typeof k !== "string" || !k || /\.\.|^\//.test(k)) return null;
    const region = typeof r === "string" && /^[a-z0-9-]+$/.test(r) ? r : "us-east-1";
    const path = k.split("/").map(encodeURIComponent).join("/");
    return { url: `https://${b}.s3.${region}.amazonaws.com/${path}`, key: k };
  } catch {
    return null;
  }
}

/**
 * True if the SIA footprint "POLYGON ICRS ra1 dec1 ra2 dec2 ..." contains all 4 corners of a square
 * field of half-width `halfDeg` around (ra, dec): motion_frames.covers_field on a flat tangent patch.
 * Null if the footprint cannot be read.
 */
export function coversField(sRegion: string, ra: number, dec: number, halfDeg: number): boolean | null {
  const nums = sRegion.split(/\s+/).map(Number).filter((v) => Number.isFinite(v));
  if (nums.length < 6) return null;
  const cosd = Math.cos((dec * Math.PI) / 180);
  const px: number[] = [];
  const py: number[] = [];
  for (let k = 0; k + 1 < nums.length; k += 2) {
    px.push(((((nums[k] - ra + 180) % 360) + 360) % 360 - 180) * cosd);
    py.push(nums[k + 1] - dec);
  }
  const inside = (x: number, y: number) => {
    let c = false;
    for (let i = 0, j = px.length - 1; i < px.length; j = i++) {
      if (py[i] > y !== py[j] > y && x < ((px[j] - px[i]) * (y - py[i])) / (py[j] - py[i]) + px[i]) c = !c;
    }
    return c;
  };
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) if (!inside(sx * halfDeg, sy * halfDeg)) return false;
  return true;
}

/** Half-width (deg) used for `covers_field`: the default 41 px grid plus 0.01 deg, as motion_frames. */
export const COVER_HALF_DEG = (DEFAULT_GRID_PX * PIXEL_ARCSEC) / 3600 / 2 + 0.01;

const intOrNull = (s: string | undefined): number | null => {
  const v = s === undefined || s === "" ? NaN : Number(s);
  return Number.isFinite(v) ? Math.round(v) : null;
};

/** Build the list from a parsed SIA table. Rows that are not SPHEREx exposures are dropped. */
export function buildList(t: VoTable, ra: number, dec: number, fetchedUtc: string): QuickLookList {
  const col = (name: string) => t.fields.indexOf(name);
  const need = ["obs_id", "energy_bandpassname", "t_min", "access_url", "obs_collection"];
  for (const n of need) if (col(n) < 0) throw new Error(`SIA answer has no ${n} column`);
  const ix = {
    obs: col("obs_id"),
    band: col("energy_bandpassname"),
    tmin: col("t_min"),
    tmax: col("t_max"),
    url: col("access_url"),
    coll: col("obs_collection"),
    cloud: col("cloud_access"),
    region: col("s_region"),
    x1: col("s_xel1"),
    x2: col("s_xel2"),
    size: col("access_estsize"),
  };
  type Row = { obs_id: string; detector: number; collection: string; t_min: number; cells: string[] };
  const rows: Row[] = [];
  for (const c of t.rows) {
    const m = /D([1-6])$/.exec(c[ix.band] ?? "");
    const tmin = Number(c[ix.tmin]);
    if (!m || !Number.isFinite(tmin) || !c[ix.obs] || !c[ix.url]) continue;
    rows.push({ obs_id: c[ix.obs], detector: Number(m[1]), collection: c[ix.coll] ?? "", t_min: tmin, cells: c });
  }
  const unique = uniqueImages(rows).map((r) => ({ ...r, mjd: r.t_min }));
  const bursts = groupBursts(unique);
  const exposures: QuickLookExposure[] = [];
  const out: QuickLookBurst[] = [];
  bursts.forEach((b, bi) => {
    const idx: number[] = [];
    for (const r of b) {
      const c = r.cells;
      const s3 = ix.cloud >= 0 ? s3UrlFromCloudAccess(c[ix.cloud] ?? "") : null;
      const tmax = ix.tmax >= 0 ? Number(c[ix.tmax]) : NaN;
      idx.push(exposures.length);
      exposures.push({
        obs_id: r.obs_id,
        mjd: r.t_min,
        utc: mjdToUtc(r.t_min),
        detector: r.detector,
        path: s3 ? s3.key : c[ix.url],
        url: s3 ? s3.url : null,
        access_url: c[ix.url],
        source: s3 ? "s3" : "irsa",
        est_size_bytes: ix.size >= 0 && intOrNull(c[ix.size]) !== null ? (intOrNull(c[ix.size]) as number) * 1000 : null,
        collection: r.collection,
        mjd_end: Number.isFinite(tmax) ? tmax : null,
        naxis1: ix.x1 >= 0 ? intOrNull(c[ix.x1]) : null,
        naxis2: ix.x2 >= 0 ? intOrNull(c[ix.x2]) : null,
        covers_field: ix.region >= 0 ? coversField(c[ix.region] ?? "", ra, dec, COVER_HALF_DEG) : null,
        burst: bi,
      });
    }
    out.push({
      i: bi,
      mjd: b[0].t_min,
      utc: mjdToUtc(b[0].t_min),
      exposures: idx,
      detectors: [...new Set(b.map((r) => r.detector))].sort((p, q) => p - q),
    });
  });
  return {
    ra,
    dec,
    radius_deg: SIA_RADIUS_DEG,
    exposures,
    bursts: out,
    source: { service: "irsa_sia", collections: SIA_COLLECTIONS, fetched_utc: fetchedUtc },
  };
}

// ------------------------------------------------------------------------------------------------
// Fetch with retries + cache
// ------------------------------------------------------------------------------------------------

export function siaQueryUrl(ra: number, dec: number): string {
  const coll = SIA_COLLECTIONS.map((c) => `COLLECTION=${c}`).join("&");
  return `${SIA_URL}?${coll}&POS=circle+${ra}+${dec}+${SIA_RADIUS_DEG.toFixed(9)}&RESPONSEFORMAT=votable`;
}

const cache = new Map<string, { at: number; value: QuickLookList }>();

/** For tests. */
export function clearQuickLookListCache(): void {
  cache.clear();
}

/**
 * Exposures over (ra, dec), from cache when asked within a day. Positions are rounded to 1e-5 deg
 * (0.036 arcsec) so the same spot hits the cache. Throws ApiFail upstream_failed (service irsa_sia)
 * when IRSA keeps failing for ~45 s; failures are never cached.
 */
export async function listQuickLook(raIn: number, decIn: number, deps: ListDeps = {}): Promise<QuickLookList> {
  const ra = Math.round(raIn * 1e5) / 1e5;
  const dec = Math.round(decIn * 1e5) / 1e5;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const f = deps.fetch ?? (fetch as FetchLike);
  const key = `${ra},${dec}`;
  const hit = cache.get(key);
  if (hit && now() - hit.at < CACHE_MS) return hit.value;

  const started = now();
  let attempt = 0;
  let tries = 0;
  let last = "no answer";
  while (true) {
    const left = TOTAL_BUDGET_MS - (now() - started);
    if (left <= 1000) break;
    tries++;
    try {
      const res = await f(siaQueryUrl(ra, dec), { signal: AbortSignal.timeout(Math.min(TRY_TIMEOUT_MS, left)) });
      if (res.ok) {
        const t = parseVoTable(await res.text());
        if (t.status === "OK" || (t.status === null && t.fields.length)) {
          const value = buildList(t, ra, dec, new Date(now()).toISOString().slice(0, 19));
          if (cache.size >= CACHE_MAX) {
            const oldest = cache.keys().next().value;
            if (oldest !== undefined) cache.delete(oldest);
          }
          cache.set(key, { at: now(), value });
          return value;
        }
        // IRSA reports its own transient faults inside a 200 VOTable ("TransientFault: ...").
        last = `QUERY_STATUS ${t.status ?? "missing"}${t.statusText ? `: ${t.statusText.slice(0, 120)}` : ""}`;
      } else {
        last = `HTTP ${res.status}`;
        if (res.status < 500 && res.status !== 429) break; // a 4xx will not get better by retrying
      }
    } catch (e) {
      last = e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 160) : "network error";
    }
    const wait = Math.min(FIRST_BACKOFF_MS * 2 ** attempt, TOTAL_BUDGET_MS - (now() - started) - 1000);
    attempt++;
    if (wait <= 0) break;
    await sleep(wait);
  }
  throw new ApiFail("upstream_failed", "IRSA is not answering right now. Try again in a minute.", {
    service: "irsa_sia",
    attempts: tries,
    last_error: last,
  });
}
