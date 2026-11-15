// Browser-side Supabase helpers. Contract: docs/contracts/api.md section 13.
// Imported by client components: no node:* imports, and never the service key.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

/** One shared client, or null when the public env vars are missing (guest mode only). */
export function getSupabaseBrowser(): SupabaseClient | null {
  if (client !== undefined) return client;
  // Literal names so Next.js can inline them into the browser bundle.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    client = null;
    return client;
  }
  try {
    client = createClient(url, key);
  } catch {
    client = null;
  }
  return client;
}

/** `{ Authorization: "Bearer ..." }` for a logged-in player, `{}` for a guest. */
export async function authHeader(): Promise<Record<string, string>> {
  const sb = getSupabaseBrowser();
  if (!sb) return {};
  try {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}
