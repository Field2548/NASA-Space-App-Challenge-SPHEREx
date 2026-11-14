// Saving a /api/check answer to the database (owner: SERVER). Server only.
// Contract: docs/contracts/api.md sections 3, 4 and 8. The write itself is the record_find()
// RPC (supabase/migrations/20261115000000_init.sql), called with the service role.
// No database, or a database that fails, is never an error for the player: the answer is
// returned as not persisted.

import type { SupabaseClient } from "@supabase/supabase-js";
import { firstFinderBonus, type FieldForScoring, type FindKey, type Scored } from "@/lib/scoring";
import { hpxNest } from "@/lib/healpix";
import { serviceClient, userFromRequest } from "@/lib/server/db";

export type SaveResult = {
  persisted: boolean;
  first_finder: boolean;
  already_found: boolean;
  points: number;
};

/** Test seams. Defaults: the real service client and the caller's token. */
export type PersistDeps = {
  client?: () => SupabaseClient | null;
  user?: (request: Request) => Promise<{ id: string } | null>;
};

/** Arguments of the record_find() RPC, named exactly as its parameters. */
export type FindRow = {
  p_user: string | null; // filled in by saveFind from the caller's token
  p_spot: string;
  p_ra: number;
  p_dec: number;
  p_hpx12: number;
  p_x: number | null;
  p_y: number | null;
  p_vx: number | null;
  p_vy: number | null;
  p_verdict: string;
  p_object_name: string | null;
  p_find_key: FindKey | null;
  p_points: number;
  p_bonus: number;
  p_practice: boolean;
};

const RPC_TIMEOUT_MS = 5000;

/**
 * The record_find() arguments for one answer on a ready spot. Pure.
 * Position rule (api.md section 8): the SPOT CENTRE and its order-12 HEALPix cell, never the
 * mover's position. `p_points` is the base score; the first-finder bonus goes in `p_bonus`.
 * `p_x`..`p_vy` are the fitted track (null for a "nothing" answer).
 * Throws when the field has no centre; saveFind turns that into "not persisted".
 */
export function buildFindRow(
  slug: string,
  field: FieldForScoring,
  scored: Scored,
  practice: boolean,
): FindRow {
  if (field.ra === undefined || field.dec === undefined) {
    throw new Error(`Spot "${slug}" has no centre in its field.json.`);
  }
  const { verdict, track, matched } = scored;
  return {
    p_user: null,
    p_spot: slug,
    p_ra: field.ra,
    p_dec: field.dec,
    p_hpx12: hpxNest(field.ra, field.dec, 12),
    p_x: track ? track.x0 : null,
    p_y: track ? track.y0 : null,
    p_vx: track ? track.vx : null,
    p_vy: track ? track.vy : null,
    p_verdict: verdict.kind,
    p_object_name: verdict.object_name ?? null,
    p_find_key: matched?.find_key ?? null,
    p_points: verdict.points,
    p_bonus: firstFinderBonus(verdict.kind, field.difficulty),
    p_practice: practice,
  };
}

/** What a not-saved answer reports. Practice earns nothing. */
function notSaved(scored: Scored, practice: boolean): SaveResult {
  return {
    persisted: false,
    first_finder: false,
    already_found: false,
    points: practice ? 0 : scored.verdict.points,
  };
}

async function withTimeout<T>(work: PromiseLike<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`database call timed out after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([Promise.resolve(work), late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Save one answer for the logged-in caller. Never throws: with no database, no user, or any
 * database error it returns `persisted: false` (errors are logged on the server).
 */
export async function saveFind(
  request: Request,
  slug: string,
  field: FieldForScoring,
  scored: Scored,
  practice: boolean,
  deps: PersistDeps = {},
): Promise<SaveResult> {
  try {
    const client = (deps.client ?? serviceClient)();
    if (!client) return notSaved(scored, practice);
    const user = await (deps.user ?? userFromRequest)(request);
    if (!user) return notSaved(scored, practice);

    const row = { ...buildFindRow(slug, field, scored, practice), p_user: user.id };
    const { data, error } = await withTimeout(client.rpc("record_find", row), RPC_TIMEOUT_MS);
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    if (!result || typeof result.first_finder !== "boolean") {
      throw new Error("record_find returned no row");
    }
    return {
      persisted: true,
      first_finder: result.first_finder,
      already_found: Boolean(result.already_found),
      points: Number(result.points) || 0,
    };
  } catch (e) {
    console.error(`[persist] could not save the answer for "${slug}":`, e);
    return notSaved(scored, practice);
  }
}

/** True when this player already has a saved visit to the spot. False on error or no database. */
export async function hasVisit(userId: string, slug: string, deps: PersistDeps = {}): Promise<boolean> {
  try {
    const client = (deps.client ?? serviceClient)();
    if (!client) return false;
    const { data, error } = await client
      .from("visits")
      .select("spot_slug")
      .eq("user_id", userId)
      .eq("spot_slug", slug)
      .limit(1);
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  } catch (e) {
    console.error(`[persist] could not read the visit to "${slug}":`, e);
    return false;
  }
}
