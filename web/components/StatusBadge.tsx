"use client";

// Footer status light: one dot plus a word, linking to /status. Fetches /api/health once.

import Link from "next/link";
import { useEffect, useState } from "react";

type Light = "checking" | "green" | "amber" | "red";

const LABEL: Record<Light, string> = {
  checking: "Checking services",
  green: "All services working",
  amber: "Some services slow",
  red: "Some services down",
};

const COLOR: Record<Light, string> = {
  checking: "var(--text-dim)",
  green: "var(--cyan)",
  amber: "var(--amber)",
  red: "var(--magenta)",
};

export function StatusBadge() {
  const [light, setLight] = useState<Light>("checking");
  const [unknown, setUnknown] = useState(false);

  useEffect(() => {
    const ctl = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/health", { signal: ctl.signal });
        const body = (await res.json()) as { overall?: string };
        if (body.overall === "green" || body.overall === "amber" || body.overall === "red") {
          setLight(body.overall);
        } else {
          throw new Error("bad shape");
        }
      } catch {
        if (!ctl.signal.aborted) {
          setUnknown(true);
          setLight("amber");
        }
      }
    })();
    return () => ctl.abort();
  }, []);

  const text = unknown ? "Status unknown" : LABEL[light];
  return (
    <Link
      href="/status"
      aria-label={`${text}. Open the status page.`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-2)",
        color: "var(--text-dim)",
        textDecoration: "none",
        fontSize: 13,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 10,
          height: 10,
          borderRadius: "var(--radius-pill)",
          background: COLOR[light],
          boxShadow: light === "checking" ? "none" : `0 0 6px ${COLOR[light]}`,
        }}
      />
      <span>{text}</span>
    </Link>
  );
}
