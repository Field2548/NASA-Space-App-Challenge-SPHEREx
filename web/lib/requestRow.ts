/** Display text for one row of the request queue. Safe for null, string or odd values: never throws. */

const DASH = "–";

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function fixed(value: unknown, digits: number): string {
  const n = num(value);
  return n === null ? DASH : n.toFixed(digits);
}

/** "RA 12.346°, Dec -1.000°, field of view 0.1°", with "–" for any value that is not a number. */
export function formatRequestPosition(row: { ra?: unknown; dec?: unknown; fov?: unknown }): string {
  const fov = num(row.fov);
  return `RA ${fixed(row.ra, 3)}°, Dec ${fixed(row.dec, 3)}°, field of view ${fov === null ? DASH : fov}°`;
}

/** Locale date text for an ISO string, or "–" when it is missing or not a date. */
export function formatRequestTime(value: unknown): string {
  if (typeof value !== "string") return DASH;
  const t = new Date(value);
  return Number.isNaN(t.getTime()) ? DASH : t.toLocaleString();
}
