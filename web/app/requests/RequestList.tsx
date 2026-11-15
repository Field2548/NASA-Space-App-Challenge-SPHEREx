"use client";

import { useEffect, useState } from "react";
import { formatRequestPosition, formatRequestTime } from "@/lib/requestRow";

// Database numerics can arrive as strings or null, so the position fields are not trusted as numbers.
type Req = { id: number; ra: unknown; dec: unknown; fov: unknown; status: string; created_at: string };
type Queue = { requests: Req[]; source?: string };

const STATUS: Record<string, string> = {
  queued: "Waiting",
  processing: "Being processed",
  done: "Done",
  failed: "Failed",
};

export function RequestList() {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const ctl = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/request-spot", { signal: ctl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as Queue;
        if (!body || !Array.isArray(body.requests)) throw new Error("bad shape");
        setQueue(body);
      } catch {
        if (!ctl.signal.aborted) setFailed(true);
      }
    })();
    return () => ctl.abort();
  }, []);

  let note: string | null = null;
  if (failed) note = "Could not load the requests. Try again in a moment.";
  else if (!queue) note = "Loading.";
  else if (queue.requests.length === 0) {
    note = queue.source === "none" ? "No database is connected, so requests cannot be saved yet." : "No requests yet.";
  }

  return (
    <section aria-labelledby="queue-heading">
      <h2 id="queue-heading" style={{ fontSize: 16 }}>
        Queue
      </h2>
      <div aria-live="polite" style={{ color: "var(--text-dim)" }}>
        {note}
      </div>
      {queue && queue.requests.length > 0 && (
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--space-2)" }}>
          {queue.requests.map((r, i) => (
            <li
              key={r.id}
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr auto",
                gap: "var(--space-3)",
                padding: "var(--space-3)",
                background: "var(--bg-1)",
                border: "1px solid var(--line)",
              }}
            >
              <span style={{ color: "var(--text-dim)" }}>#{i + 1}</span>
              <span>
                {formatRequestPosition(r)}
              </span>
              <span style={{ textAlign: "right" }}>
                <span style={{ color: r.status === "failed" ? "var(--magenta)" : "var(--cyan)" }}>
                  {STATUS[r.status] ?? r.status}
                </span>
                <br />
                <time dateTime={r.created_at} style={{ color: "var(--text-dim)" }}>
                  {formatRequestTime(r.created_at)}
                </time>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
