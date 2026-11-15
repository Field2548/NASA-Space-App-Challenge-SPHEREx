// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { formatDec, formatRA } from "@/lib/coords";
import { pixelToSky } from "@/lib/wcs";
import { formatUtc } from "./FieldViewer";
import InspectPanel, { formatSigma } from "./InspectPanel";
import { makeField } from "./testFixtures";

afterEach(cleanup);

function frames(w: number, h: number, n: number): Float32Array[] {
  return Array.from({ length: n }, (_, k) => {
    const f = new Float32Array(w * h).fill(0.5);
    f[3 * w + 2] = 7.25 + k; // pixel (2, 3)
    f[0] = Number.NaN;
    return f;
  });
}

describe("InspectPanel", () => {
  const field = makeField({}, 3, 20, 10);
  const fr = frames(20, 10, 3);

  it("shows x, y, RA, Dec, the pixel's sigma in the current frame and its time, in a labelled region", () => {
    render(<InspectPanel field={field} frames={fr} frameIndex={1} x={2} y={3} />);
    const region = screen.getByRole("region", { name: "Inspect pixel 2, 3" });
    const [ra, dec] = pixelToSky(field.wcs, 10, 2, 3);
    const text = region.textContent ?? "";
    expect(text).toContain("INSPECT // px 2,3");
    expect(text).toContain("x 2, y 3");
    expect(text).toContain(formatRA(ra));
    expect(text).toContain(formatDec(dec));
    expect(text).toContain("8.3σ"); // frame index 1: 7.25 + 1
    expect(text).toContain(`Frame 2, ${formatUtc(field.frames[1].utc)}`);
    expect(region.querySelector("h1")).toBeNull();
  });

  it("says no data for a NaN pixel", () => {
    render(<InspectPanel field={field} frames={fr} frameIndex={0} x={0} y={0} />);
    expect(screen.getByRole("region").textContent).toContain("No data in this frame");
    expect(formatSigma(Number.NaN)).toBe("no data");
  });

  it("shows no object name or distance unless one is passed", () => {
    const { rerender } = render(<InspectPanel field={field} frames={fr} frameIndex={0} x={2} y={3} />);
    expect(screen.queryByTestId("inspect-object")).toBeNull();
    expect(screen.getByRole("region").textContent).not.toMatch(/Test spot|\bAU\b|distance/);
    rerender(<InspectPanel field={field} frames={fr} frameIndex={0} x={2} y={3} objectName="433 Eros" />);
    expect(screen.getByTestId("inspect-object").textContent).toBe("433 Eros");
    expect(screen.getByRole("region").textContent).not.toMatch(/\bAU\b|distance/i);
  });
});
