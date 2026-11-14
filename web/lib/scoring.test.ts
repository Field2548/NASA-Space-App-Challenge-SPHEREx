// Scoring against the real answer keys DATA exported (web/data/answers) and the fixture.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkSubmission,
  firstFinderBonus,
  fitTrack,
  loadAnswerKey,
  loadFieldForScoring,
  pointsFor,
  scoreSubmission,
  ScoringError,
  type AnswerKey,
  type FieldForScoring,
  type Mark,
} from "@/lib/scoring";

const root = process.cwd();

async function spot(slug: string): Promise<{ key: AnswerKey; field: FieldForScoring }> {
  const [key, field] = await Promise.all([loadAnswerKey(slug, root), loadFieldForScoring(slug, root)]);
  if (!key || !field) throw new Error(`missing test data for ${slug}`);
  return { key, field };
}

/** Marks placed on a known object's answer-key positions (rounded, like a click). */
function marksOn(key: AnswerKey, frames?: number[]): Mark[] {
  return key.objects[0].positions
    .filter((p) => p.in_grid && (!frames || frames.includes(p.frame)))
    .map((p) => ({ frame: p.frame, x: Math.round(p.x), y: Math.round(p.y) }));
}

describe("pointsFor", () => {
  it("follows the build prompt table, with +50 percent for a first finder", () => {
    expect(pointsFor("known", "easy", false)).toBe(100);
    expect(pointsFor("known", "medium", false)).toBe(250);
    expect(pointsFor("known", "hard", false)).toBe(500);
    expect(pointsFor("known", "boss", false)).toBe(1000);
    expect(pointsFor("known", "expert", false)).toBe(750);
    expect(pointsFor("known", "boss", true)).toBe(1500);
    expect(firstFinderBonus("known", "medium")).toBe(125);
  });
  it("gives nothing for verdicts that are not correct finds", () => {
    for (const kind of ["candidate", "static", "nothing_wrong"] as const) {
      expect(pointsFor(kind, "boss", true)).toBe(0);
    }
    expect(pointsFor("known", "no-such-difficulty", false)).toBe(0);
  });
});

describe("fitTrack", () => {
  it("recovers a straight line and the rate in arcsec per hour", () => {
    const field: FieldForScoring = {
      slug: "t",
      difficulty: "easy",
      pixel_arcsec: 6.15,
      frames: [
        { i: 1, mjd: 100 },
        { i: 2, mjd: 100.5 },
        { i: 3, mjd: 101 },
      ],
    };
    const t = fitTrack(
      [
        { frame: 3, x: 14, y: 7 },
        { frame: 1, x: 10, y: 10 },
        { frame: 2, x: 12, y: 8.5 },
      ],
      field,
    );
    expect(t.x0).toBeCloseTo(10, 6);
    expect(t.y0).toBeCloseTo(10, 6);
    expect(t.vx).toBeCloseTo(4, 6);
    expect(t.vy).toBeCloseTo(-3, 6);
    expect(t.rms).toBeCloseTo(0, 6);
    expect(t.rate_arcsec_per_hour).toBeCloseTo((5 * 6.15) / 24, 6);
  });
});

