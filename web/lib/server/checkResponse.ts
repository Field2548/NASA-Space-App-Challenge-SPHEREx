// The POST /api/check request schema and response body (owner: SERVER). Server only.
// Lives here, not in app/api/check/route.ts, because Next.js route files may only export HTTP handlers.
// Contract: docs/contracts/api.md section 3.

import { z } from "zod";
import type { Scored } from "@/lib/scoring";

// Coarse bounds here; the scorer then refuses marks more than 2 px outside the spot's picture.
const Slug = z.string().regex(/^[a-z0-9-]{1,40}$/);
const Coord = z.number().finite().min(-64).max(4096);
const Mark = z.object({
  frame: z.number().int().min(1),
  x: Coord,
  y: Coord,
});
export const CheckBody = z.discriminatedUnion("answer", [
  z.object({ spot: Slug, answer: z.literal("track"), marks: z.array(Mark).min(2).max(32) }),
  z.object({ spot: Slug, answer: z.literal("nothing") }),
]);

export const PRACTICE_SUFFIX = " Practice: this spot is already open, so no points.";

/**
 * The JSON body of a /api/check answer. `unlocked`: the spot's lock is off for this player now.
 * `practice`: the spot was already open before this call, so the verdict earns 0 points.
 * `spot_reveal` (the spot's real title) is sent only when the spot is open: unlocked or practice.
 * A wrong answer to a locked spot never carries it.
 */
export function responseBody(scored: Scored, state: { unlocked: boolean; practice: boolean }) {
  const { unlocked, practice } = state;
  const verdict = practice
    ? { ...scored.verdict, points: 0, message: scored.verdict.message + PRACTICE_SUFFIX }
    : scored.verdict;
  const open = unlocked || practice;
  return {
    verdict,
    first_finder: false, // No database yet (issue #3 item 1): nothing is saved, so there is no first finder.
    already_found: false,
    persisted: false,
    unlocked,
    practice,
    ...(scored.reveal ? { reveal: scored.reveal } : {}),
    ...(scored.track ? { track: scored.track } : {}),
    noise_bar_sigma: scored.noise_bar_sigma,
    ...(open && scored.spot_reveal ? { spot_reveal: scored.spot_reveal } : {}),
  };
}
