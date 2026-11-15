"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  friendlyAuthError,
  moveGuestProgress,
  validateDisplayName,
  validateEmail,
  validatePassword,
} from "@/lib/auth";
import { authHeader, getSupabaseBrowser } from "@/lib/supabase";

type Mode = "login" | "signup";
type ErrorField = "email" | "password" | "name" | null;

export interface AuthDialogProps {
  open: boolean;
  onClose: () => void;
  onSignedIn?: (displayName: string | null) => void;
  initialMode?: Mode;
}

const GUEST_NOTE = "Guest progress stays in this browser. Sign up later to keep it.";

const DIALOG_CSS = `
.auth-dialog {
  width: min(420px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  padding: var(--space-4);
  background: var(--bg-1);
  color: var(--text);
  border: 1px solid var(--line);
}
.auth-dialog::backdrop {
  background: color-mix(in srgb, var(--bg-0) 80%, transparent);
}
.auth-dialog input {
  width: 100%;
  margin-top: var(--space-1);
  padding: var(--space-2);
  background: var(--bg-0);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 0;
  font: inherit;
}
.auth-dialog input[aria-invalid="true"] {
  border-color: var(--magenta);
}
.auth-dialog :focus-visible {
  outline: 2px solid var(--cyan);
  outline-offset: 2px;
}
.auth-dialog .auth-muted {
  color: var(--text-dim);
  font-size: 13px;
}
`;

/** Login and sign-up dialog. Guest play needs no account, so "Play as guest" just closes it. */
export function AuthDialog({ open, onClose, onSignedIn, initialMode }: AuthDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  // True while we close the dialog because `open` went false, so onClose is not called twice.
  const closingFromProp = useRef(false);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // showModal focuses the first control (Close); the email field is where typing starts.
      dialog.querySelector<HTMLInputElement>('input[name="email"]')?.focus();
    } else if (!open && dialog.open) {
      closingFromProp.current = true;
      dialog.close();
    }
  }, [open]);

  // Esc and the browser's own close also end here; tell the parent so its state follows.
  function handleClose() {
    if (closingFromProp.current) {
      closingFromProp.current = false;
      return;
    }
    onClose();
  }

  const sb = getSupabaseBrowser();

  return (
    <dialog ref={ref} className="auth-dialog" aria-labelledby={titleId} onClose={handleClose}>
      <style>{DIALOG_CSS}</style>
      {open ? (
        sb ? (
          <AuthForm
            sb={sb}
            titleId={titleId}
            initialMode={initialMode ?? "login"}
            onClose={onClose}
            onSignedIn={onSignedIn}
          />
        ) : (
          <Unavailable titleId={titleId} onClose={onClose} />
        )
      ) : null}
    </dialog>
  );
}

function Unavailable({ titleId, onClose }: { titleId: string; onClose: () => void }) {
  return (
    <>
      <Header titleId={titleId} title="Account" onClose={onClose} />
      <p>Accounts are not available right now. You can play as a guest.</p>
      <GuestButton onClose={onClose} />
    </>
  );
}

function Header({ titleId, title, onClose }: { titleId: string; title: string; onClose: () => void }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-3)" }}>
      <h2 id={titleId} style={{ fontSize: 18, margin: 0 }}>
        {title}
      </h2>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  );
}

