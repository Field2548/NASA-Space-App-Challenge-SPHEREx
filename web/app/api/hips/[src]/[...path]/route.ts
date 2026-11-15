// GET /api/hips/<src>/<path>: one HiPS file (properties, all-sky preview or tile) from an
// allowlisted SPHEREx HiPS, with long CDN caching so Vercel's edge serves repeats. The logic
// (allowlist, cache headers) is in lib/hipsProxy.ts. Not rate limited: one map view asks for
// dozens of tiles at once, and the allowlist keeps the route to public, fixed files.

import { CACHE_MISSING, CACHE_NONE, CACHE_OK, upstreamUrl } from "@/lib/hipsProxy";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ src: string; path: string[] }> },
): Promise<Response> {
  const { src, path } = await params;
  const url = upstreamUrl(src, path);
  if (!url) return new Response("Not an allowed HiPS file.", { status: 404, headers: { "Cache-Control": CACHE_NONE } });
  let res: Response;
  try {
    // redirect "manual": never follow the upstream off the allowlisted host.
    res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15000), cache: "no-store" });
  } catch {
    return new Response("The sky picture server did not answer.", { status: 504, headers: { "Cache-Control": CACHE_NONE } });
  }
  if (res.status === 404) return new Response(null, { status: 404, headers: { "Cache-Control": CACHE_MISSING } });
  if (!res.ok) return new Response(null, { status: 502, headers: { "Cache-Control": CACHE_NONE } });
  const type = res.headers.get("content-type") ?? (url.endsWith("properties") ? "text/plain" : "application/octet-stream");
  return new Response(res.body, {
    status: 200,
    headers: { "Content-Type": type, "Cache-Control": CACHE_OK, "Access-Control-Allow-Origin": "*" },
  });
}
