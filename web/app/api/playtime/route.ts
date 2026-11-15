// POST /api/playtime { seconds }. Contract: docs/contracts/api.md section 7b.
// Thin: rate limit, body, then lib/server/playtime.ts credits the caller. Only HTTP handlers are exported from this file.

import { NextResponse, type NextRequest } from "next/server";
import { handle, readJsonBody } from "@/lib/server/http";
import { creditPlayTime } from "@/lib/server/playtime";
import { rateLimit } from "@/lib/server/rateLimit";

export async function POST(request: NextRequest): Promise<Response> {
  return handle(async () => {
    rateLimit(request, "playtime", 10);
    return NextResponse.json(await creditPlayTime(request, await readJsonBody(request)), { headers: { "Cache-Control": "no-store" } });
  });
}
