"use client";
// Renders nothing. Plays a short tick when a button or link is pressed, a box is ticked or a slider
// moves (lib/uiSound). Reads the on/off setting at each event, so /settings applies at once.

import { useEffect } from "react";
import { loadUiSounds, playUiSound, soundFor } from "@/lib/uiSound";

export default function UiSounds() {
  useEffect(() => {
    if (window.location.pathname.startsWith("/embed")) return;
    const on = (kind: "press" | "change") => (e: Event) => {
      const s = soundFor(e.target instanceof Element ? e.target : null, kind);
      if (s && loadUiSounds()) playUiSound(s);
    };
    const press = on("press");
    const change = on("change");
    // click, not pointerdown, so Enter and Space on a focused button sound too.
    document.addEventListener("click", press, { capture: true, passive: true });
    document.addEventListener("input", change, { capture: true, passive: true });
    return () => {
      document.removeEventListener("click", press, { capture: true });
      document.removeEventListener("input", change, { capture: true });
    };
  }, []);
  return null;
}
