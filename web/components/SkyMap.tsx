"use client";

// Sky map (BP 8.1, 8.2): Aladin Lite v3 over the CDS SPHEREx QR2 colour HiPS, galactic frame, Aitoff,
// full sky with the Milky Way horizontal. Ready spots as reticles; click one for a preview card.
// Owner: SERVER. Props are a contract with GAME; keep their shape.
//
// Aladin Lite API used (all checked in node_modules/aladin-lite/dist/aladin.js, version 3.8.2):
//   A.init (promise; WASM + WebGL2), A.aladin(el, options), A.HiPS(id, {url, name, errorCallback}),
//   A.catalog({name, shape: canvas, sourceSize, onClick: fn, displayLabel, labelColumn, labelColor,
//   labelFont}), A.source(ra, dec, data), A.graphicOverlay({name, lineWidth}), A.polygon(raDec,
//   {color, fill, fillColor, lineWidth}); instance: on("mouseMove"|"click"|"zoomChanged"),
//   pix2world(x, y, "icrs"), gotoRaDec, animateToRaDec(ra, dec, sec), setFoV, zoomToFoV(fov, sec),
//   increaseZoom, decreaseZoom, addCatalog, addOverlay, removeOverlay, overlay.addFootprints.
//   Options: cooFrame "galactic", projection "AIT", fov 360, mode "dark", show*Control flags (from
//   iA.DEFAULT_OPTIONS). Aladin's logo (bottom right) stays visible: its terms of use ask for that.
//
// Aladin Lite is GPL-3.0; the HiPS is ODbL (CDS). Credit both on /credits.

