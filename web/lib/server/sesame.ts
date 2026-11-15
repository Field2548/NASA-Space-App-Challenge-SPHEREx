// Name to coordinates through CDS Sesame. Server only.
// Contract: docs/contracts/api.md section 5. Results are cached in memory for 1 day.

import { ApiFail } from "@/lib/server/http";

const SESAME_URL = "https://cds.unistra.fr/cgi-bin/nph-sesame/-ox/SNV?";
const TIMEOUT_MS = 8000;
const RETRIES = 2;
const BACKOFF_MS = 200;
const CACHE_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 500;

export type Resolved = { name: string; ra: number; dec: number };
type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

function tag(xml: string, name: string): number | null {
  const m = xml.match(new RegExp(`<${name}>\\s*([^<\\s]+)\\s*</${name}>`));
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
}

/** First `<jradeg>` and `<jdedeg>` in a Sesame XML answer, or null if absent or out of range. */
export function parseSesameXml(xml: string): { ra: number; dec: number } | null {
  const ra = tag(xml, "jradeg");
  const dec = tag(xml, "jdedeg");
  if (ra === null || dec === null) return null;
  if (ra < 0 || ra > 360 || dec < -90 || dec > 90) return null;
  return { ra, dec };
}

const cache = new Map<string, { at: number; value: { ra: number; dec: number } | null }>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Resolve a name. Returns null when Sesame has no position; throws ApiFail when it does not answer. */
export async function resolveName(
  name: string,
  fetchImpl: FetchLike = fetch as FetchLike,
): Promise<Resolved | null> {
  const clean = name.trim();
  const key = clean.toLowerCase();
  const hitEntry = cache.get(key);
  if (hitEntry && Date.now() - hitEntry.at < CACHE_MS) {
    return hitEntry.value ? { name: clean, ...hitEntry.value } : null;
  }

  const fail = () =>
    new ApiFail(
      "upstream_failed",
      "The name service (CDS Sesame) did not answer. Please try again in a moment.",
      { service: "cds_sesame" },
    );

  let xml: string | null = null;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await sleep(BACKOFF_MS * attempt);
    try {
      const res = await fetchImpl(SESAME_URL + encodeURIComponent(clean), {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status >= 500) continue;
      if (!res.ok) throw fail();
      xml = await res.text();
      break;
    } catch (e) {
      if (e instanceof ApiFail) throw e;
      // network error or timeout: try again
    }
  }
  if (xml === null) throw fail();

  const value = parseSesameXml(xml);
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), value });
  return value ? { name: clean, ...value } : null;
}

/** For tests. */
export function clearSesameCache(): void {
  cache.clear();
}
