import { describe, expect, it } from "vitest";
import { computeAchievements, type SpotInfo } from "@/lib/achievements";

const spots: SpotInfo[] = [
  { slug: "a1", kind: "asteroid", difficulty: "easy" },
  { slug: "a2", kind: "asteroid", difficulty: "medium" },
  { slug: "d1", kind: "dwarf-planet", difficulty: "hard" },
  { slug: "d2", kind: "dwarf-planet", difficulty: "boss" },
  { slug: "c1", kind: "control", difficulty: "medium" },
  { slug: "s1", kind: "star", difficulty: "tool" },
  { slug: "s2", kind: "star", difficulty: "tool" },
];
const solve = (slug: string, at: string | null) => {
  const s = spots.find((x) => x.slug === slug)!;
  return { ...s, at };
};
const byId = (l: ReturnType<typeof computeAchievements>) => Object.fromEntries(l.map((a) => [a.id, a]));

describe("computeAchievements", () => {
  it("caps goals at the number of spots of that kind", () => {
    const a = byId(computeAchievements([], spots, 0));
    expect(a["rock-hunter"].goal).toBe(2);
    expect(a["tool-tester"].goal).toBe(2);
    expect(a["star-collector"].goal).toBe(2);
    expect(a["ice-giants-club"].goal).toBe(2);
    expect(a["completionist"].goal).toBe(7);
    expect(a["boss"].goal).toBe(1);
  });

  it("omits achievements whose kind has no spots", () => {
    const ids = computeAchievements([], spots.filter((s) => s.kind !== "star" && s.kind !== "control"), 0).map((a) => a.id);
    expect(ids).not.toContain("tool-tester");
    expect(ids).not.toContain("star-collector");
    expect(ids).not.toContain("still-sky");
    expect(ids).toContain("first-light");
  });

  it("unlockedAt is the time of the solve that completed the goal", () => {
    const a = byId(
      computeAchievements(
        [solve("a2", "2026-02-01T00:00:00Z"), solve("a1", "2026-03-01T00:00:00Z"), solve("a1", "2026-04-01T00:00:00Z")],
        spots,
        0,
      ),
    );
    expect(a["first-light"].unlockedAt).toBe("2026-02-01T00:00:00Z");
    expect(a["rock-hunter"].unlocked).toBe(true);
    expect(a["rock-hunter"].unlockedAt).toBe("2026-03-01T00:00:00Z");
    expect(a["completionist"].unlocked).toBe(false);
    expect(a["completionist"].unlockedAt).toBeNull();
  });

  it("guest solves have no times", () => {
    const a = byId(computeAchievements([solve("c1", null)], spots, 0));
    expect(a["still-sky"].unlocked).toBe(true);
    expect(a["still-sky"].unlockedAt).toBeNull();
  });

  it("ignores spots that do not exist and tiers follow points", () => {
    const a = byId(computeAchievements([{ slug: "zzz", kind: "asteroid", difficulty: "easy", at: null }], spots, 1200));
    expect(a["first-light"].progress).toBe(0);
    expect(a["points-1"].unlocked).toBe(true);
    expect(a["points-2"].unlocked).toBe(false);
    expect(a["points-2"].progress).toBe(1200);
  });
});
