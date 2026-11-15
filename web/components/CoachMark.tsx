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

export function findTarget(target: string | undefined, root: ParentNode = document): HTMLElement | null {
  if (!target || !/^[\w-]+$/.test(target)) return null;
  return root.querySelector<HTMLElement>(`[data-tutorial-target~="${target}"]`);
}

/**
 * Card position next to a target box, inside a viewport of vw x vh: below, above, then to the
 * right or left. null when nothing fits (a tall target such as the viewer): the card docks
 * bottom-left instead of covering the target.
 */
export function placeCard(box: Box, vw: number, vh: number, cardW = 320, cardH = 180, gap = 12): { left: number; top: number } | null {
  const left = Math.min(Math.max(8, box.left), Math.max(8, vw - cardW - 8));
  const below = box.top + box.height + gap;
  if (below + cardH <= vh - 8) return { left, top: below };
  const above = box.top - gap - cardH;
  if (above >= 8) return { left, top: above };
  const top = Math.min(Math.max(8, box.top), Math.max(8, vh - cardH - 8));
  const right = box.left + box.width + gap;
  if (right + cardW <= vw - 8) return { left: right, top };
  const leftSide = box.left - gap - cardW;
  if (leftSide >= 8) return { left: leftSide, top };
  return null;
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
  const headingId = useId();

  useEffect(() => {
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = findTarget(target);
        const r = el?.getBoundingClientRect();
        const next = r && r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
        setBox((b) =>
          b && next && b.left === next.left && b.top === next.top && b.width === next.width && b.height === next.height ? b : next,
        );
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

  // A target below or above the fold (phones, where the panels stack) is scrolled into view once
  // per step, so the ring and the card are not off screen.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const el = findTarget(target);
      const r = el?.getBoundingClientRect();
      if (el && r && r.height > 0 && r.height < window.innerHeight * 0.8 && (r.bottom > window.innerHeight || r.top < 0)) {
        el.scrollIntoView?.({ block: "center" });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [target]);

  // Real card size (text length varies); the fallback is the CSS width and a typical height.
  const cardRef = useRef<HTMLElement>(null);
  const [size, setSize] = useState<[number, number]>([320, 180]);
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const w = el.offsetWidth || 320;
    const h = el.offsetHeight || 180;
    setSize((s) => (s[0] === w && s[1] === h ? s : [w, h]));
  }, [heading, text, progress, children, box]);

  const pos = box && typeof window !== "undefined" ? placeCard(box, window.innerWidth, window.innerHeight, size[0], size[1]) : null;

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
