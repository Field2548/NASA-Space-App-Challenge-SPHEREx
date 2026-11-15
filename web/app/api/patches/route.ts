// GET /api/patches?ra=&dec=&r=: picked patches near a point, solved or reported, with no names.
// Contract: docs/contracts/api.md section 15. The work is in lib/server/patchCheck.ts.

import type { NextRequest } from "next/server";
import { handle } from "@/lib/server/http";
import { runPatches } from "@/lib/server/patchCheck";

export async function GET(request: NextRequest): Promise<Response> {
  return handle(() => runPatches(request));
}
