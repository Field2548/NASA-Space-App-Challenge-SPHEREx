"use client";
// /play?patch=p11-N (or ?ra=&dec=): any point picked on the sky map, played like a stage.
// Flow: a still from IRSA's all-sky HiPS shows at once; GET /api/quicklook/list says which SPHEREx
// exposures cover the patch; planQuickLook picks the bursts and states the byte budget; the player
// starts the download (progress in frames and bytes); then the same Game as a ready spot, with
// marks, tools and Submit, checked by POST /api/patch-check. No object name is shown before a
// correct answer: Inspect asks by sky position in round mode, and the known overlay stays empty.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { paintStill, planStill, stillTilePath } from "@/lib/hipsStill";
import { type Patch, randomPatch } from "@/lib/patch";
import { savePatchCheck, submitPatchCheck, type PatchCheckResponse } from "@/lib/patchSolves";
import {
  planQuickLook,
  type QuickLookField,
  type QuickLookList,
  type QuickLookProgress,
  type QuickLookWorkerRequest,
  type QuickLookWorkerResponse,
} from "@/lib/quicklook";
import type { CheckRequest, CheckResponse, Field } from "@/lib/types";
import type { KnownOverlay } from "./overlay";
import styles from "./PatchPlay.module.css";
import { QUICKLOOK_MAX_BYTES } from "./QuickLook";

/** Frames asked of the planner: enough to see a track, inside the 30 MB budget. */
export const PATCH_FRAMES = 5;
export const NO_EXPOSURES_TEXT = "No SPHEREx exposures here yet.";
const EMPTY_KNOWN: KnownOverlay = { asteroids: [], stars: [] };

export interface PickedHooks {
  submit(req: CheckRequest): Promise<CheckResponse>;
  onResult(res: CheckResponse): void;
}
export interface PatchGameArgs {
  field: Field;
  frames: Float32Array[];
  knownLocal: KnownOverlay;
  picked: PickedHooks;
}

type State =
  | { s: "listing" }
  | { s: "list-error"; message: string }
  | { s: "ready"; list: QuickLookList }
  | { s: "running"; list: QuickLookList; info: QuickLookProgress | null }
  | { s: "run-error"; list: QuickLookList; message: string }
  | { s: "done"; field: QuickLookField };

const mb = (b: number) => `${(b / 1e6).toFixed(b < 1e7 ? 1 : 0)} MB`;

/** The patch as a Game field: the quick-look grid, renamed to the patch, no exposures or spectrum. */
export function patchField(patch: Patch, ql: QuickLookField): Field {
  return { ...ql, slug: patch.id, title: `Patch ${patch.id}`, has: { exposures: false, spectrum: false } };
}

/** The /api/patch-check request for a Game check request on this patch's frames. */
export function patchRequest(patch: Patch, field: Field, req: CheckRequest) {
  const frames = field.frames.map((f) => ({ i: f.i, mjd: f.mjd }));
  return req.answer === "track"
    ? { patch: patch.id, answer: "track" as const, marks: req.marks, frames }
    : { patch: patch.id, answer: "nothing" as const, frames };
}

function Still({ patch, children }: { patch: Patch; children?: ReactNode }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const plan = planStill(patch.wcs, patch.size);
    let alive = true;
    Promise.all(
      plan.tiles.map(async (t) => {
        try {
          const r = await fetch(`/api/hips/irsa/${stillTilePath(t)}`);
          if (!r.ok) return null;
          const bmp = await createImageBitmap(await r.blob());
          const c = document.createElement("canvas");
          c.width = bmp.width;
          c.height = bmp.height;
          const ctx = c.getContext("2d");
          if (!ctx) return null;
          ctx.drawImage(bmp, 0, 0);
          return ctx.getImageData(0, 0, bmp.width, bmp.height).data;
        } catch {
          return null;
        }
      }),
    ).then((tiles) => {
      const c = ref.current;
      const ctx = c?.getContext("2d");
      if (!alive || !c || !ctx) return;
      ctx.putImageData(new ImageData(new Uint8ClampedArray(paintStill(plan, tiles)), plan.width, plan.height), 0, 0);
    });
    return () => {
      alive = false;
    };
  }, [patch]);
  return (
    <div className={styles.still}>
      <canvas ref={ref} width={patch.size[0]} height={patch.size[1]} aria-label="Still picture of this patch from the SPHEREx all-sky map" role="img" />
      {children}
    </div>
  );
}

function Actions() {
  const router = useRouter();
  return (
    <div className={styles.row}>
      <button type="button" className="btn-primary" onClick={() => router.push(`/play?patch=${randomPatch().id}`)}>
        Try a random patch
      </button>
      <Link href="/map">Back to the map</Link>
    </div>
  );
}

