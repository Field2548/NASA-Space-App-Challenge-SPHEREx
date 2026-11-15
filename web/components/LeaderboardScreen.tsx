"use client";
// /leaderboard: a dashboard. Header controls (ranking metric, time range) apply to everything below.
// The page opens on "Movers found" (distinct real moving objects a player identified); "Points" is
// the other metric. Every board covers all stages.
//  1. "Your standing": my rank and numbers for the chosen metric, from the Global or the Local board.
//  2. A global board and a local (my country) board, each with a podium for the top 3 and a table.
//  3. Clicking any player's name opens a stats window (PlayerStatsDialog).
// Both boards load at once (no waterfall). Each request is tied to the selection that started it, so
// a late answer for an older selection is never shown.

import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import {
  countryName,
  DEFAULT_METRIC,
  fetchBoardV2,
  flagEmoji,
  splitPodium,
  type BoardMe,
  type BoardResult,
  type BoardRow,
  type BoardV2,
  type Metric,
  type Period,
  type Region,
} from "@/lib/leaderboard";
import { formatAccuracy } from "@/lib/scoreboard";
import BackLink from "./BackLink";
import styles from "./LeaderboardScreen.module.css";
import PlayerStatsDialog from "./PlayerStatsDialog";

const PERIODS: { value: Period; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "week", label: "This week" },
];
const METRICS: { value: Metric; label: string }[] = [
  { value: "movers", label: "Movers found" },
  { value: "points", label: "Points" },
];
const MEDALS = ["gold", "silver", "bronze"] as const;

/** The latest answer for one board; `key` says which selection asked for it. */
type View = { key: string; result: { ok: true; data: BoardResult } | { ok: false } };
type OpenPlayer = (name: string, button: HTMLElement) => void;

const count = (n: number | null | undefined) => (n === null || n === undefined ? "–" : String(n));
const moversText = (n: number | null | undefined) => `${n ?? 0} ${n === 1 ? "mover" : "movers"}`;

