import type { Metadata } from "next";
import { StatusList } from "./StatusList";

export const metadata: Metadata = { title: "Status" };

export default function StatusPage() {
  return (
    <main style={{ padding: "var(--space-5)", maxWidth: 860, margin: "0 auto" }}>
      <h1>Status</h1>
      <p style={{ color: "var(--text-dim)" }}>
        This site asks several outside services for data. Here is whether each one is answering right now.
        Results are saved for one minute, so pressing the button more often will not change them.
      </p>
      <StatusList />
    </main>
  );
}