import Image from "next/image";
import { Minus, Plus, RotateCw, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { formatDec, formatRA } from "@/lib/coords";
import { FIELDS_BASE } from "@/lib/fields";
import { edgeUrl } from "@/lib/hipsProxy";
import type { Difficulty, FieldSummary } from "@/lib/types";
import {
  findHipsUrl,
  HIPS_ID,
  HIPS_NAME,
  IRSA_HIPS,
  IRSA_HIPS_ID,
  IRSA_HIPS_NAME,
  IRSA_SLICE_ARG,
  loadAladin,
  releaseAladin,
  type AladinCatalog,
  type AladinInstance,
  type AladinOverlay,
  type AladinSource,
  type AladinStatic,
} from "./skymap/aladin";
import { difficultyStyle, flyFovForSpot, heatColor, heatGradientCss } from "./skymap/geometry";
import { difficultyColor, reticleCanvas, SpotGlyph } from "./skymap/markers";
import { loadSpotsOnce } from "./skymap/spots";

export interface SkyMapProps {
  onPlay: (slug: string) => void;
  target?: { ra: number; dec: number; fov?: number } | null;
  onPointer?: (p: { ra: number; dec: number } | null) => void;
  /** fov: the map's field of view (degrees) at the click. */
  onClickSky?: (p: { ra: number; dec: number; fov?: number }) => void;
  overlay?: { cells: { corners: [number, number][]; value: number }[]; max: number; label: string } | null;
  className?: string;
  /** Ready-spot reticles, their list and preview card (default on; /map turns them off). */
  showSpots?: boolean;
  /** Solved patches, drawn only once the view is PATCH_SHOW_FOV or closer. */
  patches?: SkyPatch[] | null;
  /** The patch the player picked: an amber square. */
  picked?: { corners: [number, number][] } | null;
  /** View centre (ICRS) and field of view, after the view settles. */
  onView?: (v: { ra: number; dec: number; fov: number }) => void;
  /** A parent that owns the spot card (/stages): a marker click calls this and the map's own list and card stay off. */
  onSpot?: (slug: string) => void;
  /** Extra word per spot slug (Solved, Tried, NEXT), added to the marker label. */
  spotMarks?: Record<string, string>;
}

/** A solved patch on the map: outline, matched known objects and players' reports. */
export interface SkyPatch {
  id: string;
  corners: [number, number][];
  objects: { ra: number; dec: number }[];
  reports: { ra: number; dec: number }[];
  mine?: boolean;
}

/** Solved patches show at this field of view (degrees) or closer. */
export const PATCH_SHOW_FOV = 3;

type MapState = "loading" | "ready" | "failed";

/** Galactic centre in ICRS: with the galactic frame this puts the Milky Way along the equator. */
const GALACTIC_CENTER: [number, number] = [266.40499, -28.93617];
const DEFAULT_FLY_FOV = 1.5;
const FLY_SECONDS = 1.6;
const NO_POINTER = "RA --h--m--.--s  Dec ---°--′--.-″";

/** HEALPix order 0 has 12 tiles: the whole sky at its coarsest. */
const FIRST_TILES = 12;
/** Hide the loading bar after this long even if tiles are still coming. */
const TILE_WAIT_MS = 12000;

const DIFFICULTY_ORDER: Difficulty[] = ["easy", "medium", "hard", "expert", "boss", "tool", "control"];

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function fovText(fov: number): string {
  if (fov >= 10) return `${fov.toFixed(0)}°`;
  if (fov >= 1) return `${fov.toFixed(1)}°`;
  return `${(fov * 60).toFixed(1)}′`;
}

const chip: CSSProperties = {
  background: "color-mix(in srgb, var(--bg-0) 82%, transparent)",
  border: "1px solid var(--line)",
  color: "var(--text)",
  fontFamily: "var(--font-mono-stack)",
  fontSize: 12,
};

export function SkyMap({
  onPlay,
  target,
  onPointer,
  onClickSky,
  overlay,
  className,
  showSpots = true,
  patches,
  picked,
  onView,
  onSpot,
  spotMarks,
}: SkyMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  const playRef = useRef<HTMLButtonElement>(null);
  const aladinRef = useRef<AladinInstance | null>(null);
  const libRef = useRef<AladinStatic | null>(null);
  const objectClickRef = useRef(false);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Latest callbacks for Aladin's listeners, which are registered once.
  const cbRef = useRef({ onPlay, onPointer, onClickSky, onView, onSpot });
  useEffect(() => {
    cbRef.current = { onPlay, onPointer, onClickSky, onView, onSpot };
  });

  const [spots, setSpots] = useState<FieldSummary[] | null>(null);
  const [spotsFailed, setSpotsFailed] = useState(false);
  const [mapState, setMapState] = useState<MapState>("loading");
  const [failReason, setFailReason] = useState("");
  const [programReady, setProgramReady] = useState(false); // Aladin Lite loaded; still waiting on CDS
  const [attempt, setAttempt] = useState(0);
  const [fromIrsa, setFromIrsa] = useState(false); // CDS down: the base layer is IRSA's SPHEREx DR1 HiPS
  const [selected, setSelected] = useState<FieldSummary | null>(null);
  const [fov, setFov] = useState(360);
  const listId = useId();
  const cardTitleId = useId();

  const spotsRef = useRef<FieldSummary[]>([]);
  useEffect(() => {
    spotsRef.current = spots ?? [];
  }, [spots]);

  // Ready spots.
  useEffect(() => {
    let live = true;
    loadSpotsOnce()
      .then((rows) => live && setSpots(rows))
      .catch(() => live && setSpotsFailed(true));
    return () => {
      live = false;
    };
  }, []);

  // Aladin Lite: load in the browser only, after checking the HiPS really answers.
  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    const ctl = new AbortController();
    let cancelled = false;
    let raf = 0;
    const fail = (why: string) => {
      if (cancelled) return;
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      aladinRef.current = null;
      // Aladin cannot be destroyed; free its WebGL contexts so the hidden map stops drawing.
      releaseAladin(el);
      setFailReason(why);
      setMapState("failed");
    };

    (async () => {
      let lib: AladinStatic;
      let url: string | null;
      try {
        const libP = loadAladin();
        void libP.then(() => !cancelled && setProgramReady(true), () => {});
        [lib, url] = await Promise.all([libP, findHipsUrl(ctl.signal)]);
      } catch (e) {
        if (ctl.signal.aborted) return;
        const msg = String(e);
        fail(
          /webgl/i.test(msg)
            ? "This browser cannot draw the sky map (it needs WebGL2)."
            : "The sky map program did not load. Check your connection.",
        );
        return;
      }
      if (cancelled) return;
      if (!url) {
        fail("The SPHEREx sky picture (CDS Strasbourg and IRSA) is not answering right now.");
        return;
      }
      try {
        const irsa = url === IRSA_HIPS;
        setFromIrsa(irsa);
        const survey = lib.HiPS(irsa ? IRSA_HIPS_ID : HIPS_ID, {
          // Tiles go through the site's edge cache (app/api/hips); the probe above used the source.
          url: edgeUrl(url, window.location.origin),
          name: irsa ? IRSA_HIPS_NAME : HIPS_NAME,
          errorCallback: () => fail(`The SPHEREx sky picture from ${irsa ? "IRSA" : "CDS (Strasbourg)"} stopped answering.`),
        });
        const a = lib.aladin(el, {
          survey,
          cooFrame: "galactic",
          projection: "AIT",
          fov: 360,
          mode: "dark",
          backgroundColor: "rgb(0, 0, 0)",
          showZoomControl: false,
          showLayersControl: false,
          showFullscreenControl: false,
          showProjectionControl: false,
          showSimbadPointerControl: false,
          showCooGridControl: false,
          showSettingsControl: false,
          showShareControl: false,
          showColorPickerControl: false,
          showContextMenu: false,
          showFrame: false,
          showFov: false,
          showCooLocation: false,
          showStatusBar: false,
          showReticle: false,
          log: false,
        });
        // IRSA's cube opens on its middle band, a blank dichroic channel (its properties file).
        // IRSA_SLICE_ARG makes Aladin fetch tile suffix _3 (0.81 um), which matches the credit label.
        // Aladin applies the slice only once the layer is attached, so set it again after that.
        if (irsa) {
          survey.setSliceNumber?.(IRSA_SLICE_ARG);
          for (const ms of [0, 300, 1500]) setTimeout(() => !cancelled && survey.setSliceNumber?.(IRSA_SLICE_ARG), ms);
        }
        a.gotoRaDec(GALACTIC_CENTER[0], GALACTIC_CENTER[1]);
        a.setFoV(360);

        let pending: { ra: number; dec: number } | null = null;
        a.on("mouseMove", (e: { x: number; y: number }) => {
          let p: { ra: number; dec: number } | null = null;
          try {
            const w = a.pix2world(e.x, e.y, "icrs");
            if (w && Number.isFinite(w[0]) && Number.isFinite(w[1])) p = { ra: w[0], dec: w[1] };
          } catch {
            p = null; // outside the projection
          }
          pending = p;
          if (!raf) {
            raf = requestAnimationFrame(() => {
              raf = 0;
              if (cancelled) return;
              if (statusRef.current) {
                statusRef.current.textContent = pending
                  ? `RA ${formatRA(pending.ra)}  Dec ${formatDec(pending.dec)}`
                  : NO_POINTER;
              }
              cbRef.current.onPointer?.(pending);
            });
          }
        });
        a.on("click", (e: { ra: number; dec: number; isDragging?: boolean }) => {
          if (cancelled) return;
          if (objectClickRef.current) {
            objectClickRef.current = false;
            return;
          }
          if (e.isDragging) return;
          setSelected(null);
          if (Number.isFinite(e.ra) && Number.isFinite(e.dec)) {
            let f: number | undefined;
            try {
              f = a.getFov()[0];
            } catch {
              f = undefined;
            }
            cbRef.current.onClickSky?.({ ra: e.ra, dec: e.dec, fov: f });
          }
        });
        // onView after the view settles (a drag or zoom fires many events).
        let viewTimer: ReturnType<typeof setTimeout> | null = null;
        const viewSoon = () => {
          if (viewTimer) clearTimeout(viewTimer);
          viewTimer = setTimeout(() => {
            if (cancelled) return;
            try {
              const [ra, dec] = a.getRaDec();
              const f = a.getFov()[0];
              if ([ra, dec, f].every(Number.isFinite)) cbRef.current.onView?.({ ra, dec, fov: f });
            } catch {
              /* view not ready */
            }
          }, 400);
        };
        a.on("zoomChanged", (f: number) => {
          if (!cancelled && Number.isFinite(f)) setFov(f);
          viewSoon();
        });
        a.on("positionChanged", viewSoon);

        aladinRef.current = a;
        libRef.current = lib;
        setMapState("ready");
      } catch (e) {
        console.error("SkyMap: Aladin Lite failed to start", e);
        fail("The sky map could not start in this browser.");
      }
    })();

    return () => {
      cancelled = true;
      ctl.abort();
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (clickTimer.current) clearTimeout(clickTimer.current);
      clickTimer.current = null;
      aladinRef.current = null;
      releaseAladin(el);
    };
  }, [attempt]);

  // Spot reticles: one catalog per difficulty, each with its own glyph, colour and word label.
  useEffect(() => {
    const a = aladinRef.current;
    const lib = libRef.current;
    if (!showSpots || mapState !== "ready" || !a || !lib || !spots?.length) return;
    const labelFont = `12px ${getComputedStyle(document.body).fontFamily}`;
    const cats: AladinCatalog[] = [];
    for (const d of DIFFICULTY_ORDER) {
      const rows = spots.filter((s) => s.difficulty === d);
      if (!rows.length) continue;
      const color = difficultyColor(d);
      const cat = lib.catalog({
        name: `Ready spots: ${difficultyStyle(d).word}`,
        shape: reticleCanvas(d, color),
        sourceSize: 28,
        color,
        displayLabel: true,
        labelColumn: "label",
        labelColor: color,
        labelFont,
        onClick: (src: AladinSource<unknown>) => {
          if (!mountedRef.current) return;
          objectClickRef.current = true;
          if (clickTimer.current) clearTimeout(clickTimer.current);
          clickTimer.current = setTimeout(() => {
            objectClickRef.current = false;
            clickTimer.current = null;
          }, 0);
          const slug = (src.data as { slug?: string } | undefined)?.slug;
          const hit = spotsRef.current.find((s) => s.slug === slug);
          if (!hit) return;
          if (cbRef.current.onSpot) cbRef.current.onSpot(hit.slug);
          else setSelected(hit);
        },
      });
      a.addCatalog(cat);
      cat.addSources(
        rows.map((s) => lib.source(s.ra, s.dec, { slug: s.slug, label: `${s.title} · ${difficultyStyle(d).word}${spotMarks?.[s.slug] ? ` · ${spotMarks[s.slug]}` : ""}` })),
      );
      cats.push(cat);
    }
    return () => {
      for (const c of cats) {
        try {
          a.removeOverlay(c);
        } catch {
          /* map already gone */
        }
      }
    };
  }, [mapState, spots, showSpots, spotMarks]);

  // Fly to the target.
  const tRa = target?.ra;
  const tDec = target?.dec;
  const tFov = target?.fov;
  const flyTo = useCallback((ra: number, dec: number, fovDeg: number) => {
    const a = aladinRef.current;
    if (!a) return;
    try {
      if (prefersReducedMotion()) {
        a.gotoRaDec(ra, dec);
        a.setFoV(fovDeg);
      } else {
        a.animateToRaDec(ra, dec, FLY_SECONDS);
        a.zoomToFoV(fovDeg, FLY_SECONDS);
      }
    } catch (e) {
      console.error("SkyMap: could not move the view", e);
    }
  }, []);
  useEffect(() => {
    if (mapState !== "ready" || tRa === undefined || tDec === undefined) return;
    if (!Number.isFinite(tRa) || !Number.isFinite(tDec)) return;
    flyTo(tRa, tDec, tFov && tFov > 0 ? tFov : DEFAULT_FLY_FOV);
  }, [mapState, tRa, tDec, tFov, flyTo]);

  // Density overlay: HEALPix cells as filled polygons on a heat scale.
  useEffect(() => {
    const a = aladinRef.current;
    const lib = libRef.current;
    if (mapState !== "ready" || !a || !lib || !overlay?.cells.length) return;
    let layer: AladinOverlay | null = null;
    try {
      layer = lib.graphicOverlay({ name: overlay.label, lineWidth: 1 });
      a.addOverlay(layer);
      layer.addFootprints(
        overlay.cells
          .filter((c) => c.corners.length >= 3)
          .map((c) =>
            lib.polygon(
              c.corners.map(([r, d]) => [r, d] as [number, number]),
              {
                color: heatColor(c.value, overlay.max, 0.9),
                fill: true,
                fillColor: heatColor(c.value, overlay.max, 0.35),
                lineWidth: 1,
              },
            ),
          ),
      );
    } catch (e) {
      console.error("SkyMap: could not draw the density layer", e);
    }
    return () => {
      if (layer) {
        try {
          a.removeOverlay(layer);
        } catch {
          /* map already gone */
        }
      }
    };
  }, [mapState, overlay]);

  // Solved patches (green outline, cyan known objects, amber reports) once zoomed in close.
  const patchesShown = fov <= PATCH_SHOW_FOV;
  useEffect(() => {
    const a = aladinRef.current;
    const lib = libRef.current;
    if (mapState !== "ready" || !a || !lib || !patchesShown || !patches?.length) return;
    const layers: (AladinOverlay | AladinCatalog)[] = [];
    try {
      const outline = lib.graphicOverlay({ name: "Solved patches", lineWidth: 2 });
      a.addOverlay(outline);
      layers.push(outline);
      outline.addFootprints(
        patches
          .filter((p) => p.corners.length >= 3)
          .map((p) =>
            lib.polygon(p.corners, {
              color: p.mine ? "#a7f3d0" : "#34d399",
              fill: true,
              fillColor: "rgba(52, 211, 153, 0.12)",
              lineWidth: 2,
            }),
          ),
      );
      const known = patches.flatMap((p) => p.objects);
      if (known.length) {
        const cat = lib.catalog({ name: "Known objects found", shape: "circle", sourceSize: 10, color: "#67e8f9" });
        a.addCatalog(cat);
        layers.push(cat);
        cat.addSources(known.map((o) => lib.source(o.ra, o.dec, {})));
      }
      const reported = patches.flatMap((p) => p.reports);
      if (reported.length) {
        const cat = lib.catalog({ name: "Players' reports", shape: "cross", sourceSize: 10, color: "#fbbf24" });
        a.addCatalog(cat);
        layers.push(cat);
        cat.addSources(reported.map((o) => lib.source(o.ra, o.dec, {})));
      }
    } catch (e) {
      console.error("SkyMap: could not draw the solved patches", e);
    }
    return () => {
      for (const layer of layers) {
        try {
          a.removeOverlay(layer);
        } catch {
          /* map already gone */
        }
      }
    };
  }, [mapState, patches, patchesShown]);

  // The picked patch: an amber square.
  useEffect(() => {
    const a = aladinRef.current;
    const lib = libRef.current;
    if (mapState !== "ready" || !a || !lib || !picked || picked.corners.length < 3) return;
    let layer: AladinOverlay | null = null;
    try {
      layer = lib.graphicOverlay({ name: "Picked patch", lineWidth: 2 });
      a.addOverlay(layer);
      layer.addFootprints([lib.polygon(picked.corners, { color: "#fbbf24", lineWidth: 2 })]);
    } catch (e) {
      console.error("SkyMap: could not draw the picked patch", e);
    }
    return () => {
      if (layer) {
        try {
          a.removeOverlay(layer);
        } catch {
          /* map already gone */
        }
      }
    };
  }, [mapState, picked]);

  // Loading bar: count HiPS tiles as the browser finishes them (Aladin has no tile event).
  // Keyed by attempt, so a retry starts from zero without a reset inside the effect.
  const [tiles, setTiles] = useState({ attempt: -1, seen: 0, timedOut: false });
  const tilesSeen = tiles.attempt === attempt ? tiles.seen : 0;
  const tilesTimedOut = tiles.attempt === attempt && tiles.timedOut;
  useEffect(() => {
    if (mapState !== "ready") return;
    const setTilesSeen = (seen: number) => setTiles((t) => ({ attempt, seen, timedOut: t.attempt === attempt && t.timedOut }));
    const setTilesTimedOut = (timedOut: boolean) =>
      setTiles((t) => ({ attempt, seen: t.attempt === attempt ? t.seen : 0, timedOut }));
    if (typeof PerformanceObserver === "undefined") {
      const t0 = setTimeout(() => setTilesTimedOut(true), 0);
      return () => clearTimeout(t0);
    }
    let seen = 0;
    const obs = new PerformanceObserver((list) => {
      // responseStatus (where the browser has it) leaves out missing tiles.
      const n = list
        .getEntries()
        .filter((e) => /Npix\d+/.test(e.name) && ((e as { responseStatus?: number }).responseStatus ?? 200) < 400).length;
      if (n) {
        seen += n;
        setTilesSeen(seen);
      }
    });
    try {
      obs.observe({ type: "resource", buffered: true });
    } catch {
      setTilesTimedOut(true);
    }
    const t = setTimeout(() => setTilesTimedOut(true), TILE_WAIT_MS);
    return () => {
      obs.disconnect();
      clearTimeout(t);
    };
  }, [mapState, attempt]);

  // Focus Play when a card opens and give focus back to whatever opened it when it closes.
  const cardOpen = selected !== null;
  useEffect(() => {
    if (!cardOpen) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    playRef.current?.focus({ preventScroll: true });
    return () => {
      if (opener && opener !== document.body && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [cardOpen]);

  const choose = (s: FieldSummary) => {
    setSelected(s);
    flyTo(s.ra, s.dec, flyFovForSpot(s));
  };

  const leave = () => {
    if (statusRef.current) statusRef.current.textContent = NO_POINTER;
    cbRef.current.onPointer?.(null);
  };

  const ready = mapState === "ready";
  const failed = mapState === "failed";
  const progress = ready
    ? tilesSeen >= FIRST_TILES || tilesTimedOut
      ? 1
      : 0.5 + (0.5 * tilesSeen) / FIRST_TILES
    : programReady
      ? 0.35
      : 0.1;
  const loadingText = ready
    ? `Drawing the sky: ${Math.min(tilesSeen, FIRST_TILES)} of ${FIRST_TILES} tiles. A coarse sky shows first, sharper tiles follow as you zoom.`
    : programReady
      ? "Finding the SPHEREx sky picture (IRSA or CDS)…"
      : "Loading the sky map program…";

  return (
    <div
      className={className}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        minHeight: 320,
        overflow: "hidden",
        background: "var(--viewport)",
        fontFamily: "var(--font-mono-stack)",
      }}
    >
      {/* Aladin draws into this div. It stays mounted so a retry can reuse it. */}
      <section
        aria-label="Sky map. Use the ready spots list to reach spots with the keyboard."
        style={{ position: "absolute", inset: 0, visibility: failed ? "hidden" : "visible" }}
      >
        <div ref={mapRef} onPointerLeave={leave} style={{ position: "absolute", inset: 0 }} />
      </section>

      {!failed && progress < 1 && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "absolute",
            left: "50%",
            transform: "translateX(-50%)",
            ...(ready ? { bottom: 16 } : { top: "45%" }),
            width: "min(420px, 80%)",
            padding: "10px 14px",
            borderRadius: 14,
            background: "color-mix(in srgb, var(--bg-0) 80%, transparent)",
            color: "var(--text-dim)",
            fontFamily: "var(--font-body-stack)",
            fontSize: 13,
            pointerEvents: "none",
          }}
        >
          <div>{loadingText}</div>
          <div
            role="progressbar"
            aria-label="Sky map loading"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            style={{ marginTop: 6, height: 6, borderRadius: 999, background: "rgba(255,255,255,.12)", overflow: "hidden" }}
          >
            <div
              style={{
                width: `${Math.round(progress * 100)}%`,
                height: "100%",
                background: "var(--accent)",
                transition: "width 300ms ease-out",
              }}
            />
          </div>
        </div>
      )}

      {failed && (
        <div
          role="alert"
          style={{ position: "absolute", inset: 0, overflow: "auto", padding: "var(--space-5) var(--space-4)" }}
        >
          <div className="panel" data-part="MAP-00 // SKY MAP OFFLINE" style={{ maxWidth: 560, margin: "0 auto" }}>
            <p style={{ marginTop: 0 }}>{failReason}</p>
            <p style={{ color: "var(--text-dim)" }}>
              The game still works. Pick a ready spot below, or type a position in the coordinate box.
            </p>
            {spots && spots.length > 0 && (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--space-2)" }}>
                {spots.map((s) => (
                  <li key={s.slug}>
                    <button
                      type="button"
                      onClick={() => onPlay(s.slug)}
                      style={{ width: "100%", display: "flex", alignItems: "center", gap: "var(--space-2)" }}
                    >
                      <SpotGlyph difficulty={s.difficulty} />
                      <span style={{ flex: 1, textAlign: "left" }}>Play {s.title}</span>
                      <span style={{ color: `var(${difficultyStyle(s.difficulty).cssVar})` }}>
                        {difficultyStyle(s.difficulty).word}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {spotsFailed && <p style={{ color: "var(--amber)" }}>The list of ready spots did not load either.</p>}
            <button
              type="button"
              onClick={() => {
                setMapState("loading");
                setAttempt((n) => n + 1);
              }}
              style={{ marginTop: "var(--space-3)", display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <RotateCw size={14} aria-hidden="true" /> Try the map again
            </button>
          </div>
        </div>
      )}

      {/* Keyboard and screen-reader route to the spots (the canvas markers are mouse-only). */}
      {showSpots && !onSpot && !failed && spots && spots.length > 0 && (
        <details
          style={{ ...chip, position: "absolute", left: 12, bottom: 40, maxWidth: 300, padding: "4px 10px" }}
        >
          <summary className="label" style={{ cursor: "pointer", fontSize: 11 }}>
            Ready spots ({spots.length})
          </summary>
          <ul id={listId} style={{ listStyle: "none", margin: "6px 0 4px", padding: 0, display: "grid", gap: 4 }}>
            {spots.map((s) => (
              <li key={s.slug}>
                <button
                  type="button"
                  onClick={() => choose(s)}
                  aria-label={`${s.title}, ${difficultyStyle(s.difficulty).word}. Show on the map`}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "4px 10px",
                    fontFamily: "var(--font-mono-stack)",
                    textTransform: "none",
                    letterSpacing: 0,
                    fontSize: 12,
                  }}
                >
                  <SpotGlyph difficulty={s.difficulty} size={16} />
                  <span style={{ flex: 1, textAlign: "left" }}>{s.title}</span>
                  <span style={{ color: "var(--text-dim)" }}>{difficultyStyle(s.difficulty).word}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Preview card. */}
      {selected && (
        <section
          aria-labelledby={cardTitleId}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setSelected(null);
            }
          }}
          className="panel"
          data-part="SPT-01 // READY SPOT"
          style={{ position: "absolute", right: 16, top: 72, width: 240, padding: "var(--space-3)" }}
        >
          <button
            type="button"
            onClick={() => setSelected(null)}
            aria-label="Close the preview"
            style={{ position: "absolute", right: 6, top: 6, padding: 4, lineHeight: 0 }}
          >
            <X size={14} aria-hidden="true" />
          </button>
          <Image
            src={`${FIELDS_BASE}/${selected.thumbnail}`}
            alt={`First frame of ${selected.title}`}
            width={200}
            height={200}
            unoptimized
            className="science-viewport"
            style={{ display: "block", width: "100%", height: "auto", aspectRatio: "1", objectFit: "contain" }}
          />
          <h3 id={cardTitleId} style={{ fontSize: 13, margin: "var(--space-2) 0 4px" }}>
            {selected.title}
          </h3>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-dim)" }}>
            <SpotGlyph difficulty={selected.difficulty} size={16} />
            <span style={{ color: `var(${difficultyStyle(selected.difficulty).cssVar})` }}>
              {difficultyStyle(selected.difficulty).word}
            </span>
            <span>· {fovText(selected.fov_deg)} wide</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 4 }}>
            {formatRA(selected.ra)} {formatDec(selected.dec)}
          </div>
          <button
            ref={playRef}
            type="button"
            onClick={() => onPlay(selected.slug)}
            style={{
              marginTop: "var(--space-3)",
              width: "100%",
              color: "var(--bg-0)",
              background: "var(--cyan)",
              borderColor: "var(--cyan)",
            }}
          >
            Play
          </button>
        </section>
      )}

      {/* Density legend. */}
      {ready && overlay && overlay.cells.length > 0 && (
        <div
          style={{ ...chip, position: "absolute", left: "50%", bottom: 12, transform: "translateX(-50%)", padding: "6px 10px" }}
        >
          <div style={{ marginBottom: 4 }}>{overlay.label}</div>
          <div aria-hidden="true" style={{ width: 160, height: 8, background: heatGradientCss() }} />
          <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-dim)" }}>
            <span>0</span>
            <span>{overlay.max}</span>
          </div>
        </div>
      )}

      {/* Pointer status line, bottom-left. */}
      {!failed && (
        <div style={{ ...chip, position: "absolute", left: 12, bottom: 10, padding: "3px 8px", whiteSpace: "pre" }}>
          <span ref={statusRef}>{NO_POINTER}</span>
          <span style={{ color: "var(--text-dim)" }}>{`  J2000  FOV ${fovText(fov)}`}</span>
        </div>
      )}

      {/* Zoom, bottom-right, above Aladin's logo. */}
      {ready && (
        <div style={{ position: "absolute", right: 12, bottom: 64, display: "grid", gap: 6 }}>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => aladinRef.current?.increaseZoom()}
            style={{ padding: 6, lineHeight: 0 }}
          >
            <Plus size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => aladinRef.current?.decreaseZoom()}
            style={{ padding: 6, lineHeight: 0 }}
          >
            <Minus size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Data credit (ODbL asks for attribution). Aladin's own logo sits at the far bottom-right. */}
      {!failed && <div
        style={{
          position: "absolute",
          right: 100,
          bottom: 10,
          fontSize: 11,
          color: "var(--text-dim)",
          pointerEvents: "none",
        }}
      >
        {fromIrsa ? "SPHEREx DR1 HiPS (0.81 µm): IRSA" : "SPHEREx QR2 HiPS: CDS"}
      </div>}
    </div>
  );
}

export default SkyMap;
