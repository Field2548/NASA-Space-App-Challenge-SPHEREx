"use client";

// TEMPORARY demo host for SkyMap + CoordinateBox, owned by SERVER. Used by /skymap-demo only,
// so the two components can be seen and tested without touching GAME's pages. Delete once GAME
// mounts them in the real layout.

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CoordinateBox } from "../CoordinateBox";
import { SkyMap } from "../SkyMap";
import { cellCorners } from "@/lib/healpix";
import type { FieldSummary } from "@/lib/types";
import { flyFovForSpot, spotCovering } from "./geometry";
import { loadSpotsOnce } from "./spots";

export function SkyMapDemo() {
  const router = useRouter();
  const [spots, setSpots] = useState<FieldSummary[] | undefined>(undefined);
  const [target, setTarget] = useState<{ ra: number; dec: number; fov?: number } | null>(null);
  const [note, setNote] = useState("");
  const [showPattern, setShowPattern] = useState(false);

  // Test pattern for the density-layer code path. NOT data: the value of each HEALPix order-3 cell
  // is just its own index, so the heat scale and legend can be checked by eye.
  const pattern = useMemo(
    () => ({
      cells: Array.from({ length: 768 }, (_, i) => ({ corners: cellCorners(i, 3), value: i })),
      max: 767,
      label: "Test pattern (not data): cell index",
    }),
    [],
  );

  useEffect(() => {
    let live = true;
    loadSpotsOnce()
      .then((rows) => live && setSpots(rows))
      .catch(() => live && setSpots([]));
    return () => {
      live = false;
    };
  }, []);

  const play = (slug: string) => router.push(`/play?spot=${encodeURIComponent(slug)}`);

  return (
    <div style={{ position: "relative", height: "calc(100vh - 120px)", minHeight: 480, border: "1px solid var(--line)" }}>
      <SkyMap
        onPlay={play}
        target={target}
        overlay={showPattern ? pattern : null}
        onClickSky={(p) => setNote(`Clicked RA ${p.ra.toFixed(4)} Dec ${p.dec.toFixed(4)}`)}
      />
      <div style={{ position: "absolute", left: 12, top: 12 }}>
        <CoordinateBox
          spots={spots}
          onGo={({ ra, dec, label }) => {
            const s = spotCovering(ra, dec, spots ?? []);
            setTarget({ ra, dec, fov: s ? flyFovForSpot(s) : 1 });
            setNote(`Flying to ${label}`);
          }}
          onPlay={play}
          onQuickLook={(p) => setNote(`Quick look requested at ${p.ra.toFixed(4)} ${p.dec.toFixed(4)} (not built here)`)}
          onRequest={(p) => setNote(`Full processing requested at ${p.ra.toFixed(4)} ${p.dec.toFixed(4)} (not built here)`)}
        />
      </div>
      <label style={{ position: "absolute", right: 0, top: -36, fontSize: 12, color: "var(--text-dim)" }}>
        <input type="checkbox" checked={showPattern} onChange={(e) => setShowPattern(e.target.checked)} /> Density
        layer test pattern
      </label>
      <p
        data-testid="demo-note"
        aria-live="polite"
        style={{ position: "absolute", left: 12, top: -36, margin: 0, color: "var(--text-dim)", fontSize: 12 }}
      >
        {note}
      </p>
    </div>
  );
}
