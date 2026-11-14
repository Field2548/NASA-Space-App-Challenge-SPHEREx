"use client";
// /play field mode (BP 8.1 at 1440 x 900): top bar, left tool panel, centre viewport, right
// scoreboard panel, bottom timeline. Loads a spot from field.json + frames.u16; a missing or
// broken spot shows an ASCII empty state. Empty, named slots (data-slot="...") are left for
// the parts other batches build: Submit, "Nothing moved here", scoreboard, auth, sky map, etc.
//
// Props: { spot?: string }

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PROJECT_NAME } from "@/lib/brand";
import { loadField, loadFrames } from "@/lib/fields";
import type { Field, Mark } from "@/lib/types";
import { useBlink } from "@/lib/useBlink";
import BrightnessSlider from "./BrightnessSlider";
import FieldViewer, { fitScale, type ViewerMode, type ViewerOverlay } from "./FieldViewer";
import styles from "./PlayScreen.module.css";
import Timeline from "./Timeline";

type Loaded = { spot: string; field: Field; frames: Float32Array[] } | { spot: string; error: string };

export interface PlayScreenProps {
  spot?: string;
  loading?: boolean; // Suspense fallback while ?spot= is read
}

export const MAX_SCALE = 32;

/** One mark per frame: a new click in a frame replaces that frame's mark. */
export function upsertMark(marks: Mark[], m: Mark): Mark[] {
  return [...marks.filter((x) => x.frame !== m.frame), m].sort((a, b) => a.frame - b.frame);
}

export default function PlayScreen({ spot, loading = false }: PlayScreenProps) {
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
        <EmptyState title="LOADING" text={`Loading spot “${spot}”…`} />
      ) : "error" in current ? (
        <EmptyState title="NO SIGNAL" text={`Could not load spot “${spot}”. ${current.error}`} />
      ) : (
        <Game key={spot} field={current.field} frames={current.frames} />
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
      <h2 className="sr-only">{title}</h2>
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

function Game({ field, frames }: { field: Field; frames: Float32Array[] }) {
  const [W, H] = field.size;
  const [marks, setMarks] = useState<Mark[]>([]);
  const [mode, setMode] = useState<ViewerMode>("mark");
  const [overlay, setOverlay] = useState<ViewerOverlay>("none");
  const [black, setBlack] = useState(field.stretch.black_sigma);
  const fit = useMemo(() => fitScale(W, H, 900, 560), [W, H]);
  const [scale, setScale] = useState(fit);
  const [inspected, setInspected] = useState<[number, number] | null>(null);
  const [scoreOpen, setScoreOpen] = useState(true);
  const blink = useBlink(frames.length);
  const { pause } = blink;

  const toggleInspect = useCallback(() => setMode((m) => (m === "inspect" ? "mark" : "inspect")), []);

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
          <button type="button" aria-pressed={mode === "inspect"} onClick={toggleInspect} className={styles.wide}>
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
            onClick={() => setOverlay((o) => (o === "colorByTime" ? "none" : "colorByTime"))}
            title="Still things turn white. Moving things leave colored dots."
            className={styles.wide}
          >
            Color by time
          </button>
          <Slot name="image-tools" label="more tools" />
        </section>
        <section className="panel" data-part="PNL-03 // WAVELENGTH">
          <Slot name="wavelength" label="wavelength switch" />
        </section>
        <section className="panel" data-part="PNL-04 // OVERLAYS">
          <Slot name="overlays" label="overlay toggles" />
        </section>
        <section className="panel" data-part="PNL-05 // COLOR VISION">
          <Slot name="color-vision" label="vision picker" />
        </section>
        <section className="panel" data-part="PNL-06 // BRIGHTNESS">
          <BrightnessSlider value={black} onChange={setBlack} defaultValue={field.stretch.black_sigma} png8={png8} />
        </section>
        <footer className={styles.footer}>
          <Link href="/status" className={styles.statusLight} data-slot="status-light">
            <span aria-hidden="true" />
            Status
          </Link>
          <Link href="/credits">Credits</Link>
        </footer>
      </aside>

      <main className={styles.center}>
        <div className={styles.viewportTop}>
          <Slot name="coordinate-box" label="coordinate box" />
          <h1 className={styles.title}>{field.title}</h1>
          <Slot name="show-work" label="show my / others' work" />
        </div>
        <div className={styles.viewer}>
          <FieldViewer
            field={field}
            frames={frames}
            frameIndex={blink.index}
            marks={marks}
            onMark={(m) => setMarks((ms) => upsertMark(ms, m))}
            mode={mode}
            onInspect={(x, y) => setInspected([x, y])}
            overlay={overlay}
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
              <Slot name="submit" label="Submit" />
              <Slot name="nothing-moved" label="Nothing moved here" />
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

      <footer className={styles.bottom}>
        <Timeline
          field={field}
          frames={frames}
          index={blink.index}
          onIndexChange={blink.setIndex}
          marks={marks}
          brightness={black}
          playing={blink.playing}
          onTogglePlay={blink.toggle}
          reducedMotion={blink.reducedMotion}
        />
      </footer>
    </div>
  );
}
