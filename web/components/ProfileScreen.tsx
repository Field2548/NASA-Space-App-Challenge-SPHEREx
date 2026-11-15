"use client";
// /profile: display name, Log out, and progress. Solved stages come from this device's guest store
// (the same source as /stages); total points and rank from GET /api/leaderboard?scope=all (`me`, present
// only with a login). A guest sees "Not logged in" and a Log in button. Stages are counted, never named.

import { useEffect, useState } from "react";
import { fetchBoard } from "@/lib/boardFetch";
import { loadFieldIndex } from "@/lib/fields";
import { loadGuest } from "@/lib/guest";
import type { MeRow } from "@/lib/scoreboard";
import { getSupabaseBrowser } from "@/lib/supabase";
import { AuthDialog } from "./AuthDialog";
import BackLink from "./BackLink";
import { sessionName } from "./LoginButton";
import styles from "./ProfileScreen.module.css";

export default function ProfileScreen() {
  const [name, setName] = useState<string | null | undefined>(undefined); // undefined: still checking
  const [solved, setSolved] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [me, setMe] = useState<MeRow | null | undefined>(undefined); // undefined: loading
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    void sessionName().then((s) => {
      if (!live) return;
      const n = s ?? (getSupabaseBrowser() ? null : (loadGuest().name ?? null)); // as AccountControl

      setName(n);
      setSolved(new Set(loadGuest().finds.map((f) => f.spot)).size);
      if (!n) return setMe(null);
      fetchBoard()
        .then((b) => live && setMe(b.me ?? null))
        .catch(() => live && setMe(null));
    });
    loadFieldIndex()
      .then((index) => live && setTotal(index.length))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  async function logOut() {
    await getSupabaseBrowser()?.auth.signOut();
    setName(null);
    setMe(null);
  }

  return (
    <main className={styles.page}>
      <BackLink />
      <h1>Profile</h1>
      {name === undefined && <p role="status">Loading…</p>}
      {name === null && (
        <>
          <p>Not logged in</p>
          <button type="button" className={styles.button} onClick={() => setOpen(true)} aria-haspopup="dialog">
            Log in
          </button>
        </>
      )}
      {name && (
        <>
          <p className={styles.name}>{name}</p>
          <button type="button" className={styles.button} onClick={() => void logOut()}>
            Log out
          </button>
        </>
      )}
      {name !== undefined && (
        <dl className={styles.stats}>
          <dt>Stages solved</dt>
          <dd>{total === null ? solved : `${solved} of ${total}`}</dd>
          {name && (
            <>
              <dt>Total points</dt>
              <dd>{me === undefined ? "…" : me ? me.score : "–"}</dd>
              <dt>Rank</dt>
              <dd>{me === undefined ? "…" : me ? `#${me.rank}` : "–"}</dd>
            </>
          )}
        </dl>
      )}
      {open && (
        <AuthDialog
          open
          onClose={() => setOpen(false)}
          onSignedIn={(n) => {
            setOpen(false);
            setName(n || "Signed in");
            fetchBoard()
              .then((b) => setMe(b.me ?? null))
              .catch(() => setMe(null));
          }}
        />
      )}
    </main>
  );
}
