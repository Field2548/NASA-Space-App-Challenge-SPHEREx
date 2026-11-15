"use client";
// /profile: display name, Log out, and single-player progress. Solved stages come from this device's
// guest store (the same source as /stages) or, with a login, from the account's own finds (one query;
// only correct verdicts count). Total points, rank and accuracy come from GET /api/leaderboard?scope=all
// (`me`, present only with a login); badges from GET /api/achievements. A guest sees "Not logged in" and
// a Log in button. Stages are counted and listed by their neutral titles, never by object names.

import Link from "next/link";
import { useEffect, useState } from "react";
import { validateDisplayName } from "@/lib/auth";
import { fetchBoard } from "@/lib/boardFetch";
import { FIELDS_BASE, loadFieldIndex } from "@/lib/fields";
import { loadGuest } from "@/lib/guest";
import { formatAccuracy, type MeRow } from "@/lib/scoreboard";
import { orderedSpots } from "@/lib/stageOrder";
import { getSupabaseBrowser } from "@/lib/supabase";
import type { FieldSummary } from "@/lib/types";
import { type AchievementItem, type AchievementsResponse, Badge, fetchAchievements } from "./AchievementsScreen";
import { AuthDialog } from "./AuthDialog";
import BackLink from "./BackLink";
import { sessionName } from "./LoginButton";
import { difficultyStyle } from "./skymap/geometry";
import styles from "./ProfileScreen.module.css";

/** A correct find, from the account's finds table or the guest store. */
type Solve = { spot: string; points: number; at: string };

// Verdicts that count as solving a stage; a wrong answer ("candidate", "static", "nothing_wrong") does not.
const SOLVED_VERDICTS = ["known", "bot_match", "nothing_correct"];

const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

/** Earliest solve date per stage. */
function solvedMap(solves: Solve[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of solves) {
    const old = m.get(s.spot);
    if (!old || s.at < old) m.set(s.spot, s.at);
  }
  return m;
}

function guestSolves(): Solve[] {
  return loadGuest().finds.map((f) => ({ spot: f.spot, points: f.points, at: f.at }));
}

/** Up to 3 badges: the latest unlocked ones, or the closest to done when none are unlocked. */
function stripBadges(list: AchievementItem[]): { title: string; items: AchievementItem[] } {
  const unlocked = list.filter((a) => a.unlocked).sort((a, b) => (b.unlockedAt ?? "").localeCompare(a.unlockedAt ?? ""));
  if (unlocked.length) return { title: "Recent achievements", items: unlocked.slice(0, 3) };
  const ratio = (a: AchievementItem) => a.progress / Math.max(a.goal, 1);
  return { title: "Next achievements", items: [...list].sort((a, b) => ratio(b) - ratio(a)).slice(0, 3) };
}

