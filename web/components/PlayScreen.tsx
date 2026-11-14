"use client";
// /play field mode (BP 8.1 at 1440 x 900): top bar, left tool panel, centre viewport, right
// scoreboard panel, bottom timeline. Loads a spot from field.json + frames.u16; a missing or
// broken spot shows an ASCII empty state. Empty, named slots (data-slot="...") are left for
// the parts other batches build: Submit, "Nothing moved here", scoreboard, auth, sky map, etc.
//
// Keyboard marking: focus the viewer, arrows move a crosshair (Shift = 10 px), Enter marks
// (or inspects in Inspect mode). Tutorial hooks: data-tutorial-target on the parts a coach mark
// points at, and onEvent(name) from the handlers (never from state effects).
//
// Round mode (default): the heading is the sky position, never the title or slug, until a
// verdict arrives; Tutorial passes showTitle.
//
// Props: { spot?: string; loading?: boolean; onEvent?; markFrames?; markHint?; fetcher?; showTitle? }

import Link from "next/link";
import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useId, useMemo, useState } from "react";
import { PROJECT_NAME } from "@/lib/brand";
import { formatDec, formatRA } from "@/lib/coords";
import { loadField, loadFrames } from "@/lib/fields";
import type { CheckResponse, Field, Mark } from "@/lib/types";
import { type BlinkMode, useBlink } from "@/lib/useBlink";
import BrightnessSlider from "./BrightnessSlider";
import FieldViewer, { fitScale, type ViewerMode, type ViewerOverlay } from "./FieldViewer";
import styles from "./PlayScreen.module.css";
import SubmitBar from "./SubmitBar";
import Timeline, { clampOnion, ONION_MAX, onionRangeFrames } from "./Timeline";

type Loaded = { spot: string; field: Field; frames: Float32Array[] } | { spot: string; error: string };

/** Events the tutorial listens for (TutorialStep.doneWhen). */
export type PlayEvent =
  | "play-pressed"
  | "frame-changed"
  | "mark-placed"
  | "inspect-opened"
  | "overlay-toggled"
  | "color-by-time-toggled"
  | "submitted";
export interface PlayEventDetail {
  markedFrames: number; // distinct frames with a mark, after the event
}

export interface PlayScreenProps {
  spot?: string;
  loading?: boolean; // Suspense fallback while ?spot= is read
  onEvent?(name: PlayEvent, detail: PlayEventDetail): void;
  /** Only these FrameMeta.i values accept a mark; others show markHint instead. */
  markFrames?: number[];
  markHint?: string;
  fetcher?: typeof fetch; // for /api/check (tests)
  /** Show field.title from the start (tutorial). Default: a round, so the heading is the sky
   * position until a verdict arrives, then the real title. */
  showTitle?: boolean;
}

/** Heading that does not give the answer away: the field's sky position. */
export function neutralTitle(field: Pick<Field, "ra" | "dec">): string {
  return `Field at RA ${formatRA(field.ra)} Dec ${formatDec(field.dec)}`;
}

type GameProps = Omit<PlayScreenProps, "spot" | "loading"> & { spot: string; field: Field; frames: Float32Array[] };

export const MAX_SCALE = 32;

/** One mark per frame: a new click in a frame replaces that frame's mark. */
export function upsertMark(marks: Mark[], m: Mark): Mark[] {
  return [...marks.filter((x) => x.frame !== m.frame), m].sort((a, b) => a.frame - b.frame);
}

