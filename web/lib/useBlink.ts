"use client";
// Blink playback (BP 8.8): starts paused, at most 3 frames per second (WCAG 2.3.1),
// and no auto-play when the user prefers reduced motion. Manual stepping always works.

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

export const MAX_BLINK_FPS = 3;

/** Milliseconds between frames for a requested rate, never faster than MAX_BLINK_FPS. */
export function blinkIntervalMs(fps: number): number {
  const f = Number.isFinite(fps) && fps > 0 ? Math.min(fps, MAX_BLINK_FPS) : MAX_BLINK_FPS;
  return Math.ceil(1000 / f);
}

/** Next index for one blink tick: forward, back to the first frame after the last. */
export function nextBlinkIndex(i: number, n: number): number {
  return n <= 1 ? 0 : (i + 1) % n;
}

/** Index after moving by delta frames, wrapping round the ends (never stuck on the first or last frame). */
export function wrapIndex(i: number, delta: number, n: number): number {
  return n <= 1 ? 0 : (((i + delta) % n) + n) % n;
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

/** Rates the speed control offers (frames per second), all within MAX_BLINK_FPS. */
export const BLINK_SPEEDS = [0.5, 1, 2, 3] as const;

export interface BlinkOptions {
  fps?: number; // requested rate, capped at MAX_BLINK_FPS
  range?: [number, number]; // inclusive array indices the blink plays; default all frames
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
  const intervalMs = blinkIntervalMs(opts.fps ?? MAX_BLINK_FPS);
  const reducedMotion = usePrefersReducedMotion();
  const [rawIndex, setRawIndex] = useState(opts.initialIndex ?? 0);
  const [wantPlay, setWantPlay] = useState(false);
  const lo = n > 0 ? Math.min(Math.max(0, opts.range ? Math.min(opts.range[0], opts.range[1]) : 0), n - 1) : 0;
  const hi = n > 0 ? Math.min(Math.max(lo, opts.range ? Math.max(opts.range[0], opts.range[1]) : n - 1), n - 1) : 0;

  const index = n > 0 ? Math.min(Math.max(0, rawIndex), n - 1) : 0;
  const playing = wantPlay && !reducedMotion && n > 1;

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setRawIndex((i) => {
        // Positions inside the loop range; a frame outside it joins the loop at the nearest end.
        return lo + nextBlinkIndex(Math.min(Math.max(i, lo), hi) - lo, hi - lo + 1);
      });
    }, intervalMs);
    return () => clearInterval(id);
  }, [playing, lo, hi, intervalMs]);

  const setIndex = useCallback((i: number) => setRawIndex(n > 0 ? Math.min(Math.max(0, Math.round(i)), n - 1) : 0), [n]);
  const step = useCallback(
    (delta: number) => setRawIndex((i) => (n > 0 ? wrapIndex(Math.min(i, n - 1), delta, n) : 0)),
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
