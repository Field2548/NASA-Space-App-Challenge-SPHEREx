// GET /api/density?layer=finds|checked&order=&who=me|all  Contract: docs/contracts/api.md section 8.
// HEALPix NESTED cell counts. No database (or a database that fails): source "none", no cells.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { anonClient, userFromRequest } from "@/lib/server/db";
import { ApiFail, handle, parse, queryObject } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";

const Query = z.object({
  layer: z.enum(["finds", "checked"]),
  order: z.coerce.number().int().min(0).max(12).default(4),
  who: z.enum(["me", "all"]).default("all"),
});

export async function GET(request: NextRequest): Promise<Response> {
  return handle(async () => {
    rateLimit(request, "density", 60);
    const q = parse(Query, queryObject(request));
    if (q.who === "me" && !(await userFromRequest(request))) {
      throw new ApiFail("unauthorized", "Log in to see your own layer.");
    }
    const empty = { layer: q.layer, order: q.order, who: q.who, source: "none" as const, max: 0, cells: [] };

    const sb = anonClient(request);
    if (!sb) return NextResponse.json(empty);
    try {
      const { data, error } = await sb
        .rpc("density", { p_layer: q.layer, p_order: q.order, p_mine: q.who === "me" })
        .abortSignal(AbortSignal.timeout(5000));
      if (error || !Array.isArray(data)) return NextResponse.json(empty);
      const cells = (data as { ipix: number | string; n: number | string }[])
        .map((r) => [Number(r.ipix), Number(r.n)] as [number, number])
        .filter(([, n]) => n > 0)
        .sort((a, b) => a[0] - b[0]);
      const max = cells.reduce((m, [, n]) => Math.max(m, n), 0);
      return NextResponse.json({ layer: q.layer, order: q.order, who: q.who, source: "db", max, cells });
    } catch {
      return NextResponse.json(empty);
    }
  });
}
