// Live check (network; skipped unless QL_LIVE=1). BUILD_PROMPT 16: the browser's Range-read pixels
// must equal IRSA's cutout for the same file and area. This half reads real rows from the public S3
// bucket with lib/fits.ts and dumps them to QL_DUMP; pipeline/dev/compare_quicklook_cutout.py
// fetches IRSA's cutout of the same file and compares. It also runs the whole quick look once.
//   QL_LIVE=1 QL_DUMP=/path/rows.json npx vitest run lib/quicklook.live.test.ts

import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findHdu, readHeaders, readRows } from "./fits";
import { planQuickLook, runQuickLook } from "./quicklook";
import { listQuickLook } from "./quicklookList";
import { compileSipWcs, sipWorldToPixel } from "./sipwcs";

const RA = Number(process.env.QL_RA ?? 13.2004);
const DEC = Number(process.env.QL_DEC ?? 14.38);

describe.skipIf(!process.env.QL_LIVE)("quick look on real SPHEREx files", () => {
  it("Range-reads rows from S3 and builds frames", { timeout: 240_000 }, async () => {
    const list = await listQuickLook(RA, DEC);
    const e = list.exposures.find((x) => x.url && x.covers_field);
    expect(e).toBeDefined();
    const url = e!.url as string;
    const { hdus } = await readHeaders(url, { stopAfter: "IMAGE" });
    const img = findHdu(hdus, "IMAGE")!;
    const p = sipWorldToPixel(compileSipWcs(img.header), RA, DEC);
    const half = 20;
    const y0 = Math.round(p.y) - half;
    const y1 = Math.round(p.y) + half;
    const x0 = Math.round(p.x) - half;
    const x1 = Math.round(p.x) + half;
    const rows = await readRows(url, img, y0, y1);
    const w = img.naxis[0];
    const patch: number[][] = [];
    for (let y = y0; y <= y1; y++) {
      const r: number[] = [];
      for (let x = x0; x <= x1; x++) r.push(rows[(y - y0) * w + x]);
      patch.push(r);
    }
    if (process.env.QL_DUMP) {
      writeFileSync(
        process.env.QL_DUMP,
        JSON.stringify({ url, access_url: e!.access_url, obs_id: e!.obs_id, detector: e!.detector, ra: RA, dec: DEC, x0, y0, patch,
          crpix: [img.header.CRPIX1, img.header.CRPIX2] }),
      );
    }

    const plan = planQuickLook(list.exposures, { ra: RA, dec: DEC, frames: 3, spacing: "even", minGapHours: 1, detectors: [], perBurst: 3 });
    const field = await runQuickLook(plan, () => {}, new AbortController().signal);
    const summary = {
      exposures: list.exposures.length,
      planned: plan.exposures.length,
      frames: field.frames.length,
      bytesDownloaded: field.bytesDownloaded,
      bytesPlanned: plan.bytes,
      skipped: field.exposures.filter((r) => r.skipped).map((r) => r.skipped),
    };
    if (process.env.QL_DUMP) writeFileSync(process.env.QL_DUMP.replace(/\.json$/, ".summary.json"), JSON.stringify(summary));
    expect(field.frames.length).toBeGreaterThan(0);
  });
});
