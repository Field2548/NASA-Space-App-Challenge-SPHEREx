// Server-only scoring. Never import this from a client component: it reads the private
// answer keys in web/data/answers/. Contract: docs/contracts/api.md section 3.
// Answer-key and field shapes: docs/contracts/field-schema.md (DATA).
//
// The pure functions (fitTrack, scoreSubmission, pointsFor) take the answer key as an
// argument so tests can run them without the file system.

import { readFile } from "node:fs/promises";
import path from "node:path";

// ------------------------------------------------------------------ shapes

export type VerdictKind =
  | "known"
  | "bot_match"
  | "candidate"
  | "static"
  | "nothing_correct"
  | "nothing_wrong";

export type Verdict = {
  kind: VerdictKind;
  object_name?: string;
  points: number;
  message: string;
};

export type Mark = { frame: number; x: number; y: number };
export type Submission = { answer: "track"; marks: Mark[] } | { answer: "nothing" };

export type FittedTrack = {
  x0: number; // position at the first marked frame's time, px, top-down
  y0: number;
  vx: number; // px per day
  vy: number;
  rms: number; // px
  rate_arcsec_per_hour: number;
};

export type AnswerObject = {
  id: string;
  name: string;
  kind: string;
  source?: string;
  positions: { frame: number; x: number; y: number; in_grid: boolean }[];
  vx_px_per_day?: number;
  vy_px_per_day?: number;
};

export type BotCandidate = {
  rank: number;
  x: number; // position at t_ref_mjd
  y: number;
  vx_px_per_day: number;
  vy_px_per_day: number;
  stacked_snr: number;
  above_noise_bar: boolean;
};

export type AnswerKey = {
  slug: string;
  nothing_moves: boolean;
  noise_bar_sigma: number | null;
  t_ref_mjd: number;
  objects: AnswerObject[];
  bot: { source?: string; candidates: BotCandidate[] };
};

export type FieldForScoring = {
  slug: string;
  difficulty: string;
  pixel_arcsec: number;
  frames: { i: number; mjd: number }[];
};

export type Scored = {
  verdict: Verdict;
  track?: FittedTrack;
  /** Where to open Inspect as the reward. Only for `known`. */
  reveal?: { frame: number; x: number; y: number };
  noise_bar_sigma: number | null;
  /** Internal: which answer-key object or bot candidate matched. Not sent to the client. */
  matched?: { object_id?: string; bot_rank?: number };
};

export class ScoringError extends Error {
  code: "bad_request" | "not_found";
  constructor(code: "bad_request" | "not_found", message: string) {
    super(message);
    this.code = code;
  }
}

// ------------------------------------------------------------------ rules (BP 8.10)

/** A mark counts as "on" a known object or bot candidate within this many pixels. */
export const MATCH_RADIUS_PX = 2;
/** A known object must be matched in at least this many different frames. */
export const MIN_MATCHED_FRAMES = 2;
/** Bot match: the fitted velocity must agree this closely (px per day)... */
export const BOT_VELOCITY_TOL_PX_DAY = 2;
/** ...and a track that moved less than this in total is a star, not a mover. */
export const STATIC_MOTION_PX = 1;

const BASE_POINTS: Record<string, number> = {
  easy: 100,
  medium: 250,
  hard: 500,
  boss: 1000,
  expert: 750,
  control: 250, // SERVER decision (BP is silent): the "Nothing moved" spot scores like medium
  fixture: 100,
};
export const FIRST_FINDER_BONUS = 0.5;

/** Points for a verdict. Only `known`, `bot_match` and `nothing_correct` score. */
export function pointsFor(
  kind: VerdictKind,
  difficulty: string,
  firstFinder: boolean,
): number {
  if (kind !== "known" && kind !== "bot_match" && kind !== "nothing_correct") return 0;
  const base = BASE_POINTS[difficulty] ?? 0;
  return firstFinder ? Math.round(base * (1 + FIRST_FINDER_BONUS)) : base;
}

