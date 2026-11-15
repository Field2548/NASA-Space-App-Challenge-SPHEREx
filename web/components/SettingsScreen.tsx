"use client";
// /settings: choices kept on this device (guest store). Colour vision and music live here.

import { useEffect, useState } from "react";
import { DEFAULT_MUSIC_VOLUME, type MusicSettings, loadMusic, saveMusic } from "@/lib/music";
import { loadVision, saveVision } from "@/lib/settings";
import type { Vision } from "@/lib/types";
import BackLink from "./BackLink";
import styles from "./InfoPage.module.css";
import VisionPicker from "./VisionPicker";

export default function SettingsScreen() {
  // Server and first client render show the defaults; the saved values are read after mount.
  const [vision, setVision] = useState<Vision>("normal");
  const [music, setMusic] = useState<MusicSettings>({ on: true, volume: DEFAULT_MUSIC_VOLUME });
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage exists only on the client
    setVision(loadVision());
    setMusic(loadMusic());
  }, []);
  const changeMusic = (m: Partial<MusicSettings>) => {
    setMusic((old) => ({ ...old, ...m }));
    saveMusic(m);
  };
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
      <section className="panel" data-part="Music">
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={music.on} onChange={(e) => changeMusic({ on: e.target.checked })} />
          Play music
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          Volume
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(music.volume * 100)}
            disabled={!music.on}
            onChange={(e) => changeMusic({ volume: Number(e.target.value) / 100 })}
            aria-valuetext={`${Math.round(music.volume * 100)} percent`}
          />
        </label>
        <p>
          Space ambience on the map and menus, a cello piece during a round, and a short theme when you solve a spot.
          Music starts after your first click on the page.
        </p>
      </section>
    </main>
  );
}
