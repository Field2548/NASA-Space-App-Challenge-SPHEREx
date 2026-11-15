"use client";
// /play field mode (BP 8.1 at 1440 x 900): top bar, left tool panel, centre viewport, right
// scoreboard panel, bottom timeline. Loads a spot from field.json + frames.u16; a missing or
// broken spot shows an ASCII empty state. Players never see placeholders: parts not built yet
// (coordinate box, show-work) render nothing until a real component exists. The right panel holds
// SERVER's Scoreboard (refreshKey bumps on every verdict); "Log in / Sign up" opens AuthDialog.
//
// Keyboard marking: focus the viewer, arrows move a crosshair (Shift = 10 px), Enter marks
// (or inspects in Inspect mode). Tutorial hooks: data-tutorial-target on the parts a coach mark
// points at, and onEvent(name) from the handlers (never from state effects).
//
// Round mode (default): the heading is the sky position, never the title or slug, until a
// verdict arrives; Tutorial passes showTitle.
//
// Inspect on /play opens SERVER's InspectPopup in "round" mode; /api/info keeps names locked
// until an unlocked verdict. The tutorial (showTitle) keeps InspectPanel, which names the object
// from the tutorial's own copy (InspectPopup has no name prop).
//
// Tools: `tools` lists the parts shown (ALL_TOOLS on /play). The tutorial passes a growing set
// so parts unlock one by one; a hidden tool also ignores its keyboard shortcut. "Known
// asteroids" (BP 8.18) is locked during a round (spoiler rule) and opens after an unlocked
// verdict; the tutorial (showTitle) is never a round. Opening it fetches /api/overlay (explore)
// once; the tutorial passes `knownLocal` (Eros) and fetches nothing.
//
// Props: { spot?: string; loading?: boolean; onEvent?; markFrames?; markHint?; fetcher?; showTitle?; tools?; initialView?; onViewChange?; knownLocal? }

import Link from "next/link";
import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { PROJECT_NAME } from "@/lib/brand";
import { formatDec, formatRA } from "@/lib/coords";
import { loadField, loadFieldIndex, loadFrames } from "@/lib/fields";
import type { CheckResponse, Field, Mark, Vision } from "@/lib/types";
import { type BlinkMode, useBlink } from "@/lib/useBlink";
import BrightnessSlider from "./BrightnessSlider";
import FieldViewer, { fitScale, type ViewerMode, type ViewerOverlay } from "./FieldViewer";
import InspectPanel from "./InspectPanel";
import { InspectPopup } from "./InspectPopup";
import LoginButton from "./LoginButton";
import styles from "./PlayScreen.module.css";
import { Scoreboard } from "./Scoreboard";
import SubmitBar from "./SubmitBar";
import Timeline, { clampOnion, ONION_MAX, onionRangeFrames } from "./Timeline";
import VisionPicker from "./VisionPicker";
import { fetchOverlay, type KnownOverlay, OVERLAY_UNAVAILABLE } from "./overlay";
import { type ViewState } from "./viewState";
import WavelengthSwitch, { useWavelengthFrames, type WavelengthSelection } from "./WavelengthSwitch";

type Loaded = { spot: string; field: Field; frames: Float32Array[] } | { spot: string; error: string };

/** Events the tutorial listens for (TutorialStep.doneWhen). */
export type PlayEvent =
  | "play-pressed"
  | "frame-changed"
  | "mark-placed"
  | "inspect-opened"
  | "inspect-closed"
  | "overlay-toggled"
  | "color-by-time-toggled"
  | "submitted";
export interface PlayEventDetail {
  markedFrames: number; // distinct frames with a mark, after the event
  inspectOn?: boolean; // Inspect mode after the event; set on inspect-opened / inspect-closed
  unlocked?: boolean; // set on submitted: the verdict was correct and the spot unlocked
}

/** Parts of the screen a caller can show or hide (PlayScreenProps.tools). */
export type PlayTool =
  | "mark" // marking, the answer panel and the scoreboard
  | "inspect"
  | "color-by-time" // the button and its onion range on the timeline
  | "overlays"
  | "brightness"
  | "frames-spacing" // loop order and real spacing on the timeline
  | "wavelength"
  | "color-vision"
  | "coordinates" // coordinate box
  | "show-work";

