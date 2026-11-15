"use client";
// Title menu: a vertical list, four equal items. A ">" caret marks the hovered or focused item
// (CSS); ArrowUp / ArrowDown move focus between items, wrapping at the ends.

import Link from "next/link";
import type { KeyboardEvent } from "react";
import styles from "./TitleScreen.module.css";

export const MENU_ITEMS = [
  { href: "/stages", label: "Game stages" },
  { href: "/map", label: "Explore the sky" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/settings", label: "Settings" },
] as const;

export default function TitleMenu() {
  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLAnchorElement>("a"));
    const at = items.indexOf(document.activeElement as HTMLAnchorElement);
    const idx = at === -1 ? (step > 0 ? 0 : items.length - 1) : (at + step + items.length) % items.length;
    e.preventDefault();
    items[idx]?.focus();
  }
  return (
    <nav aria-label="Start" className={styles.menu} onKeyDown={onKeyDown}>
      {MENU_ITEMS.map((item) => (
        <Link key={item.href} href={item.href} className={styles.item}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
