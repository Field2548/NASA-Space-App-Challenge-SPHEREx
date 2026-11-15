"use client";
// /stages: one card per ready spot in public/fields/index.json order, like the levels of a game.
// Status comes from this device: a correct find in the guest store (recordFind) is "Solved", a saved
// answer that was not a find is "Tried". The solution is shown only for a solved stage, and only what
// GET /api/overlay?mode=explore returns (the server checks its signed unlock cookie; answer keys are
// never imported here). An unsolved stage never asks the server and its DOM holds no object name.

import Link from "next/link";
import { useEffect, useState } from "react";
import { loadGuestSubmissions } from "@/lib/auth";
import { FIELDS_BASE, loadField, loadFieldIndex } from "@/lib/fields";
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

function readStages(index: FieldSummary[]): Stage[] {
  const finds = loadGuest().finds;
  const tried = new Set(loadGuestSubmissions().map((r) => r.spot));
  return index.map((spot) => {
    const find = finds.find((f) => f.spot === spot.slug);
    return { spot, status: find ? "solved" : tried.has(spot.slug) ? "tried" : "new", findKind: find?.kind };
  });
}

const utcText = (utc: string) => `${utc.slice(0, 10)} ${utc.slice(11, 16)} UTC`;

export default function StagesScreen() {
  const [stages, setStages] = useState<Stage[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    loadFieldIndex()
      .then((index) => live && setStages(readStages(index)))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, []);

  return (
    <main className={styles.page}>
      <BackLink />
      <h1>Stages</h1>
      <p>Play the spots in order. The solution of a stage opens after you solve it.</p>
      {error && <p role="alert">The list of stages could not be loaded.</p>}
      {!stages && !error && <p role="status">Loading the stages…</p>}
      <ol className={styles.list}>
        {stages?.map((s, i) => (
          <StageCard key={s.spot.slug} n={i + 1} stage={s} />
        ))}
      </ol>
    </main>
  );
}

function StageCard({ n, stage }: { n: number; stage: Stage }) {
  const { spot, status } = stage;
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
    <li className={`panel ${styles.card}`} data-testid={`stage-${spot.slug}`} data-part={`STG-${String(n).padStart(2, "0")}`}>
      <div className={styles.head}>
        <h2>Stage {n}</h2>
        <span className={styles.diff}>{spot.difficulty}</span>
        <span className={styles.status} data-status={status}>
          {STATUS_LABEL[status]}
        </span>
      </div>
      <Thumb spot={spot} solution={solution} />
      <Link className={styles.play} href={`/play?spot=${encodeURIComponent(spot.slug)}`}>
        {status === "solved" ? "Play again" : "Play"}
      </Link>
      <SolutionPanel solution={solution} />
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
