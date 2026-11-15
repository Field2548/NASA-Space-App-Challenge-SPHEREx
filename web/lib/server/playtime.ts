// POST /api/playtime: a logged-in player reports play time (owner: SERVER). Server only.
// Contract: docs/contracts/api.md section 7b. Database: add_play_time() in
// supabase/migrations/20261117000000_leaderboard_v2.sql, which caps the credit by the real time since
// the player's last report, so this route cannot be used to add more than elapsed time.
//
// The call is made with the CALLER's token on the anon client (never the service client), so
// auth.uid() inside the function is the caller and nobody else's row can be touched.

import { z } from "zod";
import { anonClient, bearerToken, userFromRequest } from "@/lib/server/db";
import { ApiFail, parse } from "@/lib/server/http";

/** Most seconds one report may claim (the database credits at most 90 of them anyway). */
export const MAX_REPORT_SECONDS = 120;
const TIMEOUT_MS = 5000;
const UNAVAILABLE = "Play time cannot be saved right now.";

export const PlayTimeBody = z.object({ seconds: z.number().int().min(1).max(MAX_REPORT_SECONDS) });

/** Validate the body, check the caller, call add_play_time. Throws ApiFail (400, 401, 503). */
export async function creditPlayTime(request: Request, rawBody: unknown): Promise<{ credited: number }> {
  // A guest has no play time to save; this needs neither a body nor a database.
  if (!bearerToken(request)) throw new ApiFail("unauthorized", "Log in to save play time.");
  const { seconds } = parse(PlayTimeBody, rawBody);

  const sb = anonClient(request);
  if (!sb) throw new ApiFail("db_unavailable", UNAVAILABLE);
  // A token the database does not accept (expired, forged) is a guest as well.
  if (!(await userFromRequest(request))) throw new ApiFail("unauthorized", "Log in to save play time.");

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await sb.rpc("add_play_time", { p_seconds: seconds }).abortSignal(ctl.signal);
    if (res.error) {
      console.error("[playtime] add_play_time failed:", res.error.message);
      throw new ApiFail("db_unavailable", UNAVAILABLE);
    }
    const credited = Number(res.data);
    return { credited: Number.isFinite(credited) ? Math.max(0, Math.round(credited)) : 0 };
  } catch (e) {
    if (e instanceof ApiFail) throw e;
    throw new ApiFail("db_unavailable", UNAVAILABLE);
  } finally {
    clearTimeout(timer);
  }
}
