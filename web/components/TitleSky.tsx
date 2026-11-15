// The title-screen sky: real stars to magnitude 5 at their true places, constellation figures and
// the Milky Way band, drawn as one SVG plus HTML glyphs for the twinkling stars (stereographic view from the north celestial pole, Orion on
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
  // The static sky is one SVG, painted once. The few twinkling bright stars are HTML glyphs on top,
  // swaying with it: an opacity animation on an HTML element runs on the compositor, while one on
  // an SVG <text> repaints the whole rotated sky every frame (measured: 50-67 ms frames).
  return (
    <div
      className={styles.sky}
      aria-hidden="true"
      data-testid="starfield"
      data-stars={STARS.length}
      style={{ "--sky-unit": `calc(var(--sky-size) / ${2 * r})` } as React.CSSProperties}
    >
      <svg className={styles.skyLayer} viewBox={`${-r} ${-r} ${2 * r} ${2 * r}`}>
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
        </g>
      </svg>
      {BRIGHT.map((s) => (
        <span
          key={s.hip}
          data-testid="bright-star"
          className={`${styles.star} ${styles[`tw${1 + (s.hip % 3)}`]} ${s.bv < 0.3 ? styles.hot : ""}`}
          style={{
            left: `${((s.x + r) / (2 * r)) * 100}%`,
            top: `${((s.y + r) / (2 * r)) * 100}%`,
            fontSize: `calc(${2.2 + (2.5 - s.mag) * 0.8} * var(--sky-unit))`,
          }}
        >
          *
        </span>
      ))}
    </div>
  );
}
