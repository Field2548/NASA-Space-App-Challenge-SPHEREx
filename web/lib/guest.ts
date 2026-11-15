// Guest-mode store in localStorage (api.md section 13: no Supabase env = guest). SSR-safe.

import type { Vision } from "./types";

export const GUEST_KEY = "onionsky:v1";

export interface GuestFind {
  spot: string;
  kind: string; // verdict kind
  points: number;
  at: string; // ISO time
}

export interface GuestData {
  tutorial: { level: number; step: number; done: number[] };
  settings: { vision: Vision; reducedMotion?: boolean; music?: boolean; musicVolume?: number; uiSounds?: boolean };
  finds: GuestFind[];
  name?: string;
}

export const defaultGuest = (): GuestData => ({
  tutorial: { level: 1, step: 0, done: [] },
  settings: { vision: "normal" },
  finds: [],
});

let memory: GuestData | null = null; // used when there is no usable localStorage

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

function sane(raw: unknown): GuestData {
  const d = defaultGuest();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Partial<GuestData>;
  if (r.tutorial && typeof r.tutorial === "object") {
    const t = r.tutorial;
    if (Number.isFinite(t.level)) d.tutorial.level = t.level;
    if (Number.isFinite(t.step)) d.tutorial.step = t.step;
    if (Array.isArray(t.done)) d.tutorial.done = t.done.filter((n) => Number.isFinite(n));
  }
  if (r.settings && typeof r.settings === "object") d.settings = { ...d.settings, ...r.settings };
  if (Array.isArray(r.finds)) d.finds = r.finds.filter((f) => f && typeof f.spot === "string" && Number.isFinite(f.points));
  if (typeof r.name === "string") d.name = r.name;
  return d;
}

function write(d: GuestData): void {
  const s = storage();
  if (!s) {
    memory = structuredClone(d);
    return;
  }
  try {
    s.setItem(GUEST_KEY, JSON.stringify(d));
  } catch {
    memory = structuredClone(d); // quota or private mode: keep going in memory
  }
}

export function loadGuest(): GuestData {
  const s = storage();
  if (!s) return memory ? structuredClone(memory) : defaultGuest();
  try {
    const txt = s.getItem(GUEST_KEY);
    if (txt === null) return defaultGuest();
    return sane(JSON.parse(txt));
  } catch {
    const d = defaultGuest(); // corrupt JSON: reset to defaults
    write(d);
    return d;
  }
}

export interface GuestPatch {
  tutorial?: Partial<GuestData["tutorial"]>;
  settings?: Partial<GuestData["settings"]>;
  finds?: GuestFind[];
  name?: string;
}

/** Merge a patch (tutorial and settings merge by key; finds and name replace) and persist. */
export function saveGuest(patch: GuestPatch): GuestData {
  const cur = loadGuest();
  const next: GuestData = {
    ...cur,
    tutorial: { ...cur.tutorial, ...patch.tutorial },
    settings: { ...cur.settings, ...patch.settings },
    finds: patch.finds ?? cur.finds,
    name: patch.name ?? cur.name,
  };
  write(next);
  return next;
}

/** Append a find; a second find of the same spot and kind is ignored (no points twice). */
export function recordFind(spot: string, kind: string, points: number, at = new Date().toISOString()): GuestData {
  const cur = loadGuest();
  if (cur.finds.some((f) => f.spot === spot && f.kind === kind)) return cur;
  return saveGuest({ finds: [...cur.finds, { spot, kind, points, at }] });
}

export function resetGuest(): GuestData {
  memory = null;
  try {
    storage()?.removeItem(GUEST_KEY);
  } catch {
    /* ignore */
  }
  return defaultGuest();
}
