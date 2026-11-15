// Circle spectrum on the shipped taurus-ice cube at Elias 16 (a K giant behind the Taurus cloud):
// linear tiles decode through the web's own formula and the ice dips are measured on the real star.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { iceDips, loadApertureSpectrum } from "./aperture";
import { clearSpectrumCache } from "./inspect";
import type { Field } from "./types";

const WEB = join(__dirname, "..");
const field = JSON.parse(readFileSync(join(WEB, "public/fields/taurus-ice/field.json"), "utf8")) as Field;

const diskFetch = (async (url: string) => {
  try {
    return new Response(readFileSync(join(WEB, "public", url)));
  } catch {
    return new Response("missing", { status: 404 });
  }
}) as unknown as typeof fetch;

describe("circle spectrum on the real taurus-ice cube", () => {
  it("Elias 16, r = 2: a bright star with a measured ice-dip table", async () => {
    clearSpectrumCache();
    expect(field.has?.spectrum).toBe(true);
    const s = await loadApertureSpectrum(field, 59, 59, 2, diskFetch);
    expect(s).not.toBeNull();
    const ice = iceDips(s!);
    console.log(
      `taurus-ice Elias 16 r=2: ${s!.wl.length} bands, inflation ${ice.inflation.toFixed(2)}, dips ${ice.dips
        .map((d) => `${d.feature} ${d.sigma.toFixed(1)}sig tau ${d.tau?.toFixed(3)}${d.detected ? " DETECTED" : ""}`)
        .join("; ")}`,
    );
    expect(s!.wl.length).toBeGreaterThan(90);
    expect(Math.max(...s!.flux)).toBeGreaterThan(5000); // mJy: the bright star is not clipped by the tile range
  });
});
