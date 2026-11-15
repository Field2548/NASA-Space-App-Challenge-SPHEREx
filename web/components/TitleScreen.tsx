// Title screen `/` (BP 8.13): "PRESS START" feel over an ASCII starfield; Start training, Skip
// to game, Explore the sky (/map) and Log in (AuthDialog). About and Credits sit in the site footer.
// Server-safe: the starfield comes from a fixed seed (same HTML on server and client), the
// twinkle is CSS only and stops under prefers-reduced-motion.

import Link from "next/link";
import { PROJECT_NAME, PROJECT_TAGLINE } from "@/lib/brand";
import LoginButton from "./LoginButton";
import SkyPreload from "./SkyPreload";
import styles from "./TitleScreen.module.css";

type Cell = { ch: string; tw: 0 | 1 | 2 | 3 };

/** Deterministic ASCII starfield: rows x cols cells, mostly blank. */
export function starfield(rows = 40, cols = 180, seed = 433): Cell[][] {
  let s = seed >>> 0;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0; // LCG, fixed seed
    return s / 2 ** 32;
  };
  const out: Cell[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: Cell[] = [];
    for (let c = 0; c < cols; c++) {
      const u = rnd();
      const ch = u < 0.035 ? "." : u < 0.05 ? "·" : u < 0.058 ? "+" : u < 0.063 ? "*" : " ";
      row.push({ ch, tw: ch === " " ? 0 : ((1 + Math.floor(rnd() * 3)) as 1 | 2 | 3) });
    }
    out.push(row);
  }
  return out;
}

const FIELD = starfield();

export default function TitleScreen() {
  return (
    <main className={styles.screen}>
      <pre className={styles.stars} aria-hidden="true" data-testid="starfield">
        {FIELD.map((row, r) => (
          <span key={r} className={styles.row}>
            {row.map((cell, c) =>
              cell.tw ? (
                <span key={c} className={styles[`tw${cell.tw}`]}>
                  {cell.ch}
                </span>
              ) : (
                " "
              ),
            )}
            {"\n"}
          </span>
        ))}
      </pre>
      <div className={styles.card}>
        <h1 className={styles.title}>{PROJECT_NAME}</h1>
        <p className={styles.tagline}>{PROJECT_TAGLINE}</p>
        <p className={styles.press} aria-hidden="true">
          PRESS START
        </p>
        <nav aria-label="Start" className={styles.buttons}>
          <Link href="/tutorial" className={styles.primary}>
            Start training
          </Link>
          <Link href="/play?spot=eros" className={styles.button}>
            Skip to game
          </Link>
          <Link href="/map" className={styles.button}>
            Explore the sky
          </Link>
          <LoginButton className={styles.button} />
        </nav>
        <SkyPreload />
      </div>
    </main>
  );
}
