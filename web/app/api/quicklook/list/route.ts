// GET /api/quicklook/list?ra=&dec=: every SPHEREx exposure over a position, grouped into bursts,
// with the URL the browser should Range-read (BUILD_PROMPT 8.20 step 1). Owner: DATA; follows
// docs/contracts/api.md section 1 (error shape, zod). Thin: rate limit, validation, then
// lib/quicklookList.ts talks to IRSA (retries for ~45 s, 1-day in-memory cache).

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handle, parse, queryObject } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";
import { listQuickLook } from "@/lib/quicklookList";

// IRSA can take up to ~45 s of retries; leave room for the last answer.
export const maxDuration = 60;

const blank = (v: unknown) => (v === "" ? undefined : v);
const Query = z.object({
  ra: z.preprocess(blank, z.coerce.number().finite().gte(0).lt(360)),
  dec: z.preprocess(blank, z.coerce.number().finite().gte(-90).lte(90)),
});

export async function GET(request: NextRequest): Promise<Response> {
  return handle(async () => {
    rateLimit(request, "quicklook-list", 20);
    const { ra, dec } = parse(Query, queryObject(request));
    const list = await listQuickLook(ra, dec);
    // The same position gives the same list for a day (new exposures arrive at most daily).
    return NextResponse.json(list, { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } });
  });
}
