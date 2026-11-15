// One shared load of fields/index.json for the sky map and the coordinate box. Owner: SERVER.

import { loadFieldIndex as loadIndex } from "@/lib/fields";
import type { FieldSummary } from "@/lib/types";

let pending: Promise<FieldSummary[]> | null = null;

/** Ready spots (GAME's loadIndex), fetched once per page; a failure is not cached, so a retry refetches. */
export function loadSpotsOnce(): Promise<FieldSummary[]> {
  if (!pending) {
    pending = loadIndex()
      .then((rows) => (Array.isArray(rows) ? rows : []))
      .catch((e: unknown) => {
        pending = null;
        throw e;
      });
  }
  return pending;
}