describe("the fixture spot", () => {
  it("confirms the mover from two marks", async () => {
    const r = await checkSubmission(
      "fixture",
      { answer: "track", marks: [{ frame: 1, x: 10, y: 16 }, { frame: 4, x: 16, y: 16 }] },
      root,
    );
    expect(r.verdict.kind).toBe("known");
    expect(r.verdict.object_name).toBe("Fixture mover");
    expect(r.verdict.points).toBe(100);
    expect(r.reveal).toEqual({ frame: 1, x: 10, y: 16 });
    expect(r.track?.vx).toBeCloseTo(16, 6);
  });
  it("accepts clicks up to 2 px off and rejects 3 px off", async () => {
    const near = await checkSubmission(
      "fixture",
      { answer: "track", marks: [{ frame: 1, x: 12, y: 16 }, { frame: 4, x: 16, y: 18 }] },
      root,
    );
    expect(near.verdict.kind).toBe("known");
    const { key, field } = await spot("fixture");
    const far = scoreSubmission({ ...key, bot: { candidates: [] } }, field, {
      answer: "track",
      marks: [{ frame: 1, x: 13, y: 16 }, { frame: 4, x: 19, y: 16 }],
    });
    expect(far.verdict.kind).toBe("candidate");
  });
  it("needs the object in two frames: one hit is not enough", async () => {
    const r = await checkSubmission(
      "fixture",
      { answer: "track", marks: [{ frame: 1, x: 10, y: 16 }, { frame: 4, x: 25, y: 3 }] },
      root,
    );
    expect(r.verdict.kind).toBe("candidate");
    expect(r.verdict.points).toBe(0);
    expect(r.verdict.object_name).toBeUndefined();
  });
  it("calls a still star a star", async () => {
    const r = await checkSubmission(
      "fixture",
      { answer: "track", marks: [{ frame: 1, x: 8, y: 8 }, { frame: 4, x: 8.4, y: 8 }] },
      root,
    );
    expect(r.verdict.kind).toBe("static");
    expect(r.verdict.points).toBe(0);
  });
  it("says 'nothing' is wrong here, without naming the object", async () => {
    const r = await checkSubmission("fixture", { answer: "nothing" }, root);
    expect(r.verdict.kind).toBe("nothing_wrong");
    expect(JSON.stringify(r)).not.toContain("Fixture mover");
  });
  it("rejects bad marks and unknown spots", async () => {
    const twice = { answer: "track" as const, marks: [{ frame: 1, x: 1, y: 1 }, { frame: 1, x: 2, y: 2 }] };
    await expect(checkSubmission("fixture", twice, root)).rejects.toMatchObject({ code: "bad_request" });
    const noFrame = { answer: "track" as const, marks: [{ frame: 1, x: 1, y: 1 }, { frame: 9, x: 2, y: 2 }] };
    await expect(checkSubmission("fixture", noFrame, root)).rejects.toBeInstanceOf(ScoringError);
    await expect(checkSubmission("no-such-spot", { answer: "nothing" }, root)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(checkSubmission("../data/x", { answer: "nothing" }, root)).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("bot matches", () => {
  it("matches a bot candidate only above the noise bar, and always quotes the bar", async () => {
    const { key, field } = await spot("fixture");
    const botOnly = { ...key, objects: [] };
    const sub = { answer: "track" as const, marks: [{ frame: 1, x: 10.5, y: 16 }, { frame: 4, x: 16, y: 16.5 }] };
    const hit = scoreSubmission(botOnly, field, sub);
    expect(hit.verdict.kind).toBe("bot_match");
    expect(hit.verdict.message).toContain("38.0σ");
    expect(hit.verdict.message).toContain("6.0σ noise bar");
    expect(hit.noise_bar_sigma).toBe(6);
    // No noise bar on record: never claim a detection.
    expect(scoreSubmission({ ...botOnly, noise_bar_sigma: null }, field, sub).verdict.kind).toBe("candidate");
    // Candidate below the bar.
    expect(scoreSubmission({ ...botOnly, noise_bar_sigma: 50 }, field, sub).verdict.kind).toBe("candidate");
  });
  it("rejects a track that crosses the bot's path in the wrong direction", async () => {
    const { key, field } = await spot("fixture");
    const r = scoreSubmission({ ...key, objects: [] }, field, {
      answer: "track",
      marks: [{ frame: 1, x: 16, y: 16 }, { frame: 4, x: 10, y: 16 }],
    });
    expect(r.verdict.kind).toBe("candidate");
  });
});

describe("the real spots", () => {
  const have = (slug: string) => existsSync(path.join(root, "data", "answers", `${slug}.json`));
  const cases: [string, string, number][] = [
    ["eros", "Eros", 100],
    ["hektor", "Hektor", 250],
    ["makemake", "Makemake", 500],
    ["eris", "Eris", 1000],
  ];
  for (const [slug, name, points] of cases) {
    it.runIf(have(slug))(`${slug}: marks on the object give "known" and ${points} points`, async () => {
      const { key } = await spot(slug);
      const marks = marksOn(key);
      expect(marks.length).toBeGreaterThanOrEqual(2);
      const r = await checkSubmission(slug, { answer: "track", marks: [marks[0], marks[marks.length - 1]] }, root);
      expect(r.verdict.kind).toBe("known");
      expect(r.verdict.object_name).toContain(name);
      expect(r.verdict.points).toBe(points);
    });
    it.runIf(have(slug))(`${slug}: "nothing moved" is wrong`, async () => {
      const r = await checkSubmission(slug, { answer: "nothing" }, root);
      expect(r.verdict.kind).toBe("nothing_wrong");
      expect(JSON.stringify(r)).not.toContain(name);
    });
  }
  it.runIf(have("eris"))("eris: two neighbouring frames still count as known, not static", async () => {
    const { key } = await spot("eris");
    const r = await checkSubmission("eris", { answer: "track", marks: marksOn(key, [1, 2]) }, root);
    expect(r.verdict.kind).toBe("known");
  });
  it.runIf(have("eros"))("eros: positions outside the picture are never matched", async () => {
    const { key } = await spot("eros");
    const out = key.objects[0].positions.filter((p) => !p.in_grid);
    if (out.length >= 2) {
      const r = await checkSubmission(
        "eros",
        { answer: "track", marks: out.slice(0, 2).map((p) => ({ frame: p.frame, x: p.x, y: p.y })) },
        root,
      );
      expect(r.verdict.kind).not.toBe("known");
    }
  });
  it.runIf(have("cygnus"))("cygnus: 'nothing moved' is correct, random clicks are not a find", async () => {
    const ok = await checkSubmission("cygnus", { answer: "nothing" }, root);
    expect(ok.verdict.kind).toBe("nothing_correct");
    expect(ok.verdict.points).toBe(250);
    const r = await checkSubmission(
      "cygnus",
      { answer: "track", marks: [{ frame: 1, x: 20, y: 20 }, { frame: 5, x: 70, y: 90 }] },
      root,
    );
    expect(r.verdict.kind).toBe("candidate");
    expect(r.verdict.points).toBe(0);
  });
});

describe("answer keys never ship to the browser", () => {
  it("has no answer or catalog JSON under public/", () => {
    const walk = (dir: string): string[] =>
      existsSync(dir)
        ? readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
            e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
          )
        : [];
    const leaked = walk(path.join(root, "public")).filter((f) =>
      /[\\/](answers|catalog)[\\/]/.test(f),
    );
    expect(leaked).toEqual([]);
  });
});
