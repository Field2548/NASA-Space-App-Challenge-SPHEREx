"use client";
// Coach mark (BP 8.13): a non-modal card that points at the element carrying
// data-tutorial-target~="<target>", with a ring around it. No focus trap: the player keeps
// working in the game. When the target is not on screen the card docks bottom-left.
//
// Props:
//   target?: string            data-tutorial-target key to point at
//   heading: string; text: string; progress: string
//   children?: ReactNode       the buttons (Next, Back, Skip)

import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import styles from "./CoachMark.module.css";

type Box = { left: number; top: number; width: number; height: number };

function unionBox(a: Box, b: Box): Box {
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  return { left, top, width: Math.max(a.left + a.width, b.left + b.width) - left, height: Math.max(a.top + a.height, b.top + b.height) - top };
}

export function findTarget(target: string | undefined, root: ParentNode = document): HTMLElement | null {
  if (!target || !/^[\w-]+$/.test(target)) return null;
  return root.querySelector<HTMLElement>(`[data-tutorial-target~="${target}"]`);
}

/**
 * Card position next to a target box, inside a viewport of vw x vh, never overlapping the box:
 * above when the target sits in the lower half of the viewport, otherwise below; then to the right
 * or left; then a viewport corner the box does not touch. null when nothing fits (a target that
 * fills the screen): the card docks bottom-left instead.
 */
export function placeCard(box: Box, vw: number, vh: number, cardW = 320, cardH = 180, gap = 12): { left: number; top: number } | null {
  const m = 8;
  const left = Math.min(Math.max(m, box.left), Math.max(m, vw - cardW - m));
  const below = box.top + box.height + gap;
  const above = box.top - gap - cardH;
  const lower = box.top + box.height / 2 > vh / 2;
  for (const top of lower ? [above, below] : [below, above]) {
    if (top >= m && top + cardH <= vh - m) return { left, top };
  }
  const top = Math.min(Math.max(m, box.top), Math.max(m, vh - cardH - m));
  const right = box.left + box.width + gap;
  if (right + cardW <= vw - m) return { left: right, top };
  const leftSide = box.left - gap - cardW;
  if (leftSide >= m) return { left: leftSide, top };
  const hits = (l: number, t: number) =>
    l < box.left + box.width + gap && l + cardW > box.left - gap && t < box.top + box.height + gap && t + cardH > box.top - gap;
  const corners = [
    { left: m, top: vh - cardH - m },
    { left: vw - cardW - m, top: vh - cardH - m },
    { left: m, top: m },
    { left: vw - cardW - m, top: m },
  ];
  return corners.find((c) => c.left >= 0 && c.top >= 0 && !hits(c.left, c.top)) ?? null;
}

export interface CoachMarkProps {
  target?: string;
  heading: string;
  text: string;
  progress: string;
  children?: ReactNode;
}

export default function CoachMark({ target, heading, text, progress, children }: CoachMarkProps) {
  const [box, setBox] = useState<Box | null>(null);
  // The card keeps clear of this box: the target, widened to the control strip it sits in (the
  // bottom timeline), so a card for one control does not hide its neighbours.
  const [avoid, setAvoid] = useState<Box | null>(null);
  const headingId = useId();
  const cardRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = findTarget(target);
        const r = el?.getBoundingClientRect();
        const next = r && r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
        const g = el?.closest("[data-tutorial-avoid]")?.getBoundingClientRect();
        const wide = next && g && g.width > 0 && g.height > 0 ? unionBox(next, g) : next;
        const same = (b: Box | null, n: Box | null) =>
          b && n ? b.left === n.left && b.top === n.top && b.width === n.width && b.height === n.height : b === n;
        setBox((b) => (same(b, next) ? b : next));
        setAvoid((b) => (same(b, wide) ? b : wide));
      });
    };
    measure();
    const mo = new MutationObserver(measure);
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(raf);
      mo.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [target]);

  // The card takes focus once, when the tutorial first shows it (not on every step, so the player
  // is not pulled around). The account button comes before the card in the page, so without this a
  // keyboard player would tab through it first; now Tab lands on the card's first button.
  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
  }, []);

  // A target below or above the fold (phones, where the panels stack) is scrolled into view once
  // per step, so the ring and the card are not off screen. Runs again when the target first appears
  // (the screen may still be loading when the step opens).
  const hasBox = box !== null;
  useEffect(() => {
    if (!hasBox) return;
    const raf = requestAnimationFrame(() => {
      const el = findTarget(target);
      const r = el?.getBoundingClientRect();
      if (!el || !r || r.height <= 0) return;
      const vh = window.innerHeight;
      const cardH = cardRef.current?.offsetHeight || 180;
      const off = r.bottom > vh || r.top < 0;
      // A target the card has no room beside even when centred (tall panel on a phone): put the target near the top so
      // the card fits under it.
      const noRoom = placeCard({ left: r.left, top: (vh - r.height) / 2, width: r.width, height: r.height }, window.innerWidth, vh, cardRef.current?.offsetWidth || 320, cardH) === null;
      if (noRoom && r.height + cardH + 12 + 64 + 8 <= vh) window.scrollBy?.({ top: r.top - 64 });
      else if (off && r.height < vh * 0.8) el.scrollIntoView?.({ block: "center" });
    });
    return () => cancelAnimationFrame(raf);
  }, [target, hasBox]);

  // Real card size (text length varies); the fallback is the CSS width and a typical height.
  const [size, setSize] = useState<[number, number]>([320, 180]);
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const w = el.offsetWidth || 320;
    const h = el.offsetHeight || 180;
    setSize((s) => (s[0] === w && s[1] === h ? s : [w, h]));
  }, [heading, text, progress, children, box]);

  const pos = avoid && typeof window !== "undefined" ? placeCard(avoid, window.innerWidth, window.innerHeight, size[0], size[1]) : null;

  return (
    <>
      {box && (
        <div
          className={styles.ring}
          aria-hidden="true"
          style={{ left: box.left - 4, top: box.top - 4, width: box.width + 8, height: box.height + 8 }}
        />
      )}
      <section
        ref={cardRef}
        className={`${styles.card} ${pos ? "" : styles.docked}`}
        style={pos ?? undefined}
        role="region"
        tabIndex={-1}
        aria-labelledby={headingId}
        data-testid="coach-mark"
        data-target={target ?? ""}
      >
        <p className={styles.progress}>{progress}</p>
        <h2 id={headingId} className={styles.heading}>
          {heading}
        </h2>
        <p className={styles.text} aria-live="polite">
          {text}
        </p>
        <div className={styles.actions}>{children}</div>
      </section>
    </>
  );
}
