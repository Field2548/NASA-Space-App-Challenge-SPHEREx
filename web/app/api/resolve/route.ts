// GET /api/resolve?name=: name to coordinates through CDS Sesame.
// Contract: docs/contracts/api.md section 5.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ApiFail, handle, parse, queryObject } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";
import { resolveName } from "@/lib/server/sesame";

const Query = z.object({ name: z.string().trim().min(1).max(80) });

export async function GET(request: NextRequest): Promise<Response> {
  return handle(async () => {
    rateLimit(request, "resolve", 60);
    const { name } = parse(Query, queryObject(request));
    const found = await resolveName(name);
    if (!found) {
      throw new ApiFail("not_found", `No position found for "${name}". Check the spelling or try another name.`);
    }
    return NextResponse.json(
      { name: found.name, ra: found.ra, dec: found.dec, frame: "ICRS J2000", source: "CDS Sesame" },
      { headers: { "Cache-Control": "public, max-age=86400" } },
    );
  });
}
