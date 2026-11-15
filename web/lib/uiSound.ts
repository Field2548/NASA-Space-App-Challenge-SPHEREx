// Interface sounds: short ticks synthesized with Web Audio (no sound files, nothing to licence).
// One listener on the document (UiSounds) picks the sound from what was pressed or changed.
// On by default; the switch is on /settings (guest store). Embeds stay silent.

import { loadGuest, saveGuest } from "./guest";

export type UiSound = "press" | "toggle" | "slide";

export function loadUiSounds(): boolean {
  return loadGuest().settings.uiSounds !== false;
}

export function saveUiSounds(on: boolean): void {
  saveGuest({ settings: { uiSounds: on } });
}

/** Which sound an event target makes, or null for none. */
export function soundFor(el: Element | null, kind: "press" | "change"): UiSound | null {
  if (!el) return null;
  if (kind === "change") {
    if (el instanceof HTMLInputElement && el.type === "range") return "slide";
    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) return "toggle";
    if (el instanceof HTMLSelectElement) return "toggle";
    return null;
  }
  const hit = el.closest("button, a[href], [role='button'], [role='tab'], summary");
  if (!hit || hit.matches(":disabled, [aria-disabled='true']")) return null;
  return "press";
}

// Pitch (Hz), length (s) and peak gain per sound: quiet, under the music.
const VOICE: Record<UiSound, { f: number; to: number; len: number; gain: number }> = {
  press: { f: 880, to: 660, len: 0.06, gain: 0.05 },
  toggle: { f: 520, to: 780, len: 0.08, gain: 0.05 },
  slide: { f: 1200, to: 1200, len: 0.025, gain: 0.025 },
};

const SLIDE_GAP_MS = 45;
let ctx: AudioContext | null = null;
let lastSlide = 0;

/** Play one sound now. Silent without Web Audio. */
export function playUiSound(s: UiSound): void {
  if (typeof window === "undefined") return;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  if (s === "slide") {
    const now = performance.now();
    if (now - lastSlide < SLIDE_GAP_MS) return;
    lastSlide = now;
  }
  ctx ??= new AC();
  if (ctx.state === "suspended") void ctx.resume();
  const v = VOICE[s];
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(v.f, t);
  osc.frequency.exponentialRampToValueAtTime(v.to, t + v.len);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v.gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + v.len);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + v.len + 0.02);
}
