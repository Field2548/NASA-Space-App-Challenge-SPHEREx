"use client";
// /leaderboard: top players from GET /api/leaderboard (rank, name, points; my row highlighted and pinned
// by `me` when logged in). Tabs: All stages, then one tab per ready spot. Spots are named by stage number
// and difficulty only (never by object), numbered like /stages (Easy -> Boss, index order inside a group).
// A snapshot answer (database down) is labelled as such.

import { useEffect, useState } from "react";
import { fetchBoard } from "@/lib/boardFetch";
import { loadFieldIndex } from "@/lib/fields";
import { arrangeRows, type Board } from "@/lib/scoreboard";
import type { FieldSummary } from "@/lib/types";
import BackLink from "./BackLink";
import styles from "./LeaderboardScreen.module.css";

const ORDER: FieldSummary["difficulty"][] = ["easy", "medium", "hard", "expert", "boss", "tool", "control"];

type Tab = { slug: string | null; label: string };
type View = { slug: string | null; board: Board } | { slug: string | null; error: true };

export default function LeaderboardScreen() {
  const [tabs, setTabs] = useState<Tab[]>([{ slug: null, label: "All stages" }]);
  const [slug, setSlug] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);

  useEffect(() => {
    let live = true;
    loadFieldIndex()
      .then((index) => {
        if (!live) return;
        const spots = ORDER.flatMap((d) => index.filter((s) => s.difficulty === d));
        setTabs([{ slug: null, label: "All stages" }, ...spots.map((s, i) => ({ slug: s.slug, label: `Stage ${i + 1} (${s.difficulty})` }))]);
      })
      .catch(() => undefined); // the All stages tab still works
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    fetchBoard(slug)
      .then((board) => live && setView({ slug, board }))
      .catch(() => live && setView({ slug, error: true }));
    return () => {
      live = false;
    };
  }, [slug]);

  const current = view && view.slug === slug ? view : null;
  const board = current && "board" in current ? current.board : null;
  const rows = board ? arrangeRows(board, false) : [];
  const meOutside = board?.me && !rows.some((r) => r.is_me) ? board.me : null;

  return (
    <main className={styles.page}>
      <BackLink />
      <h1>Leaderboard</h1>
      <div role="tablist" aria-label="Leaderboard scope" className={styles.tabs}>
        {tabs.map((t) => (
          <button
            key={t.slug ?? "all"}
            type="button"
            role="tab"
            aria-selected={t.slug === slug}
            className={styles.tab}
            onClick={() => setSlug(t.slug)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {!current && <p role="status">Loading the leaderboard…</p>}
      {current && "error" in current && <p role="alert">The leaderboard could not be loaded.</p>}
      {board && board.source === "snapshot" && <p className={styles.note}>Showing a saved copy; live scores are unavailable.</p>}
      {board && rows.length === 0 && !meOutside && <p>No scores yet.</p>}
      {board && (rows.length > 0 || meOutside) && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Name</th>
                <th scope="col">Points</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.rank}-${r.name}`} data-me={r.is_me ? "true" : "false"}>
                  <td>{r.rank}</td>
                  <td>
                    {r.name}
                    {r.is_bot && <span className={styles.tag}> (bot)</span>}
                    {r.is_me && <span className={styles.tag}> (you)</span>}
                  </td>
                  <td>{r.score}</td>
                </tr>
              ))}
              {meOutside && (
                <tr data-me="true">
                  <td>{meOutside.rank}</td>
                  <td>
                    {meOutside.name}
                    <span className={styles.tag}> (you)</span>
                  </td>
                  <td>{meOutside.score}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
