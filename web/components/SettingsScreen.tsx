"use client";
// /settings: choices kept on this device (guest store). Colour vision lives here; the game reads it.

import { useEffect, useState } from "react";
import { loadVision, saveVision } from "@/lib/settings";
import type { Vision } from "@/lib/types";
import BackLink from "./BackLink";
import styles from "./InfoPage.module.css";
import VisionPicker from "./VisionPicker";

export default function SettingsScreen() {
  // Server and first client render show "normal"; the saved value is read after mount.
  const [vision, setVision] = useState<Vision>("normal");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage exists only on the client
    setVision(loadVision());
  }, []);
  return (
    <main className={styles.page}>
      <BackLink />
      <h1>Settings</h1>
      <p>These choices are saved on this device.</p>
      <section className="panel" data-part="Colour vision">
        <VisionPicker
          value={vision}
          onChange={(v) => {
            setVision(v);
            saveVision(v);
          }}
        />
        <p>Changes the colours of your marks in the game so the order of frames stays easy to read.</p>
      </section>
    </main>
  );
}
