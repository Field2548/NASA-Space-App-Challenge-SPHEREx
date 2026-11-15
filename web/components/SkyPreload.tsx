"use client";
// Renders nothing. When the browser is idle, starts the sky map's slow parts (Aladin Lite and its
// WASM core, the CDS mirror check) so /map opens without the wait.

import { useEffect } from "react";
import { preloadSky } from "./skymap/aladin";

export default function SkyPreload() {
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    const id = idle(() => preloadSky());
    return () => cancel(id);
  }, []);
  return null;
}
