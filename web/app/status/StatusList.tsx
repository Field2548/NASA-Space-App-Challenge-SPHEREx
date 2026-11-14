"use client";

import { useCallback, useEffect, useState } from "react";
import { statusLabel } from "@/lib/statusLabel";

type Status = "green" | "amber" | "red";
type Service = {
  id: string;
  name: string;
  status: Status;
  ms: number;
  http: number | null;
  message: string;
  configured?: boolean;
};
type Report = { checked_at: string; overall: Status; services: Service[]; warnings?: string[] };

const COLOR: Record<Status, string> = { green: "var(--cyan)", amber: "var(--amber)", red: "var(--magenta)" };

export function StatusList() {
  const [report, setReport] = useState<Report | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(true);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/health", { signal });
      const body = (await res.json()) as Report;
      if (!Array.isArray(body.services)) throw new Error("bad shape");
      setReport(body);
      setFailed(false);
    } catch {
      if (!signal?.aborted) setFailed(true);
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }, []);

  useEffect(() => {
    const ctl = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount; state is set after the await
    void load(ctl.signal);
    return () => ctl.abort();
  }, [load]);

  return (
    <section aria-labelledby="status-heading">
      <h2 id="status-heading" style={{ fontSize: 16 }}>
        Services
      </h2>
      <div aria-live="polite" style={{ color: "var(--text-dim)", marginBottom: "var(--space-3)" }}>
        {busy && !report && "Checking, this can take a few seconds."}
        {failed && "Could not reach the status check. Try again in a moment."}
        {report && !failed && `Last checked ${new Date(report.checked_at).toLocaleTimeString()}.`}
      </div>
      {report?.warnings?.length ? (
        <div role="status" style={{ display: "grid", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
          {report.warnings.map((w) => (
            <p key={w} style={{ margin: 0, color: "var(--amber)" }}>
              {w}
            </p>
          ))}
        </div>
      ) : null}
      {report && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--space-2)" }}>
          {report.services.map((s) => (
            <li
              key={s.id}
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr auto",
                gap: "var(--space-3)",
                alignItems: "start",
                padding: "var(--space-3)",
                background: "var(--bg-1)",
                border: "1px solid var(--line)",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 12,
                  height: 12,
                  marginTop: 5,
                  borderRadius: "var(--radius-pill)",
                  background: COLOR[s.status],
                }}
              />
              <div>
                <div>
                  {s.name} <strong style={{ color: COLOR[s.status] }}>{statusLabel(s)}</strong>
                </div>
                <div style={{ color: "var(--text-dim)", fontSize: 13 }}>{s.message}</div>
              </div>
              <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "right" }}>
                {s.configured === false
                  ? null
                  : s.http === null && s.status === "red"
                    ? "no answer"
                    : `${s.ms} ms`}
              </div>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={() => {
          setBusy(true);
          void load();
        }}
        disabled={busy}
        style={{
          marginTop: "var(--space-4)",
          padding: "var(--space-2) var(--space-4)",
          background: "transparent",
          color: "var(--cyan)",
          border: "1px solid var(--cyan)",
          cursor: busy ? "progress" : "pointer",
        }}
      >
        {busy ? "Checking" : "Check again"}
      </button>
    </section>
  );
}
