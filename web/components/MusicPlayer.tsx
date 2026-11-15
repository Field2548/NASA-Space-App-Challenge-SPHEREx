"use client";
// Site-wide background music (lib/music.ts picks the track for each page). Mounted once in the root
// layout, so music carries on across page changes. Browsers block sound until the visitor clicks or
// presses a key, so the first try that is refused waits for that. Off in /settings stops it at once.

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { MUSIC_EVENT, TRACKS, type TrackId, loadMusic, trackForPath } from "@/lib/music";

const FADE_MS = 600;
const FADE_STEPS = 12;

function fade(el: HTMLAudioElement, to: number, done?: () => void): () => void {
  const from = el.volume;
  let i = 0;
  const t = setInterval(() => {
    i += 1;
    el.volume = Math.min(1, Math.max(0, from + ((to - from) * i) / FADE_STEPS));
    if (i >= FADE_STEPS) {
      clearInterval(t);
      done?.();
    }
  }, FADE_MS / FADE_STEPS);
  return () => clearInterval(t);
}

export default function MusicPlayer() {
  const path = usePathname() ?? "/";
  const pageTrack = trackForPath(path);
  const ctl = useRef<{ setPage: (t: TrackId | null) => void } | null>(null);

  useEffect(() => {
    const els = new Map<TrackId, HTMLAudioElement>();
    let settings = loadMusic();
    let page: TrackId | null = null;
    let solved = false;
    let playing: TrackId | null = null;
    let waitingGesture = false;
    const stops: (() => void)[] = [];

    const audio = (id: TrackId) => {
      let el = els.get(id);
      if (!el) {
        el = new Audio(TRACKS[id].src);
        el.loop = TRACKS[id].loop;
        el.preload = "auto";
        el.volume = 0;
        if (id === "solved")
          el.addEventListener("ended", () => {
            solved = false;
            apply();
          });
        els.set(id, el);
      }
      return el;
    };

    const onGesture = () => {
      waitingGesture = false;
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
      playing = null;
      apply();
    };

    const apply = () => {
      const want = !settings.on || document.hidden ? null : solved ? "solved" : page;
      if (want === playing) {
        if (want) audio(want).volume = settings.volume;
        return;
      }
      if (playing) {
        const old = audio(playing);
        stops.push(fade(old, 0, () => old.pause()));
      }
      playing = want;
      if (!want) return;
      const el = audio(want);
      if (want === "solved") el.currentTime = 0;
      el.volume = 0;
      el.play().then(
        () => stops.push(fade(el, settings.volume)),
        () => {
          // Refused until the visitor interacts with the page.
          if (playing === want) playing = null;
          if (!waitingGesture) {
            waitingGesture = true;
            window.addEventListener("pointerdown", onGesture);
            window.addEventListener("keydown", onGesture);
          }
        },
      );
    };

    const onMusic = (e: Event) => {
      const type = (e as CustomEvent<{ type: string }>).detail?.type;
      if (type === "settings") settings = loadMusic();
      if (type === "solved") solved = true;
      apply();
    };
    window.addEventListener(MUSIC_EVENT, onMusic);
    document.addEventListener("visibilitychange", apply);
    ctl.current = {
      setPage: (t) => {
        page = t;
        apply();
      },
    };

    return () => {
      window.removeEventListener(MUSIC_EVENT, onMusic);
      document.removeEventListener("visibilitychange", apply);
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
      for (const s of stops) s();
      for (const el of els.values()) el.pause();
      ctl.current = null;
    };
  }, []);

  useEffect(() => {
    ctl.current?.setPage(pageTrack);
  }, [pageTrack]);

  return null;
}
