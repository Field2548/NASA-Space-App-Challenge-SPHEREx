// POST /api/check: check a player's submission against the private answer key.
// Contract: docs/contracts/api.md section 3. Points are computed here and nowhere else.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { checkSubmission, isCorrect } from "@/lib/scoring";
import { handle, parse, readJsonBody } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";
import { grantUnlock, isUnlocked } from "@/lib/server/unlock";

const Slug = z.string().regex(/^[a-z0-9-]{1,40}$/);
// Coarse bounds here; the scorer then refuses marks more than 2 px outside the spot's picture.
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

export async function POST(request: NextRequest): Promise<Response> {
  return handle(async () => {
    rateLimit(request, "check", 30);
    const body = parse(CheckBody, await readJsonBody(request));
    const scored = await checkSubmission(
      body.spot,
      body.answer === "track" ? { answer: "track", marks: body.marks } : { answer: "nothing" },
    );

    // The spoiler lock is off once this player has a correct answer here (section 2). After
    // that the spot is open, so answers are still judged but earn nothing ("practice").
    const practice = isUnlocked(request, body.spot);
    const correct = isCorrect(scored.verdict.kind);
    const verdict = practice
      ? { ...scored.verdict, points: 0, message: scored.verdict.message + PRACTICE_SUFFIX }
      : scored.verdict;

    // No database yet (issue #3 item 1): nothing is saved, so there is no first finder.
    const answer = (unlocked: boolean) =>
      NextResponse.json({
        verdict,
        first_finder: false,
        already_found: false,
        persisted: false,
        unlocked,
        practice,
        ...(scored.reveal ? { reveal: scored.reveal } : {}),
        ...(scored.track ? { track: scored.track } : {}),
        noise_bar_sigma: scored.noise_bar_sigma,
      });

    // Only a correct answer unlocks; a wrong one leaves the spot locked so the player can try again.
    if (correct && !practice) {
      const response = answer(true);
      if (grantUnlock(request, response, [body.spot])) return response;
      // Production without UNLOCK_SECRET: no cookie can be signed, so say so honestly.
    }
    return answer(practice);
  });
}
