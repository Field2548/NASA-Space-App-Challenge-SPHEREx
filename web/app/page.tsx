import Link from "next/link";
import { PROJECT_NAME, PROJECT_TAGLINE } from "@/lib/brand";

// Title screen placeholder (phase 0). The full title page (ASCII starfield, BP 8.13) lands in phase 1.
export default function Home() {
  return (
    <main style={{ padding: "var(--space-5)" }}>
      <h1>{PROJECT_NAME}</h1>
      <p>{PROJECT_TAGLINE}</p>
      <nav aria-label="Main" style={{ display: "flex", gap: "var(--space-3)" }}>
        <Link href="/tutorial">Start training</Link>
        <Link href="/play">Skip to game</Link>
        <Link href="/about">About</Link>
        <Link href="/credits">Credits</Link>
      </nav>
    </main>
  );
}
