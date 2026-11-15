// Picked patches on the client: the /api/patch-check client, the /api/patches shape, and the
// player's own solves in localStorage (kept with or without a database). SSR-safe, no names stored.

import { ApiCallError } from "./check";
import { patchFromId } from "./patch";
import type { ApiError, CheckResponse } from "./types";

/** A known object on the patch grid (the overlay's shape): 1-based frame, pixels, V when JPL gave one. */
export type PatchKnownObject = { name: string; positions: { frame: number; x: number; y: number; vmag?: number }[] };

export const PATCH_CHECK_URL = "/api/patch-check";
export const PATCHES_URL = "/api/patches";
export const PATCH_SOLVES_KEY = "onionsky:patches:v1";

export type SkyPoint = { ra: number; dec: number };

/** One patch in GET /api/patches, and in loadLocalPatchSolves(). Never carries an object name. */
export interface PatchSummary {
  id: string;
  ra: number;
  dec: number;
  size_deg: number;
  /** The picture's corners [ra, dec]: top-left, top-right, bottom-right, bottom-left. */
  corners: [number, number][];
  /** ISO time of the first correct answer; null when the patch has only reports. */
  solved_at: string | null;
  /** Known objects' positions, one point per object per checked frame. */
  objects: SkyPoint[];
  /** "Possible new mover" marks on the sky. */
  reports: SkyPoint[];
}
export interface PatchesResponse {
  patches: PatchSummary[];
  offline?: true;
}

export interface PatchCheckRequest {
  patch: string;
  answer: "track" | "nothing";
  marks?: { frame: number; x: number; y: number }[];
  /** Every frame the player saw: index and mid-time (MJD). The server checks them against IRSA. */
  frames: { i: number; mjd: number }[];
}

/** POST /api/patch-check: the /api/check body plus the patch's own keys. */
export interface PatchCheckResponse extends CheckResponse {
  patch: { id: string; ra: number; dec: number };
  /** Only after a correct answer. */
  objects?: SkyPoint[];
  /** Only after a correct answer: the known objects with names and pixel positions, for the overlay. */
  known_objects?: { asteroids: PatchKnownObject[]; stars: [] };
  /** Only for a `candidate` verdict. */
  report?: { saved: boolean; positions: SkyPoint[] };
  solve_saved: boolean;
}

export async function submitPatchCheck(req: PatchCheckRequest, fetcher: typeof fetch = fetch): Promise<PatchCheckResponse> {
  let res: Response;
  try {
    res = await fetcher(PATCH_CHECK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(req),
    });
  } catch (e) {
    throw new ApiCallError("upstream_failed", e instanceof Error ? e.message : "Network request failed");
  }
  if (!res.ok) {
    let err: ApiError["error"] | undefined;
    try {
      err = ((await res.json()) as ApiError).error;
    } catch {
      /* not JSON */
    }
    if (err && typeof err.code === "string") throw new ApiCallError(err.code, err.message, res.status, err.details);
    throw new ApiCallError("internal", `POST ${PATCH_CHECK_URL} failed: ${res.status}`, res.status);
  }
  try {
    return (await res.json()) as PatchCheckResponse;
  } catch {
    throw new ApiCallError("upstream_failed", `Unreadable response from ${PATCH_CHECK_URL}`, res.status);
  }
}

// ------------------------------------------------------------------ local solves

type Stored = { id: string; solved_at: string | null; objects: SkyPoint[]; reports: SkyPoint[] };
let memory: Stored[] = [];

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}
const isPoint = (p: unknown): p is SkyPoint =>
  !!p && typeof p === "object" && Number.isFinite((p as SkyPoint).ra) && Number.isFinite((p as SkyPoint).dec);

function read(): Stored[] {
  const s = storage();
  if (!s) return memory;
  try {
    const raw: unknown = JSON.parse(s.getItem(PATCH_SOLVES_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((r): r is Stored => !!r && typeof r === "object" && typeof (r as Stored).id === "string")
      .map((r) => ({
        id: r.id,
        solved_at: typeof r.solved_at === "string" ? r.solved_at : null,
        objects: Array.isArray(r.objects) ? r.objects.filter(isPoint) : [],
        reports: Array.isArray(r.reports) ? r.reports.filter(isPoint) : [],
      }));
  } catch {
    return memory;
  }
}
function write(rows: Stored[]): void {
  memory = rows;
  try {
    storage()?.setItem(PATCH_SOLVES_KEY, JSON.stringify(rows));
  } catch {
    /* quota or private mode: kept in memory */
  }
}

/** Keep this player's result on a patch: a correct answer (solve) and/or report positions. */
export function saveLocalPatchResult(
  id: string,
  r: { solved: boolean; objects?: SkyPoint[]; reports?: SkyPoint[] },
  at = new Date().toISOString(),
): void {
  if (!patchFromId(id)) return;
  const rows = read();
  let row = rows.find((x) => x.id === id);
  if (!row) {
    row = { id, solved_at: null, objects: [], reports: [] };
    rows.push(row);
  }
  if (r.solved && row.solved_at === null) {
    row.solved_at = at;
    row.objects = (r.objects ?? []).filter(isPoint);
  }
  if (r.reports?.length) row.reports.push(...r.reports.filter(isPoint));
  write(rows);
}

/** Save from a /api/patch-check answer: a correct verdict is a solve, a candidate a report. */
export function savePatchCheck(res: PatchCheckResponse): void {
  const solved = res.unlocked && ["known", "bot_match", "nothing_correct"].includes(res.verdict.kind);
  const reports = res.report?.positions ?? [];
  if (solved || reports.length) saveLocalPatchResult(res.patch.id, { solved, objects: res.objects, reports });
}

/** The player's own patches, in the GET /api/patches shape. */
export function loadLocalPatchSolves(): PatchSummary[] {
  const out: PatchSummary[] = [];
  for (const r of read()) {
    const p = patchFromId(r.id);
    if (!p) continue;
    out.push({ id: r.id, ra: p.ra, dec: p.dec, size_deg: p.size_deg, corners: p.corners, solved_at: r.solved_at, objects: r.objects, reports: r.reports });
  }
  return out;
}

/** True when this player has already solved the patch on this device. */
export function isLocallySolved(id: string): boolean {
  return read().some((r) => r.id === id && r.solved_at !== null);
}
