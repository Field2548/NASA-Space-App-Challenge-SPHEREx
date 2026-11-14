// Site footer, mounted once by app/layout.tsx: About, Credits and SERVER's status light.
// Its height is --site-footer-h (set on <body>), so full-height screens subtract it and stay in
// one viewport.

import Link from "next/link";
import { StatusBadge } from "./StatusBadge";
import styles from "./SiteFooter.module.css";

export default function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <Link href="/about">About</Link>
      <Link href="/credits">Credits</Link>
      <StatusBadge />
    </footer>
  );
}
