"use client";
// /profile: display name, Log out, and progress. Solved stages come from this device's guest store
// (the same source as /stages); total points and rank from GET /api/leaderboard?scope=all (`me`, present
// only with a login). A guest sees "Not logged in" and a Log in button. Stages are counted, never named.

import { useEffect, useState } from "react";
import { validateDisplayName } from "@/lib/auth";
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
  const [uid, setUid] = useState<string | null>(null); // set for a logged-in user
  const [hasRow, setHasRow] = useState(true); // false: signed up without a profiles row
  const [draft, setDraft] = useState("");
  const [nameMsg, setNameMsg] = useState<string | null>(null);

  // A logged-in user's profile row and solved stages come from the database; the guest count stays
  // when the query fails.
  async function loadAccount() {
    const sb = getSupabaseBrowser();
    if (!sb) return;
    try {
      const id = (await sb.auth.getSession()).data.session?.user.id;
      if (!id) return;
      setUid(id);
      const { data: row } = await sb.from("profiles").select("display_name").eq("id", id).maybeSingle();
      setHasRow(!!row);
      setDraft(row?.display_name ?? "");
      const { data: finds, error } = await sb.from("finds").select("spot_slug").eq("user_id", id).neq("spot_slug", "quicklook");
      if (!error && finds) setSolved(new Set(finds.map((f) => f.spot_slug)).size);
    } catch {
      /* keep the local numbers */
    }
  }

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    const sb = getSupabaseBrowser();
    const display_name = draft.trim();
    const invalid = validateDisplayName(display_name);
    if (invalid) return setNameMsg(invalid);
    if (!sb || !uid) return;
    setNameMsg(null);
    // Update only display_name when the row exists (the column grant allows nothing else).
    const { error } = hasRow
      ? await sb.from("profiles").update({ display_name }).eq("id", uid)
      : await sb.from("profiles").insert({ id: uid, display_name });
    if (error) return setNameMsg(error.code === "23505" ? "That name is taken. Pick another." : "Could not save the name. Try again.");
    setHasRow(true);
    setName(display_name);
    setNameMsg("Saved.");
    await sb.auth.updateUser({ data: { display_name } }); // USER_UPDATED refreshes the header
  }

  useEffect(() => {
    let live = true;
    void sessionName().then((s) => {
      if (!live) return;
      const n = s ?? (getSupabaseBrowser() ? null : (loadGuest().name ?? null)); // as AccountControl

      setName(n);
      setSolved(new Set(loadGuest().finds.map((f) => f.spot)).size);
      if (!n) return setMe(null);
      void loadAccount();
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
    setUid(null);
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
      {name && uid && (
        <form onSubmit={(e) => void saveName(e)}>
          {!hasRow && <p>Pick a display name so you appear on the scoreboard.</p>}
          <label htmlFor="profile-name">Display name </label>
          <input id="profile-name" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={20} autoComplete="nickname" aria-describedby="profile-name-msg" />{" "}
          <button type="submit" className={styles.button}>
            Save
          </button>
          <p id="profile-name-msg" role="status">
            {nameMsg}
          </p>
        </form>
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
            void loadAccount();
            fetchBoard()
              .then((b) => setMe(b.me ?? null))
              .catch(() => setMe(null));
          }}
        />
      )}
    </main>
  );
}
