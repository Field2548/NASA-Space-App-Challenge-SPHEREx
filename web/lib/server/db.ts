// Supabase clients for route handlers. Server only.
// No database is a normal state: every function here returns null instead of throwing.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function env() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || undefined,
    anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || undefined,
    service: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || undefined,
  };
}

/** True when the public URL and anon key are set. */
export function dbConfigured(): boolean {
  const e = env();
  return Boolean(e.url && e.anon);
}

/** The bearer token of a request, or null. */
export function bearerToken(request: Request): string | null {
  const m = (request.headers.get("authorization") ?? "").match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}

const NO_SESSION = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

/** Anon-key client. Forwards the caller's bearer token so `auth.uid()` works inside RPCs. */
export function anonClient(request?: Request): SupabaseClient | null {
  const e = env();
  if (!e.url || !e.anon) return null;
  const token = request ? bearerToken(request) : null;
  try {
    return createClient(e.url, e.anon, {
      auth: NO_SESSION,
      ...(token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {}),
    });
  } catch {
    return null;
  }
}

/** Service-role client (bypasses row-level security). Never expose anything it reads unfiltered. */
export function serviceClient(): SupabaseClient | null {
  const e = env();
  if (!e.url || !e.service) return null;
  try {
    return createClient(e.url, e.service, { auth: { persistSession: false } });
  } catch {
    return null;
  }
}

/** Who is calling? Null for guests, a bad token, or no database. */
export async function userFromRequest(request: Request): Promise<{ id: string } | null> {
  const token = bearerToken(request);
  if (!token) return null;
  const sb = anonClient();
  if (!sb) return null;
  try {
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data.user) return null;
    return { id: data.user.id };
  } catch {
    return null;
  }
}
