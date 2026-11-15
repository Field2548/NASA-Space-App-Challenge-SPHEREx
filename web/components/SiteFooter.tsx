"use client";
// Site footer, mounted once by app/layout.tsx: About, Credits and SERVER's status light.
// Pinned to the bottom of the window (position: fixed) on every page, so it stays visible while
// scrolling. Its height is --site-footer-h (set on <body>); <body> reserves that height as
// padding-bottom, and full-height screens subtract it so they fit one viewport. On narrow screens
// the row scrolls sideways inside the bar. Hidden on /embed, which is a bare viewer for iframes.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { StatusBadge } from "./StatusBadge";
import styles from "./SiteFooter.module.css";

export default function SiteFooter() {
  const pathname = usePathname();
  if (pathname === "/embed" || pathname?.startsWith("/embed/")) return null;
  return (
    <footer className={styles.footer} data-site-footer>
      <Link href="/about">About</Link>
      <Link href="/credits">Credits</Link>
      <StatusBadge />
      <a href="https://github.com/Field2548/NASA-Space-App-Challenge-SPHEREx/tree/web" rel="noreferrer" aria-label="Source code, GPL-3.0 licence">
        <span className={styles.wide}>Source code: GPL-3.0</span>
        <span className={styles.narrow} aria-hidden="true">
          Source
        </span>
      </a>
      <Link href="/licence">Licence</Link>
      <Link href="/settings">Settings</Link>
    </footer>
  );
}
