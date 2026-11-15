"use client";
// /stages: the all-sky map with only the ready spots pickable, like the levels of a game. The player
// pans and zooms freely; a marker opens that stage's card (Play, status, solution once solved); empty
// sky selects nothing. Markers carry Solved / Tried / NEXT in their labels (SkyMap spotMarks).
// Status comes from this device: a correct find in the guest store (recordFind) is "Solved", a saved
// answer that was not a find is "Tried". The solution is shown only for a solved stage, and only what
// GET /api/overlay?mode=explore returns (the server checks its signed unlock cookie; answer keys are
// never imported here). An unsolved stage never asks the server and its DOM holds no object name.
// Stage 0 "Training" (the tutorial at /tutorial) has no sky position: a button over the map. It is
// solved when every tutorial level is in the guest store's tutorial.done, and while it is not done it
// is NEXT instead of the first spot. Stages are ordered Easy -> Medium -> Hard -> Boss -> Tool tests
// (lib/stageOrder); the first unsolved one is NEXT. A collapsible list of the stages is the keyboard
// and screen-reader route, since the map canvas is mouse-only.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { loadGuestSubmissions } from "@/lib/auth";
import { loadCelebrated, markCelebrated } from "@/lib/celebrated";
import { FIELDS_BASE, loadField, loadFieldIndex } from "@/lib/fields";
import { TUTORIAL } from "@/lib/copy/tutorial";
import { loadGuest } from "@/lib/guest";
import type { Field, FieldSummary } from "@/lib/types";
import { GROUPS } from "@/lib/stageOrder";
import BackLink from "./BackLink";
import { SkyMap } from "./SkyMap";
import { flyFovForSpot } from "./skymap/geometry";
import styles from "./StagesScreen.module.css";

type Status = "new" | "tried" | "solved";
type Stage = { spot: FieldSummary; status: Status; findKind?: string };
type OverlayPosition = { frame: number; x: number; y: number };
type Asteroid = { name: string; positions: OverlayPosition[] };
type Solution = "loading" | "locked" | { field: Field; asteroids: Asteroid[]; nothing: boolean };