export default function PlayScreen({ spot, loading = false, ...hooks }: PlayScreenProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!spot) return;
    let alive = true;
    loadField(spot)
      .then(async (field) => ({ spot, field, frames: await loadFrames(field) }))
      .then(
        (ok) => alive && setLoaded(ok),
        (e: unknown) => alive && setLoaded({ spot, error: e instanceof Error ? e.message : String(e) }),
      );
    return () => {
      alive = false;
    };
  }, [spot]);

  const current = loaded && loaded.spot === spot ? loaded : null;

  return (
    <div className={styles.screen}>
      <header className={styles.top}>
        <Link href="/" className={styles.logo}>
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
            <circle cx="11" cy="11" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="11" cy="11" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M11 0v5M11 17v5M0 11h5M17 11h5" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <span>{PROJECT_NAME}</span>
        </Link>
        <div data-slot="auth" className={styles.auth}>
          <button type="button" disabled title="Coming soon">
            Log in / Sign up
          </button>
        </div>
      </header>
      {loading ? (
        <EmptyState title="LOADING" text="Reading the spot from the address…" />
      ) : !spot ? (
        <EmptyState title="NO SPOT SELECTED" text="Pick a spot from the sky map, or open /play?spot=fixture." />
      ) : !current ? (
        <EmptyState title="LOADING" text="Loading the spot…" />
      ) : "error" in current ? (
        <EmptyState title="NO SIGNAL" text={`Could not load spot. ${current.error.split(spot).join("this spot")}`} />
      ) : (
        <Game key={spot} spot={spot} field={current.field} frames={current.frames} {...hooks} />
      )}
    </div>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  const bar = "-".repeat(title.length + 6);
  return (
    <main className={styles.empty} role="status">
      <pre aria-hidden="true">{`   .        *          .
      +${bar}+
  *   |  [ ${title} ]  |   .
      +${bar}+
 .          .      *`}</pre>
      <h1 className="sr-only">{title}</h1>
      <p>{text}</p>
      <p>
        <Link href="/">Back to the start</Link>
      </p>
    </main>
  );
}

function Slot({ name, label }: { name: string; label: string }) {
  return (
    <div className={styles.slot} data-slot={name}>
      {label}
    </div>
  );
}

/** Crosshair step for an arrow key, or null for other keys. */
export function arrowStep(key: string, big: boolean): [number, number] | null {
  const d = big ? 10 : 1;
  if (key === "ArrowLeft") return [-d, 0];
  if (key === "ArrowRight") return [d, 0];
  if (key === "ArrowUp") return [0, -d];
  if (key === "ArrowDown") return [0, d];
  return null;
}

const distinctFrames = (ms: Mark[]) => new Set(ms.map((m) => m.frame)).size;

