"use client";
// "World progress" bar on the title card: checked sky boxes out of all HEALPix order-4 boxes, from
// /api/density (layer=checked, everyone). Fetched once on mount, no polling. With source "none" or a
// failed fetch the bar stays empty and says it is offline; no number is invented.

import { useEffect, useState } from "react";
import { WORLD_TOTAL, WORLD_URL } from "@/lib/worldProgress";
import styles from "./WorldProgress.module.css";

export default function WorldProgress() {
  const [checked, setChecked] = useState<number | null>(null); // null: loading or offline
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let live = true;
    fetch(WORLD_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { source?: string; cells?: unknown }) => {
        if (!live) return;
        if (body.source === "none" || !Array.isArray(body.cells)) return setOffline(true);
        setChecked(body.cells.length);
      })
      .catch(() => live && setOffline(true));
    return () => {
      live = false;
    };
  }, []);
  const now = checked ?? 0;
  const pct = ((now / WORLD_TOTAL) * 100).toFixed(1);
  return (
    <div className={styles.wrap}>
      <div
        className={styles.bar}
        role="progressbar"
        aria-label="World progress"
        aria-valuemin={0}
        aria-valuemax={WORLD_TOTAL}
        aria-valuenow={now}
        aria-valuetext={checked === null ? "unavailable" : `${now} of ${WORLD_TOTAL} sky boxes checked`}
      >
        <span className={styles.fill} style={{ width: `${(now / WORLD_TOTAL) * 100}%` }} />
      </div>
      <p className={styles.text}>
        <span className={styles.label}>WORLD PROGRESS</span> <strong data-testid="world-pct">{checked === null ? "–%" : `${pct}%`}</strong>{" "}
        {offline ? "World progress offline" : checked === null ? "Loading…" : `${now.toLocaleString("en-US")} / ${WORLD_TOTAL.toLocaleString("en-US")} sky boxes checked`}
      </p>
    </div>
  );
}
