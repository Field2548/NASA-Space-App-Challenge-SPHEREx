"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { formatDec, formatRA } from "@/lib/coords";
import { eclipticLatitude, lightCurveAt, toPlainType } from "@/lib/inspect";
import { pixelToSky } from "@/lib/wcs";
import { distanceLines, galactic, placePopup, safeHttpsUrl, type InfoExplore, type SourceStatus } from "@/lib/inspectPopup";
import type { Field } from "@/lib/types";

const LOCKED_TEXT = "[LOCKED] Names and distances unlock after you submit.";
const CAVEAT_TEXT = "Age and exact chemical amounts can't be measured from this data.";
const SOURCE_NAME = { simbad: "SIMBAD", gaia: "Gaia", jpl: "JPL Horizons" } as const;

const headingStyle = {
  fontFamily: "var(--font-display-stack)",
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--cyan)",
  margin: "0 0 var(--space-2)",
} as const;

const dimStyle = { color: "var(--text-dim)", fontSize: 13 } as const;
const listStyle = { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--space-2)" } as const;

function subscribeResize(cb: () => void) {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
}

/** Viewport size, kept in sync with resizes. The server snapshot is a fallback; the panel mounts on click. */
function useViewport(): { w: number; h: number } {
  const w = useSyncExternalStore(subscribeResize, () => window.innerWidth, () => 1024);
  const h = useSyncExternalStore(subscribeResize, () => window.innerHeight, () => 768);
  return { w, h };
}

/** A source that did not answer gets a plain sentence; null when it did. */
function sourceProblem(status: SourceStatus | undefined, name: string): string | null {
  if (status === "error" || status === "timeout") return `${name} did not answer.`;
  if (status === "skipped") return `${name} was not checked for this spot.`;
  return null;
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} style={{ padding: "var(--space-3)", borderTop: "1px solid var(--line)" }}>
      <h3 id={id} style={headingStyle}>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Source({ children }: { children: string }) {
  return <span style={dimStyle}> · Source: {children}</span>;
}

export interface InspectPopupProps {
  field: Field;
  frames?: Float32Array[];
  x: number;
  y: number;
  click: { x: number; y: number };
  mode: "round" | "explore";
  onClose: () => void;
  spectrumSlot?: ReactNode;
  lightCurveSlot?: ReactNode;
}

