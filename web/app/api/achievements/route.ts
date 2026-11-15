// GET /api/achievements  Contract: docs/contracts/api.md section 16.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { accountAchievements, guestAchievements } from "@/lib/server/achievements";
import { bearerToken, userFromRequest } from "@/lib/server/db";
import { ApiFail, handle, parse, queryObject } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";

const Query = z.object({ solved: z.string().max(40 * 41).optional() });
const SLUG = /^[a-z0-9-]{1,40}$/;

export async function GET(request: NextRequest): Promise<Response> {
  return handle(async () => {
    rateLimit(request, "achievements", 60);
    const q = parse(Query, queryObject(request));
    let source: "account" | "guest" = "guest";
    let achievements;
    if (bearerToken(request)) {
      const user = await userFromRequest(request);
      if (!user) throw new ApiFail("unauthorized", "Your session is not valid. Please log in again.");
      const mine = await accountAchievements(user.id);
      if (!mine) throw new ApiFail("db_unavailable", "The database is not available right now.");
      achievements = mine;
      source = "account";
    } else {
      const slugs = (q.solved ?? "").split(",").filter(Boolean);
      if (slugs.length > 40 || slugs.some((s) => !SLUG.test(s))) {
        throw new ApiFail("bad_request", "solved must be at most 40 spot names (a-z, 0-9, -).");
      }
      achievements = await guestAchievements(slugs);
    }
    return NextResponse.json(
      { source, unlocked: achievements.filter((a) => a.unlocked).length, total: achievements.length, achievements },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
