// The work behind POST /api/patch-check and GET /api/patches (owner: SERVER). Server only.
// A picked patch has no answer key on disk, so one is built here from JPL's Small-Body
// Identification service at the times of the player's frames, then scored with the same
// scoreSubmission as a ready spot. The geometry comes from the patch id alone (lib/patch.ts) and
// the frame times are checked against IRSA's own list of exposures, never trusted from the client.
// An upstream failure is an honest 502 ("could not check right now"), never a made-up score.

import { NextResponse } from "next/server";
import { z } from "zod";
import { patchFromId, PATCH_SIZE_DEG, type Patch } from "@/lib/patch";
import type { QuickLookList } from "@/lib/quicklook";
import { listQuickLook } from "@/lib/quicklookList";
import { isCorrect, scoreSubmission, type AnswerKey, type AnswerObject, type Scored, type Submission } from "@/lib/scoring";
import { responseBody } from "@/lib/server/checkResponse";
import { userFromRequest } from "@/lib/server/db";
import { ApiFail, parse, readJsonBody } from "@/lib/server/http";
import { patchStore, type PatchStore } from "@/lib/server/patchStore";
import { rateLimit } from "@/lib/server/rateLimit";
import { querySbIdent, type SbResult } from "@/lib/server/sbIdent";
import { PIXEL_ARCSEC } from "@/lib/quicklook";
import { pixelToSky, skyToPixel } from "@/lib/wcs";
import type { PatchSummary, SkyPoint } from "@/lib/patchSolves";

/** A frame's mid-time must fall inside one of IRSA's bursts, give or take this (days). */
export const FRAME_TIME_SLACK_DAYS = 2 / 1440;
/** "Nothing moved" is wrong when a known object this bright (V) is inside the picture. */
export const NOTHING_VMAG_LIMIT = 18;
/** Largest search radius for GET /api/patches, degrees. */
export const MAX_PATCHES_RADIUS_DEG = 5;

const PatchId = z.string().regex(/^p11-\d{1,8}$/);
const Frame = z.object({ i: z.number().int().min(1).max(64), mjd: z.number().finite().min(50000).max(80000) });
const Coord = z.number().finite().min(-64).max(4096);
const MarkSchema = z.object({ frame: z.number().int().min(1), x: Coord, y: Coord });
const Frames = z.array(Frame).min(2).max(16);
export const PatchCheckBody = z.discriminatedUnion("answer", [
  z.object({ patch: PatchId, answer: z.literal("track"), marks: z.array(MarkSchema).min(2).max(32), frames: Frames }),
  z.object({ patch: PatchId, answer: z.literal("nothing"), frames: Frames }),
]);
type Body = z.infer<typeof PatchCheckBody>;

export interface PatchDeps {
  list: (ra: number, dec: number) => Promise<QuickLookList>;
  sbIdent: (ra: number, dec: number, halfDeg: number, mjd: number) => Promise<SbResult>;
  store: () => PatchStore | null;
  user: (request: Request) => Promise<{ id: string } | null>;
}
export const realPatchDeps: PatchDeps = {
  list: (ra, dec) => listQuickLook(ra, dec),
  sbIdent: (ra, dec, h, mjd) => querySbIdent(ra, dec, h, mjd),
  store: patchStore,
  user: userFromRequest,
};

const COMET = /^(\d+[PCDXI](-\w+)?\/|[PCDXI]\/\d{4}\s)/;

/** Every frame time lies inside some burst of IRSA's list (first exposure start to last exposure end, +-2 min). */
export function framesMatchList(frames: { mjd: number }[], list: QuickLookList): boolean {
  const spans = list.bursts.map((b) => {
    const ex = b.exposures.map((k) => list.exposures[k]).filter(Boolean);
    const lo = Math.min(...ex.map((e) => e.mjd));
    const hi = Math.max(...ex.map((e) => e.mjd_end ?? e.mjd));
    return [lo - FRAME_TIME_SLACK_DAYS, hi + FRAME_TIME_SLACK_DAYS] as const;
  });
  return frames.every((f) => spans.some(([lo, hi]) => f.mjd >= lo && f.mjd <= hi));
}

