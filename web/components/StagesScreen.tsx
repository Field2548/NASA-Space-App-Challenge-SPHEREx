"use client";
// /stages: one card per ready spot in public/fields/index.json order, like the levels of a game.
// Status comes from this device: a correct find in the guest store (recordFind) is "Solved", a saved
// answer that was not a find is "Tried". The solution is shown only for a solved stage, and only what
// GET /api/overlay?mode=explore returns (the server checks its signed unlock cookie; answer keys are
// never imported here). An unsolved stage never asks the server and its DOM holds no object name.
// Stage 0 "Training" (the tutorial at /tutorial) comes first; it is solved when every tutorial level is
// in the guest store's tutorial.done, and while it is not done it is NEXT instead of the first spot.
// Stages are grouped Easy -> Medium -> Hard -> Boss (index order inside a group). The first unsolved one
// in that order is NEXT. A card expands in place (one at a time); arrow keys rove focus between cards.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent } from "react";
import { loadGuestSubmissions } from "@/lib/auth";
import { loadCelebrated, markCelebrated } from "@/lib/celebrated";
import { FIELDS_BASE, loadField, loadFieldIndex } from "@/lib/fields";
import { TUTORIAL } from "@/lib/copy/tutorial";
import { loadGuest } from "@/lib/guest";
import type { Field, FieldSummary } from "@/lib/types";
import BackLink from "./BackLink";
import styles from "./StagesScreen.module.css";

type Status = "new" | "tried" | "solved";
type Stage = { spot: FieldSummary; status: Status; findKind?: string };
type OverlayPosition = { frame: number; x: number; y: number };
type Asteroid = { name: string; positions: OverlayPosition[] };
type Solution = "loading" | "locked" | { field: Field; asteroids: Asteroid[]; nothing: boolean };

const STATUS_LABEL: Record<Status, string> = { new: "Not played", tried: "Tried", solved: "Solved" };
const GROUPS: { difficulty: FieldSummary["difficulty"]; label: string }[] = [
  { difficulty: "easy", label: "Easy" },
  { difficulty: "medium", label: "Medium" },
  { difficulty: "hard", label: "Hard" },
  { difficulty: "expert", label: "Expert" }, // not in the current index; kept so no stage is dropped
  { difficulty: "boss", label: "Boss" },
  { difficulty: "control", label: "Control" }, // legacy
];

function readStages(index: FieldSummary[]): Stage[] {
  const finds = loadGuest().finds;
  const tried = new Set(loadGuestSubmissions().map((r) => r.spot));
  return index.map((spot) => {
    const find = finds.find((f) => f.spot === spot.slug);
    return { spot, status: find ? "solved" : tried.has(spot.slug) ? "tried" : "new", findKind: find?.kind };
  });
}

type Group = { difficulty: FieldSummary["difficulty"]; label: string; stages: { n: number; stage: Stage }[] };

// Easy -> Boss, stable by index order inside a group; numbers continue across groups.
function groupStages(stages: Stage[]): Group[] {
  let n = 0;
  return GROUPS.map((g) => ({
    ...g,
    stages: stages.filter((s) => s.spot.difficulty === g.difficulty).map((stage) => ({ n: ++n, stage })),
  })).filter((g) => g.stages.length > 0);
}

const utcText = (utc: string) => `${utc.slice(0, 10)} ${utc.slice(11, 16)} UTC`;

