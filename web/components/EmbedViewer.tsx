"use client";
// /embed?spot=<slug>&frames=a-b&vision=...: a minimal viewer for iframes. The field viewer and the
// timeline (Play blink, Next frame) only: no marking, submit, scoreboard, login or object name.
// frames=a-b turns on Color by time over that range. A small link opens the same view on /play.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatDec, formatRA } from "@/lib/coords";
import { loadField, loadFrames } from "@/lib/fields";
import type { Field } from "@/lib/types";
import { useBlink } from "@/lib/useBlink";
import FieldViewer, { fitScale } from "./FieldViewer";
import styles from "./EmbedViewer.module.css";
import Timeline, { clampOnion, onionRangeFrames } from "./Timeline";
import { applyView, parseView, type RawParams } from "./viewState";

type Loaded = { spot: string; field: Field; frames: Float32Array[] } | { spot: string; error: string };

/** The /play address for the same view. */
export function playHref(spot: string, params: RawParams): string {
  const q = applyView(new URLSearchParams({ spot }), parseView(params));
  return `/play?${q.toString()}`;
}

const noMark = () => {};

export default function EmbedViewer({ spot, params, loading = false }: { spot?: string; params: RawParams; loading?: boolean }) {
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
    <main className={styles.root}>
      {current && !("error" in current) ? (
        <Embedded field={current.field} frames={current.frames} spot={current.spot} params={params} />
      ) : (
        <>
          <h1 className="sr-only">Field viewer</h1>
          <p className={styles.note} role="status">
            {loading ? "Loading the spot…" : !spot ? "No spot selected. Add ?spot=<name> to the address." : current ? "Could not load this spot." : "Loading the spot…"}
          </p>
        </>
      )}
    </main>
  );
}

function Embedded({ field, frames, spot, params }: { field: Field; frames: Float32Array[]; spot: string; params: RawParams }) {
  const view = useMemo(() => parseView(params), [params]);
  const [W, H] = field.size;
  const blink = useBlink(frames.length);
  const scale = useMemo(() => fitScale(W, H, 640, 420), [W, H]);
  const onion = view.frames ? clampOnion(view.frames, frames.length) : null;
  return (
    <>
      <h1 className="sr-only">{field.title || `Field at RA ${formatRA(field.ra)} Dec ${formatDec(field.dec)}`}</h1>
      <div className={styles.viewer}>
        <FieldViewer
          field={field}
          frames={frames}
          vision={view.vision}
          frameIndex={blink.index}
          marks={[]}
          onMark={noMark}
          mode="inspect"
          overlay={onion ? "colorByTime" : "none"}
          overlayFrames={onion ? onionRangeFrames(onion) : undefined}
          scale={scale}
        />
      </div>
      <Timeline
        field={field}
        frames={frames}
        vision={view.vision}
        index={blink.index}
        onIndexChange={blink.setIndex}
        playing={blink.playing}
        onTogglePlay={blink.toggle}
        reducedMotion={blink.reducedMotion}
        onionRange={onion ?? undefined}
      />
      <Link href={playHref(spot, params)} className={styles.open} target="_top">
        Open in Onion Sky
      </Link>
    </>
  );
}