export type JplRow = { frame: number; name: string; ra: number; dec: number; vmag: number | null };

/** The answer key of a patch from JPL rows. Objects grouped by name; positions on the patch grid. Pure. */
export function buildPatchKey(patch: Patch, rows: JplRow[], tRef: number): AnswerKey {
  const [w, h] = patch.size;
  const by = new Map<string, AnswerObject>();
  for (const r of rows) {
    const xy = skyToPixel(patch.wcs, h, r.ra, r.dec);
    if (!xy) continue;
    const [x, y] = xy;
    if (!(x >= -2 && x <= w + 1 && y >= -2 && y <= h + 1)) continue;
    let o = by.get(r.name);
    if (!o) {
      o = { id: r.name, name: r.name, kind: COMET.test(r.name) ? "comet" : "asteroid", source: "jpl_sb_ident", positions: [] };
      by.set(r.name, o);
    }
    o.positions.push({ frame: r.frame, x, y, in_grid: x >= -0.5 && x < w - 0.5 && y >= -0.5 && y < h - 0.5 });
  }
  return { slug: patch.id, nothing_moves: false, noise_bar_sigma: null, t_ref_mjd: tRef, objects: [...by.values()], bot: { candidates: [] } };
}

const OPEN_NOTHING =
  "Checked: no known object bright enough to see is in this patch. Unknown movers cannot be ruled out, so no points.";

function score(patch: Patch, body: Body, rows: JplRow[]): Scored {
  const frames = [...body.frames].sort((a, b) => a.i - b.i);
  const key = buildPatchKey(patch, rows, frames[0].mjd);
  const field = { slug: patch.id, difficulty: "easy", pixel_arcsec: PIXEL_ARCSEC, size: patch.size, frames };
  if (body.answer === "nothing") {
    const bright = rows.some((r) => {
      const o = key.objects.find((k) => k.name === r.name);
      return r.vmag !== null && r.vmag <= NOTHING_VMAG_LIMIT && o?.positions.some((p) => p.frame === r.frame && p.in_grid);
    });
    if (bright) return scoreSubmission(key, field, { answer: "nothing" });
    const ok = scoreSubmission({ ...key, nothing_moves: true }, field, { answer: "nothing" });
    return { ...ok, verdict: { ...ok.verdict, points: 0, message: OPEN_NOTHING } };
  }
  const sub: Submission = { answer: "track", marks: body.marks };
  return scoreSubmission(key, field, sub);
}

