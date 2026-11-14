// POST /api/complete: move a guest's saved replay into the logged-in account (api.md section 4).
// Each entry is checked again on the server and saved. Only HTTP handlers are exported here.

import { NextResponse, type NextRequest } from "next/server";
import { checkSubmission, isCorrect, loadFieldForScoring, ScoringError, type Scored } from "@/lib/scoring";
import { CompleteBody, responseBody } from "@/lib/server/checkResponse";
import { dbConfigured, serviceClient, userFromRequest } from "@/lib/server/db";
import { ApiFail, handle, parse, readJsonBody } from "@/lib/server/http";
import { hasVisit, saveFind, type SaveResult } from "@/lib/server/persist";
import { rateLimit } from "@/lib/server/rateLimit";
import { encodeUnlocked, grantUnlock } from "@/lib/server/unlock";

type Done = { spot: string; scored: Scored; practice: boolean; correct: boolean; save: SaveResult };
type Entry = Done | { error: { code: string; message: string } };

export async function POST(request: NextRequest): Promise<Response> {
  return handle(async () => {
    const body = parse(CompleteBody, await readJsonBody(request));
    // Order: body parse, then the limiters (each replayed entry costs one /api/check unit, so
    // guessing through this route uses the same budget as /api/check), then 503 and 401.
    rateLimit(request, "complete", 5);
    rateLimit(request, "check", 30, 60_000, body.replay.length);
    if (!dbConfigured() || !serviceClient()) {
      throw new ApiFail("db_unavailable", "Saving progress needs the database, which is not set up here.");
    }
    const user = await userFromRequest(request);
    if (!user) throw new ApiFail("unauthorized", "Log in to save your progress.");

    // Practice is decided per spot from the visits saved BEFORE this replay, plus any earlier
    // entry in this replay that answered the spot correctly (api.md section 4).
    const visitedBefore = new Map<string, boolean>();
    for (const spot of new Set(body.replay.map((e) => e.spot))) {
      visitedBefore.set(spot, await hasVisit(user.id, spot));
    }

    const answeredCorrect = new Set<string>();
    const entries: Entry[] = [];
    for (const entry of body.replay) {
      let scored: Scored;
      try {
        scored = await checkSubmission(
          entry.spot,
          entry.answer === "track" ? { answer: "track", marks: entry.marks } : { answer: "nothing" },
        );
      } catch (e) {
        if (e instanceof ScoringError) {
          entries.push({ error: { code: e.code, message: e.message } });
          continue;
        }
        throw e;
      }
      const field = await loadFieldForScoring(entry.spot);
      if (!field) throw new Error(`Spot "${entry.spot}" has no field.json on the server.`);

      const practice = visitedBefore.get(entry.spot) === true || answeredCorrect.has(entry.spot);
      const correct = isCorrect(scored.verdict.kind);
      const save = await saveFind(request, entry.spot, field, scored, practice, { user: async () => user });
      if (correct) answeredCorrect.add(entry.spot);
      entries.push({ spot: entry.spot, scored, practice, correct, save });
    }

    // The unlock cookie covers every spot answered correctly. With no signing key (production
    // without UNLOCK_SECRET) no cookie is set, so those answers stay locked (api.md section 2).
    const correctSpots = [...answeredCorrect];
    const signing = correctSpots.length === 0 || encodeUnlocked(correctSpots) !== null;

    const results = entries.map((e) => {
      if ("error" in e) return e;
      const unlocked = e.practice || (e.correct && signing);
      return responseBody(e.scored, { unlocked, practice: e.practice }, e.save);
    });
    const totalPoints = entries.reduce(
      (sum, e) => (("error" in e || e.save.already_found) ? sum : sum + e.save.points),
      0,
    );

    const response = NextResponse.json({ results, total_points: totalPoints });
    if (correctSpots.length > 0) grantUnlock(request, response, correctSpots);
    return response;
  });
}
