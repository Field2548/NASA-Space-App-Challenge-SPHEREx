// POST /api/check: check a player's submission against the private answer key.
// Contract: docs/contracts/api.md section 3. Points are computed here and nowhere else.
// Only HTTP handlers are exported from this file (Next.js route rule); the work is in
// lib/server/checkFlow.ts, the schema and the response body in lib/server/checkResponse.ts.

import type { NextRequest } from "next/server";
import { runCheck } from "@/lib/server/checkFlow";
import { handle } from "@/lib/server/http";

export async function POST(request: NextRequest): Promise<Response> {
  return handle(() => runCheck(request));
}
