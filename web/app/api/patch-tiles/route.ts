// GET /api/patch-tiles?tileOrder=&tile=&order=|mode=patches: community patches as HEALPix tiles.
// The work is in lib/server/patchTiles.ts.

import type { NextRequest } from "next/server";
import { handle } from "@/lib/server/http";
import { runPatchTiles } from "@/lib/server/patchTiles";

export async function GET(request: NextRequest): Promise<Response> {
  return handle(() => runPatchTiles(request));
}
