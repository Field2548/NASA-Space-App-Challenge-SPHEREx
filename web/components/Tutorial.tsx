"use client";
// /tutorial (BP 8.13): levels 0 and 1 from lib/copy/tutorial.ts on the real Eros spot. A coach
// mark points at each step's target; a step finishes when PlayScreen emits its doneWhen event.
// Progress is saved in guest storage; Back and Skip work from the keyboard (the coach mark comes
// first in tab order). Eros leaves the picture after frame 3, so marks are limited to frames 1-3.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { TUTORIAL, type TutorialLevel } from "@/lib/copy/tutorial";
import { GUEST_KEY, type GuestData, loadGuest, saveGuest } from "@/lib/guest";
import { usePrefersReducedMotion } from "@/lib/useBlink";
import CoachMark from "./CoachMark";
import PlayScreen, { type PlayEvent, type PlayEventDetail } from "./PlayScreen";
import styles from "./Tutorial.module.css";

export const EROS_FRAMES = [1, 2, 3];
export const EROS_HINT = "Eros leaves the picture after frame 3, so mark it in frames 1, 2 or 3.";
export const REDUCED_MOTION_NOTE = "Auto-play is off on this device: step to the next frame instead.";

/** Position in the tutorial. step === steps.length means the level is complete. */
export interface TutorialPos {
  level: number; // index into levels
  step: number;
}

/** Resume at the first level not done; trust the saved step only when it is for that level. */
export function resumePos(t: GuestData["tutorial"], levels: TutorialLevel[] = TUTORIAL): TutorialPos {
  const idx = levels.findIndex((l) => !t.done.includes(l.id));
  if (idx < 0) return { level: levels.length - 1, step: levels[levels.length - 1].steps.length };
  const saved = levels[idx].id === t.level ? t.step : 0;
  return { level: idx, step: Math.min(Math.max(0, saved), levels[idx].steps.length - 1) };
}

/** Next position after an event, or null when the event does not finish the current step. */
export function nextPos(pos: TutorialPos, event: string, detail: PlayEventDetail, levels: TutorialLevel[] = TUTORIAL): TutorialPos | null {
  const steps = levels[pos.level]?.steps ?? [];
  const step = steps[pos.step];
  if (!step || step.doneWhen !== event) return null;
  if (event === "mark-placed") {
    // The n-th mark step of a level needs marks in n distinct frames (a same-frame click replaces).
    const n = steps.slice(0, pos.step + 1).filter((s) => s.doneWhen === "mark-placed").length;
    if (detail.markedFrames < n) return null;
  }
  return { level: pos.level, step: pos.step + 1 };
}

export function backPos(pos: TutorialPos, levels: TutorialLevel[] = TUTORIAL): TutorialPos {
  if (pos.step > 0) return { level: pos.level, step: pos.step - 1 };
  if (pos.level > 0) return { level: pos.level - 1, step: levels[pos.level - 1].steps.length - 1 };
  return pos;
}

// Guest storage is read on the client only (server snapshot null), so the first client render
// matches the server HTML and the coach mark appears after hydration.
const subscribeNone = () => () => {};
const storedGuest = () => {
  try {
    return window.localStorage.getItem(GUEST_KEY) ?? "";
  } catch {
    return "";
  }
};

export interface TutorialProps {
  levels?: TutorialLevel[];
  fetcher?: typeof fetch;
}

export default function Tutorial({ levels = TUTORIAL, fetcher }: TutorialProps) {
  const stored = useSyncExternalStore(subscribeNone, storedGuest, () => null);
  const [override, setOverride] = useState<TutorialPos | null>(null);
  // Resume point from storage on first client render; after that, the player's moves win.
  const onClient = stored !== null;
  const resumed = useMemo(() => (onClient ? resumePos(loadGuest().tutorial, levels) : null), [onClient, levels]);
  const pos = override ?? resumed;
  const posRef = useRef<TutorialPos | null>(null);
  useEffect(() => {
    posRef.current = pos;
  }, [pos]);
  const reducedMotion = usePrefersReducedMotion();

  const go = useCallback(
    (next: TutorialPos, finishedLevel?: number) => {
      posRef.current = next;
      setOverride(next);
      const cur = loadGuest().tutorial;
      const done = finishedLevel !== undefined && !cur.done.includes(finishedLevel) ? [...cur.done, finishedLevel] : cur.done;
      saveGuest({ tutorial: { level: levels[next.level].id, step: next.step, done } });
    },
    [levels],
  );

  /** Move to `next`, marking the level done when its last step finishes. */
  const advance = useCallback(
    (next: TutorialPos) => {
      const len = levels[next.level].steps.length;
      go(next, next.step >= len ? levels[next.level].id : undefined);
    },
    [go, levels],
  );

  const onEvent = useCallback(
    (name: PlayEvent | "intro-seen", detail: PlayEventDetail) => {
      const p = posRef.current;
      if (!p) return;
      const next = nextPos(p, name, detail, levels);
      if (next) advance(next);
    },
    [advance, levels],
  );

  const level = pos ? levels[pos.level] : levels[0];
  const step = pos ? level.steps[pos.step] : undefined;
  const complete = pos !== null && step === undefined;
  const lastLevel = pos !== null && pos.level === levels.length - 1;
  const progress = `LEVEL ${level.id} // ${level.title.toUpperCase()}${step && pos ? ` // STEP ${pos.step + 1} OF ${level.steps.length}` : ""}`;

  let text = step?.text ?? "";
  if (step?.doneWhen === "play-pressed" && reducedMotion) text = `${text} ${REDUCED_MOTION_NOTE}`;
  if (step?.doneWhen === "mark-placed") text = `${text} ${EROS_HINT}`;
  if (step?.doneWhen === "overlay-toggled") text = `${text} (Preview: the toggle works; the diamonds arrive in a later build.)`;

  return (
    <div className={styles.root}>
      {pos && (
        <CoachMark
          target={step?.target}
          heading={complete ? `Level ${level.id} complete` : level.title}
          text={complete ? (lastLevel ? "Training done. You found a real asteroid in real SPHEREx data." : `Next: level ${levels[pos.level + 1].id}, ${levels[pos.level + 1].title}.`) : text}
          progress={progress}
        >
          {step?.doneWhen === "intro-seen" && (
            <button type="button" onClick={() => onEvent("intro-seen", { markedFrames: 0 })}>
              Next
            </button>
          )}
          {complete && !lastLevel && (
            <button type="button" onClick={() => go({ level: pos.level + 1, step: 0 })}>
              Start level {levels[pos.level + 1].id}
            </button>
          )}
          {complete && lastLevel && (
            <Link href="/play?spot=eros" className={styles.link}>
              Play freely
            </Link>
          )}
          <button type="button" onClick={() => go(backPos(pos, levels))} disabled={pos.level === 0 && pos.step === 0}>
            Back
          </button>
          {!complete && (
            <button type="button" onClick={() => advance({ level: pos.level, step: pos.step + 1 })}>
              Skip step
            </button>
          )}
          <Link href="/" className={styles.link}>
            Leave
          </Link>
        </CoachMark>
      )}
      <PlayScreen spot={level.spot} onEvent={onEvent} markFrames={level.spot === "eros" ? EROS_FRAMES : undefined} markHint={level.spot === "eros" ? EROS_HINT : undefined} fetcher={fetcher} showTitle />
    </div>
  );
}
