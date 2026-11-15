import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SpectrumChart, {
  CHART_MARGIN,
  niceTicks,
  spectrumCsv,
  validPoints,
  xToPx,
  yRange,
  yToPx,
  type MoleculeFamily,
  type SpectrumPoint,
} from "./SpectrumChart";

const families = (
  JSON.parse(readFileSync(join(__dirname, "../public/ref/molecule_bands.json"), "utf8")) as {
    families: MoleculeFamily[];
  }
).families;

const pt = (wl: number, value: number, err = 0, extra: Partial<SpectrumPoint> = {}): SpectrumPoint => ({
  wl,
  value,
  err,
  ...extra,
});

const circleFills = (markup: string): string[] =>
  [...markup.matchAll(/<circle[^>]*fill="([^"]+)"/g)].map((m) => m[1]);

describe("validPoints", () => {
  it("drops bad wavelengths and values, fixes err, sorts, and leaves the input alone", () => {
    const input: SpectrumPoint[] = [
      pt(NaN, 1),
      pt(2, NaN),
      pt(0.5, 1),
      pt(5.5, 1),
      pt(1.5, 2, NaN),
      pt(1.0, 3, -1),
      pt(4, 2, 0.5),
    ];
    const before = structuredClone(input);
    const out = validPoints(input);
    expect(out.map((p) => p.wl)).toEqual([1.0, 1.5, 4]);
    expect(out.map((p) => p.err)).toEqual([0, 0, 0.5]);
    expect(input).toEqual(before);
    expect(out).not.toBe(input);
  });
});

describe("yRange", () => {
  it("pads the top and keeps a zero floor at 0", () => {
    const [lo, hi] = yRange([pt(1, 1, 0.5), pt(2, 2, 0.5), pt(3, 3, 0.5)]);
    expect(lo).toBe(0);
    expect(hi).toBeCloseTo(3.5 + 0.05 * 3.5, 9);
  });

  it("pads both ends when values are negative", () => {
    const [lo, hi] = yRange([pt(1, -2), pt(2, 4)]);
    expect(lo).toBeCloseTo(-2 - 0.3, 9);
    expect(hi).toBeCloseTo(4 + 0.3, 9);
  });

  it("gives [0, 1] for no data", () => {
    expect(yRange([])).toEqual([0, 1]);
  });

  it("gives a range with hi > lo for a single zero point", () => {
    const [lo, hi] = yRange([pt(2, 0, 0)]);
    expect(hi).toBeGreaterThan(lo);
  });
});

describe("pixel mapping", () => {
  const width = 520;
  const height = 260;

  it("maps the wavelength range onto the plot edges, increasing", () => {
    expect(xToPx(0.75, width)).toBe(CHART_MARGIN.left);
    expect(xToPx(5.0, width)).toBe(width - CHART_MARGIN.right);
    expect(xToPx(1, width)).toBeLessThan(xToPx(2, width));
  });

  it("maps the brightness range onto the plot edges (SVG y grows downward)", () => {
    const range: [number, number] = [-0.4, 3.9];
    expect(yToPx(range[0], range, height)).toBe(height - CHART_MARGIN.bottom);
    expect(yToPx(range[1], range, height)).toBeCloseTo(CHART_MARGIN.top, 9);
  });
});

describe("niceTicks", () => {
  const cases: [number, number][] = [
    [0, 3.675],
    [-2.3, 4.3],
    [0, 0.00042],
    [0, 48000],
  ];
  for (const [lo, hi] of cases) {
    it(`gives 3 to 6 ascending round values inside [${lo}, ${hi}] with no -0`, () => {
      const ticks = niceTicks(lo, hi);
      expect(ticks.length).toBeGreaterThanOrEqual(3);
      expect(ticks.length).toBeLessThanOrEqual(6);
      for (let i = 0; i < ticks.length; i++) {
        expect(ticks[i]).toBeGreaterThanOrEqual(lo);
        expect(ticks[i]).toBeLessThanOrEqual(hi);
        expect(Object.is(ticks[i], -0)).toBe(false);
        if (i > 0) expect(ticks[i]).toBeGreaterThan(ticks[i - 1]);
      }
    });
  }
});

