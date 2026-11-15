"use client";
// Site footer, mounted once by app/layout.tsx: About, Credits and SERVER's status light.
// Its height is --site-footer-h (set on <body>), so full-height screens subtract it and stay in
// one viewport. Hidden on /embed, which is a bare viewer for iframes.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { StatusBadge } from "./StatusBadge";
import styles from "./SiteFooter.module.css";

export default function SiteFooter() {
  const pathname = usePathname();
  if (pathname === "/embed" || pathname?.startsWith("/embed/")) return null;
  return (
    <footer className={styles.footer}>
      <Link href="/about">About</Link>
      <Link href="/credits">Credits</Link>
      <StatusBadge />
      <a href="https://github.com/Field2548/NASA-Space-App-Challenge-SPHEREx/tree/web" rel="noreferrer">
        Source code: GPL-3.0
      </a>
      <Link href="/licence">Licence</Link>
    </footer>
  );
}
