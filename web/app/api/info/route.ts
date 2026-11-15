// GET /api/info?spot=&x=&y=&ra=&dec=&mode=round|explore. Contract: docs/contracts/api.md section 6.
// Thin: rate limit, validation, then lib/server/info.ts decides what may be shown (the server
// decides the mode, section 2). Only HTTP handlers are exported from this file.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { answerInfo } from "@/lib/server/info";
import { handle, parse, queryObject } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";

// An empty value (`x=`) counts as missing, not as 0 (z.coerce.number would read it as 0).
const blank = (v: unknown) => (v === "" ? undefined : v);
const Num = z.preprocess(blank, z.coerce.number().finite().optional());

const Query = z.object({
  spot: z.preprocess(blank, z.string().regex(/^[a-z0-9-]{1,40}$/, "Use a spot name of letters, digits and dashes.").optional()),
  x: Num,
  y: Num,
  ra: z.preprocess(blank, z.coerce.number().finite().gte(0).lt(360).optional()),
  dec: z.preprocess(blank, z.coerce.number().finite().gte(-90).lte(90).optional()),
  // A missing (or empty) mode means round. Any value other than round or explore is a 400 bad_request.
  mode: z.preprocess(blank, z.enum(["round", "explore"]).optional()),
  // `patch=1`: asked from a picked patch (/play?patch=). Accepted; Inspect is open there too.
  patch: z.preprocess(blank, z.enum(["1"]).optional()),
});

export async function GET(request: NextRequest): Promise<Response> {
  return handle(async () => {
    rateLimit(request, "info", 60);
    const q = parse(Query, queryObject(request));
    // The body depends on the caller's unlock cookie, so no cache may keep it.
    return NextResponse.json(await answerInfo(request, q), { headers: { "Cache-Control": "private, no-store" } });
  });
}