describe("spectrumCsv", () => {
  const points: SpectrumPoint[] = [
    pt(2.0, 1.5, 0.1, { band: 7, det: 3, date: "2025-07-06" }),
    pt(1.0, 0.25, 0.02),
    pt(3.0, NaN, 0.1, { band: 9 }),
  ];

  it("writes the MJy/sr header, one row per valid point in wavelength order, ending in a newline", () => {
    const csv = spectrumCsv(points, "MJy/sr");
    const lines = csv.split("\n");
    expect(lines[0]).toBe("band,wavelength_um,value_MJy_per_sr,error,detector,date");
    expect(lines[1]).toBe(",1,0.25,0.02,,");
    expect(lines[2]).toBe("7,2,1.5,0.1,3,2025-07-06");
    expect(lines.length).toBe(4); // header, two rows, empty string after the final newline
    expect(lines[3]).toBe("");
    expect(csv.endsWith("\n")).toBe(true);
  });

  it("writes the mJy header", () => {
    expect(spectrumCsv(points, "mJy").split("\n")[0]).toBe("band,wavelength_um,value_mJy,error,detector,date");
  });
});

describe("SpectrumChart markup", () => {
  const hundred: SpectrumPoint[] = Array.from({ length: 100 }, (_, i) => ({
    wl: 0.8 + (4.1 * i) / 99,
    value: 1 + Math.sin(i / 7),
    err: 0.1,
    band: i,
    det: 1 + (i % 6),
    date: "2025-07-06",
  }));

  it("renders 100 dots, the labels, the notes and both molecule families", () => {
    const markup = renderToStaticMarkup(<SpectrumChart points={hundred} units="MJy/sr" families={families} />);
    expect((markup.match(/<circle/g) ?? []).length).toBe(100);
    expect(markup).toContain('role="img"');
    expect(markup).toContain("100 bands");
    expect(markup).toContain('data-family="gas"');
    expect(markup).toContain('data-family="ice"');
    expect(markup).toContain("False color: infrared is invisible, so colors stand in for wavelength.");
    expect(markup).toContain("Built from single images taken over many months");
    expect(markup).toContain("Download CSV");
    expect(markup).toContain("Wavelength (µm)");
    expect(markup).toContain("Brightness (MJy/sr)");
    expect(markup).not.toContain("NaN");
    expect(markup).not.toContain("undefined");
  });

  it("colours dots by wavelength by default, and in gray for mono vision", () => {
    const two = [pt(0.8, 1), pt(4.9, 1)];
    const normal = circleFills(renderToStaticMarkup(<SpectrumChart points={two} units="mJy" />));
    expect(normal).toHaveLength(2);
    expect(normal[0]).not.toBe(normal[1]);

    const mono = circleFills(renderToStaticMarkup(<SpectrumChart points={two} units="mJy" vision="mono" />));
    expect(mono).toHaveLength(2);
    expect(new Set(mono).size).toBe(1);
  });

  it("puts the band details in a title, and leaves out missing parts", () => {
    const full = renderToStaticMarkup(
      <SpectrumChart points={[pt(1.2345, 0.123456, 0.0123, { band: 12, det: 2, date: "2025-07-06" })]} units="MJy/sr" />,
    );
    expect(full).toContain("Band 12");
    expect(full).toContain("1.235 µm");
    expect(full).toContain("D2");
    expect(full).toContain("2025-07-06");

    const bare = renderToStaticMarkup(<SpectrumChart points={[pt(1.2345, 0.123456, 0.0123)]} units="MJy/sr" />);
    expect(bare).not.toContain("Band");
    expect(bare).not.toContain("detector");
    expect(bare).not.toContain("undefined");
  });

  it("shows the empty state for no points", () => {
    const markup = renderToStaticMarkup(<SpectrumChart points={[]} units="mJy" />);
    expect(markup).toContain("Spectrum: no data");
    expect(markup).toContain("No spectrum here.");
    expect(markup).not.toContain("<circle");
    expect(markup).not.toContain("NaN");
  });

  it("shows the same empty state when every point is invalid", () => {
    const markup = renderToStaticMarkup(
      <SpectrumChart points={[pt(1, NaN), pt(2, NaN, 0.1), pt(NaN, 1)]} units="mJy" families={families} />,
    );
    expect(markup).toContain("Spectrum: no data");
    expect(markup).toContain("No spectrum here.");
    expect(markup).not.toContain("<circle");
    expect(markup).not.toContain("NaN");
  });

  it("draws a dashed polyline with data-model and the label in the legend for a model curve", () => {
    const model = { label: "Blackbody 800 K", wl: [0.8, 2, 4.9], value: [0.5, 1, 2] };
    const markup = renderToStaticMarkup(<SpectrumChart points={[pt(1, 1)]} units="mJy" models={[model]} />);
    expect(markup).toContain('<polyline');
    expect(markup).toContain('data-model="Blackbody 800 K"');
    const legend = markup.slice(markup.indexOf("<ul"), markup.indexOf("</ul>"));
    expect(legend).toContain("Blackbody 800 K");
  });
});
