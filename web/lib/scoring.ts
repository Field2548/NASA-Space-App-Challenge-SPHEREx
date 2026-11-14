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
  /** The spot's real title, sent to the player once the spot is open (api.md section 3). */
  reveal?: { title: string; kind: string; difficulty: string };
};

export type FieldForScoring = {
  slug: string;
  difficulty: string;
  /** The spot centre, degrees (field.json `ra`, `dec`). Used for the Finds layer, never the mover. */
  ra?: number;
  dec?: number;
  pixel_arcsec: number;
  /** [width, height] in pixels (field.json `size`). */
  size: [number, number];
  frames: { i: number; mjd: number }[];
};

/**
 * What "the same find" means in a spot, so a player cannot score one thing twice.
 * `object:<id>` for a known object (however it was reached), `bot:<rank>` for a bot candidate
 * that is not a known object, `nothing` for a correct "Nothing moved here".
 * The route passes it to `record_find(p_find_key)` (supabase migration).
 */
export type FindKey = `object:${string}` | `bot:${number}` | "nothing";

export type Scored = {
  verdict: Verdict;
  track?: FittedTrack;
  /** Where to open Inspect as the reward. Only for `known`. */
  reveal?: { frame: number; x: number; y: number };
  noise_bar_sigma: number | null;
  /** Internal: which answer-key object or bot candidate matched. Not sent to the client. */
  matched?: { find_key: FindKey; object_id?: string; bot_rank?: number };
  /** The spot's real title and kind, from the answer key's `reveal`. undefined when the key has none. */
  spot_reveal?: { title: string; kind: string; difficulty: string };
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
/**
 * A bot candidate "is" a known object when its predicted path passes this close to the
 * object's answer-key positions in at least MIN_MATCHED_FRAMES frames. 3 px, not 2: the bot's
 * straight-line path for Hektor is up to 2.5 px from JPL's positions.
 */
export const BOT_KNOWN_RADIUS_PX = 3;
/**
 * A bot candidate is above the noise bar when it is flagged above it and its stacked S/N is
 * over the spot's bar. No bar (null) means no candidate counts. The one shared rule for
 * /api/check (bot_match) and the bot's scoreboard row.
 */
export function isAboveBar(
  c: { above_noise_bar: boolean; stacked_snr: number },
  noiseBar: number | null,
): boolean {
  return noiseBar !== null && c.above_noise_bar && c.stacked_snr > noiseBar;
}

/** A track that moved less than this in total is a star, not a mover. */
export const STATIC_MOTION_PX = 1;
/** Marks may sit at most this far outside the picture (a click on the edge pixel's border). */
export const MARK_MARGIN_PX = 2;
// No separate velocity tolerance for bot matches (removed in api.md 1.2): marks that are on the
// bot's path in every marked frame, in at least 2 frames, already pin its velocity down.

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

/** Verdicts that count as a correct submission for accuracy (and unlock the spot). */
export const CORRECT_VERDICTS: readonly VerdictKind[] = ["known", "bot_match", "nothing_correct"];
export const isCorrect = (kind: VerdictKind): boolean => CORRECT_VERDICTS.includes(kind);

/**
 * Points for a verdict. Only `known` and `nothing_correct` score. `bot_match` is correct but
 * earns 0 (api.md 1.2: a bot candidate that is no known object is not a confirmed find).
 * The first-finder bonus applies to `known` only.
 */
export function pointsFor(
  kind: VerdictKind,
  difficulty: string,
  firstFinder: boolean,
): number {
  if (kind !== "known" && kind !== "nothing_correct") return 0;
  const base = BASE_POINTS[difficulty] ?? 0;
  return firstFinder && kind === "known" ? Math.round(base * (1 + FIRST_FINDER_BONUS)) : base;
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
  const [w, h] = field.size;
  for (const m of marks) {
    if (!known.has(m.frame)) {
      throw new ScoringError("bad_request", `This spot has no frame ${m.frame}.`);
    }
    if (seen.has(m.frame)) {
      throw new ScoringError("bad_request", `Frame ${m.frame} is marked twice. Mark each frame once.`);
    }
    if (
      !Number.isFinite(m.x) ||
      !Number.isFinite(m.y) ||
      m.x < -MARK_MARGIN_PX ||
      m.y < -MARK_MARGIN_PX ||
      m.x > w - 1 + MARK_MARGIN_PX ||
      m.y > h - 1 + MARK_MARGIN_PX
    ) {
      throw new ScoringError("bad_request", `The mark in frame ${m.frame} is outside the picture.`);
    }
    seen.add(m.frame);
  }
  if (seen.size < 2) {
    throw new ScoringError("bad_request", "Mark the object in at least 2 different frames.");
  }
}

const fmt = (v: number) => v.toFixed(1);

/** Where a bot candidate's straight-line path is at a given time (answer-key convention). */
export function botPosition(key: AnswerKey, c: BotCandidate, mjd: number): { x: number; y: number } {
  const dt = mjd - key.t_ref_mjd;
  return { x: c.x + c.vx_px_per_day * dt, y: c.y + c.vy_px_per_day * dt };
}

/**
 * The known object a bot candidate is, or null: its predicted path is within
 * BOT_KNOWN_RADIUS_PX of the object's in-grid answer positions in at least 2 frames.
 */
export function botCandidateObject(
  key: AnswerKey,
  field: Pick<FieldForScoring, "frames">,
  c: BotCandidate,
): AnswerObject | null {
  const mjd = new Map(field.frames.map((f) => [f.i, f.mjd]));
  for (const obj of key.objects) {
    let frames = 0;
    for (const p of obj.positions) {
      const t = mjd.get(p.frame);
      if (!p.in_grid || t === undefined) continue;
      const b = botPosition(key, c, t);
      if (Math.hypot(b.x - p.x, b.y - p.y) <= BOT_KNOWN_RADIUS_PX) frames += 1;
    }
    if (frames >= MIN_MATCHED_FRAMES) return obj;
  }
  return null;
}

/**
 * Score one submission against one answer key. Pure: no I/O, no database.
 * Order (api.md section 3): known, then bot_match, then static, then candidate.
 */
export function scoreSubmission(
  key: AnswerKey,
  field: FieldForScoring,
  sub: Submission,
): Scored {
  const noise_bar_sigma = key.noise_bar_sigma ?? null;
  const spot_reveal = key.reveal
    ? { title: key.reveal.title, kind: key.reveal.kind, difficulty: key.reveal.difficulty }
    : undefined;
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
    spot_reveal,
    ...extra,
  });

  if (sub.answer === "nothing") {
    return key.nothing_moves
      ? make("nothing_correct", "Correct: nothing moved here. Every dot is a star that stays put.", {
          matched: { find_key: "nothing" },
        })
      : make("nothing_wrong", "Something does move here. Look again.");
  }

  validateMarks(sub.marks, field);
  const track = fitTrack(sub.marks, field);
  if (!Object.values(track).every(Number.isFinite)) {
    throw new ScoringError("bad_request", "Those marks do not make a track. Mark the object again.");
  }
  const mjd = new Map(field.frames.map((f) => [f.i, f.mjd]));

  const known = (obj: AnswerObject, hits: Mark[]): Scored => {
    // Reveal at the earliest in-grid answer position among the hit frames (else the first in-grid one).
    const inGrid = obj.positions.filter((q) => q.in_grid);
    const hitFrames = new Set(hits.map((m) => m.frame));
    const p =
      inGrid.filter((q) => hitFrames.has(q.frame)).sort((a, b) => a.frame - b.frame)[0] ??
      inGrid.sort((a, b) => a.frame - b.frame)[0];
    return make(
      "known",
      `Confirmed: ${obj.name}, ${obj.kind.replace(/-/g, " ")}.`,
      {
        track,
        ...(p ? { reveal: { frame: p.frame, x: p.x, y: p.y } } : {}),
        matched: { find_key: `object:${obj.id}`, object_id: obj.id },
      },
      obj.name,
    );
  };

  // 1a. A known object: within 2 px of its answer-key position in at least 2 frames.
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
  if (best) return known(best.obj, best.hits);

  // Bot candidates whose path the marks follow: within 2 px in every marked frame (at least 2
  // frames, guaranteed by validateMarks). That fixes the velocity too, so there is no separate
  // velocity check.
  const onPath = key.bot.candidates.filter((c) =>
    sub.marks.every((m) => {
      const b = botPosition(key, c, mjd.get(m.frame) as number);
      return Math.hypot(m.x - b.x, m.y - b.y) <= MATCH_RADIUS_PX;
    }),
  );

  // 1b. A known object reached through the bot's path (Hektor's bot path is up to 2.5 px off JPL).
  // Same object, same name, same points and same find key as a direct hit: never a second find.
  for (const c of onPath) {
    const obj = botCandidateObject(key, field, c);
    if (obj) return known(obj, sub.marks);
  }

  // 2. A bot candidate above the noise bar that is no known object: correct, but 0 points.
  // Never claimed without the noise bar.
  if (noise_bar_sigma !== null) {
    for (const c of onPath) {
      if (!isAboveBar(c, noise_bar_sigma)) continue;
      return make(
        "bot_match",
        `Matches the bot: ${fmt(c.stacked_snr)}σ against a ${fmt(noise_bar_sigma)}σ noise bar. ` +
          "Not a confirmed object, so no points.",
        { track, matched: { find_key: `bot:${c.rank}`, bot_rank: c.rank } },
      );
    }
  }

  // 3. Did it move at all? Under 1 px in total over the marked frames = a star.
  const times = sub.marks.map((m) => mjd.get(m.frame) as number);
  const spanDays = Math.max(...times) - Math.min(...times);
  if (Math.hypot(track.vx, track.vy) * spanDays < STATIC_MOTION_PX) {
    return make("static", "That one didn't move; it's a star.", { track });
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

/** Slugs listed in public/fields/index.json. A missing or broken index is a server fault. */
export async function readySlugs(root?: string): Promise<string[]> {
  const file = path.join(webRoot(root), "public", "fields", "index.json");
  const raw = await readJson<unknown>(file);
  if (!Array.isArray(raw)) throw new Error(`Cannot read the spot list ${file}.`);
  return raw.flatMap((s) => (s && typeof s.slug === "string" ? [s.slug as string] : []));
}

/**
 * Check a submission for a ready spot. Throws ScoringError for an unknown spot or bad marks.
 * A spot listed in index.json whose answer key or field.json cannot be read is a server fault
 * (a plain Error, which the route answers as 500 `internal`), never `not_found`. A spot that is
 * not listed (the test-only `fixture`) is scored when both files exist, else it is `not_found`.
 */
export async function checkSubmission(
  slug: string,
  sub: Submission,
  root?: string,
): Promise<Scored> {
  if (!SLUG.test(slug)) throw new ScoringError("not_found", `No spot called "${slug}".`);
  const [listed, key, field] = await Promise.all([
    readySlugs(root).then((s) => s.includes(slug)),
    loadAnswerKey(slug, root),
    loadFieldForScoring(slug, root),
  ]);
  if (!key || !field) {
    if (listed || key || field) {
      throw new Error(`Spot "${slug}" is missing its ${key ? "field.json" : "answer key"} on the server.`);
    }
    throw new ScoringError("not_found", `No spot called "${slug}".`);
  }
  return scoreSubmission(key, field, sub);
}