export const ALL_TOOLS: ReadonlySet<PlayTool> = new Set<PlayTool>([
  "mark",
  "inspect",
  "color-by-time",
  "overlays",
  "brightness",
  "frames-spacing",
  "wavelength",
  "color-vision",
  "coordinates",
  "show-work",
]);

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
  /** Known object name for the tutorial heading and Inspect (the public field title is neutral). */
  objectName?: string;
  /** Parts shown; the viewer, Play and Next frame are always there. Default: ALL_TOOLS. */
  tools?: ReadonlySet<PlayTool>;
  /** Initial vision, onion range and spacing (from the URL on /play). */
  initialView?: ViewState;
  /** Called when vision, onion range or spacing change (/play writes them back to the URL). */
  onViewChange?(v: ViewState): void;
  /** Known objects drawn locally instead of fetched (the tutorial's Eros). */
  knownLocal?: KnownOverlay;
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
          <LoginButton label="Log in / Sign up" />
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

function Game({ spot, field, frames, onEvent, markFrames, markHint, fetcher, showTitle = false, objectName, tools: toolsProp, initialView, onViewChange, knownLocal }: GameProps) {
  const tools = toolsProp ?? ALL_TOOLS;
  const showOverlays = tools.has("overlays");
  const [W, H] = field.size;
  const [vision, setVision] = useState<Vision>(initialView?.vision ?? "normal");
  const [wavelength, setWavelength] = useState<WavelengthSelection>("all");
  // The exposures (up to ~1 MB) are fetched only once a band other than "all" is picked.
  const wlField = useMemo<Field>(
    () => (wavelength === "all" ? { ...field, has: { ...field.has, exposures: false } } : field),
    [field, wavelength],
  );
  const wl = useWavelengthFrames(wlField, wavelength);
  // Frames shown: the originals for "all" or until the rebuild is ready. A frame with no
  // exposure on the chosen detectors becomes a blank (NaN) plane so indices stay aligned.
  const shownFrames = useMemo(() => {
    if (wavelength === "all" || !wl.frames) return frames;
    const blank = new Float32Array(W * H).fill(NaN);
    return wl.frames.map((f) => f ?? blank);
  }, [wavelength, wl.frames, frames, W, H]);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [rawMode, setMode] = useState<ViewerMode>("mark");
  const canInspect = tools.has("inspect");
  // A hidden Inspect (tutorial Back) never leaves the viewer stuck in inspect mode.
  const mode: ViewerMode = canInspect ? rawMode : "mark";
  const [revealName, setRevealName] = useState<string | null>(null);
  const [revealTitle, setRevealTitle] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<ViewerOverlay>("none");
  const [knownOverlay, setKnownOverlay] = useState(false);
  const [black, setBlack] = useState(field.stretch.black_sigma);
  // Game mounts after the field loads (client only), so window is there. On a phone the image fits the width.
  const fit = useMemo(() => fitScale(W, H, Math.min(900, (typeof window === "undefined" ? 1440 : window.innerWidth) - 40), 560), [W, H]);
  const [scale, setScale] = useState(fit);
  // Inspected pixel plus its screen point (InspectPopup opens beside it).
  const [inspected, setInspected] = useState<{ x: number; y: number; click: { x: number; y: number } } | null>(null);
  const [verdicts, setVerdicts] = useState(0); // Scoreboard.refreshKey: bumps on every verdict
  const viewerRef = useRef<HTMLDivElement>(null);
  const [scoreOpen, setScoreOpen] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const [pointer, setPointer] = useState(false); // last input was a pointer: hide the crosshair
  const statusId = useId();
  const [loopMode, setLoopMode] = useState<BlinkMode>("loop");
  const defaultOnion = useMemo(() => clampOnion([0, ONION_MAX - 1], frames.length), [frames.length]);
  const [onionRange, setOnionRange] = useState<[number, number]>(() => clampOnion(initialView?.frames ?? [0, ONION_MAX - 1], frames.length));
  const [realSpacing, setRealSpacing] = useState(initialView?.realSpacing ?? false);
  const viewCb = useRef(onViewChange);
  useEffect(() => {
    viewCb.current = onViewChange;
  });
  useEffect(() => {
    const isDefault = onionRange[0] === defaultOnion[0] && onionRange[1] === defaultOnion[1];
    viewCb.current?.({ frames: isDefault ? null : onionRange, realSpacing, vision });
  }, [onionRange, defaultOnion, realSpacing, vision]);
  const [verdictIn, setVerdictIn] = useState(false);
  // The spot after this one in public/fields/index.json order (wrapping), fetched after the first verdict.
  const [nextSlug, setNextSlug] = useState<string | null>(null);
  const hasVerdict = verdicts > 0;
  useEffect(() => {
    if (!hasVerdict || showTitle) return;
    let live = true;
    loadFieldIndex()
      .then((list) => {
        const slugs = list.map((s) => s.slug);
        const at = slugs.indexOf(spot);
        const next = slugs.length > 1 ? slugs[(at + 1) % slugs.length] : null;
        if (live) setNextSlug(next && next !== spot ? next : null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [hasVerdict, showTitle, spot]);
  // undefined: not fetched yet; null: unavailable. Fetched once, only after the spot is unlocked.
  const [fetchedKnown, setFetchedKnown] = useState<KnownOverlay | null | undefined>(undefined);
  const knownUnlocked = showTitle || verdictIn;
  useEffect(() => {
    if (!knownOverlay || !knownUnlocked || knownLocal || fetchedKnown !== undefined) return;
    let alive = true;
    fetchOverlay(spot, "explore").then((o) => alive && setFetchedKnown(o));
    return () => {
      alive = false;
    };
  }, [knownOverlay, knownUnlocked, knownLocal, fetchedKnown, spot]);
  const knownData = knownOverlay && knownUnlocked ? (knownLocal ?? fetchedKnown ?? null) : null;
  const knownMissing = knownOverlay && knownUnlocked && !knownLocal && fetchedKnown === null;
  const blink = useBlink(frames.length, { mode: loopMode });
  const { pause } = blink;

  const emit = useCallback(
    (name: PlayEvent, ms: Mark[], inspectOn?: boolean) =>
      onEvent?.(name, inspectOn === undefined ? { markedFrames: distinctFrames(ms) } : { markedFrames: distinctFrames(ms), inspectOn }),
    [onEvent],
  );

  const toggleInspect = useCallback(() => {
    if (!canInspect) return;
    const on = mode !== "inspect";
    setMode(on ? "inspect" : "mark");
    emit(on ? "inspect-opened" : "inspect-closed", marks, on);
  }, [canInspect, mode, marks, emit]);

  /** The one mark path shared by click and keyboard. */
  const placeMark = (m: Mark) => {
    if (!tools.has("mark")) return;
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
  /** Open Inspect on pixel (x, y); the popup's anchor is that pixel's centre on screen. */
  const inspectAt = (x: number, y: number) => {
    const canvas = viewerRef.current?.querySelector('[data-testid="field-canvas"]');
    const r = canvas?.getBoundingClientRect();
    const click = r && r.width > 0 && r.height > 0 ? { x: r.left + ((x + 0.5) * r.width) / W, y: r.top + ((y + 0.5) * r.height) / H } : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    setInspected({ x, y, click });
  };

  const markAt = (x: number, y: number) => {
    if (!meta) return;
    if (mode === "inspect") inspectAt(x, y);
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
    // A wrong answer leaves the spot locked (api.md 3), so the name stays hidden for a retry.
    if (res.unlocked) setVerdictIn(true);
    if (res.unlocked) setRevealTitle(res.spot_reveal?.title ?? res.verdict.object_name ?? field.title);
    if (res.unlocked && res.reveal) setRevealName(res.spot_reveal?.title ?? res.verdict.object_name ?? null);
    setVerdicts((v) => v + 1);
    onEvent?.("submitted", { markedFrames: distinctFrames(marks), unlocked: res.unlocked === true });
    if (res.reveal && canInspect) {
      inspectAt(Math.round(res.reveal.x), Math.round(res.reveal.y));
      if (mode !== "inspect") {
        setMode("inspect");
        emit("inspect-opened", marks, true);
      }
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.key === "i" || e.key === "I") toggleInspect();
      else if (e.key === "Escape") pause();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleInspect, pause]);

  const png8 = field.data.precision === "png8";

  return (
    <div className={`${styles.body} ${!tools.has("mark") ? styles.noRight : scoreOpen ? "" : styles.scoreClosed}`}>
      <aside className={styles.left}>
        {canInspect && (
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
        )}
        {tools.has("color-by-time") && (
          <section className="panel" data-part="PNL-02 // IMAGE TOOLS">
            <button
              type="button"
              aria-pressed={overlay === "colorByTime"}
              onClick={() => {
                // Turning it on stops the blink: the colour composite is one still picture of all frames.
                if (overlay !== "colorByTime") pause();
                setOverlay((o) => (o === "colorByTime" ? "none" : "colorByTime"));
                emit("color-by-time-toggled", marks);
              }}
              title="Still things turn white. Moving things leave colored dots."
              className={styles.wide}
              data-tutorial-target="color-by-time"
            >
              Color by time
            </button>
          </section>
        )}
        {tools.has("wavelength") && field.has?.exposures === true && (
          <section className="panel" data-part="PNL-03 // WAVELENGTH">
            <WavelengthSwitch field={field} value={wavelength} onChange={setWavelength} fewerThanThree={wl.fewerThanThree} />
            {wavelength !== "all" && !wl.frames && (
              <p className={styles.small} role="status" data-testid="wavelength-status">
                {wl.loading ? "Loading the single exposures…" : "Could not rebuild these bands; showing all bands."}
              </p>
            )}
          </section>
        )}
        {showOverlays && (
          <section className="panel" data-part="PNL-04 // OVERLAYS">
            <div data-slot="overlays">
              <button
                type="button"
                aria-pressed={knownOverlay && knownUnlocked}
                disabled={!knownUnlocked}
                onClick={() => {
                  setKnownOverlay((v) => !v);
                  emit("overlay-toggled", marks);
                }}
                className={styles.wide}
                data-tutorial-target="overlay-known-asteroids"
                title={knownUnlocked ? "JPL's predicted spots (diamonds) and catalogue stars (rings)." : "Available after you submit."}
              >
                Known asteroids
              </button>
              {knownMissing && (
                <span className={styles.small} role="status">
                  {OVERLAY_UNAVAILABLE}
                </span>
              )}
            </div>
          </section>
        )}
        {tools.has("color-vision") && (
          <section className="panel" data-part="PNL-05 // COLOR VISION">
            <VisionPicker value={vision} onChange={setVision} />
          </section>
        )}
        {tools.has("brightness") && (
          <section className="panel" data-part="PNL-06 // BRIGHTNESS">
            <BrightnessSlider value={black} onChange={setBlack} defaultValue={field.stretch.black_sigma} png8={png8} minBlack={field.stretch.black_sigma} />
          </section>
        )}
      </aside>

      <main className={styles.center}>
        <div className={styles.viewportTop}>
          <h1 className={styles.title} data-testid="field-title">
            {showTitle ? (objectName ?? field.title) : verdictIn ? (revealTitle ?? field.title) : field.title || neutralTitle(field)}
          </h1>
        </div>
        <div className={styles.viewer}>
          <div
            ref={viewerRef}
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
              frames={shownFrames}
              vision={vision}
              frameIndex={blink.index}
              marks={marks}
              onMark={placeMark}
              mode={mode}
              onInspect={inspectAt}
              overlay={overlay}
              overlayFrames={onionRangeFrames(onionRange)}
              known={knownData}
              crosshair={pointer ? null : cursor}
              brightness={black}
              scale={scale}
              inspectSlot={
                // Tutorial only: InspectPopup takes no name, and the tutorial names its object from its own copy.
                showTitle && mode === "inspect" && inspected ? (
                  <InspectPanel
                    field={field}
                    frames={shownFrames}
                    frameIndex={k}
                    x={inspected.x}
                    y={inspected.y}
                    objectName={revealName ?? objectName ?? null}
                  />
                ) : null
              }
            />
          </div>
          {!showTitle && mode === "inspect" && inspected && (
            // Round before a correct answer; explore after it (api.md 2: the server still decides from
            // the unlock cookie). The key remounts the popup once the spot unlocks so it refetches.
            <InspectPopup
              key={verdictIn ? "unlocked" : "locked"}
              field={field}
              frames={shownFrames}
              x={inspected.x}
              y={inspected.y}
              click={inspected.click}
              mode={verdictIn ? "explore" : "round"}
              onClose={() => setInspected(null)}
            />
          )}
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

      {tools.has("mark") && (
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
                {/* After any verdict a round can move on (the tutorial's coach leads instead). */}
                {!showTitle && verdicts > 0 && (
                  <p className={styles.small}>
                    {nextSlug && <Link href={`/play?spot=${encodeURIComponent(nextSlug)}`}>Next spot →</Link>}
                    {nextSlug && " · "}
                    <Link href="/map">Sky map</Link>
                  </p>
                )}
              </section>
              {/* Not in the tutorial (showTitle): it is training, not a scored round. */}
              {!showTitle && <Scoreboard slug={spot} refreshKey={verdicts} />}
            </>
          )}
        </aside>
      )}

      <footer className={styles.bottom} data-tutorial-target="timeline">
        <Timeline
          field={field}
          frames={shownFrames}
          thumbsFromFrames={shownFrames !== frames}
          vision={vision}
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
          onLoopModeChange={tools.has("frames-spacing") ? setLoopMode : undefined}
          onionRange={tools.has("color-by-time") ? onionRange : undefined}
          onOnionRangeChange={tools.has("color-by-time") ? setOnionRange : undefined}
          realSpacing={realSpacing}
          onRealSpacingChange={tools.has("frames-spacing") ? setRealSpacing : undefined}
        />
      </footer>
    </div>
  );
}
