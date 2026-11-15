import { describe, expect, it } from "vitest";
import { crowdAgreement, fitTrack, sameTrack, type CrowdMark, type CrowdRow } from "@/lib/server/patchCrowd";

const T = 60000;
const track = (x0: number, y0: number, vx: number, vy: number, times: number[]): CrowdMark[] =>
  times.map((t) => ({ x: x0 + vx * t, y: y0 + vy * t, mjd: T + t }));
const row = (user_id: string | null, marks: CrowdMark[], created_at = "2026-01-01T00:00:00Z"): CrowdRow => ({ user_id, marks, created_at });
const mine = track(10, 10, 5, 2, [0, 0.5, 1]);

describe("sameTrack", () => {
  it("identical tracks agree", () => expect(sameTrack(mine, mine)).toBe(true));
  it("an offset beyond the tolerance disagrees, a small one agrees", () => {
    expect(sameTrack(mine, track(10, 15, 5, 2, [0, 0.5, 1]))).toBe(false);
    expect(sameTrack(mine, track(11, 10.5, 5, 2, [0, 0.5, 1]))).toBe(true);
  });
  it("same motion marked at other frame times agrees", () => {
    expect(sameTrack(mine, track(10, 10, 5, 2, [0.1, 0.7]))).toBe(true);
  });
  it("a different direction disagrees", () => expect(sameTrack(mine, track(10, 10, -5, 2, [0, 0.5, 1]))).toBe(false));
  it("fewer than 2 marks, or one time, never match", () => {
    expect(fitTrack(mine.slice(0, 1))).toBeNull();
    expect(sameTrack(mine, mine.slice(0, 1))).toBe(false);
    expect(sameTrack(mine, [mine[0], { ...mine[0] }])).toBe(false);
  });
});

describe("crowdAgreement", () => {
  it("is first when nobody else reported", () => {
    expect(crowdAgreement(mine, [], "me")).toEqual({ others: 0, agree: 0, first: true });
  });
  it("leaves out the player's own reports", () => {
    expect(crowdAgreement(mine, [row("me", mine)], "me")).toEqual({ others: 0, agree: 0, first: true });
  });
  it("counts a resubmitting player once, by the newest report", () => {
    const far = track(10, 30, 5, 2, [0, 1]);
    const rows = [row("a", far, "2026-01-01T00:00:00Z"), row("a", mine, "2026-01-02T00:00:00Z"), row("a", far, "2026-01-01T12:00:00Z")];
    expect(crowdAgreement(mine, rows, "me")).toEqual({ others: 1, agree: 1, first: false });
  });
  it("counts agreeing and disagreeing players", () => {
    const rows = [row("a", mine), row("b", track(10, 40, 5, 2, [0, 1])), row("c", mine.slice(0, 1))];
    expect(crowdAgreement(mine, rows, null)).toEqual({ others: 3, agree: 1, first: false });
  });
  it("leaves guests out", () => {
    expect(crowdAgreement(mine, [row(null, mine), row(null, mine)], "me")).toEqual({ others: 0, agree: 0, first: true });
  });
});
