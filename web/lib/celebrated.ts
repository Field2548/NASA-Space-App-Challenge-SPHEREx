// Stages whose first-solve celebration already played on this device. SSR-safe; never throws.

export const CELEBRATED_KEY = "onionsky:celebrated:v1";

export function loadCelebrated(): Set<string> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(CELEBRATED_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string") : []);
  } catch {
    return new Set();
  }
}

export function markCelebrated(slugs: string[]): void {
  try {
    const all = loadCelebrated();
    for (const s of slugs) all.add(s);
    window.localStorage.setItem(CELEBRATED_KEY, JSON.stringify([...all]));
  } catch {
    // storage unavailable: the burst may replay next visit, which is harmless
  }
}
