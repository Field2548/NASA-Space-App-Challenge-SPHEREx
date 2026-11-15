import { beforeEach, describe, expect, it, vi } from "vitest";
import { INPUT_WINDOW_MS, MAX_REPORT_SECONDS, PlayTimer } from "./playTimer";

let t: number;
let sent: { seconds: number; keepalive: boolean }[];
let status: number;

function make(): PlayTimer {
  return new PlayTimer({
    now: () => t,
    send: async (seconds, keepalive) => {
      sent.push({ seconds, keepalive });
      return status;
    },
  });
}
/** Move the clock forward `s` seconds, one tick every 5 s like the component. */
function run(timer: PlayTimer, s: number, input = false): void {
  for (let i = 0; i < s; i += 5) {
    t += 5000;
    if (input && i % 30 === 0) timer.input();
    timer.tick();
  }
}
const flushPromises = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.useRealTimers();
  t = 1_000_000;
  sent = [];
  status = 200;
});

describe("PlayTimer", () => {
  it("counts and sends nothing while logged out", () => {
    const timer = make();
    timer.input();
    run(timer, 300, true);
    timer.setVisible(false);
    timer.finish();
    expect(sent).toEqual([]);
    expect(timer.pending).toBe(0);
  });

  it("reports whole seconds after 60 s of counted time with input", () => {
    const timer = make();
    timer.setLoggedIn(true);
    timer.input();
    run(timer, 55, true);
    expect(sent).toEqual([]);
    run(timer, 10, true);
    expect(sent).toHaveLength(1);
    expect(sent[0].seconds).toBeGreaterThanOrEqual(60);
    expect(sent[0].seconds).toBeLessThanOrEqual(65);
    expect(sent[0].keepalive).toBe(false);
  });

  it("counts nothing without any input, and stops counting 120 s after the last input", () => {
    const timer = make();
    timer.setLoggedIn(true);
    run(timer, 600); // never an input
    expect(timer.pending).toBe(0);
    expect(sent).toEqual([]);

    timer.input();
    run(timer, 600); // one input, then idle: only the 120 s window counts
    const total = sent.reduce((n, s) => n + s.seconds, 0) + Math.floor(timer.pending / 1000);
    expect(total).toBe(INPUT_WINDOW_MS / 1000);
  });

  it("does not count the idle stretch before a new input", () => {
    const timer = make();
    timer.setLoggedIn(true);
    timer.input();
    run(timer, 10);
    run(timer, 600); // long idle
    const before = sent.reduce((n, s) => n + s.seconds, 0) + Math.floor(timer.pending / 1000);
    timer.input();
    const after = sent.reduce((n, s) => n + s.seconds, 0) + Math.floor(timer.pending / 1000);
    expect(after).toBe(before);
    expect(before).toBe(120);
  });

  it("counts nothing while the tab is hidden and flushes what was counted when it becomes hidden", () => {
    const timer = make();
    timer.setLoggedIn(true);
    timer.input();
    run(timer, 30, true);
    timer.setVisible(false);
    expect(sent).toHaveLength(1);
    expect(sent[0].keepalive).toBe(true);
    expect(sent[0].seconds).toBe(30);
    run(timer, 100, true); // inputs while hidden (e.g. synthetic) count for nothing
    expect(timer.pending).toBe(0);
    expect(sent).toHaveLength(1);
    timer.setVisible(true);
    timer.input();
    run(timer, 20, true);
    expect(timer.pending).toBeGreaterThan(0);
  });

  it("flushes on page hide with keepalive, and not twice for the same seconds", () => {
    const timer = make();
    timer.setLoggedIn(true);
    timer.input();
    run(timer, 20, true);
    timer.finish();
    timer.finish();
    expect(sent).toEqual([{ seconds: 20, keepalive: true }]);
  });

  it("sends nothing for under a second", () => {
    const timer = make();
    timer.setLoggedIn(true);
    timer.input();
    t += 400;
    timer.finish();
    expect(sent).toEqual([]);
  });

  it("caps one report at 120 s and keeps the rest for the next", () => {
    const timer = make();
    timer.setLoggedIn(true);
    timer.input();
    t += 119_000; // one long gap with no tick (a throttled background timer)
    timer.finish();
    expect(sent.map((s) => s.seconds)).toEqual([119]);

    // Inputs close the interval without reporting, so a backlog of 200 s can build before the next tick.
    sent = [];
    const timer2 = make();
    timer2.setLoggedIn(true);
    timer2.input();
    t += 100_000;
    timer2.input();
    t += 100_000;
    timer2.input();
    expect(timer2.pending).toBe(200_000);
    timer2.tick();
    expect(sent.map((s) => s.seconds)).toEqual([MAX_REPORT_SECONDS]);
    expect(timer2.pending).toBe(80_000);
  });

  it("stops counting and sending after a 401 with no change of login", async () => {
    status = 401;
    const timer = make();
    timer.setLoggedIn(true);
    timer.input();
    run(timer, 70, true);
    expect(sent).toHaveLength(1);
    await flushPromises();
    expect(timer.stopped).toBe(true);
    run(timer, 300, true);
    timer.setVisible(false);
    timer.finish();
    expect(sent).toHaveLength(1);
  });

  it("counts and reports again after resume() (a new token or a new login) lifts a 401 halt", async () => {
    status = 401;
    const timer = make();
    timer.setLoggedIn(true);
    timer.input();
    run(timer, 70, true);
    await flushPromises();
    expect(timer.stopped).toBe(true);
    run(timer, 300, true); // halted time is not counted
    expect(timer.pending).toBe(0);
    status = 200;
    timer.resume();
    expect(timer.stopped).toBe(false);
    timer.input();
    run(timer, 70, true);
    await flushPromises();
    expect(sent).toHaveLength(2);
    expect(sent[1].seconds).toBeGreaterThanOrEqual(60);
    expect(timer.stopped).toBe(false);
  });

  it("ignores a 401 that answers a report sent before resume()", async () => {
    let release: (s: number) => void = () => {};
    const timer = new PlayTimer({
      now: () => t,
      send: () => new Promise<number>((r) => (release = r)),
    });
    timer.setLoggedIn(true);
    timer.input();
    run(timer, 70, true); // report in flight with the old token
    timer.resume(); // the token changed meanwhile
    release(401);
    await flushPromises();
    expect(timer.stopped).toBe(false);
  });

  it("drops a failed report without retrying, and keeps going after a 500, a 503, a 429 or a network error", async () => {
    for (const code of [500, 503, 429, 0]) {
      sent = [];
      status = code;
      const timer = make();
      timer.setLoggedIn(true);
      timer.input();
      run(timer, 65, true);
      await flushPromises();
      expect(sent).toHaveLength(1);
      expect(timer.stopped).toBe(false);
      expect(timer.pending).toBeLessThan(10_000); // the sent seconds are gone, not queued again
    }
  });

  it("never throws when the sender throws or rejects", async () => {
    const timer = new PlayTimer({
      now: () => t,
      send: () => {
        throw new Error("boom");
      },
    });
    timer.setLoggedIn(true);
    timer.input();
    t += 70_000;
    expect(() => timer.tick()).not.toThrow();
    const timer2 = new PlayTimer({ now: () => t, send: () => Promise.reject(new Error("no network")) });
    timer2.setLoggedIn(true);
    timer2.input();
    t += 30_000;
    expect(() => timer2.finish()).not.toThrow();
    await flushPromises();
  });

  it("logging out discards what was counted", () => {
    const timer = make();
    timer.setLoggedIn(true);
    timer.input();
    run(timer, 30, true);
    timer.setLoggedIn(false);
    timer.finish();
    expect(sent).toEqual([]);
  });

  it("throttles input bursts to one input a second", () => {
    const timer = make();
    timer.setLoggedIn(true);
    timer.input();
    t += 100;
    timer.input(); // ignored: lastInput stays, the window still ends 120 s after the first
    t += 130_000;
    timer.tick();
    expect(timer.pending + sent.reduce((n, s) => n + s.seconds * 1000, 0)).toBe(120_000);
  });
});
