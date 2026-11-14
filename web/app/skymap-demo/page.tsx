// TEMPORARY demo page owned by SERVER: shows SkyMap + CoordinateBox wired together so they can be
// seen and tested without editing GAME's pages. Remove when the components live in the real layout.

import type { Metadata } from "next";
import { SkyMapDemo } from "@/components/skymap/SkyMapDemo";

export const metadata: Metadata = { title: "Sky map demo", robots: { index: false, follow: false } };

export default function SkyMapDemoPage() {
  return (
    <main style={{ padding: "56px var(--space-4) var(--space-4)" }}>
      <SkyMapDemo />
    </main>
  );
}