// ----- pieces ---------------------------------------------------------------------------------

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className={styles.seg}>
      {options.map((o) => (
        <button key={o.value} type="button" className={styles.segBtn} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function PlayerName({ name, onOpen }: { name: string; onOpen: OpenPlayer }) {
  return (
    <button type="button" className={styles.nameBtn} title={name} aria-label={`View stats for ${name}`} onClick={(e: MouseEvent<HTMLButtonElement>) => onOpen(name, e.currentTarget)}>
      {name}
    </button>
  );
}

function Tags({ row }: { row: { is_bot?: boolean; is_me?: boolean } }) {
  return (
    <>
      {row.is_bot && <span className={styles.badge}>bot</span>}
      {row.is_me && <span className={styles.badge}>you</span>}
    </>
  );
}

function Podium({ rows, onOpen, metric }: { rows: BoardRow[]; onOpen: OpenPlayer; metric: Metric }) {
  return (
    <ol className={styles.podium}>
      {rows.map((r, i) => (
        <li key={`${r.rank}-${r.name}`} className={styles.card} data-medal={MEDALS[i]} data-me={r.is_me ? "true" : "false"}>
          <span className={styles.cardRank}>#{r.rank}</span>
          <span className={styles.cardName}>
            <PlayerName name={r.name} onOpen={onOpen} />
            <Tags row={r} />
          </span>
          <span className={styles.cardPoints}>
            {metric === "movers" ? (
              <>
                {moversText(r.movers)}
                <span className={styles.cardSub}>
                  {r.score} <span className={styles.unit}>pts</span>
                </span>
              </>
            ) : (
              <>
                {r.score} <span className={styles.unit}>pts</span>
              </>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

function BoardTable({ label, rows, me, meShown, onOpen, metric }: { label: string; rows: BoardRow[]; me: BoardMe | null; meShown: boolean; onOpen: OpenPlayer; metric: Metric }) {
  const movers = metric === "movers";
  // I am pinned at the bottom only when I am not among the rows already shown (podium or table).
  const pinned = me && !meShown ? me : null;
  if (rows.length === 0 && !pinned) return null;
  const line = (r: { rank: number; name: string; score: number; accuracy: number | null; finds?: number | null; movers?: number | null; is_bot?: boolean; is_me?: boolean }) => (
    <tr key={`${r.rank}-${r.name}`} data-me={r.is_me ? "true" : "false"}>
      <td className={styles.num}>{r.rank}</td>
      <td className={styles.player}>
        <span className={styles.cardName}>
          <PlayerName name={r.name} onOpen={onOpen} />
          <Tags row={r} />
        </span>
      </td>
      {movers && <td className={styles.num}>{r.movers ?? 0}</td>}
      <td className={styles.num}>{r.score}</td>
      <td className={`${styles.num} ${styles.hideNarrow}`}>{formatAccuracy(r.accuracy)}</td>
      {!movers && <td className={`${styles.num} ${styles.hideNarrow}`}>{count(r.finds)}</td>}
    </tr>
  );
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table} aria-label={label}>
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col">Player</th>
            {movers && <th scope="col">Movers</th>}
            <th scope="col">Points</th>
            <th scope="col" className={styles.hideNarrow}>
              Accuracy
            </th>
            {!movers && (
              <th scope="col" className={styles.hideNarrow}>
                Classifications
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map(line)}
          {pinned && (
            <>
              <tr className={styles.gap} aria-hidden="true">
                <td colSpan={5}>⋮</td>
              </tr>
              {line({ ...pinned, is_me: true })}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Podium + table for one available board, or an honest empty line. */
function BoardRows({ label, board, onOpen, period, metric }: { label: string; board: BoardV2; onOpen: OpenPlayer; period: Period; metric: Metric }) {
  const { podium, rest } = splitPodium(board.rows);
  if (board.rows.length === 0 && !board.me) {
    const what = metric === "movers" ? "movers found" : "scores";
    return <p className={styles.note}>{period === "week" ? `No ${what} this week yet.` : `No ${what} yet.`}</p>;
  }
  return (
    <>
      {podium.length > 0 && <Podium rows={podium} onOpen={onOpen} metric={metric} />}
      <BoardTable label={label} rows={rest} me={board.me} meShown={board.rows.some((r) => r.is_me)} onOpen={onOpen} metric={metric} />
    </>
  );
}

function unavailableText(reason: BoardV2["reason"], metric: Metric): string {
  if (reason === "not_installed") {
    return metric === "movers" ? "The movers ranking is being set up. Switch to Points to see scores." : "Weekly and local boards are being set up. All-time global scores are shown.";
  }
  return "Live scores are unavailable right now.";
}

// ----- the page -------------------------------------------------------------------------------

/** `initialMetric` is for tests; the page always opens on DEFAULT_METRIC (movers). */
export default function LeaderboardScreen({ initialMetric = DEFAULT_METRIC }: { initialMetric?: Metric } = {}) {
  const [metric, setMetric] = useState<Metric>(initialMetric);
  const [period, setPeriod] = useState<Period>("all");
  const [country, setCountry] = useState<string | null>(null); // chosen by me; null = detected
  const [mine, setMine] = useState<Region>("global");
  const [globalView, setGlobalView] = useState<View | null>(null);
  const [localView, setLocalView] = useState<View | null>(null);
  // Remembered across reloads of the local board so its country picker never blinks away.
  const [picker, setPicker] = useState<{ countries: { code: string; players: number }[]; detected: string | null; shown: string | null }>({ countries: [], detected: null, shown: null });
  const [openName, setOpenName] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const ids = { standing: useId(), global: useId(), local: useId(), country: useId() };

  const globalKey = `${metric}|${period}`;
  const localKey = `${globalKey}|${country ?? ""}`;

  useEffect(() => {
    let live = true;
    fetchBoardV2({ metric, period, region: "global" })
      .then((data) => live && setGlobalView({ key: globalKey, result: { ok: true, data } }))
      .catch(() => live && setGlobalView({ key: globalKey, result: { ok: false } }));
    return () => {
      live = false;
    };
  }, [metric, period, globalKey]);

  useEffect(() => {
    let live = true;
    fetchBoardV2({ metric, period, region: "local", country })
      .then((data) => {
        if (!live) return;
        setLocalView({ key: localKey, result: { ok: true, data } });
        setPicker({ countries: data.board.countries, detected: data.board.detected_country, shown: data.board.country });
      })
      .catch(() => live && setLocalView({ key: localKey, result: { ok: false } }));
    return () => {
      live = false;
    };
  }, [metric, period, country, localKey]);

  const globalNow = globalView?.key === globalKey ? globalView.result : null;
  const localNow = localView?.key === localKey ? localView.result : null;

  const openPlayer: OpenPlayer = (name, button) => {
    opener.current = button;
    setOpenName(name);
  };
  const closePlayer = () => {
    setOpenName(null);
    const el = opener.current;
    opener.current = null;
    if (el?.isConnected) el.focus();
  };

  const periodLabel = PERIODS.find((p) => p.value === period)?.label ?? "";
  const metricLabel = METRICS.find((m) => m.value === metric)?.label ?? "";

  const localCountry = country ?? (localNow?.ok ? localNow.data.board.country : null) ?? picker.shown;
  const pickerValue = country ?? picker.shown ?? picker.detected ?? "";
  const options = picker.countries.some((c) => c.code === pickerValue) || !pickerValue ? picker.countries : [{ code: pickerValue, players: 0 }, ...picker.countries];

  const countrySelect = (
    <div className={styles.field}>
      <label htmlFor={ids.country}>Country</label>
      <select id={ids.country} className={styles.countrySelect} value={pickerValue} onChange={(e) => setCountry(e.target.value || null)}>
        {!pickerValue && (
          <option value="" disabled>
            Choose a country
          </option>
        )}
        {options.map((c) => (
          <option key={c.code} value={c.code}>
            {flagEmoji(c.code)} {countryName(c.code)}
          </option>
        ))}
      </select>
    </div>
  );

  // ----- Your standing
  const standingView = mine === "global" ? globalNow : localNow;
  let standing: ReactNode;
  if (!standingView) standing = <p role="status">Loading your standing…</p>;
  else if (!standingView.ok) standing = <p role="alert">Your standing could not be loaded.</p>;
  else {
    const { board, signedIn } = standingView.data;
    if (!signedIn) {
      standing = (
        <div className={styles.standingMsg}>
          <p className={styles.bigMsg}>Log in to get a rank</p>
          <p className={styles.note}>Use the Log in button at the top right of the page. Guests can play but are not ranked.</p>
        </div>
      );
    } else if (!board.available) {
      standing = <p className={styles.note}>{board.reason === "no_country" ? "Pick a country on the Local board to see your local rank." : "Your rank is not available right now."}</p>;
    } else if (board.me) {
      const me = board.me;
      standing = (
        <dl className={styles.kpis}>
          <div className={styles.kpi}>
            <dt>Rank</dt>
            <dd className={styles.rankBig}>#{me.rank}</dd>
          </div>
          {metric === "movers" && (
            <div className={styles.kpi}>
              <dt>Movers found</dt>
              <dd>{me.movers ?? 0}</dd>
            </div>
          )}
          <div className={styles.kpi}>
            <dt>Points</dt>
            <dd>{me.score}</dd>
          </div>
          <div className={styles.kpi}>
            <dt>Accuracy</dt>
            <dd>{formatAccuracy(me.accuracy)}</dd>
          </div>
          {metric === "points" && (
            <div className={styles.kpi}>
              <dt>Classifications</dt>
              <dd>{count(me.finds)}</dd>
            </div>
          )}
        </dl>
      );
    } else if (board.source === "snapshot") {
      standing = <p className={styles.note}>Your rank is not in the saved copy. It will show when live scores are back.</p>;
    } else {
      const what = metric === "movers" ? "movers found" : "points";
      standing = <p className={styles.msg}>{period === "week" ? `You have no ${what} this week yet.` : `You have no ${what} yet.`} Classify a field to get on the board.</p>;
    }
  }
  const guest = standingView?.ok === true && !standingView.data.signedIn;
  const standingCaption = `${mine === "global" ? "Global" : localCountry ? `Local, ${countryName(localCountry)}` : "Local"} · ${periodLabel} · ${metricLabel}`;

  // ----- boards
  let globalBody: ReactNode;
  if (!globalNow) globalBody = <p role="status">Loading the global board…</p>;
  else if (!globalNow.ok) globalBody = <p role="alert">The global board could not be loaded.</p>;
  else {
    const board = globalNow.data.board;
    globalBody = (
      <>
        {board.source === "snapshot" && <p className={styles.note}>Showing a saved copy; live scores are unavailable.</p>}
        {board.available ? <BoardRows label="Global ranking" board={board} onOpen={openPlayer} period={period} metric={metric} /> : <p className={styles.note}>{unavailableText(board.reason, metric)}</p>}
      </>
    );
  }

  let localBody: ReactNode;
  let pickFirst = false; // the "pick a country" sentence goes above the select
  if (!localNow) localBody = <p role="status">Loading the local board…</p>;
  else if (!localNow.ok) localBody = <p role="alert">The local board could not be loaded.</p>;
  else {
    const board = localNow.data.board;
    if (board.available) {
      localBody = (
        <>
          {board.source === "snapshot" && <p className={styles.note}>Showing a saved copy; live scores are unavailable.</p>}
          <BoardRows label="Local ranking" board={board} onOpen={openPlayer} period={period} metric={metric} />
        </>
      );
    } else if (board.reason === "no_country") {
      pickFirst = true;
      localBody = (
        <p className={styles.note}>
          {picker.countries.length > 0 ? "We could not tell which country you are in. Pick one:" : "We could not tell which country you are in. Local boards appear once players from a country have scores."}
        </p>
      );
    } else {
      localBody = <p className={styles.note}>{unavailableText(board.reason, metric)}</p>;
    }
  }
  const showPicker = picker.countries.length > 0 || country !== null;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <BackLink />
        <h1 className={styles.h1}>Leaderboard</h1>
      </header>
      <div className={styles.controls}>
        <Segmented label="Rank by" value={metric} options={METRICS} onChange={setMetric} />
        <Segmented label="Time range" value={period} options={PERIODS} onChange={setPeriod} />
      </div>

      <section className={styles.standing} aria-labelledby={ids.standing}>
        <div className={styles.standingHead}>
          <div>
            <h2 id={ids.standing} className={styles.h2}>
              Your standing
            </h2>
            <p className={styles.caption}>{standingCaption}</p>
          </div>
          {!guest && (
            <Segmented
              label="Compare my rank with"
              value={mine}
              options={[
                { value: "global", label: "Global" },
                { value: "local", label: "Local" },
              ]}
              onChange={setMine}
            />
          )}
        </div>
        {standing}
      </section>

      <div className={styles.boards}>
        <section className={styles.board} aria-labelledby={ids.global}>
          <h2 id={ids.global} className={styles.h2}>
            Global
          </h2>
          <p className={styles.caption}>
            {periodLabel} · {metricLabel}
          </p>
          {globalBody}
        </section>

        <section className={styles.board} aria-labelledby={ids.local}>
          <h2 id={ids.local} className={styles.h2}>
            Local
            {localCountry && (
              <>
                {" "}
                <span aria-hidden="true">{flagEmoji(localCountry)}</span> {countryName(localCountry)}
              </>
            )}
          </h2>
          <p className={styles.caption}>
            {periodLabel} · {metricLabel}
          </p>
          {pickFirst && localBody}
          {showPicker && countrySelect}
          {!pickFirst && localBody}
          <p className={styles.fine}>
            Local boards use the country your internet connection appears to come from. We keep only the two-letter country code on your profile, never your IP address.
          </p>
        </section>
      </div>

      {openName !== null && <PlayerStatsDialog key={openName} name={openName} onClose={closePlayer} />}
    </main>
  );
}
