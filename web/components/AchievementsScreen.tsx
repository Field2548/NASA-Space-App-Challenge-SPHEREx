"use client";
// /achievements: "N of M unlocked", an overall progress bar and a grid of badges. Data comes from
// GET /api/achievements: a logged-in player sends the auth header (the server reads the account);
// a guest passes the spots solved on this device as ?solved=a,b. Badge icons are small inline SVGs.

import { useEffect, useState } from "react";
import type { Achievement, AchievementsResponse } from "@/lib/achievements";
import { loadGuest } from "@/lib/guest";
import { authHeader } from "@/lib/supabase";
import BackLink from "./BackLink";
import styles from "./AchievementsScreen.module.css";

export type AchievementItem = Achievement;
export type { AchievementsResponse };

/** Fetches the player's achievements; throws on any failure. */
export async function fetchAchievements(): Promise<AchievementsResponse> {
  const headers = await authHeader();
  let url = "/api/achievements";
  if (!headers.Authorization) {
    const solved = Array.from(new Set(loadGuest().finds.map((f) => f.spot)));
    if (solved.length) url += `?solved=${solved.map(encodeURIComponent).join(",")}`;
  }
  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`achievements ${res.status}`);
  return (await res.json()) as AchievementsResponse;
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

// Icons in a 24 x 24 box, drawn with strokes only.
const ICONS: Record<string, string> = {
  "first-light": "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18M12 9.5A2.5 2.5 0 1 1 12 14.5A2.5 2.5 0 1 1 12 9.5Z",
  "rock-hunter": "M5 15l2-6 5-3 5 2 2 6-4 4-6 1zM10 11l3 1M9 15l3-1",
  "far-out": "M4 18C8 8 16 5 20 6M4 18l3-4M4 18l5 0M17 3.5A2.5 2.5 0 1 1 17 8.5A2.5 2.5 0 1 1 17 3.5Z",
  "ice-giants-club": "M12 4A8 8 0 1 1 12 20A8 8 0 1 1 12 4ZM3 12h18M5.5 8h13M5.5 16h13M2 14l20-4",
  boss: "M4 18l2-10 4 4 2-6 2 6 4-4 2 10zM6 21h12",
  "still-sky": "M20 14A8 8 0 1 1 10 4a6.5 6.5 0 0 0 10 10zM15 5v3M13.5 6.5h3",
  "tool-tester": "M14.5 5a4 4 0 0 0-4.8 5.2L4 16l4 4 5.8-5.7A4 4 0 0 0 19 9.5l-2.5 2.5-2.5-.5-.5-2.5z",
  "star-collector": "M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.7 6.6 19.7l1.1-6.1L3.2 9.4l6.1-.8z",
  completionist: "M12 3a9 9 0 1 1 0 18a9 9 0 0 1 0-18ZM7.5 12.5l3 3 6-6.5",
  "points-1": "M4 19V9M10 19V5M16 19v-7M2 19.5h16M20 7l1.5-1.5M20 7l-1.5-1.5",
  "points-2": "M4 19V12M10 19V7M16 19V3M2 19.5h16M20 5l1.5-1.5M20 5l-1.5-1.5M20 9l1.5-1.5M20 9l-1.5-1.5",
};
const GENERIC_ICON = "M12 3l7 4v6c0 4-3 7-7 8-4-1-7-4-7-8V7zM9.5 12l2 2 3.5-4";

export function BadgeIcon({ id }: { id: string }) {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" width="32" height="32" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={ICONS[id] ?? GENERIC_ICON} />
    </svg>
  );
}

export function Badge({ a, compact = false }: { a: AchievementItem; compact?: boolean }) {
  const goal = Math.max(a.goal, 1);
  const progress = Math.min(Math.max(a.progress, 0), goal);
  return (
    <li className={compact ? `${styles.badge} ${styles.compact}` : styles.badge} data-unlocked={a.unlocked ? "true" : "false"} data-testid={`badge-${a.id}`}>
      <BadgeIcon id={a.id} />
      <div className={styles.body}>
        <h3 className={styles.badgeTitle}>{a.title}</h3>
        <p className={styles.desc}>{a.description}</p>
        <div
          className={styles.bar}
          role="progressbar"
          aria-label={`${a.title} progress`}
          aria-valuemin={0}
          aria-valuemax={goal}
          aria-valuenow={progress}
          aria-valuetext={`${progress} of ${goal}`}
        >
          <span style={{ width: `${(progress / goal) * 100}%` }} />
        </div>
        <p className={styles.meta}>
          <span>
            {progress} / {goal}
          </span>
          <span>{a.unlocked ? (a.unlockedAt ? `Unlocked ${shortDate(a.unlockedAt)}` : "Unlocked") : "Locked"}</span>
        </p>
      </div>
    </li>
  );
}

export default function AchievementsScreen() {
  const [data, setData] = useState<AchievementsResponse | null>(null);
  const [failed, setFailed] = useState(false);

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    fetchAchievements()
      .then((d) => live && setData(d))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [attempt]);

  function retry() {
    setFailed(false);
    setData(null);
    setAttempt((n) => n + 1);
  }

  return (
    <main className={styles.page}>
      <BackLink />
      <h1>Achievements</h1>
      {!data && !failed && <p role="status">Loading…</p>}
      {failed && (
        <div role="alert" className={styles.error}>
          <p>Could not load your achievements. Check your connection and try again.</p>
          <button type="button" onClick={retry}>
            Retry
          </button>
        </div>
      )}
      {data && (
        <>
          {data.source === "guest" && (
            <p className={styles.guest}>Playing as a guest: achievements are kept in this browser. Log in to keep them on your account.</p>
          )}
          <section aria-labelledby="ach-total">
            <h2 id="ach-total" className={styles.total}>
              {data.unlocked} of {data.total} unlocked
            </h2>
            <div className={styles.bar} role="progressbar" aria-labelledby="ach-total" aria-valuemin={0} aria-valuemax={Math.max(data.total, 1)} aria-valuenow={data.unlocked}>
              <span style={{ width: `${data.total ? (data.unlocked / data.total) * 100 : 0}%` }} />
            </div>
          </section>
          <ul className={styles.grid}>
            {data.achievements.map((a) => (
              <Badge key={a.id} a={a} />
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