export default function PatchPlay({ patch, renderGame }: { patch: Patch; renderGame(a: PatchGameArgs): ReactNode }) {
  const [state, setState] = useState<State>({ s: "listing" });
  const [known, setKnown] = useState<KnownOverlay>(EMPTY_KNOWN);
  const worker = useRef<Worker | null>(null);
  const runId = useRef<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/quicklook/list?ra=${patch.ra}&dec=${patch.dec}`, { signal: ac.signal })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body?.error?.message ?? `IRSA list failed (${r.status}).`);
        setState({ s: "ready", list: body as QuickLookList });
      })
      .catch((e: unknown) => {
        if (!ac.signal.aborted) setState({ s: "list-error", message: e instanceof Error ? e.message : String(e) });
      });
    return () => ac.abort();
  }, [patch]);

  useEffect(
    () => () => {
      if (worker.current && runId.current) worker.current.postMessage({ type: "cancel", id: runId.current } satisfies QuickLookWorkerRequest);
      worker.current?.terminate();
      worker.current = null;
    },
    [],
  );

  const list = state.s === "ready" || state.s === "running" || state.s === "run-error" ? state.list : null;
  const plan = useMemo(
    () =>
      list
        ? planQuickLook(list.exposures, {
            ra: patch.ra,
            dec: patch.dec,
            frames: PATCH_FRAMES,
            spacing: "even",
            minGapHours: 1.5,
            detectors: [],
            gridPx: patch.size[0],
            maxBytes: QUICKLOOK_MAX_BYTES,
          })
        : null,
    [list, patch],
  );

  const start = () => {
    if (!plan || !list) return;
    if (!worker.current) {
      const w = new Worker(new URL("../workers/quicklook.ts", import.meta.url), { type: "module" });
      w.onmessage = (e: MessageEvent<QuickLookWorkerResponse>) => {
        const m = e.data;
        if (m.id !== runId.current) return;
        if (m.type === "progress") setState((s) => (s.s === "running" ? { ...s, info: m.info } : s));
        else if (m.type === "done") {
          runId.current = null;
          setState({ s: "done", field: m.field });
        } else {
          runId.current = null;
          setState((s) => (s.s === "running" ? (m.cancelled ? { s: "ready", list: s.list } : { s: "run-error", list: s.list, message: m.message }) : s));
        }
      };
      worker.current = w;
    }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    runId.current = id;
    setState({ s: "running", list, info: null });
    worker.current.postMessage({ type: "start", id, plan } satisfies QuickLookWorkerRequest);
  };

  const field = useMemo(() => (state.s === "done" ? patchField(patch, state.field) : null), [state, patch]);
  const picked = useMemo<PickedHooks | null>(
    () =>
      field
        ? {
            submit: (req) => submitPatchCheck(patchRequest(patch, field, req)),
            onResult: (res) => {
              const r = res as PatchCheckResponse;
              savePatchCheck(r);
              if (r.unlocked && r.known_objects) setKnown({ asteroids: r.known_objects.asteroids, stars: [] });
            },
          }
        : null,
    [field, patch],
  );

  if (state.s === "done" && field && picked) {
    if (field.frames.length >= 2) return renderGame({ field, frames: state.field.planes, knownLocal: known, picked });
  }

  const where = `RA ${patch.ra.toFixed(4)}, Dec ${patch.dec >= 0 ? "+" : ""}${patch.dec.toFixed(4)}`;
  const tooFew = plan !== null && plan.bursts.length < 2;
  const noneAtAll = list !== null && list.exposures.length === 0;
  const doneTooFew = state.s === "done" && (field?.frames.length ?? 0) < 2;

  let over: ReactNode = null;
  let body: ReactNode = null;
  if (state.s === "listing") {
    over = "Asking NASA IRSA which SPHEREx images cover this patch…";
  } else if (state.s === "list-error") {
    over = "Could not reach NASA IRSA right now.";
    body = (
      <>
        <p className={styles.small}>{state.message}</p>
        <Actions />
      </>
    );
  } else if (noneAtAll || tooFew || doneTooFew) {
    over = noneAtAll ? NO_EXPOSURES_TEXT : "Too few SPHEREx visits here to see anything move.";
    body = (
      <>
        <p className={styles.small}>
          {noneAtAll
            ? "SPHEREx has not imaged this spot yet, so there are no frames to play. The still is from the all-sky map."
            : `SPHEREx has imaged this spot ${doneTooFew ? "only once with usable data" : `in ${plan?.bursts.length ?? 0} visit`}; a mover needs at least 2 visits.`}
        </p>
        <Actions />
      </>
    );
  } else if (state.s === "ready" && plan) {
    body = (
      <>
        <p className={styles.small}>
          {plan.bursts.length} frames from SPHEREx, about {mb(plan.bytes)} to download (at most {mb(QUICKLOOK_MAX_BYTES)}).
        </p>
        {plan.notes.map((n) => (
          <p key={n} className={styles.small}>
            {n}
          </p>
        ))}
        <button type="button" className="btn-primary" onClick={start}>
          Load the frames and play
        </button>
      </>
    );
  } else if (state.s === "running") {
    const i = state.info;
    const p = i && i.exposuresTotal ? i.exposuresDone / i.exposuresTotal : 0;
    over = "Downloading SPHEREx frames…";
    body = (
      <>
        <div className={styles.bar} role="progressbar" aria-label="Frames downloaded" aria-valuemin={0} aria-valuemax={i?.exposuresTotal ?? 0} aria-valuenow={i?.exposuresDone ?? 0}>
          <span style={{ width: `${Math.round(p * 100)}%` }} />
        </div>
        <p className={styles.small}>
          {i ? `${i.exposuresDone} of ${i.exposuresTotal} images, ${mb(i.bytesDownloaded)} of about ${mb(i.bytesPlanned)}` : "Starting…"}
        </p>
      </>
    );
  } else if (state.s === "run-error") {
    over = "The download stopped.";
    body = (
      <>
        <p className={styles.small}>{state.message}</p>
        <button type="button" className="btn-primary" onClick={start}>
          Try again
        </button>
        <Actions />
      </>
    );
  }

  return (
    <main className={styles.root} aria-live="polite">
      <h1 className={styles.title}>Patch at {where}</h1>
      <Still patch={patch}>{over ? <p className={styles.over}>{over}</p> : null}</Still>
      {body}
    </main>
  );
}
