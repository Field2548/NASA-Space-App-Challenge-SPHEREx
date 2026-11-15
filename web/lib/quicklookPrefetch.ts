// Browser side of GET /api/quicklook/list (which SPHEREx exposures cover a point), shared by the
// sky map and the patch player. Picking a patch on the map starts the query
// (prefetchQuickLookList), so /play opens with the answer already on its way. One request per
// point per page load; a failed one is dropped so the next call retries.

import type { QuickLookList } from "./quicklook";

const cache = new Map<string, Promise<QuickLookList>>();
const MAX_KEPT = 16;

const key = (ra: number, dec: number) => `${ra},${dec}`;

function request(ra: number, dec: number): Promise<QuickLookList> {
  return fetch(`/api/quicklook/list?ra=${ra}&dec=${dec}`).then(async (r) => {
    const body = await r.json();
    if (!r.ok) throw new Error(body?.error?.message ?? `IRSA list failed (${r.status}).`);
    return body as QuickLookList;
  });
}

/** The exposure list for (ra, dec): the one already asked for, or a new request. */
export function loadQuickLookList(ra: number, dec: number): Promise<QuickLookList> {
  const k = key(ra, dec);
  const hit = cache.get(k);
  if (hit) return hit;
  const p = request(ra, dec);
  cache.set(k, p);
  if (cache.size > MAX_KEPT) cache.delete(cache.keys().next().value!);
  p.catch(() => {
    if (cache.get(k) === p) cache.delete(k);
  });
  return p;
}

/** Start the query early; loadQuickLookList picks up the answer. */
export function prefetchQuickLookList(ra: number, dec: number): void {
  loadQuickLookList(ra, dec).catch(() => {});
}

/** Tests only. */
export function resetQuickLookListCache(): void {
  cache.clear();
}
