// POST/GET /api/request-spot  Contract: docs/contracts/api.md section 9.
// POST saves a queued request through the request_spot() function (service role; guests may ask),
// or returns the near-identical request already there. GET lists the queue.

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
    // request_spot() (supabase migration) decides: an existing queued, processing or done request
    // within 0.05 degrees is returned as a duplicate; 200 queued requests refuse a new one.
    let row: { id: unknown; status: unknown; duplicate: unknown } | undefined;
    let queueFull = false;
    try {
      const { data, error } = await sb
        .rpc("request_spot", {
          p_user: user?.id ?? null,
          // The table allows ra in [0, 360); the contract allows 360, which is the same direction as 0.
          p_ra: body.ra % 360,
          p_dec: body.dec,
          p_fov: body.fov,
        })
        .abortSignal(AbortSignal.timeout(5000));
      if (error && /queue_full/.test(error.message)) queueFull = true;
      else if (error) throw new Error(error.message);
      else row = Array.isArray(data) ? data[0] : data;
      if (!queueFull && (!row || row.id === undefined)) throw new Error("no row");
    } catch (e) {
      console.error("[request-spot] insert failed", e instanceof Error ? e.message : e);
      throw new ApiFail("db_unavailable", "The request could not be saved right now. Please try again later.");
    }
    if (queueFull) {
      throw new ApiFail("rate_limited", "The request queue is full right now. Please try again later.");
    }
    const duplicate = row?.duplicate === true;
    return NextResponse.json(
      duplicate
        ? { id: Number(row?.id), status: String(row?.status), duplicate: true }
        : { id: Number(row?.id), status: "queued" },
      { status: duplicate ? 200 : 201 },
    );
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
