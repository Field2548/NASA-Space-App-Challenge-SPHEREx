// The title-screen sky: real stars to magnitude 5 at their true places, constellation figures and
// the Milky Way band, drawn as one SVG (stereographic view from the north celestial pole, Orion on
// the right). Stars keep the terminal look: bright ones are "*" and "+" glyphs, faint ones are dots.
// Server-safe and deterministic; the slow sway is CSS only and stops under prefers-reduced-motion.

import { linesPath, milkyWayBlobs, placedStars, FIELD_RADIUS } from "@/lib/sky/project";
import styles from "./TitleScreen.module.css";

const STARS = placedStars();
const LINES = linesPath();
const BAND = milkyWayBlobs();
const BRIGHT = STARS.filter((s) => s.mag < 2.5);
const MID = STARS.filter((s) => s.mag >= 2.5 && s.mag < 4);
const dots = (list: typeof STARS) => list.map((s) => `M${s.x} ${s.y}h0`).join("");
const FAINT = dots(STARS.filter((s) => s.mag >= 4 && s.mag < 4.5));
const FAINTEST = dots(STARS.filter((s) => s.mag >= 4.5));

export default function TitleSky() {
  const r = FIELD_RADIUS;
  return (
    <svg
      className={styles.sky}
      viewBox={`${-r} ${-r} ${2 * r} ${2 * r}`}
      aria-hidden="true"
      data-testid="starfield"
      data-stars={STARS.length}
    >
      <defs>
        <filter id="mw-blur" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>
      <g filter="url(#mw-blur)" className={styles.band} data-testid="milky-way">
        {BAND.map((b, i) => (
          <circle key={i} cx={b.x} cy={b.y} r={b.r} fillOpacity={b.o} />
        ))}
      </g>
      <path d={LINES} className={styles.figures} data-testid="constellations" />
      <path d={FAINTEST} className={styles.faintest} />
      <path d={FAINT} className={styles.faint} />
      <g textAnchor="middle" dominantBaseline="central" className={styles.glyphs}>
        {MID.map((s) => (
          <text key={s.hip} x={s.x} y={s.y} fontSize={1.6 + (4 - s.mag) * 0.25}>
            +
          </text>
        ))}
        {BRIGHT.map((s) => (
          <text
            key={s.hip}
            x={s.x}
            y={s.y}
            fontSize={2.2 + (2.5 - s.mag) * 0.8}
            className={`${styles[`tw${1 + (s.hip % 3)}`]} ${s.bv < 0.3 ? styles.hot : ""}`}
          >
            *
          </text>
        ))}
      </g>
    </svg>
  );
}
