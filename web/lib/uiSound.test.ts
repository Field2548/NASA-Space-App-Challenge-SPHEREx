// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { loadUiSounds, playUiSound, saveUiSounds, soundFor } from "./uiSound";

afterEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = "";
});

describe("interface sounds", () => {
  it("on by default, and the setting is kept", () => {
    expect(loadUiSounds()).toBe(true);
    saveUiSounds(false);
    expect(loadUiSounds()).toBe(false);
    saveUiSounds(true);
    expect(loadUiSounds()).toBe(true);
  });
  it("picks the sound from what was pressed or changed", () => {
    document.body.innerHTML = `
      <button id="b"><span id="inner">Go</span></button><button id="off" disabled>No</button>
      <a id="a" href="/x">x</a><p id="p">text</p>
      <input id="r" type="range"><input id="c" type="checkbox"><input id="t" type="text">`;
    const $ = (id: string) => document.getElementById(id);
    expect(soundFor($("inner"), "press")).toBe("press");
    expect(soundFor($("a"), "press")).toBe("press");
    expect(soundFor($("off"), "press")).toBeNull();
    expect(soundFor($("p"), "press")).toBeNull();
    expect(soundFor($("r"), "change")).toBe("slide");
    expect(soundFor($("c"), "change")).toBe("toggle");
    expect(soundFor($("t"), "change")).toBeNull();
  });
  it("is silent, not an error, without Web Audio", () => {
    expect(() => playUiSound("press")).not.toThrow();
  });
});
