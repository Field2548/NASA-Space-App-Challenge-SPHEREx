"use client";
// Blink playback (BP 8.8): starts paused, at most 3 frames per second (WCAG 2.3.1),
// and no auto-play when the user prefers reduced motion. Manual stepping always works.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

export const MAX_BLINK_FPS = 3;

export type BlinkMode = "loop" | "pingpong";

/** Milliseconds between frames for a requested rate, never faster than MAX_BLINK_FPS. */
export function blinkIntervalMs(fps: number): number {
  const f = Number.isFinite(fps) && fps > 0 ? Math.min(fps, MAX_BLINK_FPS) : MAX_BLINK_FPS;
  return Math.ceil(1000 / f);
}

/** Next index and direction for one blink tick. */
export function nextBlinkIndex(i: number, n: number, mode: BlinkMode, dir: 1 | -1): [number, 1 | -1] {
  if (n <= 1) return [0, dir];
  if (mode === "loop") return [(i + 1) % n, 1];
  let d = dir;
  if (i + d > n - 1 || i + d < 0) d = d === 1 ? -1 : 1;
  return [i + d, d];
}

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

const getSnapshot = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(QUERY).matches : false);
const getServerSnapshot = () => false;

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export interface BlinkOptions {
  fps?: number; // requested rate, capped at MAX_BLINK_FPS
  mode?: BlinkMode;
  initialIndex?: number;
}

export interface Blink {
  index: number;
  setIndex(i: number): void;
  step(delta: number): void;
  playing: boolean;
  play(): void;
  pause(): void;
  toggle(): void;
  reducedMotion: boolean;
  fps: number; // effective rate
  intervalMs: number;
}

export function useBlink(n: number, opts: BlinkOptions = {}): Blink {
  const mode = opts.mode ?? "loop";
  const intervalMs = blinkIntervalMs(opts.fps ?? MAX_BLINK_FPS);
  const reducedMotion = usePrefersReducedMotion();
  const [rawIndex, setRawIndex] = useState(opts.initialIndex ?? 0);
  const [wantPlay, setWantPlay] = useState(false);
  const dir = useRef<1 | -1>(1);

  const index = n > 0 ? Math.min(Math.max(0, rawIndex), n - 1) : 0;
  const playing = wantPlay && !reducedMotion && n > 1;

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setRawIndex((i) => {
        const [next, d] = nextBlinkIndex(Math.min(i, n - 1), n, mode, dir.current);
        dir.current = d;
        return next;
      });
    }, intervalMs);
    return () => clearInterval(id);
  }, [playing, n, mode, intervalMs]);

  const setIndex = useCallback((i: number) => setRawIndex(n > 0 ? Math.min(Math.max(0, Math.round(i)), n - 1) : 0), [n]);
  const step = useCallback(
    (delta: number) => setRawIndex((i) => (n > 0 ? Math.min(Math.max(0, Math.min(i, n - 1) + delta), n - 1) : 0)),
    [n],
  );
  const play = useCallback(() => {
    if (!reducedMotion) setWantPlay(true);
  }, [reducedMotion]);
  const pause = useCallback(() => setWantPlay(false), []);
  const toggle = useCallback(() => {
    if (playing) setWantPlay(false);
    else if (!reducedMotion) setWantPlay(true);
  }, [playing, reducedMotion]);

  return { index, setIndex, step, playing, play, pause, toggle, reducedMotion, fps: 1000 / intervalMs, intervalMs };
}
