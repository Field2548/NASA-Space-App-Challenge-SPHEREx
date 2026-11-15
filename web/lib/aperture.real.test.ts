// Circle spectrum on the shipped Cygnus cube: bright stars give a high-S/N spectrum, the loader
// fetches only the tiles the background ring touches, and an ordinary star shows no false ice dip.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { iceDips, loadApertureSpectrum } from "./aperture";
import { clearSpectrumCache, loadSpectrumIndex, loadSpectrumTile, tileValue } from "./inspect";
import type { Field } from "./types";

const WEB = join(__dirname, "..");
const CYG = join(WEB, "public/fields/cygnus");
const field = JSON.parse(readFileSync(join(CYG, "field.json"), "utf8")) as Field;
const withCube: Field = { ...field, has: { ...field.has, spectrum: true } };

function diskFetch(urls: string[]) {
  return (async (url: string) => {
    urls.push(url);
    try {
      return new Response(readFileSync(join(WEB, "public", url)));
    } catch {
      return new Response("missing", { status: 404 });
    }
  }) as unknown as typeof fetch;
}

const median = (v: number[]) => {
  const a = [...v].sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

/** The n brightest local maxima near 1 um, at least `edge` px from the cube edge and 10 px apart. */
async function brightPixels(n: number, edge: number): Promise<[number, number][]> {
  const idx = await loadSpectrumIndex(withCube, diskFetch([]));
  const b = idx.bands.reduce((best, bd, i) => (Math.abs(bd.wavelength_um - 1) < Math.abs(idx.bands[best].wavelength_um - 1) ? i : best), 0);
  const [cw, ch] = idx.covered;
  const [ox, oy] = idx.origin;
  const vals: { x: number; y: number; v: number }[] = [];
  for (let ty = 0; ty < idx.ny; ty++)
    for (let tx = 0; tx < idx.nx; tx++) {
      const tile = await loadSpectrumTile(withCube, idx, tx, ty, diskFetch([]));
      for (let j = 0; j < idx.tile; j++)
        for (let i = 0; i < idx.tile; i++) {
          const x = ox + tx * idx.tile + i;
          const y = oy + ty * idx.tile + j;
          if (x - ox < edge || y - oy < edge || x - ox >= cw - edge || y - oy >= ch - edge) continue;
          const v = tileValue(tile, idx, b, x, y);
          if (Number.isFinite(v)) vals.push({ x, y, v });
        }
    }
  vals.sort((p, q) => q.v - p.v);
  const out: [number, number][] = [];
  for (const p of vals) {
    if (out.some(([x, y]) => Math.hypot(x - p.x, y - p.y) < 10)) continue;
    out.push([p.x, p.y]);
    if (out.length === n) break;
  }
  return out;
}

describe("circle spectrum on the real Cygnus cube", () => {
  it("bright stars: high S/N, few tiles, no false ice dip", async () => {
    clearSpectrumCache();
    const stars = await brightPixels(3, 8);
    for (const [x, y] of stars) {
      clearSpectrumCache();
      const urls: string[] = [];
      const s = await loadApertureSpectrum(withCube, x, y, 2, diskFetch(urls));
      expect(s).not.toBeNull();
      const tiles = urls.filter((u) => u.endsWith(".u16"));
      expect(tiles.length).toBeLessThanOrEqual(4);
      const i1 = s!.wl.reduce((best, w, i) => (Math.abs(w - 1) < Math.abs(s!.wl[best] - 1) ? i : best), 0);
      const snr = median(s!.flux.map((f, i) => f / s!.err[i]));
      const ice = iceDips(s!);
      console.log(
        `cygnus (${x},${y}) r=2: ${s!.wl.length} bands, F(${s!.wl[i1].toFixed(3)} um) = ${s!.flux[i1].toFixed(2)} +- ${s!.err[i1].toFixed(2)} mJy, median S/N ${snr.toFixed(1)}, tiles ${tiles.length}, inflation ${ice.inflation.toFixed(2)}, dips ${ice.dips
          .map((d) => `${d.feature} ${d.sigma.toFixed(1)}sig tau ${d.tau?.toFixed(3)}${d.detected ? " DETECTED" : ""}`)
          .join("; ")}`,
      );
      expect(snr).toBeGreaterThan(10);
      // (95, 39) has one low band at 2.98 um (5 sigma alone); it must not pass as a water-ice dip.
      expect(ice.dips.filter((d) => d.detected)).toEqual([]);
    }
  });
});
