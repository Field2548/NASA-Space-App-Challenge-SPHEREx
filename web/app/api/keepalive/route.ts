// GET /api/keepalive  Contract: docs/contracts/api.md section 11.
// Vercel Cron calls it daily with Authorization: Bearer <CRON_SECRET>. It runs ping() so a
// free Supabase project does not pause for inactivity.

import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { anonClient } from "@/lib/server/db";
import { ApiFail, handle } from "@/lib/server/http";

const sha = (s: string) => createHash("sha256").update(s).digest();

export async function GET(request: NextRequest): Promise<Response> {
  return handle(async () => {
    const secret = process.env.CRON_SECRET;
    const given = (request.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
    // Compare fixed-length digests so the check takes the same time for any input.
    if (!secret || !timingSafeEqual(sha(given), sha(secret))) {
      throw new ApiFail("unauthorized", "Missing or wrong secret.");
    }
    const sb = anonClient();
    if (!sb) return NextResponse.json({ ok: true, db: "not_configured" });
    try {
      const { error } = await sb.rpc("ping").abortSignal(AbortSignal.timeout(5000));
      if (error) throw new Error(error.message);
    } catch {
      throw new ApiFail("db_unavailable", "The database did not answer the ping.");
    }
    return NextResponse.json({ ok: true, db: "ok" });
  });
}
