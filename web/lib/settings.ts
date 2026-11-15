// User settings kept in the guest store (lib/guest.ts), read by the game and edited on /settings.

import { loadGuest, saveGuest } from "./guest";
import type { Vision } from "./types";

export const VISIONS: readonly Vision[] = ["normal", "protan", "deutan", "tritan", "mono"];

/** The saved colour-vision mode; "normal" when nothing valid is stored. */
export function loadVision(): Vision {
  const v = loadGuest().settings.vision;
  return VISIONS.includes(v) ? v : "normal";
}

export function saveVision(vision: Vision): void {
  saveGuest({ settings: { vision } });
}

/** Colour-blind-safe Stack colours (Okabe-Ito, Stack limited to 7 frames); on unless turned off. */
export function loadSafeColors(): boolean {
  return loadGuest().settings.safeColors !== false;
}

export function saveSafeColors(safeColors: boolean): void {
  saveGuest({ settings: { safeColors } });
}
