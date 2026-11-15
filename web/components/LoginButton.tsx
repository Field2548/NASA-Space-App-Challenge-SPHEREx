"use client";
// Log in button that opens SERVER's AuthDialog. The dialog mounts only while open, so a closed
// dialog adds no controls to the page. The display name is restored on mount from the Supabase
// session (profile row, then user metadata), else from the guest store; no secrets are kept.

import { useEffect, useState } from "react";
import { loadGuest, saveGuest } from "@/lib/guest";
import { getSupabaseBrowser } from "@/lib/supabase";
import { AuthDialog } from "./AuthDialog";

async function sessionName(): Promise<string | null> {
  const sb = getSupabaseBrowser();
  if (!sb) return null;
  try {
    const { data } = await sb.auth.getSession();
    const user = data.session?.user;
    if (!user) return null;
    const { data: row } = await sb.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
    const fromRow = (row as { display_name?: unknown } | null)?.display_name;
    if (typeof fromRow === "string" && fromRow) return fromRow;
    const meta = user.user_metadata?.display_name;
    return typeof meta === "string" && meta ? meta : "Signed in";
  } catch {
    return null;
  }
}

export default function LoginButton({ label = "Log in", className }: { label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void sessionName().then((n) => {
      if (!live) return;
      const shown = n ?? (getSupabaseBrowser() ? null : (loadGuest().name ?? null));
      if (shown) setName(shown);
    });
    return () => {
      live = false;
    };
  }, []);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} aria-haspopup="dialog">
        {name ?? label}
      </button>
      {open && (
        <AuthDialog
          open
          onClose={() => setOpen(false)}
          onSignedIn={(n) => {
            setName(n || "Signed in");
            if (n) saveGuest({ name: n });
          }}
        />
      )}
    </>
  );
}
