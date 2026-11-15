"use client";

// Coordinate box (BP 8.3, wireframe item 7). Owner: SERVER.
// Decimal degrees and sexagesimal are read locally (GAME's parseCoordinates); names go to
// GET /api/resolve?name= (CDS Sesame). Enter calls onGo. If a ready spot's own picture contains the
// position, it offers Play; otherwise "Quick look (live)" and "Request full processing" (callbacks only).

import { Dices } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { formatDec, formatRA, parseCoordinates } from "@/lib/coords";
import type { ApiError, FieldSummary } from "@/lib/types";
import { difficultyStyle, spotCovering } from "./skymap/geometry";
import { SpotGlyph } from "./skymap/markers";
import { loadSpotsOnce } from "./skymap/spots";

export interface CoordinateBoxProps {
  onGo: (p: { ra: number; dec: number; label: string; source?: "typed" | "resolved" | "dice" }) => void;
  onPlay: (slug: string) => void;
  onQuickLook?: (p: { ra: number; dec: number }) => void;
  /** Text of the onQuickLook button (default "Quick look (live)"). */
  quickLookLabel?: string;
  onRequest?: (p: { ra: number; dec: number }) => void;
  /** Ready spots; loaded from fields/index.json when not given. */
  spots?: FieldSummary[];
  className?: string;
}

type Result =
  | { kind: "idle" }
  | { kind: "busy"; name: string }
  | { kind: "error"; message: string }
  | { kind: "ok"; ra: number; dec: number; label: string; source: "typed" | "resolved" | "dice" };

type ResolveOk = { name: string; ra: number; dec: number };

async function resolveName(name: string, signal: AbortSignal): Promise<ResolveOk> {
  let res: Response;
  try {
    res = await fetch(`/api/resolve?name=${encodeURIComponent(name)}`, { signal });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new Error("Could not reach the name service. Check your connection, or type coordinates instead.");
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const msg = (body as ApiError | null)?.error?.message;
    throw new Error(msg || `The name lookup failed (HTTP ${res.status}). Try coordinates instead.`);
  }
  const ok = body as Partial<ResolveOk> | null;
  if (!ok || typeof ok.ra !== "number" || typeof ok.dec !== "number") {
    throw new Error("The name service gave an answer we could not read. Try coordinates instead.");
  }
  return { name: ok.name ?? name, ra: ok.ra, dec: ok.dec };
}

const understood = (ra: number, dec: number) => `RA ${formatRA(ra)}  Dec ${formatDec(dec)}`;

