// GET /api/overlay?spot=&mode=round|explore. Contract: docs/contracts/field-schema.md section 11.
// Thin: rate limit, validation, then lib/overlays.ts decides what may be shown (the server
// decides the mode, api.md section 2). Only HTTP handlers are exported from this file.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { answerOverlay } from "@/lib/overlays";
import { handle, parse, queryObject } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";

const Query = z.object({
  spot: z.string().regex(/^[a-z0-9-]{1,40}$/, "Use a spot name of letters, digits and dashes."),
  // Unknown or missing modes are read as round in the lib (the safe side).
  mode: z.string().optional(),
});

export async function GET(request: NextRequest): Promise<Response> {
  return handle(async () => {
    rateLimit(request, "overlay", 60);
    const q = parse(Query, queryObject(request));
    // The body depends on the caller's unlock cookie, so no cache may keep it.
    return NextResponse.json(await answerOverlay(request, q), { headers: { "Cache-Control": "private, no-store" } });
  });
}