function Game({ spot, field, frames, onEvent, markFrames, markHint, fetcher, showTitle = false }: GameProps) {
  const [W, H] = field.size;
  const [marks, setMarks] = useState<Mark[]>([]);
  const [mode, setMode] = useState<ViewerMode>("mark");
  const [overlay, setOverlay] = useState<ViewerOverlay>("none");
  const [knownOverlay, setKnownOverlay] = useState(false);
  const [black, setBlack] = useState(field.stretch.black_sigma);
  const fit = useMemo(() => fitScale(W, H, 900, 560), [W, H]);
  const [scale, setScale] = useState(fit);
  const [inspected, setInspected] = useState<[number, number] | null>(null);
  const [scoreOpen, setScoreOpen] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const [pointer, setPointer] = useState(false); // last input was a pointer: hide the crosshair
  const statusId = useId();
  const [loopMode, setLoopMode] = useState<BlinkMode>("loop");
  const [onionRange, setOnionRange] = useState<[number, number]>(() => clampOnion([0, ONION_MAX - 1], frames.length));
  const [realSpacing, setRealSpacing] = useState(false);
  const [verdictIn, setVerdictIn] = useState(false);
  const blink = useBlink(frames.length, { mode: loopMode });
  const { pause } = blink;

  const emit = useCallback(
    (name: PlayEvent, ms: Mark[]) => onEvent?.(name, { markedFrames: distinctFrames(ms) }),
    [onEvent],
  );

  const toggleInspect = useCallback(() => {
    const on = mode !== "inspect";
    setMode(on ? "inspect" : "mark");
    if (on) emit("inspect-opened", marks);
  }, [mode, marks, emit]);

  /** The one mark path shared by click and keyboard. */
  const placeMark = (m: Mark) => {
    if (markFrames && !markFrames.includes(m.frame)) {
      setNotice(markHint ?? "This frame does not take marks here.");
      return;
    }
    setNotice(null);
    const next = upsertMark(marks, m);
    setMarks(next);
    emit("mark-placed", next);
  };

  const k = Math.min(Math.max(0, blink.index), Math.max(0, frames.length - 1));
  const meta = field.frames[k];
  const markAt = (x: number, y: number) => {
    if (!meta) return;
    if (mode === "inspect") setInspected([x, y]);
    else placeMark({ frame: meta.i, x, y, tDays: meta.mjd - field.frames[0].mjd });
  };

  const onViewerKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const step = arrowStep(e.key, e.shiftKey);
    if (step || e.key === "Enter") setPointer(false);
    if (step) {
      e.preventDefault();
      setCursor((c) => {
        const [x, y] = c ?? [Math.floor(W / 2), Math.floor(H / 2)];
        return [Math.min(W - 1, Math.max(0, x + step[0])), Math.min(H - 1, Math.max(0, y + step[1]))];
      });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const [x, y] = cursor ?? [Math.floor(W / 2), Math.floor(H / 2)];
      if (!cursor) setCursor([x, y]);
      markAt(x, y);
    }
  };

  const onResult = (res: CheckResponse) => {
    setVerdictIn(true);
    emit("submitted", marks);
    if (res.reveal) {
      setInspected([Math.round(res.reveal.x), Math.round(res.reveal.y)]);
      if (mode !== "inspect") {
        setMode("inspect");
        emit("inspect-opened", marks);
      }
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "i" || e.key === "I") toggleInspect();
      else if (e.key === "Escape") pause();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleInspect, pause]);

  const png8 = field.data.precision === "png8";

  return (
    <div className={`${styles.body} ${scoreOpen ? "" : styles.scoreClosed}`}>
      <aside className={styles.left}>
        <section className="panel" data-part="PNL-01 // INSPECT">
          <button
            type="button"
            aria-pressed={mode === "inspect"}
            onClick={toggleInspect}
            className={styles.wide}
            data-tutorial-target="inspect-toggle"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.5" />
            </svg>{" "}
            Inspect {mode === "inspect" ? "on" : "off"} <kbd>I</kbd>
          </button>
        </section>
        <section className="panel" data-part="PNL-02 // IMAGE TOOLS">
          <button
            type="button"
            aria-pressed={overlay === "colorByTime"}
            onClick={() => {
              setOverlay((o) => (o === "colorByTime" ? "none" : "colorByTime"));
              emit("color-by-time-toggled", marks);
            }}
            title="Still things turn white. Moving things leave colored dots."
            className={styles.wide}
            data-tutorial-target="color-by-time"
          >
            Color by time
          </button>
          <Slot name="image-tools" label="more tools" />
        </section>
        <section className="panel" data-part="PNL-03 // WAVELENGTH">
          <Slot name="wavelength" label="wavelength switch" />
        </section>
        <section className="panel" data-part="PNL-04 // OVERLAYS">
          <div className={styles.slot} data-slot="overlays">
            {/* Placeholder until DATA ships the overlays: the toggle works, nothing is drawn yet. */}
            <button
              type="button"
              aria-pressed={knownOverlay}
              onClick={() => {
                setKnownOverlay((v) => !v);
                emit("overlay-toggled", marks);
              }}
              className={styles.wide}
              data-tutorial-target="overlay-known-asteroids"
              title="Preview: JPL's predicted spots (diamonds) arrive in a later build."
            >
              Known asteroids
            </button>
            {knownOverlay && <span className={styles.small}>Preview: the diamonds are not drawn yet.</span>}
          </div>
        </section>
        <section className="panel" data-part="PNL-05 // COLOR VISION">
          <Slot name="color-vision" label="vision picker" />
        </section>
        <section className="panel" data-part="PNL-06 // BRIGHTNESS">
          <BrightnessSlider value={black} onChange={setBlack} defaultValue={field.stretch.black_sigma} png8={png8} minBlack={field.stretch.black_sigma} />
        </section>
        <footer className={styles.footer}>
          {/* /status is not built yet: no prefetch, so no 404 in the console. */}
          <Link href="/status" prefetch={false} className={styles.statusLight} data-slot="status-light">
            <span aria-hidden="true" />
            Status
          </Link>
          <Link href="/credits">Credits</Link>
        </footer>
      </aside>

      <main className={styles.center}>
        <div className={styles.viewportTop}>
          <Slot name="coordinate-box" label="coordinate box" />
          <h1 className={styles.title} data-testid="field-title">
            {showTitle || verdictIn ? field.title : neutralTitle(field)}
          </h1>
          <Slot name="show-work" label="show my / others' work" />
        </div>
        <div className={styles.viewer}>
          <div
            className={styles.kbd}
            tabIndex={0}
            role="group"
            aria-label="Field viewer. Arrow keys move the crosshair, Shift moves 10 pixels, Enter marks."
            aria-describedby={statusId}
            data-tutorial-target="frame-viewer mark-tool"
            onKeyDown={onViewerKey}
            data-pointer={pointer}
            onPointerDown={() => setPointer(true)}
            onFocus={(e) => {
              if (e.target === e.currentTarget && !cursor) setCursor([Math.floor(W / 2), Math.floor(H / 2)]);
            }}
          >
            <FieldViewer
              field={field}
              frames={frames}
              frameIndex={blink.index}
              marks={marks}
              onMark={placeMark}
              mode={mode}
              onInspect={(x, y) => setInspected([x, y])}
              overlay={overlay}
              overlayFrames={onionRangeFrames(onionRange)}
              crosshair={pointer ? null : cursor}
              brightness={black}
              scale={scale}
              inspectSlot={
                mode === "inspect" && inspected ? (
                  <div className={styles.slot} data-slot="inspect-popup">
                    INSPECT x {inspected[0]} y {inspected[1]}
                  </div>
                ) : null
              }
            />
          </div>
          <p id={statusId} className={styles.kbdStatus} aria-live="polite">
            {notice ? <span className={styles.notice}>{notice}</span> : null}
            {cursor ? ` Crosshair x ${cursor[0]} y ${cursor[1]}.` : ""}
          </p>
          <div className={styles.zoom} role="group" aria-label="Zoom">
            <button type="button" aria-label="Zoom in" onClick={() => setScale((s) => Math.min(MAX_SCALE, s + 1))} disabled={scale >= MAX_SCALE}>
              +
            </button>
            <button type="button" aria-label="Zoom out" onClick={() => setScale((s) => Math.max(1, s - 1))} disabled={scale <= 1}>
              −
            </button>
            <span>{scale}×</span>
          </div>
        </div>
      </main>

      <aside className={styles.right} aria-label="Scoreboard panel">
        <button type="button" className={styles.collapse} aria-expanded={scoreOpen} onClick={() => setScoreOpen((o) => !o)}>
          {scoreOpen ? "click to minimize" : "▸"}
        </button>
        {scoreOpen && (
          <>
            <section className="panel" data-part="PNL-07 // ANSWER">
              <p className={styles.small}>
                {marks.length} mark{marks.length === 1 ? "" : "s"} in {frames.length} frames. Mark the mover in at least 2 frames.
              </p>
              {markHint && <p className={styles.small}>{markHint}</p>}
              <SubmitBar spot={spot} marks={marks} fetcher={fetcher} onResult={onResult} />
              <button type="button" onClick={() => setMarks([])} disabled={marks.length === 0} className={styles.wide}>
                Clear marks
              </button>
            </section>
            <section className="panel" data-part="PNL-08 // SCOREBOARD">
              <Slot name="scoreboard" label="scoreboard" />
            </section>
          </>
        )}
      </aside>

      <footer className={styles.bottom} data-tutorial-target="timeline">
        <Timeline
          field={field}
          frames={frames}
          index={blink.index}
          onIndexChange={(i) => {
            blink.setIndex(i);
            emit("frame-changed", marks);
            // Play is off under reduced motion: stepping frames is the way to watch them change.
            if (blink.reducedMotion) emit("play-pressed", marks);
          }}
          marks={marks}
          brightness={black}
          playing={blink.playing}
          onTogglePlay={() => {
            blink.toggle();
            emit("play-pressed", marks);
          }}
          reducedMotion={blink.reducedMotion}
          loopMode={loopMode}
          onLoopModeChange={setLoopMode}
          onionRange={onionRange}
          onOnionRangeChange={setOnionRange}
          realSpacing={realSpacing}
          onRealSpacingChange={setRealSpacing}
        />
      </footer>
    </div>
  );
}
