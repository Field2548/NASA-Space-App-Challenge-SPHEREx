// /about body: one h1, then an h2 per section of lib/copy/about.ts.

import { ABOUT_SECTIONS } from "@/lib/copy/about";
import styles from "./InfoPage.module.css";

export default function AboutPage() {
  return (
    <main className={styles.page}>
      <h1>About</h1>
      {ABOUT_SECTIONS.map((s) => (
        <section key={s.heading}>
          <h2>{s.heading}</h2>
          {s.paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </section>
      ))}
    </main>
  );
}
