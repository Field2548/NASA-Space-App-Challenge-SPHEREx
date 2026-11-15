// Crowd agreement on a picked patch. Pure, server only. Nothing here scores:
// a patch has no answer key for an unknown mover, so agreement between players is only feedback.

export interface CrowdMark {
  x: number;
  y: number;
  mjd: number;
}
export interface CrowdRow {
  user_id: string | null;
  marks: unknown;
  created_at: string;
}
export interface Crowd {
  /** Other signed-in players whose latest report on this patch was compared. */
  others: number;
  /** How many of them marked the same track. */
  agree: number;
  /** No other player has reported here. */
  first: boolean;
}

/** Two tracks are "the same" when their fitted positions lie this close, in pixels (about 12 arcsec). One SPHEREx pixel is 6.15 arcsec; two pixels allows for hand-placed marks. */
export const CROWD_TOLERANCE_PX = 2;

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Marks from a stored jsonb value, dropping malformed entries. */
export function readMarks(v: unknown): CrowdMark[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((m) => {
    const o = m as { x?: unknown; y?: unknown; mjd?: unknown } | null;
    return o && num(o.x) && num(o.y) && num(o.mjd) ? [{ x: o.x, y: o.y, mjd: o.mjd }] : [];
  });
}

/** Straight-line motion x(t), y(t) by least squares; null with fewer than 2 distinct times. */
export function fitTrack(marks: CrowdMark[]): ((mjd: number) => [number, number]) | null {
  const n = marks.length;
  if (n < 2) return null;
  const t0 = marks[0].mjd;
  const mt = marks.reduce((s, m) => s + (m.mjd - t0), 0) / n;
  const sxx = marks.reduce((s, m) => s + (m.mjd - t0 - mt) ** 2, 0);
  if (sxx < 1e-12) return null;
  const line = (get: (m: CrowdMark) => number) => {
    const mv = marks.reduce((s, m) => s + get(m), 0) / n;
    const slope = marks.reduce((s, m) => s + (m.mjd - t0 - mt) * (get(m) - mv), 0) / sxx;
    return (t: number) => mv + slope * (t - t0 - mt);
  };
  const fx = line((m) => m.x);
  const fy = line((m) => m.y);
  return (t) => [fx(t), fy(t)];
}

/** Do two reports mark the same track? Both fits are compared at the first report's mark times. */
export function sameTrack(a: CrowdMark[], b: CrowdMark[], tolPx = CROWD_TOLERANCE_PX): boolean {
  const fa = fitTrack(a);
  const fb = fitTrack(b);
  if (!fa || !fb) return false;
  const d = a.reduce((s, m) => {
    const [ax, ay] = fa(m.mjd);
    const [bx, by] = fb(m.mjd);
    return s + Math.hypot(ax - bx, ay - by);
  }, 0);
  return d / a.length <= tolPx;
}

/**
 * Agreement of `mine` with the other players' reports on the same patch. Guests (user_id null)
 * are left out: nobody can tell one guest from another, so they could be counted again and again.
 * Each other player counts once, by their newest report; `userId` (the viewer) is never counted.
 */
export function crowdAgreement(mine: CrowdMark[], rows: CrowdRow[], userId: string | null): Crowd {
  const latest = new Map<string, CrowdRow>();
  for (const r of rows) {
    if (r.user_id === null || r.user_id === userId) continue;
    const cur = latest.get(r.user_id);
    if (!cur || r.created_at > cur.created_at) latest.set(r.user_id, r);
  }
  const others = latest.size;
  const agree = [...latest.values()].filter((r) => sameTrack(mine, readMarks(r.marks))).length;
  return { others, agree, first: others === 0 };
}
