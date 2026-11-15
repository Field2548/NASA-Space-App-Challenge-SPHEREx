// POST/GET /api/request-spot  Contract: docs/contracts/api.md section 9.
// POST saves a queued request (service role; guests may ask). GET lists the queue.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { anonClient, serviceClient, userFromRequest } from "@/lib/server/db";
import { ApiFail, handle, parse, readJsonBody } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";

const Body = z.object({
  ra: z.number().finite().min(0).max(360),
  dec: z.number().finite().min(-90).max(90),
  fov: z.number().finite().min(0.05).max(0.5).default(0.2),
});

export async function POST(request: NextRequest): Promise<Response> {
  return handle(async () => {
    rateLimit(request, "request-spot", 10);
    const body = parse(Body, await readJsonBody(request));
    const sb = serviceClient();
    if (!sb) {
      throw new ApiFail("db_unavailable", "No database is connected, so requests cannot be saved yet.");
    }
    const user = await userFromRequest(request);
    try {
      const { data, error } = await sb
        .from("spot_requests")
        // The table allows ra in [0, 360); the contract allows 360, which is the same direction as 0.
        .insert({ ra: body.ra % 360, dec: body.dec, fov: body.fov, user_id: user?.id ?? null })
        .select("id")
        .abortSignal(AbortSignal.timeout(5000))
        .single();
      if (error || !data) throw new Error(error?.message ?? "no row");
      return NextResponse.json({ id: Number(data.id), status: "queued" }, { status: 201 });
    } catch (e) {
      console.error("[request-spot] insert failed", e instanceof Error ? e.message : e);
      throw new ApiFail("db_unavailable", "The request could not be saved right now. Please try again later.");
    }
  });
}

export async function GET(request: NextRequest): Promise<Response> {
  return handle(async () => {
    rateLimit(request, "request-spot-list", 60);
    const none = { requests: [], source: "none" };
    const sb = anonClient(request);
    if (!sb) return NextResponse.json(none);
    try {
      const { data, error } = await sb
        .rpc("spot_request_queue", { p_limit: 100 })
        .abortSignal(AbortSignal.timeout(5000));
      if (error || !Array.isArray(data)) return NextResponse.json(none);
      return NextResponse.json({
        requests: (data as Record<string, unknown>[]).map((r) => ({
          id: Number(r.id),
          ra: Number(r.ra),
          dec: Number(r.dec),
          fov: Number(r.fov),
          status: String(r.status),
          created_at: String(r.created_at),
        })),
        source: "db",
      });
    } catch {
      return NextResponse.json(none);
    }
  });
}
