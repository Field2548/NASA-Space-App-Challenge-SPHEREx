"use client";
// (i) button that opens a small dialog with the long explanation of a control. Escape or the
// Close button closes it and focus returns to the (i) button.
//
// Props: { label: string (the control's name; the button reads "About <label>");
//          title: string (dialog heading); children: ReactNode (the explanation) }

import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import styles from "./InfoPopover.module.css";

export interface InfoPopoverProps {
  label: string;
  title: string;
  children: ReactNode;
}

export default function InfoPopover({ label, title, children }: InfoPopoverProps) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dlgRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (open) dlgRef.current?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    btnRef.current?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };

  return (
    <span className={styles.root}>
      <button
        ref={btnRef}
        type="button"
        className={styles.btn}
        aria-label={`About ${label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        i
      </button>
      {open && (
        <div ref={dlgRef} role="dialog" aria-labelledby={titleId} tabIndex={-1} className={styles.dialog} onKeyDown={onKeyDown}>
          <h3 id={titleId} className={styles.title}>
            {title}
          </h3>
          <div className={styles.body}>{children}</div>
          <button type="button" onClick={close}>
            Close
          </button>
        </div>
      )}
    </span>
  );
}
