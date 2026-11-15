// Background music (three Pixabay tracks in public/music, see CREDITS.md). Which track plays where,
// the on/off and volume setting (guest store, edited on /settings), and the "solved" cue.
//
// - space-ambient: the start page, map, stages and every info page (loops).
// - play-cello: a game round, /play and /tutorial (loops).
// - solved-ballad: once, when a submission solves the spot; then the page's track comes back.

import { loadGuest, saveGuest } from "./guest";

export type TrackId = "ambient" | "play" | "solved";

export const TRACKS: Record<TrackId, { src: string; loop: boolean }> = {
  ambient: { src: "/music/space-ambient.mp3", loop: true },
  play: { src: "/music/play-cello.mp3", loop: true },
  solved: { src: "/music/solved-ballad.mp3", loop: false },
};

export const DEFAULT_MUSIC_VOLUME = 0.35;

/** The looping track for a page. Embeds (other sites' frames) stay silent. */
export function trackForPath(path: string): TrackId | null {
  if (path.startsWith("/embed")) return null;
  if (path === "/play" || path.startsWith("/play/") || path.startsWith("/tutorial")) return "play";
  return "ambient";
}

export interface MusicSettings {
  on: boolean;
  volume: number;
}

export function loadMusic(): MusicSettings {
  const s = loadGuest().settings;
  const v = typeof s.musicVolume === "number" && Number.isFinite(s.musicVolume) ? s.musicVolume : DEFAULT_MUSIC_VOLUME;
  return { on: s.music !== false, volume: Math.min(1, Math.max(0, v)) };
}

export const MUSIC_EVENT = "onion:music";

export function saveMusic(m: Partial<MusicSettings>): void {
  saveGuest({
    settings: {
      ...(m.on !== undefined && { music: m.on }),
      ...(m.volume !== undefined && { musicVolume: Math.min(1, Math.max(0, m.volume)) }),
    },
  });
  window.dispatchEvent(new CustomEvent(MUSIC_EVENT, { detail: { type: "settings" } }));
}

/** Play the "solved" cue once over the page's track (the player calls this after a correct answer). */
export function cueSolved(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(MUSIC_EVENT, { detail: { type: "solved" } }));
}
