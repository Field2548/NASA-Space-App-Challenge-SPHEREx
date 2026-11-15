"use client";

// Right-panel scoreboard: "This spot" / "All time", a "Show me at top" checkbox, and a
// collapse-to-tab toggle. Fetches /api/leaderboard (contract: docs/contracts/api.md section 7).
// Never shows emails: the API sends none.

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { authHeader } from "@/lib/supabase";
import { arrangeRows, asciiEmpty, formatAccuracy, type Board } from "@/lib/scoreboard";

type Scope = "spot" | "all";

export type ScoreboardProps = {
  slug?: string | null;
  refreshKey?: number;
  defaultCollapsed?: boolean;
  className?: string;
};

const POLL_MS = 30_000;

export function Scoreboard({ slug = null, refreshKey = 0, defaultCollapsed = false, className }: ScoreboardProps) {
  const panelId = useId();
  const hasSlug = Boolean(slug);
  const [expanded, setExpanded] = useState(!defaultCollapsed);
  const [tab, setTab] = useState<Scope>(hasSlug ? "spot" : "all");
  const [pinMe, setPinMe] = useState(false);
  const [view, setView] = useState<{ key: string; board: Board } | null>(null);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);

  // "This spot" needs a slug; without one the panel shows all-time scores.
  const scope: Scope = tab === "spot" && hasSlug ? "spot" : "all";
  const viewKey = scope === "spot" ? `spot:${slug}` : "all";

  const load = useCallback(async () => {
    const id = ++seq.current;
    try {
      const headers = await authHeader();
      const url =
        scope === "spot"
          ? `/api/leaderboard?scope=spot&slug=${encodeURIComponent(slug ?? "")}`
          : "/api/leaderboard?scope=all";
      const res = await fetch(url, { headers, cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as Board;
      if (!Array.isArray(body.rows)) throw new Error("bad shape");
      if (id !== seq.current) return;
      setView({ key: viewKey, board: body });
      setFailed(false);
    } catch {
      if (id === seq.current) setFailed(true);
    }
  }, [scope, slug, viewKey]);

  // Fetch on mount, when the view changes, and on refreshKey. Each load supersedes older ones (seq).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount/change; state is set after the await
    void load();
  }, [load, refreshKey]);

  // Poll every 30 s while expanded and the page is visible.
  useEffect(() => {
    if (!expanded) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [expanded, load]);

  const current = view && view.key === viewKey ? view.board : null;
  const rows = current ? arrangeRows(current, pinMe) : [];

  const tabStyle = (active: boolean, disabled = false): CSSProperties => ({
    flex: 1,
    padding: "var(--space-1) var(--space-2)",
    fontSize: 12,
    borderRadius: 0,
    color: active ? "var(--cyan)" : "var(--text)",
    borderColor: active ? "var(--cyan)" : "var(--line)",
    opacity: disabled ? 0.45 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
  });

  const toggleStyle: CSSProperties = expanded
    ? { width: "100%", textAlign: "left", borderRadius: 0, padding: "var(--space-2)", fontSize: 12 }
    : {
        width: 36,
        minHeight: 160,
        borderRadius: 0,
        padding: "var(--space-2)",
        fontSize: 12,
        writingMode: "vertical-rl",
        transform: "rotate(180deg)",
      };

  return (
    <div
      className={className}
      style={{
        display: "flex",
        flexDirection: expanded ? "column" : "row",
        width: expanded ? 240 : 36,
        maxWidth: "100%",
        flexShrink: 0,
      }}
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={expanded ? panelId : undefined}
        title={expanded ? "click to minimize" : "click to expand"}
        onClick={() => setExpanded((e) => !e)}
        style={toggleStyle}
      >
        Scoreboard
      </button>

      {expanded && (
        <div id={panelId} className="panel" style={{ flex: 1, minWidth: 0 }}>
          <div role="group" aria-label="Scope" style={{ display: "flex", gap: "var(--space-1)" }}>
            <button
              type="button"
              aria-pressed={scope === "spot"}
              disabled={!hasSlug}
              onClick={() => setTab("spot")}
              style={tabStyle(scope === "spot", !hasSlug)}
            >
              This spot
            </button>
            <button
              type="button"
              aria-pressed={scope === "all"}
              onClick={() => setTab("all")}
              style={tabStyle(scope === "all")}
            >
              All time
            </button>
          </div>

          <div
            aria-live="polite"
            role="status"
            style={{ marginTop: "var(--space-2)", fontSize: 12, color: "var(--text-dim)" }}
          >
            {failed
              ? "Could not load scores."
              : current
                ? `Updated ${new Date(current.updated_at).toLocaleTimeString()}.`
                : "Loading scores."}
          </div>

          {current?.source === "snapshot" && (
            <p style={{ margin: "var(--space-2) 0 0", fontSize: 12, color: "var(--amber)" }}>
              Saved copy: live scores are not available right now.
            </p>
          )}

          {current?.me && (
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
                marginTop: "var(--space-2)",
                fontSize: 13,
                color: "var(--text-dim)",
              }}
            >
              <input type="checkbox" checked={pinMe} onChange={(e) => setPinMe(e.target.checked)} />
              Show me at top
            </label>
          )}

          {current && rows.length === 0 && (
            <div style={{ marginTop: "var(--space-3)" }}>
              <pre
                aria-label="No scores yet"
                style={{ margin: 0, fontSize: 12, lineHeight: 1.3, color: "var(--text-dim)", overflow: "hidden" }}
              >
                {asciiEmpty()}
              </pre>
              <p style={{ margin: "var(--space-2) 0 0", fontSize: 13, color: "var(--text-dim)" }}>No scores yet.</p>
            </div>
          )}

          {current && rows.length > 0 && (
            <table style={{ width: "100%", marginTop: "var(--space-3)", borderCollapse: "collapse", fontSize: 13 }}>
              <caption className="sr-only">{scope === "spot" ? "Scores for this spot" : "All-time scores"}</caption>
              <thead>
                <tr style={{ color: "var(--text-dim)", textAlign: "left" }}>
                  <th scope="col" style={{ padding: "var(--space-1)", fontWeight: 400 }}>Rank</th>
                  <th scope="col" style={{ padding: "var(--space-1)", fontWeight: 400 }}>Name</th>
                  <th scope="col" style={{ padding: "var(--space-1)", fontWeight: 400, textAlign: "right" }}>Score</th>
                  <th scope="col" style={{ padding: "var(--space-1)", fontWeight: 400, textAlign: "right" }}>Acc.</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={`${r.rank}-${r.name}-${r.is_bot ? "bot" : "p"}`}
                    style={{ borderTop: "1px solid var(--line)", color: r.is_me ? "var(--cyan)" : "var(--text)" }}
                  >
                    <td style={{ padding: "var(--space-1)" }}>{r.rank}</td>
                    <td style={{ padding: "var(--space-1)", wordBreak: "break-word" }}>
                      {r.name}
                      {r.is_me && <span> (you)</span>}
                      {r.is_bot && (
                        <span
                          style={{
                            marginLeft: "var(--space-1)",
                            padding: "0 var(--space-1)",
                            border: "1px solid var(--amber)",
                            color: "var(--amber)",
                            fontSize: 10,
                            letterSpacing: "0.08em",
                          }}
                        >
                          BOT
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "var(--space-1)", textAlign: "right" }}>{r.score}</td>
                    <td style={{ padding: "var(--space-1)", textAlign: "right" }}>{formatAccuracy(r.accuracy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
