// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import BrightnessSlider, { BLACK_MAX, BLACK_MIN, blackToSlider, LANDMARKS, sliderToBlack } from "./BrightnessSlider";

afterEach(cleanup);

describe("brightness mapping", () => {
  it("covers the range and round-trips the default black point", () => {
    expect(sliderToBlack(0)).toBeCloseTo(BLACK_MIN, 9);
    expect(sliderToBlack(1)).toBeCloseTo(BLACK_MAX, 6);
    expect(sliderToBlack(blackToSlider(-1))).toBeCloseTo(-1, 9);
    for (const b of [-1.2, 0, 3, 42, 150]) expect(sliderToBlack(blackToSlider(b))).toBeCloseTo(b, 6);
  });

  it("is a log scale: equal steps multiply (black + 2)", () => {
    const r1 = (sliderToBlack(0.5) + 2) / (sliderToBlack(0.25) + 2);
    const r2 = (sliderToBlack(0.75) + 2) / (sliderToBlack(0.5) + 2);
    expect(r1).toBeCloseTo(r2, 9);
  });

  it("orders landmarks from faint to bright", () => {
    const pos = LANDMARKS.map((m) => blackToSlider(m.snr));
    expect(pos).toEqual([...pos].sort((a, b) => a - b));
    expect(LANDMARKS.map((m) => m.name)).toEqual(["Eris", "Makemake", "Hektor", "Eros"]);
  });
});

describe("BrightnessSlider", () => {
  it("emits the black point and resets to the default", () => {
    const onChange = vi.fn();
    const { rerender } = render(<BrightnessSlider value={-1} onChange={onChange} />);
    const input = screen.getByRole("slider");
    fireEvent.change(input, { target: { value: String(blackToSlider(150)) } });
    expect(onChange.mock.calls[0][0]).toBeCloseTo(150, 6);
    rerender(<BrightnessSlider value={150} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(onChange).toHaveBeenLastCalledWith(-1);
    expect(screen.getByText("Hektor")).toBeTruthy();
    expect(screen.getByText("Hektor: S/N ~150")).toBeTruthy();
    expect(screen.getByText("Eris: S/N ~2–4, needs Follow & stack")).toBeTruthy();
    expect(screen.getByText(/Fainter/)).toBeTruthy();
  });
});
