// GET /api/health: status of every outside service. Contract: docs/contracts/api.md section 10.
// Always HTTP 200; a failing service shows up as "red" in the body.

import { NextResponse, type NextRequest } from "next/server";
import { getHealth } from "@/lib/server/health";
import { handle } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";

export async function GET(request: NextRequest): Promise<Response> {
  return handle(async () => {
    rateLimit(request, "health", 60);
    return NextResponse.json(await getHealth());
  });
}
