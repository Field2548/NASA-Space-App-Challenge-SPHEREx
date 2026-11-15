// The work behind POST /api/check and POST /api/complete. Server only.
// Lives here, not in the route files, because Next.js route files may only export HTTP handlers,
// and so tests can inject a database and a login (FlowDeps) without a real Supabase.
// Contract: docs/contracts/api.md sections 2, 3 and 4.

import { NextResponse } from "next/server";
import { checkSubmission, isCorrect, loadFieldForScoring, ScoringError, type Scored } from "@/lib/scoring";
import { CheckBody, CompleteBody, responseBody } from "@/lib/server/checkResponse";
import { dbConfigured, serviceClient, userFromRequest } from "@/lib/server/db";
import { ApiFail, parse, readJsonBody } from "@/lib/server/http";
import { hasVisit, saveFind, type PersistDeps, type SaveResult } from "@/lib/server/persist";
import { rateLimit } from "@/lib/server/rateLimit";
import { encodeUnlocked, grantUnlock, isUnlocked } from "@/lib/server/unlock";

/** Test seams. The defaults are the real database, login and visit lookup. */
export type FlowDeps = {
  /** Passed to saveFind and hasVisit: the database client and the login lookup. */
  persist: PersistDeps;
  /** True when a database can be written (url, anon key and service key set). */
  dbConfigured: () => boolean;
  hasVisit: (userId: string, slug: string, deps: PersistDeps) => Promise<boolean>;
};

export const realFlowDeps: FlowDeps = {
  persist: {},
  dbConfigured: () => dbConfigured() && serviceClient() !== null,
  hasVisit,
};

/**
 * Is this answer practice (judged, but worth 0 points)? A logged-in player with a database is
 * judged by their saved visits only: the unlock cookie lives in the browser and only lifts the
 * spoiler lock, so it must not cost a player the points of a spot they have not saved yet (for
 * example one a guest session unlocked before they logged in). A guest, or any player with no
 * database, has nothing else to go on, so for them the cookie decides. Pure.
 */
export function decidePractice(s: {
  loggedIn: boolean;
  dbConfigured: boolean;
  cookieCovers: boolean;
  hasVisit: boolean;
}): boolean {
  return s.loggedIn && s.dbConfigured ? s.hasVisit : s.cookieCovers;
}

/** A visit lookup that never throws: an error counts as "no visit". */
async function visitOrFalse(deps: FlowDeps, userId: string, slug: string): Promise<boolean> {
  try {
    return await deps.hasVisit(userId, slug, deps.persist);
  } catch (e) {
    console.error(`[check] could not read the visit to "${slug}":`, e);
    return false;
  }
}

export async function runCheck(request: Request, deps: FlowDeps = realFlowDeps): Promise<Response> {
  rateLimit(request, "check", 30);
  const body = parse(CheckBody, await readJsonBody(request));
  const scored = await checkSubmission(
    body.spot,
    body.answer === "track" ? { answer: "track", marks: body.marks } : { answer: "nothing" },
  );
  const field = await loadFieldForScoring(body.spot);
  if (!field) throw new Error(`Spot "${body.spot}" has no field.json on the server.`);

  // Practice (api.md section 3): see decidePractice. The cookie still decides `unlocked`.
  const user = await (deps.persist.user ?? userFromRequest)(request);
  const cookieCovers = isUnlocked(request, body.spot);
  const db = deps.dbConfigured();
  const visited = user !== null && db ? await visitOrFalse(deps, user.id, body.spot) : false;
  const practice = decidePractice({ loggedIn: user !== null, dbConfigured: db, cookieCovers, hasVisit: visited });
  const correct = isCorrect(scored.verdict.kind);

  // Saved (or not, with no database or a failing one): the save decides first finder and points.
  const save = await saveFind(request, body.spot, field, scored, practice, { ...deps.persist, user: async () => user });

  const answer = (unlocked: boolean) => NextResponse.json(responseBody(scored, { unlocked, practice }, save));

  // Only a correct answer unlocks; a wrong one leaves the spot locked so the player can try again.
  if (correct && !practice) {
    const response = answer(true);
    if (grantUnlock(request, response, [body.spot])) return response;
    // Production without UNLOCK_SECRET: no cookie can be signed, so say so honestly.
  }
  // A cookie that already covers the spot keeps it open even when the answer earns points.
  return answer(practice || cookieCovers);
}

type Done = { spot: string; scored: Scored; practice: boolean; correct: boolean; save: SaveResult };
type Entry = Done | { error: { code: string; message: string } };

export async function runComplete(request: Request, deps: FlowDeps = realFlowDeps): Promise<Response> {
  const body = parse(CompleteBody, await readJsonBody(request));
  // Order (api.md section 4): body parse, this route's own call limit, then 503 (no database) and
  // 401 (no login), and only then the shared "check" budget, one unit per replayed entry. A call
  // that fails before the budget is charged must not drain a player's /api/check budget.
  rateLimit(request, "complete", 5);
  if (!deps.dbConfigured()) {
    throw new ApiFail("db_unavailable", "Saving progress needs the database, which is not set up here.");
  }
  const user = await (deps.persist.user ?? userFromRequest)(request);
  if (!user) throw new ApiFail("unauthorized", "Log in to save your progress.");
  rateLimit(request, "check", 30, 60_000, body.replay.length);

  // Practice is decided per spot from the visits saved BEFORE this replay, plus any earlier
  // entry in this replay that answered the spot correctly (api.md section 4). Never the cookie.
  const visitedBefore = new Map<string, boolean>();
  for (const spot of new Set(body.replay.map((e) => e.spot))) {
    visitedBefore.set(spot, await visitOrFalse(deps, user.id, spot));
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
    const save = await saveFind(request, entry.spot, field, scored, practice, { ...deps.persist, user: async () => user });
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
    (sum, e) => ("error" in e || e.save.already_found ? sum : sum + e.save.points),
    0,
  );

  const response = NextResponse.json({ results, total_points: totalPoints });
  if (correctSpots.length > 0) grantUnlock(request, response, correctSpots);
  return response;
}
