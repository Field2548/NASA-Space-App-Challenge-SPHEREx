"use client";
// /map (BP 8.1, 8.2): SERVER's SkyMap with the CoordinateBox over it. Any point on the sky is a
// playable patch (lib/patch.ts): a wide view zooms in on a click, a close view picks the patch there
// and the patch card sends it to /play?patch=<id>, the same game page as the ready spots.
// "Random patch" picks a point uniform on the sphere. Zoomed in to PATCH_SHOW_FOV, patches other
// players already solved are drawn (GET /api/patches), so nobody plays the same patch twice.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatDec, formatRA } from "@/lib/coords";
import { patchFromPoint, randomPatch, type Patch } from "@/lib/patch";
import type { FieldSummary } from "@/lib/types";
import { CoordinateBox } from "./CoordinateBox";
import styles from "./MapScreen.module.css";
import { PATCH_SHOW_FOV, SkyMap, type SkyPatch } from "./SkyMap";
import { flyFovForSpot, spotCovering } from "./skymap/geometry";
import { loadSpotsOnce } from "./skymap/spots";

/** Field of view (degrees) at or under which a click on the sky picks that patch. */
export const PICK_FOV = PATCH_SHOW_FOV;
/** Field of view a picked patch is shown at. */
const PATCH_VIEW_FOV = 0.5;

export const playHref = (slug: string) => `/play?spot=${encodeURIComponent(slug)}`;
export const patchHref = (id: string) => `/play?patch=${encodeURIComponent(id)}`;

interface PatchesResponse {
  patches?: (SkyPatch & { solved_at?: string | null })[];
  offline?: boolean;
}

/** Solved patches around a view centre. Null when the server has none to give (offline, no route). */
async function loadPatches(ra: number, dec: number, r: number, signal: AbortSignal): Promise<SkyPatch[] | null> {
  const q = new URLSearchParams({ ra: ra.toFixed(5), dec: dec.toFixed(5), r: r.toFixed(3) });
  const res = await fetch(`/api/patches?${q}`, { signal });
  if (!res.ok) return null;
  const body = (await res.json()) as PatchesResponse;
  return body.offline ? null : (body.patches ?? []);
}

export default function MapScreen() {
  const router = useRouter();
  const [spots, setSpots] = useState<FieldSummary[] | undefined>(undefined);
  const [target, setTarget] = useState<{ ra: number; dec: number; fov?: number } | null>(null);
  const [picked, setPicked] = useState<Patch | null>(null);
  const [view, setView] = useState<{ ra: number; dec: number; fov: number } | null>(null);
  const [patches, setPatches] = useState<SkyPatch[] | null>(null);
  const [patchesOffline, setPatchesOffline] = useState(false);

  useEffect(() => {
    let live = true;
    loadSpotsOnce()
      .then((rows) => live && setSpots(rows))
      .catch(() => live && setSpots([]));
    return () => {
      live = false;
    };
  }, []);

  // Solved patches for the current close view.
  const close = view !== null && view.fov <= PATCH_SHOW_FOV;
  useEffect(() => {
    if (!close || !view) return;
    const ctl = new AbortController();
    loadPatches(view.ra, view.dec, Math.min(view.fov, PATCH_SHOW_FOV), ctl.signal)
      .then((rows) => {
        setPatches(rows);
        setPatchesOffline(rows === null);
      })
      .catch(() => {
        if (!ctl.signal.aborted) setPatchesOffline(true);
      });
    return () => ctl.abort();
  }, [close, view]);

  const play = (slug: string) => router.push(playHref(slug));
  const pick = (p: Patch) => {
    setPicked(p);
    setTarget({ ra: p.ra, dec: p.dec, fov: PATCH_VIEW_FOV });
  };
  const solved = picked ? patches?.find((p) => p.id === picked.id) : undefined;

  return (
    <div className={styles.screen}>
      <header className={styles.top}>
        <Link href="/">Back to the start</Link>
        <h1 className={styles.title}>Sky map</h1>
      </header>
      <main className={styles.map}>
        <SkyMap
          onPlay={play}
          target={target}
          showSpots={false}
          patches={patches}
          picked={picked}
          onView={setView}
          onClickSky={({ ra, dec, fov }) => {
            // A wide view zooms in on the click; a close view picks the patch there.
            if (fov !== undefined && fov > PICK_FOV) setTarget({ ra, dec, fov: PICK_FOV / 2 });
            else setPicked(patchFromPoint(ra, dec));
          }}
        />
        <div className={styles.box}>
          <CoordinateBox
            spots={spots}
            onGo={({ ra, dec }) => {
              const s = spotCovering(ra, dec, spots ?? []);
              setTarget({ ra, dec, fov: s ? flyFovForSpot(s) : 1 });
            }}
            onPlay={play}
            onQuickLook={({ ra, dec }) => pick(patchFromPoint(ra, dec))}
            quickLookLabel="Pick this patch"
          />
          <section className={`panel ${styles.card}`} aria-label="Patch">
            {picked ? (
              <>
                <h2 className={styles.cardTitle}>Patch {picked.id}</h2>
                <p className={styles.cardLine}>
                  {formatRA(picked.ra)} {formatDec(picked.dec)} · {(picked.size_deg * 60).toFixed(1)}′ square
                </p>
                <p className={styles.cardLine} data-solved={solved ? "yes" : "no"}>
                  {solved
                    ? `Already solved: ${solved.objects.length} known object${solved.objects.length === 1 ? "" : "s"}, ${solved.reports.length} report${solved.reports.length === 1 ? "" : "s"}.`
                    : patchesOffline
                      ? "Solved patches are offline, so this one may have been played."
                      : "Nobody has solved this patch yet."}
                </p>
                <div className={styles.cardRow}>
                  <button type="button" className="primary" onClick={() => router.push(patchHref(picked.id))}>
                    Play this patch
                  </button>
                  <button type="button" onClick={() => pick(randomPatch())}>
                    Random patch
                  </button>
                  <button type="button" onClick={() => setPicked(null)} aria-label="Clear the picked patch">
                    Clear
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className={styles.cardLine}>
                  Click the sky to zoom in, then click a spot to pick a patch. Solved patches show in green once you are
                  zoomed in.
                </p>
                <div className={styles.cardRow}>
                  <button type="button" className="primary" onClick={() => pick(randomPatch())}>
                    Random patch
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