function GuestButton({ onClose }: { onClose: () => void }) {
  return (
    <div style={{ display: "grid", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
      <button type="button" onClick={() => onClose()}>
        Play as guest
      </button>
      <p className="auth-muted" style={{ margin: 0 }}>
        {GUEST_NOTE}
      </p>
    </div>
  );
}

/** Looks up the caller's own profile. RLS allows reading only their own row. */
async function lookupDisplayName(sb: SupabaseClient, userId: string): Promise<string | null> {
  try {
    const { data, error } = await sb.from("profiles").select("display_name").eq("id", userId).maybeSingle();
    if (error || !data) return null;
    const name = (data as { display_name?: unknown }).display_name;
    return typeof name === "string" ? name : null;
  } catch {
    return null;
  }
}

const GENERIC_ERROR = "Could not sign in. Please try again.";

function AuthForm({
  sb,
  titleId,
  initialMode,
  onClose,
  onSignedIn,
}: {
  sb: SupabaseClient;
  titleId: string;
  initialMode: Mode;
  onClose: () => void;
  onSignedIn?: (displayName: string | null) => void;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setErrorText] = useState<string | null>(null);
  // Which field the error belongs to; null means a general error that is not tied to one input.
  const [errorField, setErrorField] = useState<ErrorField>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ids = useId();
  const emailId = `${ids}-email`;
  const passwordId = `${ids}-password`;
  const nameId = `${ids}-name`;
  const nameHintId = `${ids}-name-hint`;
  const errorId = `${ids}-error`;
  const isSignup = mode === "signup";

  function setError(message: string | null, field: ErrorField = null) {
    setErrorText(message);
    setErrorField(message ? field : null);
  }

  function switchMode(next: Mode, options?: { keepNotice?: boolean }) {
    setMode(next);
    setError(null);
    if (!options?.keepNotice) setNotice(null);
  }

  /** Guest progress moves into the account, then the parent hears about the sign-in. */
  async function finishSignIn(name: string | null) {
    const moved = await moveGuestProgress(undefined, await authHeader());
    onSignedIn?.(name);
    if ("error" in moved) {
      setError(moved.error);
      return;
    }
    onClose();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setNotice(null);

    const address = email.trim();
    const name = displayName.trim();

    const emailProblem = validateEmail(address);
    if (emailProblem) {
      setError(emailProblem, "email");
      return;
    }
    if (isSignup) {
      const nameProblem = validateDisplayName(name);
      if (nameProblem) {
        setError(nameProblem, "name");
        return;
      }
      const passwordProblem = validatePassword(password);
      if (passwordProblem) {
        setError(passwordProblem, "password");
        return;
      }
    } else if (password === "") {
      setError("Enter your password.", "password");
      return;
    }

    setBusy(true);
    try {
      if (!isSignup) {
        const { data, error: authError } = await sb.auth.signInWithPassword({ email: address, password });
        if (authError) {
          setError(friendlyAuthError(authError.message));
          return;
        }
        const knownName = data.user ? await lookupDisplayName(sb, data.user.id) : null;
        await finishSignIn(knownName);
        return;
      }

      const { data: free, error: rpcError } = await sb.rpc("display_name_available", { p_name: name });
      if (rpcError) {
        setError("Could not check the display name. Try again.");
        return;
      }
      if (free !== true) {
        setError("That name is taken.", "name");
        return;
      }

      const { data, error: signUpError } = await sb.auth.signUp({
        email: address,
        password,
        options: { data: { display_name: name } },
      });
      if (signUpError) {
        setError(friendlyAuthError(signUpError.message));
        return;
      }
      if (!data.session) {
        switchMode("login", { keepNotice: true });
        setNotice("Check your email to confirm your account, then log in.");
        return;
      }
      await finishSignIn(name);
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  const describedBy = error ? errorId : undefined;

  return (
    <>
      <Header titleId={titleId} title={isSignup ? "Sign up" : "Log in"} onClose={onClose} />

      <div role="group" aria-label="Mode" style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
        <ModeButton active={!isSignup} onClick={() => switchMode("login")}>
          Log in
        </ModeButton>
        <ModeButton active={isSignup} onClick={() => switchMode("signup")}>
          Sign up
        </ModeButton>
      </div>

      <form onSubmit={onSubmit} noValidate style={{ display: "grid", gap: "var(--space-3)", marginTop: "var(--space-3)" }}>
        <div>
          <label htmlFor={emailId}>Email</label>
          <input
            id={emailId}
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={errorField === "email" ? true : undefined}
            aria-describedby={errorField === "email" ? describedBy : undefined}
          />
        </div>

        <div>
          <label htmlFor={passwordId}>Password</label>
          <input
            id={passwordId}
            name="password"
            type="password"
            autoComplete={isSignup ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={errorField === "password" ? true : undefined}
            aria-describedby={errorField === "password" ? describedBy : undefined}
          />
          {isSignup ? (
            <p className="auth-muted" style={{ margin: "var(--space-1) 0 0" }}>
              At least 8 characters.
            </p>
          ) : null}
        </div>

        {isSignup ? (
          <div>
            <label htmlFor={nameId}>Display name</label>
            <input
              id={nameId}
              name="displayName"
              type="text"
              autoComplete="nickname"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              aria-invalid={errorField === "name" ? true : undefined}
              aria-describedby={[nameHintId, errorField === "name" ? describedBy : undefined].filter(Boolean).join(" ")}
            />
            <p id={nameHintId} className="auth-muted" style={{ margin: "var(--space-1) 0 0" }}>
              3 to 20 characters: letters, digits, space, _ . or -. Shown on the scoreboard.
            </p>
          </div>
        ) : null}

        <div id={errorId} role="alert" style={{ color: "var(--magenta)", minHeight: "1.5em" }}>
          {error}
        </div>

        {notice ? (
          <p role="status" style={{ color: "var(--cyan)", margin: 0 }}>
            {notice}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          style={{ justifySelf: "start", borderColor: "var(--cyan)", color: "var(--cyan)", cursor: busy ? "progress" : "pointer" }}
        >
          {busy ? "Working" : isSignup ? "Create account" : "Log in"}
        </button>
      </form>

      <GuestButton onClose={onClose} />
    </>
  );
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={{
        flex: 1,
        borderColor: active ? "var(--cyan)" : "var(--line)",
        color: active ? "var(--cyan)" : "var(--text-dim)",
      }}
    >
      {children}
    </button>
  );
}
