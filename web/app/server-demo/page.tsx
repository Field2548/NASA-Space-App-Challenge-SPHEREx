// TEMPORARY demo page owned by SERVER; delete when GAME mounts these components.

import type { Metadata } from "next";
import { ServerDemo } from "./ServerDemo";

export const metadata: Metadata = { title: "Server demo", robots: { index: false, follow: false } };

export default function ServerDemoPage() {
  return (
    <main style={{ padding: "56px var(--space-4) var(--space-4)" }}>
      <ServerDemo />
    </main>
  );
}
