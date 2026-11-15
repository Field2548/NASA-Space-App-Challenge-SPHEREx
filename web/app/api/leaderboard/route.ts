// GET /api/leaderboard?scope=spot|all&slug=&period=all|week&region=global|local&country=
// Contract: docs/contracts/api.md section 7. Thin: rate limit, validation, then
// lib/server/leaderboard.ts builds the board. Only HTTP handlers are exported from this file.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handle, parse, queryObject } from "@/lib/server/http";
import { answerBoard } from "@/lib/server/leaderboard";
import { rateLimit } from "@/lib/server/rateLimit";

// An empty value (`country=`) counts as missing.
const blank = (v: unknown) => (v === "" ? undefined : v);

const Query = z
  .object({
    scope: z.enum(["spot", "all"]).default("all"),
    slug: z.string().regex(/^[a-z0-9-]{1,40}$/).optional(),
    period: z.preprocess(blank, z.enum(["all", "week"]).default("all")),
    region: z.preprocess(blank, z.enum(["global", "local"]).default("global")),
    country: z.preprocess(blank, z.string().regex(/^[A-Za-z]{2}$/, "Use a two-letter country code.").optional()),
  })
  .refine((q) => q.scope === "all" || q.slug !== undefined, {
    message: "slug is required when scope=spot",
    path: ["slug"],
  });

// The body depends on the caller's unlock cookie (and on who is logged in), so no cache may keep it.
const PRIVATE = { headers: { "Cache-Control": "private, no-store" } };

export async function GET(request: NextRequest): Promise<Response> {
  return handle(async () => {
    rateLimit(request, "leaderboard", 60);
    const q = parse(Query, queryObject(request));
    return NextResponse.json(await answerBoard(request, q), PRIVATE);
  });
}
