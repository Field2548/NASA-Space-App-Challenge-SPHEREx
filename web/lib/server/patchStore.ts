// Database side of picked patches (owner: SERVER). Server only.
// Tables: supabase/migrations/20261116000000_patches.sql (service role only).
// Every function here never throws: no database, or a failing one, is a normal state.

import type { SupabaseClient } from "@supabase/supabase-js";
import { patchFromId } from "@/lib/patch";
import type { PatchSummary, SkyPoint } from "@/lib/patchSolves";
import { serviceClient } from "@/lib/server/db";
import type { CrowdRow } from "@/lib/server/patchCrowd";

export interface SolveRow {
  patch_id: string;
  user_id: string | null;
  ra: number;
  dec: number;
  objects: SkyPoint[];
}
export interface ReportRow {
  patch_id: string;
  user_id: string | null;
  ra: number;
  dec: number;
  marks: { frame: number; x: number; y: number; ra: number; dec: number; mjd: number }[];
  frame_times: { i: number; mjd: number }[];
}

/** What the routes need from storage. `null` from patchStore() means no database. */
export interface PatchStore {
  hasSolve(patchId: string, userId: string): Promise<boolean>;
  saveSolve(row: SolveRow): Promise<boolean>;
  saveReport(row: ReportRow): Promise<boolean>;
  /** Signed-in players' reports on a patch, newest first (for crowd agreement); null on a database error. */
  reportsFor(patchId: string): Promise<CrowdRow[] | null>;
  /** Patches whose centre lies within `r` degrees of (ra, dec). */
  near(ra: number, dec: number, r: number): Promise<PatchSummary[] | null>;
  /** Cells at `order` inside a tile: [ipix, patches solved, patches reported]. Null when the query fails. */
  tileDensity(order: number, tileOrder: number, tile: number): Promise<[number, number, number][] | null>;
  /** Up to `limit` patches inside a tile with what was done to each. Null when the query fails. */
  tilePatches(tileOrder: number, tile: number, limit: number): Promise<TilePatch[] | null>;
}

/** One patch in a tile: no user, no names. */
export interface TilePatch {
  id: string;
  solved: boolean;
  reported: boolean;
}

const D2R = Math.PI / 180;
/** Angular distance in degrees. */
export function sepDeg(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const s =
    Math.sin(((dec2 - dec1) * D2R) / 2) ** 2 +
    Math.cos(dec1 * D2R) * Math.cos(dec2 * D2R) * Math.sin(((ra2 - ra1) * D2R) / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(s)))) / D2R;
}

const point = (v: unknown): SkyPoint | null => {
  if (typeof v !== "object" || v === null) return null;
  const { ra, dec } = v as { ra?: unknown; dec?: unknown };
  return typeof ra === "number" && typeof dec === "number" && Number.isFinite(ra) && Number.isFinite(dec) ? { ra, dec } : null;
};
const points = (v: unknown): SkyPoint[] => (Array.isArray(v) ? v.map(point).filter((p): p is SkyPoint => p !== null) : []);

/** Merge solve and report rows into one summary per patch. Pure; exported for tests. */
export function summarise(
  solves: { patch_id: string; objects: unknown; created_at: string }[],
  reports: { patch_id: string; marks: unknown }[],
  ra: number,
  dec: number,
  r: number,
): PatchSummary[] {
  const by = new Map<string, PatchSummary>();
  const entry = (id: string): PatchSummary | null => {
    const cur = by.get(id);
    if (cur) return cur;
    const p = patchFromId(id);
    if (!p || sepDeg(ra, dec, p.ra, p.dec) > r) return null;
    const e: PatchSummary = { id, ra: p.ra, dec: p.dec, size_deg: p.size_deg, corners: p.corners, solved_at: null, objects: [], reports: [] };
    by.set(id, e);
    return e;
  };
  for (const s of solves) {
    const e = entry(s.patch_id);
    if (!e) continue;
    // Earliest solve dates the patch; every solve's positions are the same objects, so keep the first set.
    if (e.solved_at === null || s.created_at < e.solved_at) e.solved_at = s.created_at;
    if (!e.objects.length) e.objects = points(s.objects);
  }
  for (const rep of reports) {
    const e = entry(rep.patch_id);
    if (e) e.reports.push(...points(rep.marks));
  }
  return [...by.values()];
}

