"use client";
// Top-right account control, mounted once in the root layout. Logged out: a "Log in" button that
// opens the AuthDialog. Logged in: a round profile icon (initial of the display name) linking to
// /profile. The name comes from the same sources as LoginButton: the Supabase session, else (with no
// Supabase client) the guest store. It follows sign-in (AuthDialog) and sign-out (/profile).

import Link from "next/link";
import { useEffect, useState } from "react";
import { loadGuest, saveGuest } from "@/lib/guest";
import { getSupabaseBrowser } from "@/lib/supabase";
import { AuthDialog } from "./AuthDialog";
import styles from "./AccountControl.module.css";
import { sessionName } from "./LoginButton";

export default function AccountControl() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const refresh = () =>
      void sessionName().then((n) => {
        if (live) setName(n ?? (getSupabaseBrowser() ? null : (loadGuest().name ?? null)));
      });
    refresh();
    const sub = getSupabaseBrowser()?.auth.onAuthStateChange?.(() => refresh());
    return () => {
      live = false;
      sub?.data.subscription.unsubscribe();
    };
  }, []);
  return (
    <div className={styles.account} data-testid="account-control">
      {name ? (
        <Link href="/profile" className={styles.icon} aria-label={`Profile: ${name}`}>
          {name.trim().charAt(0).toUpperCase() || "?"}
        </Link>
      ) : (
        <button type="button" className={styles.login} onClick={() => setOpen(true)} aria-haspopup="dialog">
          Log in
        </button>
      )}
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
    </div>
  );
}
