"use client";

// Quick look viewer (BUILD_PROMPT 8.20): any coordinate, live, from partial downloads. Owner: DATA.
//
// Flow: GET /api/quicklook/list -> planQuickLook (byte budget shown BEFORE any download) -> Start
// -> workers/quicklook.ts downloads only the needed rows from S3 -> blinkable frames.
// Image rules: one shared asinh stretch with black at -1 sigma, nearest-neighbour upscaling
// (imageSmoothingEnabled = false and image-rendering: pixelated). Spoiler lock: no object names are
// shown (the field title is never rendered; only the typed coordinates). Marking is on the cut list.

import { useEffect, useMemo, useRef, useState } from "react";
import { makeSharedStretch } from "@/lib/imaging";
import {
  QUICKLOOK_LABEL,
  planQuickLook,
  type QuickLookField,
  type QuickLookList,
  type QuickLookPlan,
  type QuickLookWorkerRequest,
  type QuickLookWorkerResponse,
} from "@/lib/quicklook";
import { detectorsFor, type WavelengthSelection } from "./WavelengthSwitch";

/** Plan downloads are trimmed to stay under this (bytes). */
export const QUICKLOOK_MAX_BYTES = 30e6;
const SCALE = 8; // screen pixels per image pixel

/** "[#####.....]  50%" */
export function asciiBar(p: number, width = 24): string {
  const q = Math.min(1, Math.max(0, Number.isFinite(p) ? p : 0));
  const n = Math.round(q * width);
  return `[${"#".repeat(n)}${".".repeat(width - n)}] ${String(Math.round(q * 100)).padStart(3)}%`;
}

/** "~6 MB, about 20 exposures." */
export function planSummary(plan: Pick<QuickLookPlan, "bytes" | "exposures" | "bursts">): string {
  const mb = plan.bytes / 1e6;
  const size = mb < 1 ? mb.toFixed(1) : String(Math.round(mb));
  return `~${size} MB, about ${plan.exposures.length} exposures in ${plan.bursts.length} frames.`;
}

/** Frame k of a quick look as RGBA grey, with the field's shared stretch (NaN = black). */
export function frameRgba(field: Pick<QuickLookField, "planes" | "stretch">, k: number): Uint8ClampedArray {
  const stretch = makeSharedStretch(field.planes, {
    blackSigma: field.stretch.black_sigma,
    softSigma: field.stretch.soft_sigma,
    white: field.stretch.white,
  });
  const g = stretch(field.planes[k]);
  const out = new Uint8ClampedArray(g.length * 4);
  for (let i = 0; i < g.length; i++) {
    out[4 * i] = out[4 * i + 1] = out[4 * i + 2] = g[i] * 255;
    out[4 * i + 3] = 255;
  }
  return out;
}

export interface QuickLookSettings {
  frames: number;
  spacing: "even" | "growing";
  minGapHours: number;
  wavelength: WavelengthSelection;
}

export const DEFAULT_SETTINGS: QuickLookSettings = { frames: 4, spacing: "even", minGapHours: 1.5, wavelength: "all" };
const GAPS = [1.5, 6, 12, 24, 72, 168];

export type QuickLookState =
  | { phase: "listing" }
  | { phase: "error"; message: string }
  | { phase: "ready"; list: QuickLookList }
  | { phase: "running"; list: QuickLookList; p: number }
  | { phase: "done"; list: QuickLookList; field: QuickLookField };

export interface QuickLookViewProps {
  ra: number;
  dec: number;
  state: QuickLookState;
  plan: QuickLookPlan | null;
  settings: QuickLookSettings;
  frame: number;
  playing: boolean;
  onSettings?: (s: QuickLookSettings) => void;
  onStart?: () => void;
  onCancel?: () => void;
  onFrame?: (k: number) => void;
  onPlaying?: (on: boolean) => void;
  onClose?: () => void;
  canvasRef?: React.Ref<HTMLCanvasElement>;
}

