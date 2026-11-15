"use client";
// Counts how long a logged-in player really plays a stage or sky patch and reports it to
// POST /api/playtime (rules and limits: lib/playTimer.ts). Renders nothing. Mounted only by the
// screen where a stage or patch is being played. A guest gets no timer and no listeners.

import { useEffect } from "react";
import { PlayTimer } from "@/lib/playTimer";
import { authHeader, getSupabaseBrowser } from "@/lib/supabase";

const INPUT_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;
const TICK_MS = 5_000;

export default function PlayTimeTracker() {
  useEffect(() => {
    let disposed = false;
    // Latest login header, kept so a report on page hide needs no async work.
    let cached: Record<string, string> = {};
    let interval: ReturnType<typeof setInterval> | null = null;
    let listening = false;

    const timer = new PlayTimer({
      now: () => Date.now(),
      async send(seconds, keepalive) {
        try {
          const headers = keepalive ? cached : await authHeader();
          if (!headers.Authorization) return 401;
          const res = await fetch("/api/playtime", {
            method: "POST",
            headers: { ...headers, "content-type": "application/json" },
            body: JSON.stringify({ seconds }),
            keepalive,
            cache: "no-store",
          });
          return res.status;
        } catch {
          return 0;
        }
      },
    });

    const onInput = () => timer.input();
    const onVisibility = () => timer.setVisible(document.visibilityState === "visible");
    const onPageHide = () => timer.finish();

    const stopTimers = () => {
      if (interval !== null) clearInterval(interval);
      interval = null;
      if (listening) {
        for (const e of INPUT_EVENTS) window.removeEventListener(e, onInput, true);
        listening = false;
      }
    };
    const startTimers = () => {
      if (interval === null) {
        interval = setInterval(() => {
          timer.tick();
          if (timer.stopped) stopTimers();
        }, TICK_MS);
      }
      if (!listening) {
        for (const e of INPUT_EVENTS) window.addEventListener(e, onInput, { capture: true, passive: true });
        listening = true;
      }
    };

    const refresh = async () => {
      const headers = await authHeader();
      if (disposed) return;
      cached = headers;
      const loggedIn = Boolean(headers.Authorization);
      timer.setLoggedIn(loggedIn);
      timer.setVisible(document.visibilityState === "visible");
      if (loggedIn && !timer.stopped) startTimers();
      else stopTimers();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    const sub = getSupabaseBrowser()?.auth.onAuthStateChange?.(() => void refresh());
    void refresh();

    return () => {
      disposed = true;
      stopTimers();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      sub?.data.subscription.unsubscribe();
      timer.finish();
    };
  }, []);

  return null;
}
