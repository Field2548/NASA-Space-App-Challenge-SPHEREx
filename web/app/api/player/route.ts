// GET /api/player?name=<display name>. Contract: docs/contracts/api.md section 7a.
// Thin: rate limit, then lib/server/player.ts answers. Only HTTP handlers are exported from this file.

import { NextResponse, type NextRequest } from "next/server";
import { handle } from "@/lib/server/http";
import { answerPlayer } from "@/lib/server/player";
import { rateLimit } from "@/lib/server/rateLimit";

export async function GET(request: NextRequest): Promise<Response> {
  return handle(async () => {
    rateLimit(request, "player", 60);
    const name = new URL(request.url).searchParams.get("name") ?? undefined;
    // Depends on who is asking (is_me), so no cache may keep it.
    return NextResponse.json(await answerPlayer(request, name), { headers: { "Cache-Control": "private, no-store" } });
  });
}