export function InspectPopup({ field, frames, x, y, click, mode, onClose, spectrumSlot, lightCurveSlot }: InspectPopupProps) {
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const hintId = `${baseId}-hint`;
  const px = Math.round(x);
  const py = Math.round(y);
  const title = `INSPECT // px ${px},${py}`;

  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerX: number; pointerY: number; left: number; top: number } | null>(null);
  const vp = useViewport();
  const [size, setSize] = useState({ w: 380, h: 480 });
  const [moved, setMoved] = useState<{ left: number; top: number; key: string } | null>(null);

  // Position: beside the click, or where the user dragged it (a drag is kept only for the same viewport and click).
  const placeKey = `${vp.w}x${vp.h}@${click.x},${click.y}`;
  const base = placePopup(click, size, vp);
  const pos = moved && moved.key === placeKey ? moved : base;

  const moveTo = (left: number, top: number) => {
    setMoved({
      left: Math.max(0, Math.min(left, vp.w - size.w)),
      top: Math.max(0, Math.min(top, vp.h - size.h)),
      key: placeKey,
    });
  };

  // Measure the panel. The observer also fires once when the panel is first observed.
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Focus moves into the panel when it opens.
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  // Esc closes.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Catalog facts (sections D, E, G). The result is tagged with its request key, so a stale
  // response never shows for a new pixel, and no state is set synchronously inside the effect.
  const reqKey = `${field.slug}|${px}|${py}|${mode}`;
  const [result, setResult] = useState<{ key: string; data: InfoExplore | null } | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    const url = `/api/info?spot=${encodeURIComponent(field.slug)}&x=${px}&y=${py}&mode=${mode}`;
    fetch(url, { credentials: "same-origin", signal: ctl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const body: unknown = await r.json();
        if (typeof body !== "object" || body === null) throw new Error("bad shape");
        return body as InfoExplore;
      })
      .then((data) => {
        if (!ctl.signal.aborted) setResult({ key: reqKey, data });
      })
      .catch(() => {
        if (!ctl.signal.aborted) setResult({ key: reqKey, data: null });
      });
    return () => ctl.abort();
  }, [field.slug, px, py, mode, reqKey]);

  const current = result && result.key === reqKey ? result : null;
  const info = current?.data ?? null;
  const failed = current !== null && info === null;
  const locked = info?.locked === true;
  // Every link comes from API data: only https:// addresses become links, anything else is dropped.
  const safeLinks = (info?.links ?? []).flatMap((l) => {
    const href = safeHttpsUrl(l.url);
    return href ? [{ label: l.label, href }] : [];
  });

  // Section A: where.
  const [ra, dec] = pixelToSky(field.wcs, field.size[1], x, y);
  const gal = galactic(ra, dec);
  const beta = eclipticLatitude(ra, dec);

  // Section B: light curve from the frames.
  const lc = useMemo(
    () => (frames && frames.length ? lightCurveAt(frames, x, y, field.size[0]) : null),
    [frames, x, y, field.size],
  );

  const onTitleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 50 : 10;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = delta[e.key];
    if (!d) return;
    e.preventDefault();
    moveTo(pos.left + d[0], pos.top + d[1]);
  };

  const onTitleDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { pointerX: e.clientX, pointerY: e.clientY, left: pos.left, top: pos.top };
  };
  const onTitleMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    moveTo(d.left + e.clientX - d.pointerX, d.top + e.clientY - d.pointerY);
  };
  const onTitleUp = (e: PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const sid = (k: string) => `${baseId}-${k}`;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={title}
      aria-modal="false"
      aria-labelledby={titleId}
      tabIndex={-1}
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        zIndex: 50,
        width: "min(380px, calc(100vw - 32px))",
        maxHeight: "min(80vh, 640px)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "var(--bg-1)",
        color: "var(--text)",
        border: "1px solid var(--line)",
        fontFamily: "var(--font-mono-stack)",
        fontSize: 14,
        lineHeight: 1.5,
      }}
    >
      <div
        tabIndex={0}
        aria-describedby={hintId}
        title="drag or arrow keys"
        onPointerDown={onTitleDown}
        onPointerMove={onTitleMove}
        onPointerUp={onTitleUp}
        onPointerCancel={onTitleUp}
        onKeyDown={onTitleKey}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-2)",
          padding: "var(--space-2) var(--space-3)",
          borderBottom: "1px solid var(--line)",
          cursor: "grab",
          touchAction: "none",
          flexShrink: 0,
          background: "var(--bg-1)",
        }}
      >
        <h2
          id={titleId}
          style={{
            ...headingStyle,
            margin: 0,
            color: "var(--text)",
            minWidth: 0,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {title}
        </h2>
        <span id={hintId} className="sr-only">
          drag or arrow keys
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexShrink: 0 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              color: "var(--cyan)",
              border: "1px solid var(--cyan)",
              borderRadius: "var(--radius-pill)",
              padding: "var(--space-1) var(--space-2)",
              cursor: "pointer",
              fontFamily: "var(--font-display-stack)",
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Close
          </button>
        </span>
      </div>

      <div tabIndex={0} aria-label="Inspect sections" style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}>
      <Section id={sid("a")} title="A. Where">
        <ul style={listStyle}>
          <li>
            RA {formatRA(ra)}, Dec {formatDec(dec)}
          </li>
          <li style={dimStyle}>
            {ra.toFixed(5)}°, {dec.toFixed(5)}°
          </li>
          <li>
            Galactic l {gal.l.toFixed(2)}°, b {gal.b.toFixed(2)}°
          </li>
          <li>
            Ecliptic latitude β {beta.toFixed(2)}°
            {Math.abs(beta) < 10 ? (
              <div style={{ color: "var(--amber)" }}>Near the ecliptic: asteroids are common here.</div>
            ) : null}
          </li>
        </ul>
      </Section>

      <Section id={sid("b")} title="B. Over time">
        {lightCurveSlot ? (
          lightCurveSlot
        ) : !lc ? (
          <p style={{ margin: 0 }}>No frames loaded.</p>
        ) : (
          <>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ color: "var(--text-dim)", textAlign: "left" }}>
                  <th scope="col">Frame</th>
                  <th scope="col">Date (UTC)</th>
                  <th scope="col">Detectors</th>
                  <th scope="col" style={{ textAlign: "right" }}>
                    S/N
                  </th>
                </tr>
              </thead>
              <tbody>
                {lc.snr.map((v, k) => {
                  const meta = field.frames[k];
                  return (
                    <tr key={k}>
                      <td>{meta?.i ?? k + 1}</td>
                      <td>{meta?.utc ?? "unknown"}</td>
                      <td>{meta?.detectors?.join(", ") ?? "unknown"}</td>
                      <td style={{ textAlign: "right" }}>{Number.isFinite(v) ? v.toFixed(1) : "no data"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p style={{ ...dimStyle, margin: "var(--space-2) 0 0" }}>
              {lc.verdict === "faint" && "Too faint to tell: no frame reaches S/N 5."}
              {lc.verdict === "changed" && `Changed in frame ${lc.frame}, ${(lc.sigma ?? 0).toFixed(1)} σ from the other frames.`}
              {lc.verdict === "steady" && "Steady across frames."}
            </p>
            <p style={{ ...dimStyle, margin: "var(--space-1) 0 0" }}>S/N is the brightest of the 3 × 3 pixels around this one.</p>
          </>
        )}
      </Section>

      <Section id={sid("c")} title="C. Spectrum">
        {spectrumSlot ?? <p style={{ margin: 0 }}>No spectrum for this spot yet.</p>}
      </Section>

      <Section id={sid("d")} title="D. What is it?">
        {locked ? (
          <p style={{ margin: 0, color: "var(--amber)" }}>{LOCKED_TEXT}</p>
        ) : !current ? (
          <p style={{ margin: 0, ...dimStyle }}>Loading catalog facts…</p>
        ) : failed ? (
          <p style={{ margin: 0 }}>Could not load catalog facts.</p>
        ) : info ? (
          <DetailsD info={info} />
        ) : null}
      </Section>

      <Section id={sid("e")} title="E. How far?">
        {locked ? (
          <p style={{ margin: 0, color: "var(--amber)" }}>{LOCKED_TEXT}</p>
        ) : !current ? (
          <p style={{ margin: 0, ...dimStyle }}>Loading catalog facts…</p>
        ) : failed ? (
          <p style={{ margin: 0 }}>Could not load catalog facts.</p>
        ) : info ? (
          <DistancesE info={info} />
        ) : null}
      </Section>

      <Section id={sid("f")} title="F. Can't tell from here">
        <p style={{ margin: 0 }}>{CAVEAT_TEXT}</p>
      </Section>

      <Section id={sid("g")} title="G. Links">
        {locked ? (
          <p style={{ margin: 0, color: "var(--amber)" }}>{LOCKED_TEXT}</p>
        ) : !current ? (
          <p style={{ margin: 0, ...dimStyle }}>Loading catalog facts…</p>
        ) : failed ? (
          <p style={{ margin: 0 }}>Could not load catalog facts.</p>
        ) : safeLinks.length ? (
          <ul style={listStyle}>
            {safeLinks.map((l) => (
              <li key={l.href}>
                <a href={l.href} target="_blank" rel="noopener noreferrer" style={{ color: "var(--cyan)" }}>
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ margin: 0, ...dimStyle }}>No links for this spot.</p>
        )}
      </Section>
      </div>
    </div>
  );
}

function DetailsD({ info }: { info: InfoExplore }) {
  const simbadProblem = sourceProblem(info.sources?.simbad, SOURCE_NAME.simbad);
  const gaiaProblem = sourceProblem(info.sources?.gaia, SOURCE_NAME.gaia);
  const jplProblem = sourceProblem(info.sources?.jpl, SOURCE_NAME.jpl);
  const g = info.gaia;
  const plx = g?.plx;
  const err =
    g && typeof plx === "number" && typeof g.plx_over_err === "number" && g.plx_over_err > 0 ? plx / g.plx_over_err : null;

  return (
    <div style={{ display: "grid", gap: "var(--space-3)" }}>
      <div>
        <h4 style={{ margin: "0 0 var(--space-1)", fontSize: 13 }}>SIMBAD objects within 9″</h4>
        {simbadProblem ? (
          <p style={{ margin: 0 }}>{simbadProblem}</p>
        ) : !info.simbad?.length ? (
          <p style={{ margin: 0, ...dimStyle }}>None.</p>
        ) : (
          <ul style={listStyle}>
            {info.simbad.map((s) => (
              <li key={`${s.name}-${s.otype}`}>
                {s.name}: {toPlainType(s.otype)}
                {s.sp_type ? `, spectral type ${s.sp_type}` : ""}
                {typeof s.sep_arcsec === "number" ? ` (${s.sep_arcsec.toFixed(1)}″ away)` : ""}
                <Source>SIMBAD</Source>
                {safeHttpsUrl(s.url) ? (
                  <>
                    {" "}
                    <a href={safeHttpsUrl(s.url) as string} target="_blank" rel="noopener noreferrer" style={{ color: "var(--cyan)" }}>
                      SIMBAD page
                    </a>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h4 style={{ margin: "0 0 var(--space-1)", fontSize: 13 }}>Gaia DR3 source within 6″</h4>
        {gaiaProblem ? (
          <p style={{ margin: 0 }}>{gaiaProblem}</p>
        ) : !g ? (
          <p style={{ margin: 0, ...dimStyle }}>None.</p>
        ) : (
          <ul style={listStyle}>
            {g.id ? <li>{g.id}</li> : null}
            {typeof g.g_mag === "number" ? (
              <li>
                G magnitude {g.g_mag.toFixed(2)}
                <Source>Gaia DR3</Source>
              </li>
            ) : null}
            {typeof plx === "number" ? (
              <li>
                Parallax {plx.toFixed(2)} mas{err !== null ? ` ± ${err.toFixed(2)} mas` : ""}
                <Source>Gaia DR3</Source>
              </li>
            ) : null}
            {typeof g.pmra === "number" && typeof g.pmdec === "number" ? (
              <li>
                Proper motion RA {g.pmra.toFixed(2)}, Dec {g.pmdec.toFixed(2)} mas/yr
                <Source>Gaia DR3</Source>
              </li>
            ) : null}
          </ul>
        )}
      </div>

      <div>
        <h4 style={{ margin: "0 0 var(--space-1)", fontSize: 13 }}>Known asteroids and comets nearby</h4>
        {jplProblem ? (
          <p style={{ margin: 0 }}>{jplProblem}</p>
        ) : !info.solar_system?.length ? (
          <p style={{ margin: 0, ...dimStyle }}>None within 2 px at any frame time.</p>
        ) : (
          <ul style={listStyle}>
            {info.solar_system.map((o, k) => (
              <li key={`${o.name}-${k}`}>
                {o.name}
                {typeof o.frame === "number" ? `, frame ${o.frame}` : ""}
                {typeof o.sep_px === "number" ? `, ${o.sep_px.toFixed(1)} px away` : ""}
                <Source>{o.source ?? "JPL Horizons"}</Source>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function DistancesE({ info }: { info: InfoExplore }) {
  const lines = distanceLines(info);
  return (
    <ul style={listStyle}>
      {lines.map((l, k) => (
        <li key={k}>
          {l.text}
          <Source>{l.source}</Source>
        </li>
      ))}
    </ul>
  );
}