const STATUS_LABEL: Record<Status, string> = { new: "Not played", tried: "Tried", solved: "Solved" };
const TRAINING = "training";

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
  const [selected, setSelected] = useState<string | null>(null);
  const [target, setTarget] = useState<{ ra: number; dec: number; fov?: number } | null>(null);
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

  const groups = useMemo(() => (stages ? groupStages(stages) : []), [stages]);
  const numbered = groups.flatMap((g) => g.stages);
  const ordered = numbered.map((s) => s.stage);
  const solved = ordered.filter((s) => s.status === "solved").length;
  const nextSlug = trained ? ordered.find((s) => s.status !== "solved")?.spot.slug : undefined;
  const marks = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of ordered) {
      if (s.spot.slug === nextSlug) m[s.spot.slug] = "NEXT";
      else if (s.status === "solved") m[s.spot.slug] = "Solved";
      else if (s.status === "tried") m[s.spot.slug] = "Tried";
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ordered is derived from stages
  }, [stages, nextSlug]);

  const pick = (slug: string) => setSelected(slug);
  const fromList = (stage: Stage) => {
    setSelected(stage.spot.slug);
    setTarget({ ra: stage.spot.ra, dec: stage.spot.dec, fov: flyFovForSpot(stage.spot) });
  };
  const current = numbered.find((e) => e.stage.spot.slug === selected);

  return (
    <div className={styles.screen}>
      <header className={styles.top}>
        <BackLink />
        <h1 className={styles.title}>Stages</h1>
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
      </header>
      <main className={styles.map}>
        <SkyMap onPlay={() => {}} onSpot={pick} spotMarks={marks} target={target} showSpots />
        {error && <p role="alert" className={styles.note}>The list of stages could not be loaded.</p>}
        {!stages && !error && <p role="status" className={styles.note}>Loading the stages…</p>}
        {stages && (
          <div className={styles.side}>
            <p className={styles.hint}>Pan and zoom the sky. Pick a stage marker to see its card.</p>
            <button
              type="button"
              className={`panel ${styles.training}`}
              data-testid="training-button"
              data-status={trained ? "solved" : "new"}
              aria-pressed={selected === TRAINING}
              onClick={() => setSelected(TRAINING)}
            >
              <span>Stage 0 · Training</span>
              {trained ? (
                <span className={styles.badge} data-kind="solved" aria-hidden="true">
                  ★✓
                </span>
              ) : (
                <span className={styles.badge} data-kind="next">
                  NEXT
                </span>
              )}
            </button>
            <details className={`panel ${styles.listBox}`}>
              <summary>{`All stages (${ordered.length + 1})`}</summary>
              <ol className={styles.listItems}>
                {groups.map((g) => (
                  <li key={g.difficulty}>
                    <h2 className={styles.groupHead}>
                      <span>{g.label}</span>
                      <span className={styles.count}>{`${g.stages.filter((s) => s.stage.status === "solved").length}/${g.stages.length}`}</span>
                    </h2>
                    <ul>
                      {g.stages.map(({ n, stage }) => (
                        <li key={stage.spot.slug}>
                          <button
                            type="button"
                            data-testid={`list-${stage.spot.slug}`}
                            aria-pressed={selected === stage.spot.slug}
                            onClick={() => fromList(stage)}
                          >
                            {`Stage ${n}, ${stage.spot.title}. ${STATUS_LABEL[stage.status]}${stage.spot.slug === nextSlug ? ", next" : ""}`}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            </details>
          </div>
        )}
        {selected === TRAINING && stages && (
          <section className={`panel ${styles.card}`} aria-label="Stage 0" data-testid="training-card" data-status={trained ? "solved" : "new"}>
            <div className={styles.head}>
              <h2>Stage 0</h2>
              <span className={styles.diff}>Training</span>
              <span className={styles.status} data-status={trained ? "solved" : "new"}>
                {trained ? "Solved" : "Not played"}
              </span>
              {!trained && (
                <span className={styles.badge} data-kind="next">
                  NEXT
                </span>
              )}
            </div>
            <p className={styles.desc}>Learn the tools on a practice field before the first real stage.</p>
            <div className={styles.row}>
              <Link className={styles.play} href="/tutorial">
                {trained ? "Play again" : "Play"}
              </Link>
              <button type="button" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
          </section>
        )}
        {current && (
          <StageCard
            key={current.stage.spot.slug}
            n={current.n}
            stage={current.stage}
            next={current.stage.spot.slug === nextSlug}
            burst={burst.has(current.stage.spot.slug)}
            onClose={() => setSelected(null)}
          />
        )}
      </main>
    </div>
  );
}

const PIPS: Record<FieldSummary["difficulty"], number> = { easy: 1, medium: 2, hard: 3, expert: 4, boss: 4, tool: 2, control: 0 };
const BURST_BITS = Array.from({ length: 10 }, (_, i) => i);

type CardProps = { n: number; stage: Stage; next: boolean; burst: boolean; onClose: () => void };

function StageCard({ n, stage, next, burst, onClose }: CardProps) {
  const { spot, status } = stage;
  const regionId = `stage-region-${spot.slug}`;
  const [open, setOpen] = useState(false);
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

  return (
    <section
      className={`panel ${styles.card}`}
      aria-label={`Stage ${n}`}
      data-testid={`stage-${spot.slug}`}
      data-part={`STG-${String(n).padStart(2, "0")}`}
      data-status={status}
    >
      <div className={styles.head}>
        <h2>Stage {n}</h2>
        <span className={styles.diff}>{spot.difficulty}</span>
        <span className={styles.pips} aria-hidden="true">
          {[1, 2, 3, 4].map((p) => (
            <i key={p} data-on={p <= PIPS[spot.difficulty] ? "true" : "false"} />
          ))}
        </span>
        <span className={styles.status} data-status={status}>
          {STATUS_LABEL[status]}
        </span>
        {next && (
          <span className={styles.badge} data-kind="next">
            NEXT
          </span>
        )}
      </div>
      <p className={styles.desc}>
        {spot.title}, {spot.fov_deg}° across. Compare the frames and find what moves.
      </p>
      <div className={styles.thumbWrap}>
        <Thumb spot={spot} solution={solution} />
        {status === "solved" && (
          <span className={styles.badge} data-kind="solved" aria-hidden="true">
            ★✓
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
      <div className={styles.row}>
        <Link className={styles.play} href={`/play?spot=${encodeURIComponent(spot.slug)}`}>
          {status === "solved" ? "Play again" : "Play"}
        </Link>
        <button type="button" aria-expanded={open} aria-controls={regionId} onClick={() => setOpen((o) => !o)}>
          Solution
        </button>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <div id={regionId} className={styles.region} hidden={!open}>
        <SolutionPanel solution={solution} />
      </div>
    </section>
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