/** The extra points a first finder gets on top of the base score. */
export function firstFinderBonus(kind: VerdictKind, difficulty: string): number {
  return pointsFor(kind, difficulty, true) - pointsFor(kind, difficulty, false);
}

// ------------------------------------------------------------------ track fit

/** Least-squares straight line through the marks. Times come from the field's frames. */
export function fitTrack(marks: Mark[], field: FieldForScoring): FittedTrack {
  const mjd = new Map(field.frames.map((f) => [f.i, f.mjd]));
  const pts = marks
    .map((m) => ({ t: mjd.get(m.frame) as number, x: m.x, y: m.y }))
    .sort((a, b) => a.t - b.t);
  const t0 = pts[0].t;
  const n = pts.length;
  const ts = pts.map((p) => p.t - t0);
  const tMean = ts.reduce((s, t) => s + t, 0) / n;
  const xMean = pts.reduce((s, p) => s + p.x, 0) / n;
  const yMean = pts.reduce((s, p) => s + p.y, 0) / n;
  let stt = 0;
  let stx = 0;
  let sty = 0;
  for (let k = 0; k < n; k++) {
    const dt = ts[k] - tMean;
    stt += dt * dt;
    stx += dt * (pts[k].x - xMean);
    sty += dt * (pts[k].y - yMean);
  }
  const vx = stt > 0 ? stx / stt : 0;
  const vy = stt > 0 ? sty / stt : 0;
  const x0 = xMean - vx * tMean;
  const y0 = yMean - vy * tMean;
  let ss = 0;
  for (let k = 0; k < n; k++) {
    const dx = pts[k].x - (x0 + vx * ts[k]);
    const dy = pts[k].y - (y0 + vy * ts[k]);
    ss += dx * dx + dy * dy;
  }
  const speed = Math.hypot(vx, vy); // px per day
  return {
    x0,
    y0,
    vx,
    vy,
    rms: Math.sqrt(ss / n),
    rate_arcsec_per_hour: (speed * field.pixel_arcsec) / 24,
  };
}

// ------------------------------------------------------------------ the check

function validateMarks(marks: Mark[], field: FieldForScoring): void {
  const known = new Set(field.frames.map((f) => f.i));
  const seen = new Set<number>();
  for (const m of marks) {
    if (!known.has(m.frame)) {
      throw new ScoringError("bad_request", `This spot has no frame ${m.frame}.`);
    }
    if (seen.has(m.frame)) {
      throw new ScoringError("bad_request", `Frame ${m.frame} is marked twice. Mark each frame once.`);
    }
    seen.add(m.frame);
  }
  if (seen.size < 2) {
    throw new ScoringError("bad_request", "Mark the object in at least 2 different frames.");
  }
}

const fmt = (v: number) => v.toFixed(1);

