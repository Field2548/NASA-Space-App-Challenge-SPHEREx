// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CheckResponse, FieldSummary, Mark } from "@/lib/types";
import ResultSheet from "./ResultSheet";

const row = (slug: string, difficulty: FieldSummary["difficulty"]): FieldSummary => ({
  slug,
  title: "Field in Somewhere",
  ra: 0,
  dec: 0,
  fov_deg: 0.1,
  difficulty,
  kind: "spot",
  thumbnail: "",
});
// Stage order is by difficulty, not index order: hard-1 comes first in the file but is stage 3.
const index = [row("hard-1", "hard"), row("easy-1", "easy"), row("med-1", "medium")];

const marks: Mark[] = [
  { frame: 1, x: 0, y: 0, tDays: 0 },
  { frame: 3, x: 3, y: 4, tDays: 0.2 },
];
const known: CheckResponse = {
  verdict: { kind: "known", object_name: "433 Eros (A898 PA)", points: 150, message: "Confirmed: 433 Eros (A898 PA), asteroid." },
  first_finder: false,
  already_found: false,
  persisted: false,
  unlocked: true,
  reveal: { frame: 1, x: 51.2, y: 63.9 },
  track: { x0: 51, y0: 64, vx: 12.1, vy: -3.4, rms: 0.2, rate_arcsec_per_hour: 3.2 },
  noise_bar_sigma: null,
};
const wrong: CheckResponse = {
  ...known,
  verdict: { kind: "candidate", points: 0, message: "Unconfirmed candidate." },
  unlocked: false,
  reveal: undefined,
  track: undefined,
};

afterEach(cleanup);
const show = (res: CheckResponse, spot: string, onClose = vi.fn(), tutorial = false) => {
  render(<ResultSheet res={res} marks={marks} spot={spot} index={index} onClose={onClose} tutorial={tutorial} />);
  return onClose;
};

describe("ResultSheet", () => {
  it("correct: title, points, stage in /stages order, plain sentence, NEXT STAGE, focus on it", () => {
    show(known, "easy-1");
    const d = screen.getByRole("dialog");
    expect(d.getAttribute("aria-modal")).toBe("false");
    expect(d.getAttribute("aria-labelledby")).toBe(screen.getByRole("heading", { name: "★ FOUND IT!" }).id);
    expect(d.textContent).toContain("+150 pts");
    expect(d.textContent).toContain("Stage 1/3");
    expect(d.textContent).toContain("It moved 5.0 pixels between frames");
    const next = screen.getByRole("link", { name: "NEXT STAGE ▶" });
    expect(next.getAttribute("href")).toBe("/play?spot=med-1");
    expect(document.activeElement).toBe(next);
  });

  it("jargon sits behind Details only", () => {
    show(known, "easy-1");
    const sentence = d().querySelector("p")!.textContent!;
    expect(sentence).not.toMatch(/″|px\/day|rms|A898|Answer key/);
    const details = d().querySelector("details")!;
    expect(details.textContent).toContain("3.20″/h");
    expect(details.textContent).toContain("frame 1 at x 51.2, y 63.9");
  });

  it("nothing_correct is titled CORRECT", () => {
    show({ ...known, verdict: { kind: "nothing_correct", points: 250, message: "x" }, reveal: undefined, track: undefined }, "easy-1");
    expect(screen.getByRole("heading", { name: "★ CORRECT" })).toBeTruthy();
  });

  it("last stage: ALL STAGES to /stages", () => {
    show(known, "hard-1");
    expect(screen.getByRole("link", { name: "ALL STAGES ▶" }).getAttribute("href")).toBe("/stages");
  });

  it("wrong: NOT QUITE, never the name, Try again is primary and closes, Skip stage links on", () => {
    const onClose = show(wrong, "easy-1");
    const dlg = screen.getByRole("dialog");
    expect(screen.getByRole("heading", { name: "✗ NOT QUITE" })).toBeTruthy();
    expect(dlg.textContent).not.toMatch(/Eros|433|Details|NEXT STAGE/);
    expect(screen.getByRole("link", { name: "Skip stage" }).getAttribute("href")).toBe("/play?spot=med-1");
    const retry = screen.getByRole("button", { name: "Try again ▶" });
    expect(document.activeElement).toBe(retry);
    fireEvent.click(retry);
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape closes", () => {
    const onClose = show(wrong, "easy-1");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("tutorial has no stage label or next-stage link", () => {
    show(known, "easy-1", vi.fn(), true);
    expect(screen.queryByText(/Stage \d/)).toBeNull();
    expect(screen.queryByRole("link", { name: /STAGE/ })).toBeNull();
    expect(screen.getByRole("button", { name: "CONTINUE ▶" })).toBeTruthy();
  });
});

function d() {
  return screen.getByRole("dialog");
}
