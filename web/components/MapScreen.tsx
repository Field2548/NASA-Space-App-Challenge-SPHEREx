"use client";
// /map (BP 8.1, 8.2): SERVER's SkyMap with the CoordinateBox over it. Picking a ready spot, on the
// map, in the coordinate box or in the map's offline list, goes to /play?spot=<slug>. When the
// HiPS or Aladin Lite fails, SkyMap shows its own list of ready spots, so the route still works.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FieldSummary } from "@/lib/types";
import { CoordinateBox } from "./CoordinateBox";
import styles from "./MapScreen.module.css";
import QuickLook from "./QuickLook";
import { SkyMap } from "./SkyMap";
import { flyFovForSpot, spotCovering } from "./skymap/geometry";
import { loadSpotsOnce } from "./skymap/spots";

/** Field of view (degrees) at or under which a click on the sky picks that patch. */
export const PICK_FOV = 3;

export const playHref =(slug: string) => `/play?spot=${encodeURIComponent(slug)}`;

export default function MapScreen() {
  const router = useRouter();
  const [spots, setSpots] = useState<FieldSummary[] | undefined>(undefined);
  const [target, setTarget] = useState<{ ra: number; dec: number; fov?: number } | null>(null);
  const [quick, setQuick] = useState<{ ra: number; dec: number } | null>(null);

  useEffect(() => {
    let live = true;
    loadSpotsOnce()
      .then((rows) => live && setSpots(rows))
      .catch(() => live && setSpots([]));
    return () => {
      live = false;
    };
  }, []);

  const play = (slug: string) => router.push(playHref(slug));

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
          onClickSky={({ ra, dec, fov }) => {
            // Pick a patch: a wide view zooms in on the click; a close view opens Quick look there.
            if (fov !== undefined && fov > PICK_FOV) setTarget({ ra, dec, fov: PICK_FOV / 2 });
            else setQuick({ ra, dec });
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
            onQuickLook={(p) => setQuick(p)}
          />
          {quick && <QuickLook ra={quick.ra} dec={quick.dec} onClose={() => setQuick(null)} />}
        </div>
      </main>
    </div>
  );
}
