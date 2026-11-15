// POST /api/patch-check: check marks on a picked patch against JPL's known objects.
// Contract: docs/contracts/api.md section 14. The work is in lib/server/patchCheck.ts.

import type { NextRequest } from "next/server";
import { handle } from "@/lib/server/http";
import { runPatchCheck } from "@/lib/server/patchCheck";

// One JPL two-pass call takes 35 to 110 s; the calls run in parallel under a 150 s timeout.
export const maxDuration = 180;

export async function POST(request: NextRequest): Promise<Response> {
  return handle(() => runPatchCheck(request));
}
