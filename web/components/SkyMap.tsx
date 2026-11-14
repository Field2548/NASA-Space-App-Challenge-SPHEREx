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
import type { Difficulty, FieldSummary } from "@/lib/types";
import {
  findHipsUrl,
  HIPS_ID,
  HIPS_NAME,
  loadAladin,
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
  onClickSky?: (p: { ra: number; dec: number }) => void;
  overlay?: { cells: { corners: [number, number][]; value: number }[]; max: number; label: string } | null;
  className?: string;
}

type MapState = "loading" | "ready" | "failed";

/** Galactic centre in ICRS: with the galactic frame this puts the Milky Way along the equator. */
const GALACTIC_CENTER: [number, number] = [266.40499, -28.93617];
const DEFAULT_FLY_FOV = 1.5;
const FLY_SECONDS = 1.6;
const NO_POINTER = "RA --h--m--.--s  Dec ---°--′--.-″";

const DIFFICULTY_ORDER: Difficulty[] = ["easy", "medium", "hard", "expert", "boss", "control"];

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

export function SkyMap({ onPlay, target, onPointer, onClickSky, overlay, className }: SkyMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  const playRef = useRef<HTMLButtonElement>(null);
  const aladinRef = useRef<AladinInstance | null>(null);
  const libRef = useRef<AladinStatic | null>(null);
  const objectClickRef = useRef(false);

  // Latest callbacks for Aladin's listeners, which are registered once.
  const cbRef = useRef({ onPlay, onPointer, onClickSky });
  useEffect(() => {
    cbRef.current = { onPlay, onPointer, onClickSky };
  });

  const [spots, setSpots] = useState<FieldSummary[] | null>(null);
  const [spotsFailed, setSpotsFailed] = useState(false);
  const [mapState, setMapState] = useState<MapState>("loading");
  const [failReason, setFailReason] = useState("");
  const [attempt, setAttempt] = useState(0);
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
    const fail = (why: string) => {
      if (cancelled) return;
      cancelled = true;
      aladinRef.current = null;
      el.replaceChildren();
      setFailReason(why);
      setMapState("failed");
    };

    (async () => {
      let lib: AladinStatic;
      let url: string | null;
      try {
        [lib, url] = await Promise.all([loadAladin(), findHipsUrl(ctl.signal)]);
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
        fail("The SPHEREx sky picture from CDS (Strasbourg) is not answering right now.");
        return;
      }
      try {
        const survey = lib.HiPS(HIPS_ID, {
          url,
          name: HIPS_NAME,
          errorCallback: () => fail("The SPHEREx sky picture from CDS (Strasbourg) stopped answering."),
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
        a.gotoRaDec(GALACTIC_CENTER[0], GALACTIC_CENTER[1]);
        a.setFoV(360);

        let raf = 0;
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
          if (objectClickRef.current) {
            objectClickRef.current = false;
            return;
          }
          if (e.isDragging) return;
          setSelected(null);
          if (Number.isFinite(e.ra) && Number.isFinite(e.dec)) cbRef.current.onClickSky?.({ ra: e.ra, dec: e.dec });
        });
        a.on("zoomChanged", (f: number) => {
          if (Number.isFinite(f)) setFov(f);
        });

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
      aladinRef.current = null;
      el.replaceChildren();
    };
  }, [attempt]);

  // Spot reticles: one catalog per difficulty, each with its own glyph, colour and word label.
  useEffect(() => {
    const a = aladinRef.current;
    const lib = libRef.current;
    if (mapState !== "ready" || !a || !lib || !spots?.length) return;
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
          objectClickRef.current = true;
          setTimeout(() => (objectClickRef.current = false), 0);
          const slug = (src.data as { slug?: string } | undefined)?.slug;
          const hit = spotsRef.current.find((s) => s.slug === slug);
          if (hit) setSelected(hit);
        },
      });
      a.addCatalog(cat);
      cat.addSources(
        rows.map((s) => lib.source(s.ra, s.dec, { slug: s.slug, label: `${s.title} · ${difficultyStyle(d).word}` })),
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
  }, [mapState, spots]);

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

  // Focus Play when a card opens; Esc closes it.
  useEffect(() => {
    if (!selected) return;
    playRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

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
      <div
        ref={mapRef}
        onPointerLeave={leave}
        aria-label="Sky map. Use the ready spots list to reach spots with the keyboard."
        role="application"
        style={{ position: "absolute", inset: 0, visibility: failed ? "hidden" : "visible" }}
      />

      {mapState === "loading" && (
        <div
          role="status"
          style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "var(--text-dim)" }}
        >
          <span>[####------] loading the SPHEREx sky</span>
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
      {!failed && spots && spots.length > 0 && (
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
        SPHEREx QR2 HiPS: CDS
      </div>}
    </div>
  );
}

export default SkyMap;
