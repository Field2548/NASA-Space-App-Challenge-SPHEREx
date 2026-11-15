"use client";
// /map (BP 8.1, 8.2): SERVER's SkyMap with the CoordinateBox over it. Any point on the sky is a
// playable patch (lib/patch.ts). Like a street map: a click picks the patch there and shows its card
// (with a still picture) without moving the view, a double click zooms in, and Enter in the box
// flies to the typed place and picks its patch. Picking starts the IRSA exposure query, so
// /play?patch=<id> (the same game page as the ready spots) opens with it already on its way.
// The dice in the coordinate box picks a point uniform on the sphere. Zoomed in to PATCH_SHOW_FOV, patches other
// players already solved are drawn (GET /api/patches), so nobody plays the same patch twice.

import { Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatDec, formatRA } from "@/lib/coords";
import { useCommunityPref } from "@/lib/communityPref";
import { patchFromPoint, type Patch } from "@/lib/patch";
import type { FieldSummary } from "@/lib/types";
import BackLink from "./BackLink";
import { CoordinateBox } from "./CoordinateBox";
import styles from "./MapScreen.module.css";
import { PATCH_SHOW_FOV, SkyMap, type SkyPatch } from "./SkyMap";
import { Still } from "./PatchPlay";
import { CommunityLegend } from "./skymap/CommunityLegend";
import { loadSpotsOnce } from "./skymap/spots";
import { prefetchQuickLookList } from "@/lib/quicklookPrefetch";

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
  const [community, setCommunity] = useCommunityPref();

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
      .then(setPatches)
      .catch(() => {});
    return () => ctl.abort();
  }, [close, view]);

  const play = (slug: string) => router.push(playHref(slug));
  /** Show a patch's card and start asking IRSA which exposures cover it. */
  const select = (p: Patch) => {
    setPicked(p);
    prefetchQuickLookList(p.ra, p.dec);
  };
  /** Select and fly to it (dice, Enter). */
  const pick = (p: Patch) => {
    select(p);
    setTarget({ ra: p.ra, dec: p.dec, fov: PATCH_VIEW_FOV });
  };
  const solved = picked ? patches?.find((p) => p.id === picked.id) : undefined;

  return (
    <div className={styles.screen}>
      <header className={styles.top}>
        <BackLink />
        <h1 className={styles.title}>Sky map</h1>
        <button
          type="button"
          className={styles.toggle}
          aria-pressed={community}
          aria-label="Community patches"
          title="Show every player's patches on the map"
          onClick={() => setCommunity(!community)}
        >
          <Users size={14} aria-hidden="true" />
          <span className={styles.toggleText}>Community patches</span>
        </button>
      </header>
      <main className={styles.map}>
        <SkyMap
          onPlay={play}
          target={target}
          showSpots={false}
          patches={patches}
          picked={picked}
          community={community}
          onView={setView}
          onClickSky={({ ra, dec }) => select(patchFromPoint(ra, dec))}
        />
        {community && <CommunityLegend className={styles.legend} />}
        <div className={styles.box}>
          <CoordinateBox
            spots={spots}
            onGo={({ ra, dec }) => pick(patchFromPoint(ra, dec))}
            onPlay={play}
          />
          <section className={`panel ${styles.card}`} aria-label="Patch">
            {picked ? (
              <>
                <Still key={picked.id} patch={picked} className={styles.preview} />
                <h2 className={styles.cardTitle}>Patch {picked.id}</h2>
                <p className={styles.cardLine}>
                  {formatRA(picked.ra)} {formatDec(picked.dec)} · {(picked.size_deg * 60).toFixed(1)}′ square
                </p>
                <p className={styles.cardLine} data-solved={solved ? "yes" : "no"}>
                  {solved
                    ? `Already solved: ${solved.objects.length} known object${solved.objects.length === 1 ? "" : "s"}, ${solved.reports.length} report${solved.reports.length === 1 ? "" : "s"}.`
                    : "Nobody has solved this patch yet."}
                </p>
                <div className={styles.cardRow}>
                  <button type="button" className="primary" onClick={() => router.push(patchHref(picked.id))}>
                    Play this patch
                  </button>
                  <button type="button" onClick={() => setPicked(null)} aria-label="Clear the picked patch">
                    Clear
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className={styles.cardLine}>
                  Click the sky to pick a patch, double-click to zoom in, type a place and press Enter, or press the dice
                  for a random place.
                  Community patches glow green, yours in cyan; zoom in for each patch.
                </p>
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
