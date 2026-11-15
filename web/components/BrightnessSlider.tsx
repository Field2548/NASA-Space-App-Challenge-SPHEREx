"use client";
// Brightness slider (BP 8.7): "Fainter <-> Brighter" on a log scale. The value is the black
// point in S/N units (default -1 sigma, like the repo). Anything fainter than the black point
// turns black, so sliding right keeps only brighter things.
//
// Props: { value: number (black point, S/N); onChange(black: number): void;
//          defaultValue?: number (Reset target, default -1); png8?: boolean; id?: string }
//
// Mapping: position p in [0, 1] -> black = 10^(U_MIN + p (U_MAX - U_MIN)) - SHIFT, with
// SHIFT = 2 so the default -1 sits on the log scale (log10(1) = 0). Range -1.5 .. 2000 S/N.

import { useId } from "react";
import HelpImage from "./HelpImage";
import InfoPopover from "./InfoPopover";
import styles from "./BrightnessSlider.module.css";

const RAMP = Float32Array.from({ length: 48 }, (_, i) => (i % 12) / 11);

export const BRIGHTNESS_SHIFT = 2;
export const BLACK_MIN = -1.5;
export const BLACK_MAX = 2000;
const U_MIN = Math.log10(BLACK_MIN + BRIGHTNESS_SHIFT);
const U_MAX = Math.log10(BLACK_MAX + BRIGHTNESS_SHIFT);

export function sliderToBlack(p: number): number {
  const q = Math.min(1, Math.max(0, p));
  return 10 ** (U_MIN + q * (U_MAX - U_MIN)) - BRIGHTNESS_SHIFT;
}

export function blackToSlider(black: number): number {
  const b = Math.min(BLACK_MAX, Math.max(BLACK_MIN, black));
  return (Math.log10(b + BRIGHTNESS_SHIFT) - U_MIN) / (U_MAX - U_MIN);
}

/**
 * Real objects the team measured, placed at their single-frame S/N (README shift-and-stack
 * table). Described, never named: the slider is on /play, where names would give rounds away.
 */
export const LANDMARKS: { name: string; text: string; snr: number }[] = [
  { name: "faintest mover", text: "Faintest distant mover: S/N ~2–4, needs Follow & stack", snr: 3 },
  { name: "faint mover", text: "Faint distant mover: S/N ~2–12", snr: 5 },
  { name: "asteroid", text: "Asteroid in a crowded field: S/N ~140–250", snr: 190 },
  { name: "bright asteroid", text: "Bright asteroid: very bright", snr: 1000 },
];

export interface BrightnessSliderProps {
  value: number;
  onChange(black: number): void;
  defaultValue?: number;
  png8?: boolean;
  id?: string;
  /** Lowest black point in png8 mode: pass field.stretch.black_sigma. Ignored for float data. */
  minBlack?: number;
}

export function formatBlack(black: number): string {
  const v = Math.abs(black) >= 100 ? black.toFixed(0) : black.toFixed(1);
  return `${black >= 0 ? "+" : "−"}${v.replace("-", "")}σ`;
}

/**
 * Black point actually used. In png8 mode the frames are quantised and clipped below
 * field.stretch.black_sigma, so the black point cannot go fainter than that.
 */
export function effectiveBlack(value: number, png8: boolean, minBlack?: number): number {
  return png8 && minBlack !== undefined ? Math.max(value, minBlack) : value;
}

export default function BrightnessSlider({ value: rawValue, onChange, defaultValue = -1, png8 = false, id, minBlack }: BrightnessSliderProps) {
  const autoId = useId();
  const inputId = id ?? `brightness-${autoId}`;
  const descId = `${inputId}-desc`;
  const value = effectiveBlack(rawValue, png8, minBlack);
  const resetTo = effectiveBlack(defaultValue, png8, minBlack);
  const p = blackToSlider(value);
  const pMin = png8 && minBlack !== undefined ? blackToSlider(minBlack) : 0;
  return (
    <div className={styles.root}>
      <div className={styles.ends} aria-hidden="true">
        <span>Fainter</span>
        <span>⟷</span>
        <span>Brighter</span>
      </div>
      <label htmlFor={inputId} className="sr-only">
        {png8 ? "Brightness levels (preview data)" : "Brightness: black point in S/N"}
      </label>
      <div className={styles.track}>
        <input
          id={inputId}
          type="range"
          min={pMin}
          max={1}
          step="any"
          value={p}
          aria-valuetext={`black point ${formatBlack(value)}`}
          onChange={(e) => onChange(effectiveBlack(sliderToBlack(Number(e.target.value)), png8, minBlack))}
          className={styles.input}
        />
        <ul className={styles.landmarks} aria-hidden="true">
          {LANDMARKS.map((m, k) => (
            <li
              key={m.name}
              title={m.text}
              className={k % 2 ? styles.below : styles.above}
              style={{ left: `${blackToSlider(m.snr) * 100}%` }}
            >
              {m.name}
            </li>
          ))}
        </ul>
      </div>
      <div className={styles.row}>
        <InfoPopover label="Brightness" title="Brightness: where black starts">
          <p>
            Anything fainter than the black point is drawn black, so sliding right keeps only the brighter things and hides the
            faint noise. Sliding left shows more faint detail but more noise. The unit is sigma, the typical noise level of the
            frame. Landmarks on the slider show where real objects sit:
          </p>
          <ul id={descId} className={styles.legend} aria-label="Landmarks">
            {LANDMARKS.map((m) => (
              <li key={m.name}>{m.text}</li>
            ))}
          </ul>
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <HelpImage data={RAMP} w={12} h={4} label="Before: black point at the default, the whole ramp is visible" caption="Black at default" />
            <HelpImage data={RAMP.map((v) => Math.max(0, (v - 0.4) / 0.6))} w={12} h={4} label="After: a higher black point turns the faint left part black" caption="Black raised" />
          </div>
        </InfoPopover>
      </div>
      <div className={styles.row}>
        <output htmlFor={inputId} className={styles.value}>
          {png8 ? "levels " : "black "}
          {formatBlack(value)}
        </output>
        <button type="button" onClick={() => onChange(resetTo)} disabled={value === resetTo}>
          Reset
        </button>
      </div>
      {png8 && (
        <p className={styles.note} data-testid="png8-note">
          Preview data cannot go fainter than {formatBlack(minBlack ?? value)}.
        </p>
      )}
    </div>
  );
}
