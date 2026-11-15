import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QUICKLOOK_LABEL, type QuickLookField, type QuickLookList } from "@/lib/quicklook";
import { DEFAULT_SETTINGS, QuickLookView, frameRgba } from "./QuickLook";

const N = 41;
function field(): QuickLookField {
  const plane = (amp: number) => {
    const p = new Float32Array(N * N);
    for (let k = 0; k < p.length; k++) p[k] = Math.sin(k * 12.9898) * 0.5; // noise-like
    p[20 * N + 20] = amp; // a star at the centre
    p[0] = NaN;
    return p;
  };
  return {
    slug: "quicklook",
    title: "(433) Eros", // planted: the viewer must never show it (spoiler lock)
    kind: "quicklook",
    size: [N, N],
    frames: [
      { i: 1, mjd: 61000, utc: "2025-08-04T00:00:00", hours_since_prev: 0, n_bands: 4, detectors: [1] },
      { i: 2, mjd: 61000.5, utc: "2025-08-04T12:00:00", hours_since_prev: 12, n_bands: 4, detectors: [1] },
    ],
    planes: [plane(30), plane(30)],
    stretch: { black_sigma: -1, soft_sigma: 2, white: 12 },
    notes: [],
    label: QUICKLOOK_LABEL,
  } as unknown as QuickLookField;
}

describe("QuickLook", () => {
  it("renders the picture: shared asinh stretch, centre star brightest, NaN black, pixelated canvas, label shown", () => {
    const f = field();
    const rgba = frameRgba(f, 0);
    let best = -1;
    let at = -1;
    for (let k = 0; k < N * N; k++) if (rgba[4 * k] > best) [best, at] = [rgba[4 * k], k];
    expect(at).toBe(20 * N + 20);
    expect(best).toBe(255);
    expect(rgba[0]).toBe(0); // NaN -> black
    expect(rgba[3]).toBe(255);

    const list = { ra: 13.2, dec: 14.38, exposures: [], bursts: [] } as unknown as QuickLookList;
    const html = renderToStaticMarkup(
      <QuickLookView ra={13.2004} dec={14.38} state={{ phase: "done", list, field: f }} plan={null} settings={DEFAULT_SETTINGS} frame={0} playing={false} />,
    );
    expect(html).toContain(`width="${N}"`);
    expect(html).toContain("image-rendering:pixelated");
    expect(html).toContain(QUICKLOOK_LABEL);
    expect(html).not.toContain("Eros"); // no object names
  });
});