const LIMIT = 1000;

export function supabaseStore(sb: SupabaseClient): PatchStore {
  return {
    async hasSolve(patchId, userId) {
      try {
        const { data, error } = await sb.from("patch_solves").select("id").eq("patch_id", patchId).eq("user_id", userId).limit(1);
        return !error && Array.isArray(data) && data.length > 0;
      } catch {
        return false;
      }
    },
    async saveSolve(row) {
      try {
        const { error } = await sb.from("patch_solves").insert(row);
        if (error && error.code !== "23505") console.error("[patches] solve not saved:", error.message);
        return !error;
      } catch (e) {
        console.error("[patches] solve not saved:", e);
        return false;
      }
    },
    async saveReport(row) {
      try {
        const { error } = await sb.from("patch_reports").insert(row);
        if (error) console.error("[patches] report not saved:", error.message);
        return !error;
      } catch (e) {
        console.error("[patches] report not saved:", e);
        return false;
      }
    },
    async reportsFor(patchId) {
      try {
        const { data, error } = await sb
          .from("patch_reports")
          .select("user_id, marks, created_at")
          .eq("patch_id", patchId)
          .not("user_id", "is", null)
          .order("created_at", { ascending: false })
          .limit(500);
        return error ? null : ((data ?? []) as CrowdRow[]);
      } catch {
        return null;
      }
    },
    async near(ra, dec, r) {
      try {
        // A dec band from the index, then the exact distance (handles the RA wrap and the poles).
        const lo = Math.max(-90, dec - r - 0.1);
        const hi = Math.min(90, dec + r + 0.1);
        const [s, rep] = await Promise.all([
          sb.from("patch_solves").select("patch_id, objects, created_at").gte("dec", lo).lte("dec", hi).order("created_at").limit(LIMIT),
          sb.from("patch_reports").select("patch_id, marks").gte("dec", lo).lte("dec", hi).order("created_at").limit(LIMIT),
        ]);
        if (s.error || rep.error) return null;
        return summarise(s.data ?? [], rep.data ?? [], ra, dec, r);
      } catch {
        return null;
      }
    },
    async tileDensity(order, tileOrder, tile) {
      try {
        const { data, error } = await sb
          .rpc("patch_density", { p_order: order, p_tile_order: tileOrder, p_tile: tile })
          .abortSignal(AbortSignal.timeout(5000));
        if (error || !Array.isArray(data)) return null;
        return (data as { ipix: number | string; solves: number | string; reports: number | string }[])
          .map((r) => [Number(r.ipix), Number(r.solves), Number(r.reports)] as [number, number, number])
          .filter(([i, s, r]) => Number.isFinite(i) && s + r > 0)
          .sort((a, b) => a[0] - b[0]);
      } catch {
        return null;
      }
    },
    async tilePatches(tileOrder, tile, limit) {
      try {
        const { data, error } = await sb
          .rpc("patch_footprints", { p_tile_order: tileOrder, p_tile: tile, p_limit: limit })
          .abortSignal(AbortSignal.timeout(5000));
        if (error || !Array.isArray(data)) return null;
        return (data as { patch_id: string; has_solve: boolean; has_report: boolean }[]).map((r) => ({
          id: r.patch_id,
          solved: Boolean(r.has_solve),
          reported: Boolean(r.has_report),
        }));
      } catch {
        return null;
      }
    },
  };
}

/** The real store, or null with no database. */
export function patchStore(): PatchStore | null {
  const sb = serviceClient();
  return sb ? supabaseStore(sb) : null;
}
