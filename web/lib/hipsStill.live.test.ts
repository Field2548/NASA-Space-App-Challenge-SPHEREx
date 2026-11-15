// Live check (network; skipped unless QL_LIVE=1): the HiPS still lines up with real SPHEREx frames.
// Renders the Eros field's grid from IRSA's all-sky HiPS tiles in each of the 8 ways a tile can be
// flipped or turned, and correlates (Pearson) each with the median of the field's own frames.
// The orientation lib/hipsStill.ts uses must be the best one, by a clear margin.
//   QL_LIVE=1 npx vitest run lib/hipsStill.live.test.ts

import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { HIPS_SOURCES } from "./hipsProxy";
import { orient, paintStill, planStill, setOrientForCheck, STILL_TILE_PX, stillTilePath } from "./hipsStill";
import type { FieldWcs } from "./types";

const N = STILL_TILE_PX - 1;
const WAYS: Record<string, (x: number, y: number) => { col: number; row: number }> = {
  "col=x,row=y": (x, y) => ({ col: x, row: y }),
  "col=x,row=N-y": (x, y) => ({ col: x, row: N - y }),
  "col=N-x,row=y": (x, y) => ({ col: N - x, row: y }),
  "col=N-x,row=N-y": (x, y) => ({ col: N - x, row: N - y }),
  "col=y,row=x": (x, y) => ({ col: y, row: x }),
  "col=y,row=N-x": (x, y) => ({ col: y, row: N - x }),
  "col=N-y,row=x": (x, y) => ({ col: N - y, row: x }),
  "col=N-y,row=N-x": (x, y) => ({ col: N - y, row: N - x }),
};

/** Pearson correlation over the pixels where `b` is not the 65535 "no data" value. */
function pearson(a: number[], b: number[]): number {
  const k = b.map((v, i) => i).filter((i) => b[i] !== 65535);
  const ma = k.reduce((s, i) => s + a[i], 0) / k.length;
  const mb = k.reduce((s, i) => s + b[i], 0) / k.length;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (const i of k) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  return sab / Math.sqrt(saa * sbb);
}

describe.skipIf(!process.env.QL_LIVE)("HiPS still on the Eros field", () => {
  it("the library's tile orientation matches the field's own frames best", async () => {
    const dir = path.join(process.cwd(), "public/fields/eros");
    const field = JSON.parse(await readFile(path.join(dir, "field.json"), "utf8")) as { size: [number, number]; wcs: FieldWcs; frames: unknown[] };
    const [w, h] = field.size;
    const buf = await readFile(path.join(dir, "frames.u16"));
    const u16 = new Uint16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
    const nf = field.frames.length;
    // 65535 marks "no data" in a frame; the median skips it (65535 when no frame has data).
    const median = Array.from({ length: w * h }, (_, k) => {
      const v = Array.from({ length: nf }, (_, f) => u16[f * w * h + k]).filter((x) => x !== 65535).sort((a, b) => a - b);
      return v.length ? v[Math.floor(v.length / 2)] : 65535;
    });

    const keep = orient;
    const plan0 = planStill(field.wcs, [w, h]);
    const tiles = await Promise.all(
      plan0.tiles.map(async (t) => {
        const res = await fetch(`${HIPS_SOURCES.irsa}/${stillTilePath(t)}`);
        if (!res.ok) return null;
        const { data } = await sharp(Buffer.from(await res.arrayBuffer())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        return new Uint8Array(data);
      }),
    );
    expect(tiles.every((t) => t !== null)).toBe(true);

    const score: Record<string, number> = {};
    for (const [name, f] of Object.entries(WAYS)) {
      setOrientForCheck(f);
      const plan = planStill(field.wcs, [w, h]);
      expect(plan.tiles).toEqual(plan0.tiles);
      const px = paintStill(plan, tiles);
      const lum = Array.from({ length: w * h }, (_, k) => px[k * 4] + px[k * 4 + 1] + px[k * 4 + 2]);
      score[name] = pearson(lum, median);
      if (process.env.QL_DUMP) await sharp(Buffer.from(px), { raw: { width: w, height: h, channels: 4 } }).png().toFile(`${process.env.QL_DUMP}/${name}.png`);
    }
    setOrientForCheck(keep);
    console.log("[hips-still] correlation by orientation:", JSON.stringify(score));
    const mine = Object.entries(WAYS).find(([, f]) => {
      const a = f(3, 200);
      const b = keep(3, 200);
      return a.col === b.col && a.row === b.row;
    })?.[0] as string;
    const others = Object.entries(score).filter(([k]) => k !== mine).map(([, v]) => v);
    expect(score[mine]).toBeGreaterThan(0.3);
    expect(score[mine]).toBeGreaterThan(Math.max(...others) + 0.2);
  }, 120_000);
});
