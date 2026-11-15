// @vitest-environment jsdom
// The player's own patch results in localStorage, in the GET /api/patches shape, with no names.
import { beforeEach, describe, expect, it } from "vitest";
import { patchFromPoint } from "./patch";
import { isLocallySolved, loadLocalPatchSolves, PATCH_SOLVES_KEY, savePatchCheck, saveLocalPatchResult, type PatchCheckResponse } from "./patchSolves";

const p = patchFromPoint(13.2004, 14.38);
const res = (o: Partial<PatchCheckResponse>) =>
  ({ unlocked: false, verdict: { kind: "wrong" }, patch: { id: p.id, ra: p.ra, dec: p.dec }, solve_saved: false, ...o }) as PatchCheckResponse;

beforeEach(() => localStorage.clear());

describe("local patch solves", () => {
  it("a correct answer is kept as a solve with sky points only", () => {
    savePatchCheck(
      res({
        unlocked: true,
        verdict: { kind: "known" } as never,
        objects: [{ ra: 13.2, dec: 14.4 }],
        known_objects: { asteroids: [{ name: "433 Eros (A898 PA)", positions: [] }], stars: [] },
      }),
    );
    const [s] = loadLocalPatchSolves();
    expect(s).toMatchObject({ id: p.id, ra: p.ra, dec: p.dec, size_deg: p.size_deg, objects: [{ ra: 13.2, dec: 14.4 }], reports: [] });
    expect(s.corners).toHaveLength(4);
    expect(typeof s.solved_at).toBe("string");
    expect(isLocallySolved(p.id)).toBe(true);
    expect(localStorage.getItem(PATCH_SOLVES_KEY)).not.toContain("Eros");
  });

  it("a candidate is a report, not a solve; a wrong answer keeps nothing", () => {
    savePatchCheck(res({}));
    expect(loadLocalPatchSolves()).toEqual([]);
    savePatchCheck(res({ verdict: { kind: "candidate" } as never, report: { saved: false, positions: [{ ra: 1, dec: 2 }] } }));
    const [s] = loadLocalPatchSolves();
    expect(s.solved_at).toBeNull();
    expect(s.reports).toEqual([{ ra: 1, dec: 2 }]);
    expect(isLocallySolved(p.id)).toBe(false);
  });

  it("the first solve time is kept, bad ids and broken storage are ignored", () => {
    saveLocalPatchResult(p.id, { solved: true }, "2026-11-01T00:00:00Z");
    saveLocalPatchResult(p.id, { solved: true }, "2026-11-02T00:00:00Z");
    saveLocalPatchResult("eros", { solved: true });
    expect(loadLocalPatchSolves().map((s) => s.solved_at)).toEqual(["2026-11-01T00:00:00Z"]);
    localStorage.setItem(PATCH_SOLVES_KEY, "{not json");
    expect(() => loadLocalPatchSolves()).not.toThrow();
  });
});
