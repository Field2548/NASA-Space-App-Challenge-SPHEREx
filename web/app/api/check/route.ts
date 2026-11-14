// POST /api/check: check a player's submission against the private answer key.
// Contract: docs/contracts/api.md section 3. Points are computed here and nowhere else.
// Only HTTP handlers are exported from this file (Next.js route rule); the schema and the
// response body live in lib/server/checkResponse.ts.

import { NextResponse, type NextRequest } from "next/server";
import { checkSubmission, isCorrect, loadFieldForScoring } from "@/lib/scoring";
import { responseBody, CheckBody } from "@/lib/server/checkResponse";
import { userFromRequest } from "@/lib/server/db";
import { handle, parse, readJsonBody } from "@/lib/server/http";
import { hasVisit, saveFind } from "@/lib/server/persist";
import { rateLimit } from "@/lib/server/rateLimit";
import { grantUnlock, isUnlocked } from "@/lib/server/unlock";

export async function POST(request: NextRequest): Promise<Response> {
  return handle(async () => {
    rateLimit(request, "check", 30);
    const body = parse(CheckBody, await readJsonBody(request));
    const scored = await checkSubmission(
      body.spot,
      body.answer === "track" ? { answer: "track", marks: body.marks } : { answer: "nothing" },
    );
    const field = await loadFieldForScoring(body.spot);
    if (!field) throw new Error(`Spot "${body.spot}" has no field.json on the server.`);

    // The spoiler lock is off once this player has a correct answer here (section 2), or a
    // saved visit to the spot (logged in). After that the spot is open, so answers are still
    // judged but earn nothing ("practice").
    const user = await userFromRequest(request);
    const practice = isUnlocked(request, body.spot) || (user !== null && (await hasVisit(user.id, body.spot)));
    const correct = isCorrect(scored.verdict.kind);

    // Saved (or not, with no database or a failing one): the save decides first finder and points.
    const save = await saveFind(request, body.spot, field, scored, practice, { user: async () => user });

    const answer = (unlocked: boolean) =>
      NextResponse.json(responseBody(scored, { unlocked, practice }, save));

    // Only a correct answer unlocks; a wrong one leaves the spot locked so the player can try again.
    if (correct && !practice) {
      const response = answer(true);
      if (grantUnlock(request, response, [body.spot])) return response;
      // Production without UNLOCK_SECRET: no cookie can be signed, so say so honestly.
    }
    return answer(practice);
  });
}