/** Score one submission against one answer key. Pure: no I/O, no database. */
export function scoreSubmission(
  key: AnswerKey,
  field: FieldForScoring,
  sub: Submission,
): Scored {
  const noise_bar_sigma = key.noise_bar_sigma ?? null;
  const make = (
    kind: VerdictKind,
    message: string,
    extra: Partial<Scored> = {},
    object_name?: string,
  ): Scored => ({
    verdict: {
      kind,
      ...(object_name ? { object_name } : {}),
      points: pointsFor(kind, field.difficulty, false),
      message,
    },
    noise_bar_sigma,
    ...extra,
  });

  if (sub.answer === "nothing") {
    return key.nothing_moves
      ? make("nothing_correct", "Correct: nothing moved here. Every dot is a star that stays put.")
      : make("nothing_wrong", "Something does move here. Look again.");
  }

  validateMarks(sub.marks, field);
  const track = fitTrack(sub.marks, field);

  // 1. A known object: within 2 px of its answer-key position in at least 2 frames.
  let best: { obj: AnswerObject; hits: Mark[] } | null = null;
  for (const obj of key.objects) {
    const pos = new Map(obj.positions.filter((p) => p.in_grid).map((p) => [p.frame, p]));
    const hits = sub.marks.filter((m) => {
      const p = pos.get(m.frame);
      return p !== undefined && Math.hypot(m.x - p.x, m.y - p.y) <= MATCH_RADIUS_PX;
    });
    if (hits.length >= MIN_MATCHED_FRAMES && (!best || hits.length > best.hits.length)) {
      best = { obj, hits };
    }
  }
  if (best) {
    const first = best.hits.reduce((a, b) => (a.frame <= b.frame ? a : b));
    const p = best.obj.positions.find((q) => q.frame === first.frame)!;
    return make(
      "known",
      `Confirmed: ${best.obj.name}, ${best.obj.kind.replace(/-/g, " ")}.`,
      { track, reveal: { frame: p.frame, x: p.x, y: p.y }, matched: { object_id: best.obj.id } },
      best.obj.name,
    );
  }

  // 2. Did it move at all? Under 1 px in total over the marked frames = a star.
  const mjd = new Map(field.frames.map((f) => [f.i, f.mjd]));
  const times = sub.marks.map((m) => mjd.get(m.frame) as number);
  const spanDays = Math.max(...times) - Math.min(...times);
  if (Math.hypot(track.vx, track.vy) * spanDays < STATIC_MOTION_PX) {
    return make("static", "That one didn't move; it's a star.", { track });
  }

  // 3. A bot candidate above the noise bar. Never claimed without the noise bar.
  if (noise_bar_sigma !== null) {
    for (const c of key.bot.candidates) {
      if (!c.above_noise_bar || !(c.stacked_snr > noise_bar_sigma)) continue;
      const onPath = sub.marks.every((m) => {
        const dt = (mjd.get(m.frame) as number) - key.t_ref_mjd;
        const px = c.x + c.vx_px_per_day * dt;
        const py = c.y + c.vy_px_per_day * dt;
        return Math.hypot(m.x - px, m.y - py) <= MATCH_RADIUS_PX;
      });
      const dv = Math.hypot(track.vx - c.vx_px_per_day, track.vy - c.vy_px_per_day);
      // Marks that are each within 2 px of the bot's path can still differ in fitted speed
      // by up to (2 * 2 px) / span when the frames are close in time, so allow for that.
      const tol = Math.max(BOT_VELOCITY_TOL_PX_DAY, (2 * MATCH_RADIUS_PX) / spanDays);
      if (onPath && dv <= tol) {
        return make(
          "bot_match",
          `Matches the bot: ${fmt(c.stacked_snr)}σ against a ${fmt(noise_bar_sigma)}σ noise bar.`,
          { track, matched: { bot_rank: c.rank } },
        );
      }
    }
  }

  // 4. Moves, matches nothing we know.
  return make(
    "candidate",
    "Unconfirmed candidate. It is saved, but earns no points until other players agree.",
    { track },
  );
}

// ------------------------------------------------------------------ file loading

const SLUG = /^[a-z0-9-]{1,40}$/;

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/** Root of the Next.js app (the `web/` folder). Tests may pass another root. */
function webRoot(root?: string): string {
  return root ?? process.cwd();
}

export async function loadAnswerKey(slug: string, root?: string): Promise<AnswerKey | null> {
  if (!SLUG.test(slug)) return null;
  return readJson<AnswerKey>(path.join(webRoot(root), "data", "answers", `${slug}.json`));
}

export async function loadFieldForScoring(
  slug: string,
  root?: string,
): Promise<FieldForScoring | null> {
  if (!SLUG.test(slug)) return null;
  return readJson<FieldForScoring>(
    path.join(webRoot(root), "public", "fields", slug, "field.json"),
  );
}

/** Check a submission for a ready spot. Throws ScoringError for an unknown spot or bad marks. */
export async function checkSubmission(
  slug: string,
  sub: Submission,
  root?: string,
): Promise<Scored> {
  const [key, field] = await Promise.all([
    loadAnswerKey(slug, root),
    loadFieldForScoring(slug, root),
  ]);
  if (!key || !field) throw new ScoringError("not_found", `No spot called "${slug}".`);
  return scoreSubmission(key, field, sub);
}
