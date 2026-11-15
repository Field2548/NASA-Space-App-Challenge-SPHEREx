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
