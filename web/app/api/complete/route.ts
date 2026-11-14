// POST /api/complete: move a guest's saved replay into the logged-in account (api.md section 4).
// Each entry is checked again on the server and saved. Only HTTP handlers are exported here;
// the work is in lib/server/checkFlow.ts.

import type { NextRequest } from "next/server";
import { runComplete } from "@/lib/server/checkFlow";
import { handle } from "@/lib/server/http";

export async function POST(request: NextRequest): Promise<Response> {
  return handle(() => runComplete(request));
}