export default function StagesScreen() {
  const [stages, setStages] = useState<Stage[] | null>(null);
  const [trained, setTrained] = useState(false);
  const [error, setError] = useState(false);
  const [burst, setBurst] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<string | null>(null);
  const groupsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    loadFieldIndex()
      .then((index) => {
        if (!live) return;
        const read = readStages(index);
        const done = loadCelebrated();
        const fresh = read.filter((s) => s.status === "solved" && !done.has(s.spot.slug)).map((s) => s.spot.slug);
        if (fresh.length) markCelebrated(fresh);
        setBurst(new Set(fresh));
        const tdone = loadGuest().tutorial.done;
        setTrained(TUTORIAL.every((l) => tdone.includes(l.id)));
        setStages(read);
      })
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, []);

  const groups = stages ? groupStages(stages) : [];
  const ordered = groups.flatMap((g) => g.stages.map((s) => s.stage));
  const solved = ordered.filter((s) => s.status === "solved").length;
  const nextSlug = trained ? ordered.find((s) => s.status !== "solved")?.spot.slug : undefined;
  const tabSlug = tab ?? ordered[0]?.spot.slug;

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!(e.target as HTMLElement).hasAttribute("data-stage-toggle")) return;
    const toggles = Array.from(groupsRef.current?.querySelectorAll<HTMLElement>("[data-stage-toggle]") ?? []);
    const at = toggles.indexOf(e.target as HTMLElement);
    const to =
      e.key === "ArrowRight" || e.key === "ArrowDown" ? Math.min(at + 1, toggles.length - 1)
      : e.key === "ArrowLeft" || e.key === "ArrowUp" ? Math.max(at - 1, 0)
      : e.key === "Home" ? 0
      : e.key === "End" ? toggles.length - 1
      : -1;
    if (to < 0) return;
    e.preventDefault();
    toggles[to].focus();
  }

  return (
    <main className={styles.page}>
      <BackLink />
      <h1>Stages</h1>
      <p>Play the spots in order. The solution of a stage opens after you solve it.</p>
      {error && <p role="alert">The list of stages could not be loaded.</p>}
      {!stages && !error && <p role="status">Loading the stages…</p>}
      {stages && (
        <div
          className={styles.progress}
          role="progressbar"
          aria-label="Stages solved"
          aria-valuemin={0}
          aria-valuemax={ordered.length}
          aria-valuenow={solved}
          aria-valuetext={`${solved} of ${ordered.length} solved`}
        >
          <span className={styles.segments} aria-hidden="true">
            {ordered.map((s, i) => (
              <span key={s.spot.slug} className={styles.segment} data-filled={i < solved ? "true" : "false"} />
            ))}
          </span>
          <span className={styles.progressText}>{`${solved}/${ordered.length} solved`}</span>
        </div>
      )}
      <div ref={groupsRef} onKeyDown={onKeyDown}>
        {stages && (
          <section className={styles.group}>
            <h2 className={styles.groupHead}>
              <span>Training</span>
              <span className={styles.rule} aria-hidden="true" />
              <span className={styles.count}>{trained ? "1/1" : "0/1"}</span>
            </h2>
            <ol className={styles.list}>
              <li
                className={`panel ${styles.card}`}
                data-testid="training-card"
                data-part="STG-00"
                data-status={trained ? "solved" : "new"}
              >
                <div className={styles.head}>
                  <h3>Stage 0</h3>
                  <span className={styles.diff}>Training</span>
                  <span className={styles.status} data-status={trained ? "solved" : "new"}>
                    {trained ? "Solved" : "Not played"}
                  </span>
                </div>
                <p className={styles.desc}>Learn the tools on a practice field before the first real stage.</p>
                {trained ? (
                  <span className={styles.badge} data-kind="solved" aria-hidden="true">
                    ★✓
                  </span>
                ) : (
                  <span className={styles.badge} data-kind="next">
                    NEXT
                  </span>
                )}
                <Link className={styles.play} href="/tutorial">
                  {trained ? "Play again" : "Play"}
                </Link>
              </li>
            </ol>
          </section>
        )}
        {groups.map((g) => (
          <section key={g.difficulty} className={styles.group}>
            <h2 className={styles.groupHead}>
              <span>{g.label}</span>
              <span className={styles.rule} aria-hidden="true" />
              <span className={styles.count}>{`${g.stages.filter((s) => s.stage.status === "solved").length}/${g.stages.length}`}</span>
            </h2>
            <ol className={styles.list}>
              {g.stages.map(({ n, stage }) => (
                <StageCard
                  key={stage.spot.slug}
                  n={n}
                  stage={stage}
                  next={stage.spot.slug === nextSlug}
                  burst={burst.has(stage.spot.slug)}
                  open={open === stage.spot.slug}
                  tabStop={stage.spot.slug === tabSlug}
                  onToggle={() => setOpen((o) => (o === stage.spot.slug ? null : stage.spot.slug))}
                  onFocusToggle={() => setTab(stage.spot.slug)}
                />
              ))}
            </ol>
          </section>
        ))}
      </div>
    </main>
  );
}

const PIPS: Record<FieldSummary["difficulty"], number> = { easy: 1, medium: 2, hard: 3, expert: 4, boss: 4, control: 0 };
const BURST_BITS = Array.from({ length: 10 }, (_, i) => i);

type CardProps = {
  n: number;
  stage: Stage;
  next: boolean;
  burst: boolean;
  open: boolean;
  tabStop: boolean;
  onToggle: () => void;
  onFocusToggle: () => void;
};