export async function runPatchCheck(request: Request, deps: PatchDeps = realPatchDeps): Promise<Response> {
  rateLimit(request, "patch-check", 10);
  const body = parse(PatchCheckBody, await readJsonBody(request));
  const patch = patchFromId(body.patch);
  if (!patch) throw new ApiFail("bad_request", `"${body.patch}" is not a patch.`);
  const frameIdx = new Set(body.frames.map((f) => f.i));
  if (frameIdx.size !== body.frames.length) throw new ApiFail("bad_request", "Each frame may be listed once.");

  // JPL at the marked frames' times ("nothing": the first and last frame), in parallel with IRSA's list.
  const sorted = [...body.frames].sort((a, b) => a.i - b.i);
  const asked =
    body.answer === "track"
      ? sorted.filter((f) => body.marks.some((m) => m.frame === f.i))
      : [sorted[0], sorted[sorted.length - 1]];
  const half = PATCH_SIZE_DEG / 2 + 0.01;
  const [list, jpl] = await Promise.all([
    deps.list(patch.ra, patch.dec).catch((e: unknown) => {
      console.error("[patch-check] IRSA list failed:", e instanceof Error ? e.message : e);
      return null;
    }),
    Promise.all(asked.map((f) => deps.sbIdent(patch.ra, patch.dec, half, f.mjd))),
  ]);
  if (!list) throw new ApiFail("upstream_failed", "Could not check right now: IRSA did not answer. Try again in a minute.", { service: "irsa" });
  if (!framesMatchList(body.frames, list)) {
    throw new ApiFail("bad_request", "Those frame times are not SPHEREx exposures of this patch.");
  }
  if (jpl.some((r) => r.status === "timeout" || r.status === "error")) {
    throw new ApiFail("upstream_failed", "Could not check right now: JPL's object service did not answer. Try again in a minute.", { service: "jpl" });
  }
  const rows: JplRow[] = jpl.flatMap((r, k) => r.objects.map((o) => ({ frame: asked[k].i, ...o })));

  const scored = score(patch, body, rows);
  const correct = isCorrect(scored.verdict.kind);
  const store = deps.store();
  const user = await deps.user(request).catch(() => null);
  const practice = store !== null && user !== null ? await store.hasSolve(patch.id, user.id) : false;

  // Sky positions only, never names: the map shows these to everyone.
  const key = buildPatchKey(patch, rows, sorted[0].mjd);
  const objects: SkyPoint[] = key.objects.flatMap((o) =>
    o.positions.filter((p) => p.in_grid).map((p) => {
      const [ra, dec] = pixelToSky(patch.wcs, patch.size[1], p.x, p.y);
      return { ra, dec };
    }),
  );
  const mjdOf = new Map(body.frames.map((f) => [f.i, f.mjd]));

  let solve_saved = false;
  if (correct && store && !practice) {
    solve_saved = await store.saveSolve({ patch_id: patch.id, user_id: user?.id ?? null, ra: patch.ra, dec: patch.dec, objects });
  }
  let report: { saved: boolean; positions: SkyPoint[] } | undefined;
  if (scored.verdict.kind === "candidate" && body.answer === "track") {
    const marks = body.marks.map((m) => {
      const [ra, dec] = pixelToSky(patch.wcs, patch.size[1], m.x, m.y);
      return { ...m, ra, dec, mjd: mjdOf.get(m.frame) as number };
    });
    const saved = store
      ? await store.saveReport({ patch_id: patch.id, user_id: user?.id ?? null, ra: patch.ra, dec: patch.dec, marks, frame_times: sorted })
      : false;
    report = { saved, positions: marks.map(({ ra, dec }) => ({ ra, dec })) };
  }

  const known_objects = {
    asteroids: key.objects.map((o) => ({
      name: o.name,
      positions: o.positions.map((p) => {
        const vmag = rows.find((r) => r.name === o.name && r.frame === p.frame)?.vmag ?? null;
        return { frame: p.frame, x: p.x, y: p.y, ...(vmag !== null ? { vmag } : {}) };
      }),
    })),
    stars: [] as [],
  };
  return NextResponse.json({
    ...responseBody(scored, { unlocked: correct, practice }),
    patch: { id: patch.id, ra: patch.ra, dec: patch.dec },
    ...(correct ? { objects, known_objects } : {}),
    ...(report ? { report } : {}),
    solve_saved,
  });
}

const Near = z.object({
  ra: z.coerce.number().finite(),
  dec: z.coerce.number().finite().min(-90).max(90),
  r: z.coerce.number().finite().positive().max(MAX_PATCHES_RADIUS_DEG).default(1),
});

export async function runPatches(request: Request, deps: Pick<PatchDeps, "store"> = realPatchDeps): Promise<Response> {
  rateLimit(request, "patches", 60);
  const q = parse(Near, Object.fromEntries(new URL(request.url).searchParams));
  const store = deps.store();
  const found: PatchSummary[] | null = store ? await store.near(((q.ra % 360) + 360) % 360, q.dec, q.r) : null;
  const body = found === null ? { patches: [], offline: true as const } : { patches: found };
  return NextResponse.json(body, { headers: { "Cache-Control": "public, s-maxage=60" } });
}
