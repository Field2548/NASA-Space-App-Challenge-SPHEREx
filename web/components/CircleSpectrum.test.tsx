// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearSpectrumCache, type SpectrumIndex } from "@/lib/inspect";
import CircleSpectrum from "./CircleSpectrum";
import { InspectPopup } from "./InspectPopup";
import { makeField } from "./testFixtures";

afterEach(() => {
  cleanup();
  clearSpectrumCache();
  vi.unstubAllGlobals();
});

// One 32 x 32 tile, 60 bands over 0.75 to 5 um: flat 5 MJy/sr sky plus a bright square at (10, 10).
const NB = 60;
const index: SpectrumIndex = {
  size: [32, 32],
  tile: 32,
  nx: 1,
  ny: 1,
  origin: [0, 0],
  covered: [32, 32],
  units: "MJy/sr",
  nodata: 65535,
  bands: Array.from({ length: NB }, (_, b) => ({
    band: b + 1,
    detector: 1 + Math.floor(b / 10),
    wavelength_um: 0.75 + (4.25 * b) / (NB - 1),
    bandwidth_um: 0.02,
    date_obs: "2025-05-12T03:11:20",
    scale: 0.01,
    offset: 0,
    noise: 0.05,
  })),
};

function tile(): ArrayBuffer {
  const buf = new ArrayBuffer(2 * NB * 32 * 32);
  const view = new DataView(buf);
  let seed = 1;
  for (let b = 0; b < NB; b++)
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        const sky = 5 + 0.05 * (seed / 2147483648 - 0.5);
        const v = sky + (Math.abs(x - 10) <= 1 && Math.abs(y - 10) <= 1 ? 20 : 0);
        view.setUint16(2 * ((b * 32 + y) * 32 + x), Math.round(v / 0.01), true);
      }
  return buf;
}

function stubFetch() {
  const f = vi.fn(async (url: string) => {
    if (url.endsWith("index.json")) return new Response(JSON.stringify(index));
    if (url.endsWith("t_0_0.u16")) return new Response(tile());
    return new Response("missing", { status: 404 });
  });
  vi.stubGlobal("fetch", f);
  return f;
}

const cubeField = makeField({ has: { spectrum: true } }, 3, 32, 32);

describe("CircleSpectrum (Inspect section C)", () => {
  it("shows the chart, the radius control and the dip readout for a circle with data", async () => {
    stubFetch();
    const onRadius = vi.fn();
    render(<CircleSpectrum field={cubeField} x={10} y={10} radius={2} onRadius={onRadius} />);
    expect(await screen.findByRole("img", { name: /Spectrum: \d+ bands/ })).toBeTruthy();
    const slider = screen.getByRole("slider", { name: /Circle radius/ });
    expect((slider as HTMLInputElement).value).toBe("2");
    fireEvent.click(screen.getByRole("button", { name: "Larger circle" }));
    expect(onRadius).toHaveBeenCalledWith(3);
    expect(screen.getByText(/no ice dip above 3 σ/i)).toBeTruthy();
  });

  it("says No spectrum here for a spot without a cube or a circle outside it", async () => {
    stubFetch();
    render(<CircleSpectrum field={makeField({}, 3, 32, 32)} x={10} y={10} radius={2} onRadius={() => {}} />);
    expect(await screen.findByText("No spectrum here.")).toBeTruthy();
    cleanup();
    render(<CircleSpectrum field={cubeField} x={1} y={10} radius={2} onRadius={() => {}} />);
    expect(await screen.findByText("No spectrum here.")).toBeTruthy();
  });

  it("renders inside InspectPopup section C through spectrumSlot", async () => {
    stubFetch();
    // jsdom has no ResizeObserver; the popup only uses it to measure itself.
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    render(
      <InspectPopup
        field={cubeField}
        x={10}
        y={10}
        click={{ x: 0, y: 0 }}
        mode="explore"
        onClose={() => {}}
        spectrumSlot={<CircleSpectrum field={cubeField} x={10} y={10} radius={2} onRadius={() => {}} />}
      />,
    );
    expect(await screen.findByRole("img", { name: /Spectrum: \d+ bands/ })).toBeTruthy();
    expect(screen.getByRole("slider", { name: /Circle radius/ })).toBeTruthy();
  });
});
