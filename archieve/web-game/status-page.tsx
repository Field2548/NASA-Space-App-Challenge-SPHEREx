"use client";
// /status (BP 8.19, first cut): what is live right now, in plain words. Lists the ready data
// spots from the public field index (sky positions only, never names: they would spoil rounds)
// and probes /api/check from the browser. A GET is used so no answer is ever submitted; 404 or
// a network error means "not live yet", any other reply means the route answers.

import Link from "next/link";
import { useEffect, useState } from "react";
import { CHECK_URL } from "@/lib/check";
import { formatDec, formatRA } from "@/lib/coords";
import { loadFieldIndex } from "@/lib/fields";
import type { FieldSummary } from "@/lib/types";

type Spots = { state: "loading" } | { state: "ok"; spots: FieldSummary[] } | { state: "error" };
type Check = "loading" | "live" | "not-live";

export default function StatusPage() {
  const [spots, setSpots] = useState<Spots>({ state: "loading" });
  const [check, setCheck] = useState<Check>("loading");

  useEffect(() => {
    let alive = true;
    loadFieldIndex().then(
      (s) => alive && setSpots({ state: "ok", spots: s }),
      () => alive && setSpots({ state: "error" }),
    );
    fetch(CHECK_URL, { method: "GET", cache: "no-store" }).then(
      (res) => alive && setCheck(res.status === 404 ? "not-live" : "live"),
      () => alive && setCheck("not-live"),
    );
    return () => {
      alive = false;
    };
  }, []);

  return (
    <main style={{ padding: "var(--space-5)", maxWidth: "48rem" }}>
      <h1>Status</h1>
      <p>What works on this site right now.</p>

      <section aria-labelledby="status-spots">
        <h2 id="status-spots">Data spots</h2>
        <p role="status" data-testid="status-spots">
          {spots.state === "loading"
            ? "Checking the data spots…"
            : spots.state === "error"
              ? "The list of data spots could not be loaded right now."
              : `${spots.spots.length} data spot${spots.spots.length === 1 ? " is" : "s are"} ready to play.`}
        </p>
        {spots.state === "ok" && spots.spots.length > 0 && (
          <ul>
            {spots.spots.map((s, i) => (
              <li key={s.slug}>
                Spot {i + 1}: RA {formatRA(s.ra)}, Dec {formatDec(s.dec)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="status-check">
        <h2 id="status-check">Answer checking</h2>
        <p role="status" data-testid="status-check">
          {check === "loading"
            ? "Checking whether answers can be checked…"
            : check === "live"
              ? "Live: the server answers when you submit a find."
              : "Not live yet: submitting a find will not get a verdict for now."}
        </p>
      </section>

      <p>
        <Link href="/">Back to the start</Link>
      </p>
    </main>
  );
}
