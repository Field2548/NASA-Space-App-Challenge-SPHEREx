// @vitest-environment jsdom
// Music: which track each page plays, the off setting, the solved cue, and waiting for a click
// when the browser refuses to start sound.
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cueSolved, loadMusic, saveMusic, trackForPath } from "@/lib/music";

const nav = vi.hoisted(() => ({ path: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path }));

import MusicPlayer from "./MusicPlayer";

class FakeAudio {
  static all: FakeAudio[] = [];
  static refuse = false;
  src: string;
  loop = false;
  preload = "";
  volume = 1;
  currentTime = 0;
  paused = true;
  private ended: (() => void)[] = [];
  constructor(src: string) {
    this.src = src;
    FakeAudio.all.push(this);
  }
  play() {
    if (FakeAudio.refuse) return Promise.reject(new DOMException("no", "NotAllowedError"));
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  addEventListener(type: string, cb: () => void) {
    if (type === "ended") this.ended.push(cb);
  }
  end() {
    this.paused = true;
    for (const cb of this.ended) cb();
  }
}

const playingSrc = () => FakeAudio.all.filter((a) => !a.paused).map((a) => a.src);

beforeEach(() => {
  vi.useFakeTimers();
  FakeAudio.all = [];
  FakeAudio.refuse = false;
  nav.path = "/";
  window.localStorage.clear();
  vi.stubGlobal("Audio", FakeAudio);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
}

describe("trackForPath", () => {
  it("plays the cello in a round, the ambience elsewhere and nothing in embeds", () => {
    expect(trackForPath("/play")).toBe("play");
    expect(trackForPath("/tutorial")).toBe("play");
    expect(trackForPath("/map")).toBe("ambient");
    expect(trackForPath("/")).toBe("ambient");
    expect(trackForPath("/embed/eros")).toBeNull();
  });
});

describe("music settings", () => {
  it("defaults to on and clamps the volume", () => {
    expect(loadMusic().on).toBe(true);
    saveMusic({ on: false, volume: 5 });
    expect(loadMusic()).toEqual({ on: false, volume: 1 });
  });
});

describe("MusicPlayer", () => {
  it("plays the page's track and switches it on navigation", async () => {
    const r = render(<MusicPlayer />);
    await settle();
    expect(playingSrc()).toEqual(["/music/space-ambient.mp3"]);
    nav.path = "/play";
    r.rerender(<MusicPlayer />);
    await settle();
    expect(playingSrc()).toEqual(["/music/play-cello.mp3"]);
  });

  it("stops when turned off in settings and plays nothing when saved off", async () => {
    render(<MusicPlayer />);
    await settle();
    act(() => saveMusic({ on: false }));
    await settle();
    expect(playingSrc()).toEqual([]);
    cleanup();
    FakeAudio.all = [];
    render(<MusicPlayer />);
    await settle();
    expect(FakeAudio.all).toHaveLength(0);
  });

  it("plays the solved theme once, then the page's track again", async () => {
    nav.path = "/play";
    render(<MusicPlayer />);
    await settle();
    act(() => cueSolved());
    await settle();
    expect(playingSrc()).toEqual(["/music/solved-ballad.mp3"]);
    act(() => FakeAudio.all.find((a) => a.src.includes("ballad"))!.end());
    await settle();
    expect(playingSrc()).toEqual(["/music/play-cello.mp3"]);
  });

  it("waits for the first click when the browser refuses sound", async () => {
    FakeAudio.refuse = true;
    render(<MusicPlayer />);
    await settle();
    expect(playingSrc()).toEqual([]);
    FakeAudio.refuse = false;
    act(() => window.dispatchEvent(new Event("pointerdown")));
    await settle();
    expect(playingSrc()).toEqual(["/music/space-ambient.mp3"]);
  });
});