export function CoordinateBox({ onGo, onPlay, onQuickLook, quickLookLabel, onRequest, spots, className }: CoordinateBoxProps) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<Result>({ kind: "idle" });
  const [loaded, setLoaded] = useState<FieldSummary[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputId = useId();
  const hintId = useId();
  const outId = useId();

  useEffect(() => {
    if (spots) return;
    let live = true;
    loadSpotsOnce()
      .then((rows) => live && setLoaded(rows))
      .catch(() => live && setLoaded([]));
    return () => {
      live = false;
    };
  }, [spots]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const ready = spots ?? loaded ?? [];

  // Live preview of what a typed coordinate means (names are only looked up on Enter).
  const preview = (() => {
    if (!text.trim() || result.kind === "busy") return null;
    const p = parseCoordinates(text);
    return "ra" in p ? understood(p.ra, p.dec) : null;
  })();

  const go = (ra: number, dec: number, label: string, source: "typed" | "resolved" | "dice") => {
    setResult({ kind: "ok", ra, dec, label, source });
    onGo({ ra, dec, label, source });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    abortRef.current?.abort();
    const p = parseCoordinates(text);
    if ("error" in p) {
      setResult({ kind: "error", message: p.error });
      return;
    }
    if ("ra" in p) {
      go(p.ra, p.dec, understood(p.ra, p.dec), "typed");
      return;
    }
    const ctl = new AbortController();
    abortRef.current = ctl;
    setResult({ kind: "busy", name: p.name });
    try {
      const r = await resolveName(p.name, ctl.signal);
      if (ctl.signal.aborted) return;
      go(r.ra, r.dec, r.name, "resolved");
    } catch (err) {
      if (ctl.signal.aborted) return;
      setResult({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  // A random place anywhere on the sky (uniform on the sphere), not only the ready spots.
  const dice = () => {
    abortRef.current?.abort();
    const ra = Math.random() * 360;
    const dec = (Math.asin(2 * Math.random() - 1) * 180) / Math.PI;
    setText(`${ra.toFixed(4)} ${dec.toFixed(4)}`);
    go(ra, dec, understood(ra, dec), "dice");
  };

  const at = result.kind === "ok" ? result : null;
  const covering = at ? spotCovering(at.ra, at.dec, ready) : null;

  return (
    <div
      className={className}
      style={{
        width: 360,
        maxWidth: "100%",
        background: "color-mix(in srgb, var(--bg-1) 92%, transparent)",
        border: "1px solid var(--line)",
        padding: "var(--space-2)",
        fontFamily: "var(--font-mono-stack)",
        fontSize: 13,
      }}
    >
      <form onSubmit={submit} role="search" style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
        <label htmlFor={inputId} className="sr-only">
          Sky position or object name
        </label>
        <span aria-hidden="true" style={{ color: "var(--cyan)" }}>
          &gt;
        </span>
        <input
          id={inputId}
          type="text"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            // A new entry replaces the last answer; a pending name lookup is dropped.
            abortRef.current?.abort();
            if (result.kind !== "idle") setResult({ kind: "idle" });
          }}
          placeholder="133.795 -7.245 or M101"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
          aria-describedby={`${hintId} ${outId}`}
          aria-invalid={result.kind === "error"}
          style={{
            flex: 1,
            minWidth: 0,
            background: "transparent",
            border: "none",
            borderBottom: "1px solid var(--line)",
            color: "var(--text)",
            caretColor: "var(--cyan)",
            font: "inherit",
            padding: "4px 2px",
            outlineOffset: 2,
          }}
        />
        <button
          type="button"
          onClick={dice}
          aria-label="Jump to a random place on the sky"
          title="Random place"
          style={{ padding: 6, lineHeight: 0 }}
        >
          <Dices size={16} aria-hidden="true" />
        </button>
      </form>
      <span id={hintId} className="sr-only">
        Type decimal degrees, hours-minutes-seconds, or a name, then press Enter.
      </span>

      <div id={outId} aria-live="polite" style={{ marginTop: 6, minHeight: "1.5em" }}>
        {result.kind === "busy" && <span style={{ color: "var(--text-dim)" }}>Looking up “{result.name}”…</span>}
        {result.kind === "error" && (
          <span role="alert" style={{ color: "var(--amber)" }}>
            {result.message}
          </span>
        )}
        {result.kind !== "busy" && result.kind !== "error" && preview && !at && (
          <span style={{ color: "var(--text-dim)" }}>{preview}</span>
        )}
        {at && (
          <div>
            {at.source !== "typed" && <div style={{ color: "var(--text)" }}>{at.label}</div>}
            <div style={{ color: "var(--text-dim)" }}>{understood(at.ra, at.dec)}</div>
          </div>
        )}
      </div>

      {at && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
          {covering ? (
            <button
              type="button"
              onClick={() => onPlay(covering.slug)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                color: "var(--bg-0)",
                background: "var(--cyan)",
                borderColor: "var(--cyan)",
              }}
            >
              Play {covering.title}
              <span className="sr-only">, {difficultyStyle(covering.difficulty).word}</span>
            </button>
          ) : (
            <>
              {onQuickLook && (
                <button type="button" onClick={() => onQuickLook({ ra: at.ra, dec: at.dec })}>
                  {quickLookLabel ?? "Quick look (live)"}
                </button>
              )}
              {onRequest && (
                <button type="button" onClick={() => onRequest({ ra: at.ra, dec: at.dec })}>
                  Request full processing
                </button>
              )}
            </>
          )}
          {covering && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--text-dim)" }}>
              <SpotGlyph difficulty={covering.difficulty} size={14} />
              {difficultyStyle(covering.difficulty).word}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default CoordinateBox;
