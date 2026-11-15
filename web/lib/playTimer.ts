// Play-time counting rules (pure logic; PlayTimeTracker.tsx wires it to the page).
// Time counts only while (a) the player is logged in, (b) the tab is visible and (c) there was user
// input (pointer, key, wheel, touch) in the last 120 s. Every 60 s of counted time the whole seconds
// are reported (at most 120 per report); the rest is reported when the tab is hidden or closed.
// A failed report is dropped, never retried, and after a 401 or 503 nothing more is sent for the
// page view. The server (add_play_time) still caps what it credits by the real time elapsed.

export const INPUT_WINDOW_MS = 120_000;
export const REPORT_AFTER_MS = 60_000;
export const MAX_REPORT_SECONDS = 120;
/** Input events closer together than this are one input (pointermove fires many times a second). */
export const INPUT_THROTTLE_MS = 1_000;

export interface PlayTimerDeps {
  now(): number;
  /** Report `seconds` of play. Resolves the HTTP status, or 0 when the request could not be made. */
  send(seconds: number, keepalive: boolean): Promise<number>;
}

export class PlayTimer {
  private readonly deps: PlayTimerDeps;
  private loggedIn = false;
  private visible = true;
  private halted = false;
  private lastInput = Number.NEGATIVE_INFINITY;
  private mark: number;
  private pendingMs = 0;

  constructor(deps: PlayTimerDeps) {
    this.deps = deps;
    this.mark = deps.now();
  }

  /** True after a 401 or 503: nothing is counted or sent any more. */
  get stopped(): boolean {
    return this.halted;
  }

  /** Milliseconds counted and not yet reported. */
  get pending(): number {
    return this.pendingMs;
  }

  private get running(): boolean {
    return this.loggedIn && this.visible && !this.halted;
  }

  /** Close the interval since the last call: count the part of it that lies inside the input window. */
  private advance(now: number): void {
    if (this.running) {
      const end = Math.min(now, this.lastInput + INPUT_WINDOW_MS);
      if (end > this.mark) this.pendingMs += end - this.mark;
    }
    this.mark = now;
  }

  setLoggedIn(value: boolean): void {
    this.advance(this.deps.now());
    this.loggedIn = value;
    if (!value) this.pendingMs = 0;
  }

  /** Becoming hidden reports what is counted (keepalive, so it survives the page going away). */
  setVisible(value: boolean): void {
    this.advance(this.deps.now());
    this.visible = value;
    if (!value) this.flush(true);
  }

  /** A pointer, key, wheel or touch event. */
  input(): void {
    const now = this.deps.now();
    if (now - this.lastInput < INPUT_THROTTLE_MS) return;
    this.advance(now); // an idle stretch before this input is not counted
    this.lastInput = now;
  }

  /** Called every few seconds while logged in. */
  tick(): void {
    this.advance(this.deps.now());
    if (this.pendingMs >= REPORT_AFTER_MS) this.flush(false);
  }

  /** The page is going away (pagehide or unmount): report what is counted. */
  finish(): void {
    this.advance(this.deps.now());
    this.flush(true);
  }

  private flush(keepalive: boolean): void {
    if (this.halted) return;
    const seconds = Math.min(Math.floor(this.pendingMs / 1000), MAX_REPORT_SECONDS);
    if (seconds < 1) return;
    this.pendingMs -= seconds * 1000;
    let sent: Promise<number>;
    try {
      sent = this.deps.send(seconds, keepalive);
    } catch {
      return;
    }
    sent.then(
      (status) => {
        if (status === 401 || status === 503) {
          this.halted = true;
          this.pendingMs = 0;
        }
      },
      () => {},
    );
  }
}
