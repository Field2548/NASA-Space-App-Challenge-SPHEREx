import type { Metadata } from "next";
import { RequestList } from "./RequestList";

export const metadata: Metadata = { title: "Requests" };

export default function RequestsPage() {
  return (
    <main style={{ padding: "var(--space-5)", maxWidth: 860, margin: "0 auto" }}>
      <h1>Requests</h1>
      <p style={{ color: "var(--text-dim)" }}>
        Anyone can ask for a patch of sky to be processed into a new spot. Requests wait here, newest first, until the
        team runs them.
      </p>
      <RequestList />
    </main>
  );
}
