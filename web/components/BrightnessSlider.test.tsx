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
    expect(LANDMARKS.map((m) => m.name)).toEqual(["faintest mover", "faint mover", "asteroid", "bright asteroid"]);
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
    expect(screen.getByText("asteroid")).toBeTruthy();
    expect(screen.queryByText("Asteroid in a crowded field: S/N ~140–250")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "About Brightness" }));
    expect(screen.getByText("Asteroid in a crowded field: S/N ~140–250")).toBeTruthy();
    expect(screen.getByText("Faintest distant mover: S/N ~2–4, needs Follow & stack")).toBeTruthy();
    expect(screen.getByText(/Fainter/)).toBeTruthy();
  });

  it("names no object in its text or attributes", () => {
    const { container } = render(<BrightnessSlider value={-1} onChange={() => {}} />);
    expect(container.innerHTML).not.toMatch(/\b(Eros|Hektor|Makemake|Eris)\b/i);
  });
});

describe("BrightnessSlider png8", () => {
  it("clamps the black point to the stretch black and explains why", () => {
    const onChange = vi.fn();
    render(<BrightnessSlider value={-1.4} onChange={onChange} png8 minBlack={-1} />);
    const input = screen.getByRole("slider") as HTMLInputElement;
    expect(input.getAttribute("aria-valuetext")).toContain("1.0σ");
    expect(Number(input.min)).toBeCloseTo(blackToSlider(-1), 9);
    fireEvent.change(input, { target: { value: String(blackToSlider(30)) } });
    expect(onChange.mock.calls[0][0]).toBeCloseTo(30, 6);
    expect(screen.getByTestId("png8-note").textContent).toContain("cannot go fainter");
    expect((screen.getByRole("button", { name: "Reset" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("float data ignores minBlack and shows no note", () => {
    render(<BrightnessSlider value={-1.4} onChange={() => {}} minBlack={-1} />);
    expect(screen.queryByTestId("png8-note")).toBeNull();
    expect(Number((screen.getByRole("slider") as HTMLInputElement).min)).toBe(0);
  });

  it("uses the exact landmark texts", () => {
    expect(LANDMARKS.map((m) => m.text)).toEqual([
      "Faintest distant mover: S/N ~2–4, needs Follow & stack",
      "Faint distant mover: S/N ~2–12",
      "Asteroid in a crowded field: S/N ~140–250",
      "Bright asteroid: very bright",
    ]);
    // README single-frame S/N: Eris 2.2-3.8, Makemake 2.0-12.1, Hektor 140-250; marks sit inside.
    expect(LANDMARKS.map((m) => m.snr)).toEqual([3, 5, 190, 1000]);
  });
});