/** Pure view of one state (render-tested without a Worker or canvas context). */
export function QuickLookView({ canvasRef, ...v }: QuickLookViewProps) {
  const { state, plan, settings: s } = v;
  const pos = `${v.ra.toFixed(4)}, ${v.dec >= 0 ? "+" : ""}${v.dec.toFixed(4)}`;
  const set = (patch: Partial<QuickLookSettings>) => v.onSettings?.({ ...s, ...patch });
  const busy = state.phase === "running";
  return (
    <section aria-label="Quick look" className="quicklook">
      <header>
        <h2>Quick look at {pos}</h2>
        {v.onClose && (
          <button type="button" onClick={v.onClose}>
            Close
          </button>
        )}
      </header>
      <p role="note">
        <strong>{QUICKLOOK_LABEL}</strong>
      </p>

      {state.phase === "listing" && <p>Asking NASA IRSA which SPHEREx images cover this spot (this can take up to a minute)...</p>}
      {state.phase === "error" && <p role="alert">{state.message}</p>}

      {(state.phase === "ready" || state.phase === "done") && (
        <fieldset>
          <legend>Frames and spacing</legend>
          <label>
            Frames{" "}
            <select value={s.frames} onChange={(e) => set({ frames: Number(e.target.value) })}>
              {[2, 3, 4, 5, 6, 7].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>{" "}
          <label>
            Spacing{" "}
            <select value={s.spacing} onChange={(e) => set({ spacing: e.target.value as "even" | "growing" })}>
              <option value="even">Even</option>
              <option value="growing">Growing</option>
            </select>
          </label>{" "}
          <label>
            Minimum gap{" "}
            <select value={s.minGapHours} onChange={(e) => set({ minGapHours: Number(e.target.value) })}>
              {GAPS.map((h) => (
                <option key={h} value={h}>
                  {h < 24 ? `${h} h` : `${h / 24} d`}
                </option>
              ))}
            </select>
          </label>{" "}
          <label>
            Wavelength{" "}
            <select
              value={String(s.wavelength)}
              onChange={(e) => set({ wavelength: e.target.value as WavelengthSelection })}
            >
              <option value="all">All</option>
              <option value="short">Short (0.75-2.4 um)</option>
              <option value="long">Long (2.4-5 um)</option>
            </select>
          </label>
          <p>SPHEREx only looks at a spot at certain times, so we use the closest real moments.</p>
        </fieldset>
      )}

      {(state.phase === "ready" || state.phase === "done") && plan && (
        <p>
          {plan.exposures.length ? (
            <>
              Download: {planSummary(plan)}{" "}
              <button type="button" onClick={v.onStart}>
                {state.phase === "done" ? "Load again with these settings" : "Start quick look"}
              </button>
            </>
          ) : (
            "No SPHEREx images readable in the browser cover this spot with these settings."
          )}
        </p>
      )}
      {plan?.notes.map((n) => (
        <p key={n}>{n}</p>
      ))}

      {busy && (
        <p>
          <code aria-label="Download progress">{asciiBar(state.p)}</code>{" "}
          <button type="button" onClick={v.onCancel}>
            Cancel
          </button>
        </p>
      )}

      {state.phase === "done" && (
        <figure>
          <canvas
            ref={canvasRef}
            width={state.field.size[0]}
            height={state.field.size[1]}
            style={{ width: state.field.size[0] * SCALE, height: state.field.size[1] * SCALE, imageRendering: "pixelated" }}
            aria-label={`Quick look frame ${v.frame + 1} of ${state.field.frames.length}`}
          />
          <figcaption>
            Frame {v.frame + 1} of {state.field.frames.length}: {state.field.frames[v.frame]?.utc} UTC
            {v.frame > 0 && `, ${state.field.frames[v.frame]?.hours_since_prev} h after the previous frame`}. North up, east
            left.
          </figcaption>
          <button type="button" onClick={() => v.onPlaying?.(!v.playing)}>
            {v.playing ? "Pause blink" : "Blink"}
          </button>{" "}
          <input
            type="range"
            min={0}
            max={state.field.frames.length - 1}
            value={v.frame}
            onChange={(e) => v.onFrame?.(Number(e.target.value))}
            aria-label="Frame"
          />
          {state.field.notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </figure>
      )}
    </section>
  );
}

export interface QuickLookProps {
  ra: number;
  dec: number;
  onClose?: () => void;
}

/** Quick look at (ra, dec). Mount it where CoordinateBox's onQuickLook fires. */
export default function QuickLook(props: QuickLookProps) {
  // A new spot remounts: the old run is cancelled and its frames never show under the new heading.
  return <QuickLookAt key={`${props.ra},${props.dec}`} {...props} />;
}

function QuickLookAt({ ra, dec, onClose }: QuickLookProps) {
  const [state, setState] = useState<QuickLookState>({ phase: "listing" });
  const [settings, setSettings] = useState<QuickLookSettings>(DEFAULT_SETTINGS);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(true);
  const worker = useRef<Worker | null>(null);
  const runId = useRef<string | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);

  // The list. Aborted when the player leaves or moves to another spot.
  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/quicklook/list?ra=${ra}&dec=${dec}`, { signal: ac.signal })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body?.error?.message ?? `IRSA list failed (${r.status}).`);
        setState({ phase: "ready", list: body as QuickLookList });
      })
      .catch((e: unknown) => {
        if (!ac.signal.aborted) setState({ phase: "error", message: e instanceof Error ? e.message : String(e) });
      });
    return () => ac.abort();
  }, [ra, dec]);

  // One worker for the component's life (its row cache makes a second run cheap); stop it on leave.
  useEffect(
    () => () => {
      if (worker.current && runId.current) worker.current.postMessage({ type: "cancel", id: runId.current } satisfies QuickLookWorkerRequest);
      worker.current?.terminate();
      worker.current = null;
    },
    [],
  );

  const list = state.phase === "listing" || state.phase === "error" ? null : state.list;
  const plan = useMemo(
    () =>
      list
        ? planQuickLook(list.exposures, {
            ra,
            dec,
            frames: settings.frames,
            spacing: settings.spacing,
            minGapHours: settings.minGapHours,
            detectors: detectorsFor(settings.wavelength),
            maxBytes: QUICKLOOK_MAX_BYTES,
          })
        : null,
    [list, ra, dec, settings],
  );

  const start = () => {
    if (!plan || !list) return;
    if (!worker.current) {
      const w = new Worker(new URL("../workers/quicklook.ts", import.meta.url), { type: "module" });
      w.onmessage = (e: MessageEvent<QuickLookWorkerResponse>) => {
        const m = e.data;
        if (m.id !== runId.current) return;
        if (m.type === "progress") setState((s) => (s.phase === "running" ? { ...s, p: m.p } : s));
        else if (m.type === "done") {
          runId.current = null;
          setFrame(0);
          setState((s) => (s.phase === "running" ? { phase: "done", list: s.list, field: m.field } : s));
        } else {
          runId.current = null;
          setState((s) => (m.cancelled && s.phase === "running" ? { phase: "ready", list: s.list } : { phase: "error", message: m.message }));
        }
      };
      worker.current = w;
    }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    runId.current = id;
    setState({ phase: "running", list, p: 0 });
    worker.current.postMessage({ type: "start", id, plan } satisfies QuickLookWorkerRequest);
  };

  const cancel = () => {
    if (worker.current && runId.current) worker.current.postMessage({ type: "cancel", id: runId.current } satisfies QuickLookWorkerRequest);
  };

  const field = state.phase === "done" ? state.field : null;

  // Draw the current frame, nearest-neighbour.
  useEffect(() => {
    const c = canvas.current;
    if (!field || !c || !field.planes[frame]) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    const [w, h] = field.size;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(frameRgba(field, frame)), w, h), 0, 0);
  }, [field, frame]);

  // Blink.
  useEffect(() => {
    if (!field || !playing || field.planes.length < 2) return;
    const t = setInterval(() => setFrame((k) => (k + 1) % field.planes.length), 600);
    return () => clearInterval(t);
  }, [field, playing]);

  return (
    <QuickLookView
      ra={ra}
      dec={dec}
      state={state}
      plan={plan}
      settings={settings}
      frame={frame}
      playing={playing}
      onSettings={setSettings}
      onStart={start}
      onCancel={cancel}
      onFrame={(k) => {
        setPlaying(false);
        setFrame(k);
      }}
      onPlaying={setPlaying}
      onClose={onClose}
      canvasRef={canvas}
    />
  );
}
