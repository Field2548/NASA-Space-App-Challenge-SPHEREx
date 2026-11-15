"use client";
// Submit and "Nothing moved here" (BP 8.10, api.md section 3). Submit is gated by validateMarks
// only; the server decides `static` (it tests `known` first), so isStatic is a soft hint here.
// A failure of /api/check keeps the marks. With no JSON error (route missing, network, bare 5xx)
// it shows a calm offline note; a JSON error code (not_found, rate_limited, ...) shows its message.
//
// Props:
//   spot: string                       spot slug sent to /api/check
//   marks: Mark[]                      the player's marks
//   fetcher?: typeof fetch             injectable for tests (default global fetch)
//   onResult?(res: CheckResponse)      after a verdict (PlayScreen opens Inspect on `reveal`)

import { useState } from "react";
import { ApiCallError, CHECK_URL, nothingRequest, submitCheck, toCheckRequest } from "@/lib/check";
import { saveGuestSubmission } from "@/lib/auth";
import { recordFind } from "@/lib/guest";
import { fitTrack, isStatic, validateMarks } from "@/lib/marks";
import type { CheckRequest, CheckResponse, Mark, VerdictKind } from "@/lib/types";
import ResultSheet from "./ResultSheet";
import styles from "./SubmitBar.module.css";

export const OFFLINE_TEXT = "Checking is not live yet; your marks stay on screen.";
export const STATIC_HINT = "These marks barely move. You can still submit; the checker decides.";

/** Kinds that count as a find in guest mode. */
const FIND_KINDS: VerdictKind[] = ["known", "bot_match", "nothing_correct"];

export interface SubmitBarProps {
  spot: string;
  marks: Mark[];
  fetcher?: typeof fetch;
  /** Training round: the result sheet has no stage numbers or next-stage link. */
  tutorial?: boolean;
  onResult?(res: CheckResponse): void;
}

type State =
  | { s: "idle" }
  | { s: "invalid"; text: string }
  | { s: "pending" }
  | { s: "done"; res: CheckResponse; marks: Mark[]; open: boolean }
  | { s: "error"; text: string };

export const NOT_FOUND_TEXT = "The server does not know this spot.";

/**
 * Player-facing text for a failed check. lib/check invents two errors when the server sent no
 * JSON error: a network failure (status 0) and `internal` with "POST /api/check failed: N"
 * (a non-JSON 404 or 5xx). Only those, and a missing verdict, mean checking is offline; any
 * JSON error code from the server is shown plainly.
 */
export function errorText(e: unknown): string {
  if (!(e instanceof ApiCallError) || e.status === 0) return OFFLINE_TEXT;
  if (e.code === "internal" && e.message === `POST ${CHECK_URL} failed: ${e.status}`) return OFFLINE_TEXT;
  if (e.code === "upstream_failed" && e.message === "Unreadable response from /api/check") return OFFLINE_TEXT;
  if (e.code === "not_found") return NOT_FOUND_TEXT;
  if (e.code === "rate_limited") return "Too many checks in a row. Wait a moment, then try again.";
  if (e.code === "bad_request") return e.message || "The checker could not read these marks.";
  return e.message || OFFLINE_TEXT;
}

export default function SubmitBar({ spot, marks, fetcher, tutorial, onResult }: SubmitBarProps) {
  const [state, setState] = useState<State>({ s: "idle" });
  const pending = state.s === "pending";
  const valid = validateMarks(marks) === null;
  const staticHint = valid && isStatic(fitTrack(marks));

  const send = async (req: CheckRequest) => {
    setState({ s: "pending" });
    try {
      const res = await submitCheck(req, fetcher ?? fetch);
      if (!res || typeof res !== "object" || !res.verdict) throw new Error("no verdict");
      if (!res.persisted) {
        // Guest: keep the request so sign-in can replay it (the server re-scores it).
        saveGuestSubmission(req);
        if (FIND_KINDS.includes(res.verdict.kind)) recordFind(spot, res.verdict.kind, res.verdict.points);
      }
      setState({ s: "done", res, marks, open: true });
      onResult?.(res);
    } catch (e) {
      setState({ s: "error", text: errorText(e) });
    }
  };

  const onSubmit = () => {
    const err = validateMarks(marks);
    if (err) {
      setState({ s: "invalid", text: err });
      return;
    }
    void send(toCheckRequest(spot, marks));
  };

  return (
    <div className={styles.root}>
      <div data-slot="submit">
        <button type="button" className={styles.primary} onClick={onSubmit} disabled={pending}>
          {pending ? "Checking…" : "Submit"}
        </button>
      </div>
      <div data-slot="nothing-moved">
        <button type="button" className={styles.secondary} onClick={() => void send(nothingRequest(spot))} disabled={pending}>
          Nothing moved here
        </button>
      </div>
      {staticHint && state.s !== "done" && <p className={styles.hint}>{STATIC_HINT}</p>}
      <div aria-live="polite" className={styles.out}>
        {state.s === "invalid" && (
          <p role="alert" className={styles.warn}>
            {state.text}
          </p>
        )}
        {state.s === "error" && <p className={styles.calm}>{state.text}</p>}
        {state.s === "done" && !state.open && (
          <button type="button" className={styles.secondary} onClick={() => setState({ ...state, open: true })}>
            Show result
          </button>
        )}
      </div>
      {state.s === "done" && state.open && (
        <ResultSheet res={state.res} marks={state.marks} spot={spot} tutorial={tutorial} onClose={() => setState({ ...state, open: false })} />
      )}
    </div>
  );
}
