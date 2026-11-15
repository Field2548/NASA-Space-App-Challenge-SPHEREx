// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blinkIntervalMs, MAX_BLINK_FPS, nextBlinkIndex, useBlink } from "./useBlink";

function mockReducedMotion(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: reduce && q.includes("reduce"),
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("blinkIntervalMs", () => {
  it("never goes faster than 3 fps", () => {
    expect(MAX_BLINK_FPS).toBe(3);
    expect(blinkIntervalMs(3)).toBe(334);
    expect(blinkIntervalMs(60)).toBe(334);
    expect(blinkIntervalMs(1)).toBe(1000);
    expect(blinkIntervalMs(Number.NaN)).toBe(334);
  });
});

describe("nextBlinkIndex", () => {
  it("loops and ping-pongs", () => {
    expect(nextBlinkIndex(2, 3, "loop", 1)).toEqual([0, 1]);
    expect(nextBlinkIndex(2, 3, "pingpong", 1)).toEqual([1, -1]);
    expect(nextBlinkIndex(0, 3, "pingpong", -1)).toEqual([1, 1]);
  });
});

describe("useBlink", () => {
  it("starts paused and advances at most 3 frames per second", () => {
    mockReducedMotion(false);
    const { result } = renderHook(() => useBlink(5, { fps: 30 }));
    expect(result.current.playing).toBe(false);
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.index).toBe(0);
    act(() => result.current.play());
    expect(result.current.playing).toBe(true);
    act(() => vi.advanceTimersByTime(1000));
    // 1000 ms at a 334 ms interval: 2 ticks; 30 fps would have given 30.
    expect(result.current.index).toBe(2);
    act(() => vi.advanceTimersByTime(1002));
    expect(result.current.index).toBe(0); // 5 ticks, wrapped
    act(() => result.current.pause());
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current.index).toBe(0);
  });

  it("does not auto-play under prefers-reduced-motion, but steps by hand", () => {
    mockReducedMotion(true);
    const { result } = renderHook(() => useBlink(4));
    expect(result.current.reducedMotion).toBe(true);
    act(() => result.current.play());
    act(() => result.current.toggle());
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.playing).toBe(false);
    expect(result.current.index).toBe(0);
    act(() => result.current.step(1));
    act(() => result.current.step(10));
    expect(result.current.index).toBe(3);
    act(() => result.current.step(-1));
    expect(result.current.index).toBe(2);
  });
});
