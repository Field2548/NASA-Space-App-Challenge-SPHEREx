// Web Worker for quick look (BUILD_PROMPT 8.20, 11): runs lib/quicklook.ts runQuickLook off the
// main thread. Thin on purpose: every bit of logic is in the lib, where node tests reach it.
//
// Start it from client code with:
//   new Worker(new URL("../workers/quicklook.ts", import.meta.url), { type: "module" })
//
// Protocol (types in lib/quicklook.ts):
//   in:  { type: "start", id, plan, proxyPrefix? }   start a run (a new start cancels the old one)
//        { type: "cancel", id }                      abort that run; downloads stop
//   out: { type: "progress", id, p, info }           p in 0..1
//        { type: "done", id, field }                 frame and exposure buffers are TRANSFERRED
//        { type: "error", id, message, cancelled }   cancelled = true after a cancel
// The header/row cache lives in this worker, so a second run over the same spot downloads less.

import {
  runQuickLook,
  transferablesOf,
  type QuickLookWorkerRequest,
  type QuickLookWorkerResponse,
} from "../lib/quicklook";
import { isAbortError } from "../lib/fits";

// The project's TypeScript lib is "dom", not "webworker" (both at once conflict), so describe the
// two members of the worker scope used here instead of pulling in the webworker types.
interface WorkerScope {
  postMessage(message: QuickLookWorkerResponse, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (e: MessageEvent<QuickLookWorkerRequest>) => void): void;
}
const scope = globalThis as unknown as WorkerScope;

let current: { id: string; ac: AbortController } | null = null;

scope.addEventListener("message", (e) => {
  const msg = e.data;
  if (msg.type === "cancel") {
    if (current && current.id === msg.id) current.ac.abort();
    return;
  }
  if (msg.type !== "start") return;
  current?.ac.abort();
  const ac = new AbortController();
  const run = { id: msg.id, ac };
  current = run;
  const prefix = msg.proxyPrefix;
  runQuickLook(
    msg.plan,
    (p, info) => {
      if (!ac.signal.aborted) scope.postMessage({ type: "progress", id: msg.id, p, info });
    },
    ac.signal,
    prefix ? { rewriteUrl: (u) => prefix + encodeURIComponent(u) } : {},
  )
    .then((field) => {
      if (ac.signal.aborted) throw new DOMException("cancelled", "AbortError");
      scope.postMessage({ type: "done", id: msg.id, field }, transferablesOf(field));
    })
    .catch((err: unknown) => {
      const cancelled = isAbortError(err) || ac.signal.aborted;
      const message = cancelled ? "Cancelled." : err instanceof Error ? err.message : String(err);
      scope.postMessage({ type: "error", id: msg.id, message, cancelled });
    })
    .finally(() => {
      if (current === run) current = null;
    });
});