function Check() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export default function ProfileScreen() {
  const [name, setName] = useState<string | null | undefined>(undefined); // undefined: still checking
  const [solves, setSolves] = useState<Solve[]>([]);
  const [index, setIndex] = useState<FieldSummary[] | null>(null);
  const [me, setMe] = useState<MeRow | null | undefined>(undefined); // undefined: loading
  const [ach, setAch] = useState<AchievementsResponse | null | undefined>(undefined); // null: failed
  const [since, setSince] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [uid, setUid] = useState<string | null>(null); // set for a logged-in user
  const [hasRow, setHasRow] = useState(true); // false: signed up without a profiles row
  const [draft, setDraft] = useState("");
  const [nameMsg, setNameMsg] = useState<string | null>(null);

  function loadAchievements() {
    setAch(undefined);
    fetchAchievements()
      .then(setAch)
      .catch(() => setAch(null));
  }

  // A logged-in user's profile row and finds come from the database (one finds query); the guest
  // numbers stay when the query fails.
  async function loadAccount() {
    const sb = getSupabaseBrowser();
    if (!sb) return;
    try {
      const id = (await sb.auth.getSession()).data.session?.user.id;
      if (!id) return;
      setUid(id);
      const { data: row } = await sb.from("profiles").select("display_name, created_at").eq("id", id).maybeSingle();
      setHasRow(!!row);
      setDraft(row?.display_name ?? "");
      setSince(row?.created_at ?? null);
      const { data: finds, error } = await sb.from("finds").select("verdict, spot_slug, points, created_at").eq("user_id", id).neq("spot_slug", "quicklook");
      if (!error && finds) {
        setSolves(finds.filter((f) => SOLVED_VERDICTS.includes(f.verdict)).map((f) => ({ spot: f.spot_slug, points: f.points ?? 0, at: f.created_at })));
      }
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
      setSolves(guestSolves());
      loadAchievements();
      if (!n) return setMe(null);
      void loadAccount();
      fetchBoard()
        .then((b) => live && setMe(b.me ?? null))
        .catch(() => live && setMe(null));
    });
    loadFieldIndex()
      .then((i) => live && setIndex(i.filter((s) => s.slug !== "fixture")))
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
    setSince(null);
    setSolves(guestSolves());
    loadAchievements();
  }

  const total = index ? index.length : null;
  const solvedAt = solvedMap(solves);
  const titles = new Map((index ?? []).map((s) => [s.slug, s.title]));
  const solvedCount = index ? index.filter((s) => solvedAt.has(s.slug)).length : solvedAt.size;
  const recent = [...solves].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10);
  const strip = ach ? stripBadges(ach.achievements) : null;

  return (
    <main className={styles.page}>
      <BackLink />
      <h1>Profile</h1>
      {name === undefined && <p role="status">Loading…</p>}
      {name !== undefined && (
        <section className={styles.hero} aria-label="Player">
          <div className={styles.avatar} aria-hidden="true">
            {name ? name.trim().charAt(0).toUpperCase() : "?"}
          </div>
          <div className={styles.heroText}>
            {name ? (
              <>
                <p className={styles.name}>{name}</p>
                {since && <p className={styles.sub}>Explorer since {shortDate(since)}</p>}
                {me && (
                  <p className={styles.sub}>
                    Rank <strong>#{me.rank}</strong>
                  </p>
                )}
              </>
            ) : (
              <>
                <p className={styles.name}>Not logged in</p>
                <p className={styles.sub}>Your progress is kept in this browser.</p>
              </>
            )}
          </div>
          {name === null ? (
            <button type="button" className={styles.button} onClick={() => setOpen(true)} aria-haspopup="dialog">
              Log in
            </button>
          ) : (
            <button type="button" className={styles.button} onClick={() => void logOut()}>
              Log out
            </button>
          )}
        </section>
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
        <>
          <dl className={styles.stats}>
            <div>
              <dt>Stages solved</dt>
              <dd>{total === null ? solvedCount : `${solvedCount} of ${total}`}</dd>
            </div>
            {name && (
              <>
                <div>
                  <dt>Total points</dt>
                  <dd>{me === undefined ? "…" : me ? me.score : "–"}</dd>
                </div>
                <div>
                  <dt>Accuracy</dt>
                  <dd>{me === undefined ? "…" : me ? formatAccuracy(me.accuracy) : "–"}</dd>
                </div>
              </>
            )}
            <div>
              <dt>Achievements</dt>
              <dd>{ach === undefined ? "…" : ach ? `${ach.unlocked} of ${ach.total}` : "–"}</dd>
            </div>
          </dl>

          {strip && strip.items.length > 0 && (
            <section aria-labelledby="profile-ach" className={styles.section}>
              <div className={styles.sectionHead}>
                <h2 id="profile-ach">{strip.title}</h2>
                <Link href="/achievements" className={styles.more}>
                  All achievements
                </Link>
              </div>
              <ul className={styles.strip}>
                {strip.items.map((a) => (
                  <Badge key={a.id} a={a} compact />
                ))}
              </ul>
            </section>
          )}
          {ach === null && (
            <p className={styles.sub}>
              <Link href="/achievements">All achievements</Link>
            </p>
          )}

          {index && index.length > 0 && (
            <section aria-labelledby="profile-stages" className={styles.section}>
              <h2 id="profile-stages">Stage progress</h2>
              <ul className={styles.grid}>
                {orderedSpots(index).map(({ n, spot }) => {
                  const at = solvedAt.get(spot.slug);
                  const d = difficultyStyle(spot.difficulty);
                  return (
                    <li key={spot.slug} data-solved={at ? "true" : "false"} style={{ "--diff-color": `var(${d.cssVar})` } as React.CSSProperties}>
                      <Link href={`/play?spot=${encodeURIComponent(spot.slug)}`} className={styles.stage}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`${FIELDS_BASE}/${spot.thumbnail}`} alt="" width={96} height={96} loading="lazy" />
                        <span className={styles.stageText}>
                          <span className={styles.stageTitle}>
                            {n}. {spot.title}
                          </span>
                          <span className={styles.stageDiff}>{d.word}</span>
                          <span className={styles.stageState}>
                            {at ? (
                              <>
                                <Check /> Solved {shortDate(at)}
                              </>
                            ) : (
                              "Not solved"
                            )}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <section aria-labelledby="profile-recent" className={styles.section}>
            <h2 id="profile-recent">Recent activity</h2>
            {recent.length === 0 ? (
              <p className={styles.sub}>No finds yet. Pick a stage to start.</p>
            ) : (
              <ul className={styles.activity}>
                {recent.map((s, i) => (
                  <li key={`${s.spot}-${s.at}-${i}`}>
                    <span>{titles.get(s.spot) ?? "Stage"}</span>
                    <span>+{s.points} points</span>
                    <time dateTime={s.at}>{shortDate(s.at)}</time>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      {open && (
        <AuthDialog
          open
          onClose={() => setOpen(false)}
          onSignedIn={(n) => {
            setOpen(false);
            setName(n || "Signed in");
            void loadAccount();
            loadAchievements();
            fetchBoard()
              .then((b) => setMe(b.me ?? null))
              .catch(() => setMe(null));
          }}
        />
      )}
    </main>
  );
}
