"use client";
// Whether the sky map shows the community patches layer. Default on; kept in localStorage
// (best effort: private mode or blocked storage just means it is not remembered).

import { useCallback, useSyncExternalStore } from "react";

export const COMMUNITY_PREF_KEY = "onionsky:community-layer:v1";

let memory: boolean | null = null;
const listeners = new Set<() => void>();

export function loadCommunityPref(): boolean {
  try {
    const v = window.localStorage.getItem(COMMUNITY_PREF_KEY);
    if (v === "0") return false;
    if (v === "1") return true;
  } catch {
    /* storage blocked */
  }
  return memory ?? true;
}

export function saveCommunityPref(on: boolean): void {
  memory = on;
  try {
    window.localStorage.setItem(COMMUNITY_PREF_KEY, on ? "1" : "0");
  } catch {
    /* kept in memory for this visit */
  }
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === COMMUNITY_PREF_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** [on, setOn]. Server render and first paint say on. */
export function useCommunityPref(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, loadCommunityPref, () => true);
  return [on, useCallback((v: boolean) => saveCommunityPref(v), [])];
}
