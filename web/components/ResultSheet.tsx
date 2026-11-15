"use client";
// Bottom result sheet shown after a verdict (replaces the old verdict box and the "Next spot" row).
// Correct: green bar, points, "Stage N/M", one plain sentence, NEXT STAGE. Wrong: coral bar, a short
// hint, "Try again" and "Skip stage". Technical numbers sit behind "Details". The object name appears
// only when the server unlocked the spot (api.md 2/3); a wrong answer never carries it.
// "Show answer" is left out: a wrong answer on a locked spot has no reveal, and adding one would break the lock.
//
// Props:
//   res: CheckResponse, marks: Mark[] (marks at submit time), spot: string
//   tutorial?: boolean       training round: no stage numbers or next-stage link
//   index?: FieldSummary[]   injectable stage index (default: loaded from public/fields/index.json)
//   onClose(): void          Escape, Try again, Replay, Continue (back to the field)

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { loadFieldIndex } from "@/lib/fields";
import { stageInfo } from "@/lib/stageOrder";
import type { PatchCheckResponse } from "@/lib/patchSolves";
import type { CheckResponse, FieldSummary, Mark, VerdictKind } from "@/lib/types";
import styles from "./ResultSheet.module.css";

const CORRECT_KINDS: VerdictKind[] = ["known", "bot_match", "nothing_correct"];

const WRONG_HINT: Record<string, string> = {
  candidate: "Nothing we know of sits where those marks lead. Check each frame and try again.",
  static: "Those marks barely move. Look for the dot that shifts between frames.",
  nothing_wrong: "Something does move in this field. Look again.",
};

export interface ResultSheetProps {
  res: CheckResponse;
  marks: Mark[];
  spot: string;
  tutorial?: boolean;
  index?: FieldSummary[];
  onClose(): void;
}

type Crowd = NonNullable<PatchCheckResponse["crowd"]>;

/** Plain-language crowd line for a possible new mover on a picked patch. */
export function crowdText(c: Crowd): string[] {
  if (c.first) return ["You’re the first to report a mover in this patch. Your track is saved — when other players report here, they’ll be compared with it."];
  const who = c.others === 1 ? "1 other player" : `${c.others} other players`;
  if (c.agree > 0) {
    return [
      `${c.agree} of ${who} marked the same track as you (${Math.round((100 * c.agree) / c.others)}%).`,
      "There is no official answer for this patch, so agreement is the best signal.",
    ];
  }
  return [`${who} reported here, but none marked the same track. You may have spotted something different.`];
}

function shiftPixels(marks: Mark[]): number | null {
  if (marks.length < 2) return null;
  const m = [...marks].sort((a, b) => a.tDays - b.tDays);
  return Math.hypot(m[m.length - 1].x - m[0].x, m[m.length - 1].y - m[0].y);
}

export default function ResultSheet({ res, marks, spot, tutorial, index, onClose }: ResultSheetProps) {
  const { verdict: v, track, reveal } = res;
  const crowd = v.kind === "candidate" ? (res as Partial<PatchCheckResponse>).crowd : undefined;
  const correct = CORRECT_KINDS.includes(v.kind);
  const nothing = v.kind === "nothing_correct";
  const [list, setList] = useState<FieldSummary[] | null>(index ?? null);
  const primary = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (index || tutorial) return;
    let live = true;
    loadFieldIndex()
      .then((l) => live && setList(l))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [index, tutorial]);

  useEffect(() => {
    primary.current?.focus();
  }, [list]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const info = !tutorial && list ? stageInfo(list, spot) : null;
  const nextHref = info?.next ? `/play?spot=${encodeURIComponent(info.next)}` : "/stages";
  const last = !info?.next;
  const px = shiftPixels(marks);
  const sentence = crowd
    ? "No known object sits where your marks lead, so this could be something new. It is unconfirmed and scores no points."
    : correct
    ? nothing
      ? "Nothing moves in this field, and you saw that."
      : px !== null
        ? `It moved ${px < 10 ? px.toFixed(1) : Math.round(px)} pixels between frames: a real object crossing the field.`
        : "You followed a real object crossing the field."
    : (WRONG_HINT[v.kind] ?? "That is not it. Look again.");

  const secondary = (cls: string, label: string) => (
    <button type="button" className={cls} onClick={onClose}>
      {label}
    </button>
  );

  const body = (
    <section
      className={styles.sheet}
      role="dialog"
      aria-modal="false"
      aria-labelledby="result-sheet-title"
      data-kind={v.kind}
      data-correct={correct ? "true" : "false"}
      data-testid="verdict"
    >
      <div className={styles.bar} aria-hidden="true" />
      <div className={styles.inner}>
        <div className={styles.head}>
          <h2 id="result-sheet-title" className={styles.title}>
            {crowd ? "◆ POSSIBLE NEW MOVER" : correct ? (nothing ? "★ CORRECT" : "★ FOUND IT!") : "✗ NOT QUITE"}
          </h2>
          {correct && (
            <span className={styles.points}>
              +{v.points} pts{res.practice ? " (practice)" : res.already_found ? " (already found)" : ""}
            </span>
          )}
          {info && (
            <span className={styles.stage}>
              Stage {info.n}/{info.total}
            </span>
          )}
        </div>
        <p className={styles.sentence}>{sentence}</p>
        {crowd && (
          <div role="status" data-testid="crowd">
            {crowdText(crowd).map((t) => (
              <p key={t} className={styles.sentence}>
                {t}
              </p>
            ))}
          </div>
        )}
        {correct && (
          <details className={styles.details}>
            <summary>Details ⓘ</summary>
            <ul>
              {res.unlocked && v.object_name && <li>Object: {v.object_name}</li>}
              {track && (
                <li>
                  Rate {track.rate_arcsec_per_hour.toFixed(2)}″/h ({Math.hypot(track.vx, track.vy).toFixed(2)} px/day), fit rms{" "}
                  {track.rms.toFixed(2)} px
                </li>
              )}
              {reveal && (
                <li>
                  Answer key: frame {reveal.frame} at x {reveal.x.toFixed(1)}, y {reveal.y.toFixed(1)}
                </li>
              )}
              {v.kind === "bot_match" && res.noise_bar_sigma !== null && <li>Noise bar {res.noise_bar_sigma.toFixed(1)}σ</li>}
              {res.first_finder && <li>First finder</li>}
              {!tutorial && (
                <li>
                  <Link href="/map">Sky map</Link>
                </li>
              )}
            </ul>
          </details>
        )}
        <div className={styles.actions}>
          {correct ? (
            <>
              {secondary(styles.ghost, "Replay")}
              {tutorial ? (
                <button type="button" className={styles.cta} ref={(el) => void (primary.current = el)} onClick={onClose}>
                  CONTINUE ▶
                </button>
              ) : (
                <Link href={nextHref} className={styles.cta} ref={(el) => void (primary.current = el)}>
                  {last ? "ALL STAGES ▶" : "NEXT STAGE ▶"}
                </Link>
              )}
            </>
          ) : (
            <>
              {!tutorial && (
                <Link href={nextHref} className={styles.ghost}>
                  {last ? "All stages" : "Skip stage"}
                </Link>
              )}
              <button type="button" className={styles.cta} ref={(el) => void (primary.current = el)} onClick={onClose}>
                Try again ▶
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
  return typeof document === "undefined" ? null : createPortal(body, document.body);
}
