"use client";
// Drag handle that sets the width of the game page's left or right panel (pointer or arrow keys).
// usePanelWidths keeps both widths in localStorage so they stay across rounds and visits.

import { type KeyboardEvent, type PointerEvent, useCallback, useSyncExternalStore } from "react";

export const PANEL_MIN = 160;
export const PANEL_MAX = 480;
export const PANEL_DEFAULT = { left: 220, right: 240 } as const;
const KEY = "onion.panelWidths";
const STEP = 16;

export type PanelSide = "left" | "right";
export type PanelWidths = Record<PanelSide, number>;

export const clampPanel = (w: number) => Math.round(Math.min(PANEL_MAX, Math.max(PANEL_MIN, w)));

function stored(): PanelWidths {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Partial<PanelWidths> | null;
    return {
      left: Number.isFinite(raw?.left) ? clampPanel(raw!.left!) : PANEL_DEFAULT.left,
      right: Number.isFinite(raw?.right) ? clampPanel(raw!.right!) : PANEL_DEFAULT.right,
    };
  } catch {
    return { ...PANEL_DEFAULT };
  }
}

// One shared snapshot per page (useSyncExternalStore needs a stable object between changes).
let current: PanelWidths | null = null;
const listeners = new Set<() => void>();
const SERVER: PanelWidths = { ...PANEL_DEFAULT };

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function snapshot(): PanelWidths {
  return (current ??= stored());
}

/** Both panel widths, and a setter that clamps and stores them. The server render uses the defaults. */
export function usePanelWidths(): [PanelWidths, (side: PanelSide, w: number) => void] {
  const widths = useSyncExternalStore(subscribe, snapshot, () => SERVER);
  const set = useCallback((side: PanelSide, w: number) => {
    const next = { ...snapshot(), [side]: clampPanel(w) };
    current = next;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* storage full or blocked */
    }
    for (const cb of listeners) cb();
  }, []);
  return [widths, set];
}

/** Tests only: forget the cached widths so the next read comes from localStorage. */
export function resetPanelWidthsCache() {
  current = null;
}

interface PanelResizerProps {
  side: PanelSide;
  width: number;
  onChange: (w: number) => void;
  className?: string;
}

export default function PanelResizer({ side, width, onChange, className }: PanelResizerProps) {
  // Dragging right widens the left panel and narrows the right one.
  const sign = side === "left" ? 1 : -1;
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = width;
    const el = e.currentTarget;
    el.setPointerCapture?.(e.pointerId);
    const move = (ev: globalThis.PointerEvent) => onChange(w0 + sign * (ev.clientX - x0));
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const d = e.key === "ArrowRight" ? STEP : e.key === "ArrowLeft" ? -STEP : 0;
    if (d) {
      e.preventDefault();
      onChange(width + sign * d);
    } else if (e.key === "Home") {
      e.preventDefault();
      onChange(PANEL_DEFAULT[side]);
    }
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize the ${side} panel`}
      aria-valuemin={PANEL_MIN}
      aria-valuemax={PANEL_MAX}
      aria-valuenow={width}
      tabIndex={0}
      className={className}
      data-side={side}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onChange(PANEL_DEFAULT[side])}
      title="Drag to resize. Double-click to reset."
    />
  );
}
