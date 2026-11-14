"use client";
// Log in button that opens SERVER's AuthDialog. The dialog mounts only while open, so a closed
// dialog adds no controls to the page. After sign-in the button shows the display name.

import { useState } from "react";
import { AuthDialog } from "./AuthDialog";

export default function LoginButton({ label = "Log in", className }: { label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState<string | null>(null);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} aria-haspopup="dialog">
        {name ?? label}
      </button>
      {open && <AuthDialog open onClose={() => setOpen(false)} onSignedIn={(n) => setName(n || "Signed in")} />}
    </>
  );
}
