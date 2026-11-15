// Title screen `/` (BP 8.13): game-style left menu over the real sky. Title top-left,
// the four menu items as a vertical list below, World progress bottom-left; stars at their true
// places, constellation figures and the Milky Way fill the rest, with Orion on the right.
// Log in / profile is the top-right AccountControl in the layout. About and Credits sit in the
// site footer. Server-safe: the sky is deterministic; its sway, the twinkle and the shooting
// stars are CSS only and stop under prefers-reduced-motion.

import { PROJECT_NAME } from "@/lib/brand";
import BrandMark from "./BrandMark";
import SkyPreload from "./SkyPreload";
import TitleMenu from "./TitleMenu";
import TitleSky from "./TitleSky";
import WorldProgress from "./WorldProgress";
import styles from "./TitleScreen.module.css";

// ASCII shooting stars: trail then head; position and timing per streak in the CSS (.shoot1..3).
const SHOOTING = ["----*", "--==*", "~~--*"];

export default function TitleScreen() {
  return (
    <main className={styles.screen}>
      <TitleSky />
      <div className={styles.shootingSky} aria-hidden="true">
        {SHOOTING.map((s, i) => (
          <span key={i} className={`${styles.shoot} ${styles[`shoot${i + 1}`]}`} data-testid="shooting-star">
            {s}
          </span>
        ))}
      </div>
      <div className={styles.panel}>
        <header>
          <h1 className={styles.title}>
            <BrandMark className={styles.titleMark} />
            {PROJECT_NAME}
          </h1>
        </header>
        <TitleMenu />
        <div className={styles.progress}>
          <WorldProgress />
        </div>
        <SkyPreload />
      </div>
    </main>
  );
}
