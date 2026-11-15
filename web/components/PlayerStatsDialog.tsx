"use client";
// A modal window with one player's public stats (GET /api/player?name=). The parent mounts it when
// a name is clicked and unmounts it on close; it opens itself with the native <dialog> showModal(),
// so Esc, focus trapping and the backdrop come from the browser. The bot shows only points and a
// description. Object names never appear: the API does not send them.

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { countryName, difficultyRows, exactTime, fetchPlayer, flagEmoji, PlayerError, relativeTime, type PlayerResult } from "@/lib/leaderboard";
import { formatAccuracy } from "@/lib/scoreboard";
import styles from "./PlayerStatsDialog.module.css";

type State = { status: "loading" } | { status: "error"; code: number } | { status: "ok"; player: PlayerResult; now: number };

const num = (n: number | null) => (n === null ? "–" : String(n));
const rank = (n: number | null) => (n === null ? "Not ranked" : `#${n}`);

function Stat({ label, children, title }: { label: string; children: ReactNode; title?: string }) {
  return (
    <div className={styles.stat}>
      <dt>{label}</dt>
      <dd title={title || undefined}>{children}</dd>
    </div>
  );
}

function errorText(code: number): string {
  if (code === 503) return "Player stats are not available right now.";
  if (code === 404) return "We could not find that player.";
  return "Player stats could not be loaded.";
}

export default function PlayerStatsDialog({ name, onClose }: { name: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [state, setState] = useState<State>({ status: "loading" });

  // Open as a modal once. Closing (Esc, Close button, backdrop click) fires the dialog's close event.
  useEffect(() => {
    const d = ref.current;
    if (!d || d.open) return;
    if (typeof d.showModal === "function") d.showModal();
    else d.setAttribute("open", "");
  }, []);

  // One request per name. A late answer for a name that is no longer shown is dropped.
  useEffect(() => {
    let live = true;
    fetchPlayer(name)
      .then((player) => live && setState({ status: "ok", player, now: Date.now() }))
      .catch(
        (e: unknown) =>
          live &&
          setState({
            status: "error",
            code: e instanceof PlayerError ? e.status : 0,
          }),
      );
    return () => {
      live = false;
    };
  }, [name]);

  const player = state.status === "ok" ? state.player : null;
  const shownName = player?.name ?? name;
  const flag = player && !player.is_bot ? flagEmoji(player.country) : "";

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        // A click on the dark backdrop lands on the dialog element itself, not on its content.
        if (e.target === e.currentTarget) e.currentTarget.close();
      }}
    >
      <div className={styles.inner}>
        <div className={styles.head}>
          <h2 id={titleId} className={styles.title}>
            {flag && (
              <span aria-hidden="true" className={styles.flag}>
                {flag}
              </span>
            )}
            {shownName}
            {player?.is_bot && <span className={styles.tag}> (bot)</span>}
            {player?.is_me && <span className={styles.tag}> (you)</span>}
          </h2>
          <button type="button" onClick={() => ref.current?.close()}>
            Close
          </button>
        </div>

        {state.status === "loading" && <p role="status">Loading player stats…</p>}
        {state.status === "error" && <p role="alert">{errorText(state.code)}</p>}

        {player?.is_bot && (
          <>
            <dl className={styles.grid}>
              <Stat label="Points">{num(player.points)}</Stat>
            </dl>
            {player.about && <p className={styles.about}>{player.about}</p>}
          </>
        )}

        {player && !player.is_bot && (
          <>
            {player.country && <p className={styles.country}>{countryName(player.country)}</p>}
            <dl className={styles.grid}>
              <Stat label="Rank, all time">{rank(player.rank_all)}</Stat>
              <Stat label="Rank, this week">{rank(player.rank_week)}</Stat>
              <Stat label="Points, total">{num(player.points)}</Stat>
              <Stat label="Points, this week">{num(player.points_week)}</Stat>
              <Stat label="Accuracy">{formatAccuracy(player.accuracy)}</Stat>
              <Stat label="Classifications">{num(player.classifications)}</Stat>
              <Stat label="Correct answers">{num(player.correct)}</Stat>
              <Stat label="First finds">{num(player.first_finds)}</Stat>
              <Stat label="Sky patches solved">{num(player.patches_solved)}</Stat>
              <Stat label="Active days">{num(player.active_days)}</Stat>
              <Stat label="Member since" title={exactTime(player.member_since)}>
                {relativeTime(player.member_since, state.status === "ok" ? state.now : 0)}
              </Stat>
              <Stat label="Last active" title={exactTime(player.last_active)}>
                {relativeTime(player.last_active, state.status === "ok" ? state.now : 0)}
              </Stat>
            </dl>

            {player.stages_total !== null && (
              <section aria-labelledby={`${titleId}-stages`} className={styles.stages}>
                <h3 id={`${titleId}-stages`} className={styles.subtitle}>
                  Stages completed:{" "}
                  <span className={styles.mono}>
                    {player.stages_completed ?? "–"} / {player.stages_total ?? "–"}
                  </span>
                </h3>
                <ul className={styles.bars}>
                  {difficultyRows(player.by_difficulty).map((d) => (
                    <li key={d.key} className={styles.bar}>
                      <span className={styles.barLabel}>{d.label}</span>
                      <span className={styles.track} aria-hidden="true">
                        <span
                          className={styles.fill}
                          style={{
                            width: `${Math.min(100, (d.done / d.total) * 100)}%`,
                          }}
                        />
                      </span>
                      <span className={styles.mono}>
                        {d.done} / {d.total}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </dialog>
  );
}
