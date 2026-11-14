// POST /api/check: check a player's submission against the private answer key.
// Contract: docs/contracts/api.md section 3. Points are computed here and nowhere else.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { checkSubmission } from "@/lib/scoring";
import { handle, parse, readJsonBody } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";
import { grantUnlock } from "@/lib/server/unlock";

const Slug = z.string().regex(/^[a-z0-9-]{1,40}$/);
const Mark = z.object({
  frame: z.number().int().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
});
export const CheckBody = z.discriminatedUnion("answer", [
  z.object({ spot: Slug, answer: z.literal("track"), marks: z.array(Mark).min(2).max(32) }),
  z.object({ spot: Slug, answer: z.literal("nothing") }),
]);

export async function POST(request: NextRequest): Promise<Response> {
  return handle(async () => {
    rateLimit(request, "check", 30);
    const body = parse(CheckBody, await readJsonBody(request));
    const scored = await checkSubmission(
      body.spot,
      body.answer === "track" ? { answer: "track", marks: body.marks } : { answer: "nothing" },
    );

    // No database yet (issue #3 item 1): nothing is saved, so there is no first finder.
    const response = NextResponse.json({
      verdict: scored.verdict,
      first_finder: false,
      already_found: false,
      persisted: false,
      unlocked: true,
      ...(scored.reveal ? { reveal: scored.reveal } : {}),
      ...(scored.track ? { track: scored.track } : {}),
      noise_bar_sigma: scored.noise_bar_sigma,
    });
    grantUnlock(request, response, [body.spot]);
    return response;
  });
}