function StageCard({ n, stage, next, burst, open, tabStop, onToggle, onFocusToggle }: CardProps) {
  const { spot, status } = stage;
  const regionId = `stage-region-${spot.slug}`;
  const [solution, setSolution] = useState<Solution>(status === "solved" ? "loading" : "locked");
  useEffect(() => {
    if (status !== "solved") return; // an unsolved stage never asks the server
    let live = true;
    const url = `/api/overlay?spot=${encodeURIComponent(spot.slug)}&mode=explore`;
    Promise.all([fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))), loadField(spot.slug)])
      .then(([body, field]) => {
        if (!live) return;
        if (!body || body.locked !== false || !Array.isArray(body.asteroids)) return setSolution("locked");
        setSolution({ field, asteroids: body.asteroids, nothing: stage.findKind === "nothing_correct" });
      })
      .catch(() => live && setSolution("locked"));
    return () => {
      live = false;
    };
  }, [spot.slug, status, stage.findKind]);

  // The whole card toggles; a click on the Play link or inside the opened region does not.
  function onCardClick(e: MouseEvent<HTMLLIElement>) {
    if ((e.target as HTMLElement).closest("a, [data-region]")) return;
    onToggle();
  }

  return (
    <li
      className={`panel ${styles.card}`}
      data-testid={`stage-${spot.slug}`}
      data-part={`STG-${String(n).padStart(2, "0")}`}
      data-open={open ? "true" : "false"}
      data-status={status}
      onClick={onCardClick}
    >
      <div className={styles.head}>
        <h3>Stage {n}</h3>
        <span className={styles.diff}>{spot.difficulty}</span>
        <span className={styles.pips} aria-hidden="true">
          {[1, 2, 3, 4].map((p) => (
            <i key={p} data-on={p <= PIPS[spot.difficulty] ? "true" : "false"} />
          ))}
        </span>
        <span className={styles.status} data-status={status}>
          {STATUS_LABEL[status]}
        </span>
        <button
          type="button"
          className={styles.toggle}
          data-stage-toggle=""
          aria-expanded={open}
          aria-controls={regionId}
          aria-label={`Stage ${n}, ${spot.difficulty}`}
          tabIndex={tabStop ? 0 : -1}
          onFocus={onFocusToggle}
        >
          <span aria-hidden="true">{open ? "▴" : "▾"}</span>
        </button>
      </div>
      <div className={styles.thumbWrap}>
        <Thumb spot={spot} solution={solution} />
        {status === "solved" && (
          <span className={styles.badge} data-kind="solved" aria-hidden="true">
            ★✓
          </span>
        )}
        {status === "tried" && (
          <span className={styles.badge} data-kind="tried">
            TRIED
          </span>
        )}
        {next && (
          <span className={styles.badge} data-kind="next">
            NEXT
          </span>
        )}
        {burst && (
          <span className={styles.burst} data-burst="" aria-hidden="true">
            {BURST_BITS.map((i) => (
              <i key={i} style={{ "--a": `${i * 36}deg` } as CSSProperties}>
                {i % 2 ? "★" : "✦"}
              </i>
            ))}
          </span>
        )}
      </div>
      <Link className={styles.play} href={`/play?spot=${encodeURIComponent(spot.slug)}`}>
        {status === "solved" ? "Play again" : "Play"}
      </Link>
      <div id={regionId} className={styles.region} data-region="" hidden={!open}>
        <p className={styles.desc}>
          {spot.title}, {spot.fov_deg}° across. Compare the frames and find what moves.
        </p>
        <SolutionPanel solution={solution} />
      </div>
    </li>
  );
}

function Thumb({ spot, solution }: { spot: FieldSummary; solution: Solution }) {
  const field = typeof solution === "object" ? solution.field : null;
  const [w, h] = field?.size ?? [1, 1];
  return (
    <div className={styles.thumb} style={field ? { aspectRatio: `${w} / ${h}` } : undefined}>
      {/* eslint-disable-next-line @next/next/no-img-element -- static webp from public/fields */}
      <img src={`${FIELDS_BASE}/${spot.thumbnail}`} alt={`Stage thumbnail`} />
      {field && typeof solution === "object" && (
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
          {solution.asteroids.map((a) => (
            <g key={a.name}>
              <polyline points={a.positions.map((p) => `${p.x},${p.y}`).join(" ")} />
              {a.positions.map((p) => (
                <circle key={p.frame} cx={p.x} cy={p.y} r={Math.max(w, h) / 80} />
              ))}
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}

function SolutionPanel({ solution }: { solution: Solution }) {
  if (solution === "loading") return <p className={styles.solution}>Loading the solution…</p>;
  if (solution === "locked") return <p className={styles.solution}>Solution locked. Solve this stage to see it.</p>;
  const { field, asteroids, nothing } = solution;
  if (asteroids.length === 0) {
    return <p className={styles.solution}>{nothing ? "Nothing moves here." : "No known object is listed for this stage."}</p>;
  }
  return (
    <div className={styles.solution}>
      {asteroids.map((a) => (
        <div key={a.name}>
          <strong>{a.name}</strong>
          <ul>
            {a.positions.map((p) => {
              const meta = field.frames.find((f) => f.i === p.frame) ?? field.frames[p.frame - 1];
              return (
                <li key={p.frame}>
                  Frame {p.frame}
                  {meta ? `: ${utcText(meta.utc)}` : ""}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
