// Scoring against the real answer keys DATA exported (web/data/answers) and the fixture.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  botCandidateObject,
  checkSubmission,
  firstFinderBonus,
  fitTrack,
  loadAnswerKey,
  loadFieldForScoring,
  MATCH_RADIUS_PX,
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
  it("gives a bot match 0 points (api.md 1.2), and the first-finder bonus only to known", () => {
    expect(pointsFor("bot_match", "boss", false)).toBe(0);
    expect(pointsFor("bot_match", "boss", true)).toBe(0);
    expect(pointsFor("nothing_correct", "control", true)).toBe(250);
    expect(firstFinderBonus("nothing_correct", "control")).toBe(0);
    expect(firstFinderBonus("bot_match", "boss")).toBe(0);
  });
});

describe("fitTrack", () => {
  it("recovers a straight line and the rate in arcsec per hour", () => {
    const field: FieldForScoring = {
      slug: "t",
      difficulty: "easy",
      pixel_arcsec: 6.15,
      size: [32, 32],
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
  const sub = { answer: "track" as const, marks: [{ frame: 1, x: 10.5, y: 16 }, { frame: 4, x: 16, y: 16.5 }] };

  it("matches a bot candidate above the noise bar, quotes the bar, and pays 0 points", async () => {
    const { key, field } = await spot("fixture");
    const botOnly = { ...key, objects: [] };
    const hit = scoreSubmission(botOnly, field, sub);
    expect(hit.verdict).toEqual({
      kind: "bot_match",
      points: 0,
      message: "Matches the bot: 38.0σ against a 6.0σ noise bar. Not a confirmed object, so no points.",
    });
    expect(hit.noise_bar_sigma).toBe(6);
    expect(hit.matched).toEqual({ find_key: "bot:1", bot_rank: 1 });
  });
  it("never claims a bot match without a noise bar", async () => {
    const { key, field } = await spot("fixture");
    expect(scoreSubmission({ ...key, objects: [], noise_bar_sigma: null }, field, sub).verdict.kind).toBe("candidate");
  });
  it("needs above_noise_bar: a candidate flagged below the bar is not a match, whatever its S/N", async () => {
    // Fails if the above_noise_bar check is deleted: stacked_snr 38 is far above the 6σ bar.
    const { key, field } = await spot("fixture");
    const flagged = { ...key, objects: [], bot: { candidates: key.bot.candidates.map((c) => ({ ...c, above_noise_bar: false })) } };
    expect(flagged.bot.candidates[0].stacked_snr).toBeGreaterThan(flagged.noise_bar_sigma!);
    expect(scoreSubmission(flagged, field, sub).verdict.kind).toBe("candidate");
  });
  it("needs stacked_snr above the noise bar, even when the candidate is flagged above it", async () => {
    // Fails if the stacked_snr > noise_bar_sigma check is deleted: above_noise_bar stays true.
    const { key, field } = await spot("fixture");
    const r = scoreSubmission({ ...key, objects: [], noise_bar_sigma: 50 }, field, sub);
    expect(key.bot.candidates[0].above_noise_bar).toBe(true);
    expect(r.verdict.kind).toBe("candidate");
    // Equal to the bar is not above it.
    expect(scoreSubmission({ ...key, objects: [], noise_bar_sigma: 38 }, field, sub).verdict.kind).toBe("candidate");
  });
  it("rejects a track that crosses the bot's path in the wrong direction", async () => {
    const { key, field } = await spot("fixture");
    const r = scoreSubmission({ ...key, objects: [] }, field, {
      answer: "track",
      marks: [{ frame: 1, x: 16, y: 16 }, { frame: 4, x: 10, y: 16 }],
    });
    expect(r.verdict.kind).toBe("candidate");
  });
  it("needs the marks on the path in every marked frame, not just two", async () => {
    const { key, field } = await spot("fixture");
    const r = scoreSubmission({ ...key, objects: [] }, field, {
      answer: "track",
      marks: [{ frame: 1, x: 10, y: 16 }, { frame: 2, x: 12, y: 16 }, { frame: 4, x: 16, y: 25 }],
    });
    expect(r.verdict.kind).toBe("candidate");
  });
  it("checks bot_match before static: a slow bot candidate in two close frames is a bot match", async () => {
    // A candidate moving 0.5 px/day: over frames 1 and 4 (9 hours) it moves 0.19 px, under the 1 px rule.
    const { key, field } = await spot("fixture");
    const slow = {
      ...key,
      objects: [],
      bot: { candidates: [{ rank: 1, x: 20, y: 20, vx_px_per_day: 0.5, vy_px_per_day: 0, stacked_snr: 9, above_noise_bar: true }] },
    };
    const at = (frame: number) => {
      const t = field.frames.find((f) => f.i === frame)!.mjd - key.t_ref_mjd;
      return { frame, x: 20 + 0.5 * t, y: 20 };
    };
    const r = scoreSubmission(slow, field, { answer: "track", marks: [at(1), at(4)] });
    expect(r.verdict.kind).toBe("bot_match");
    // The same marks with no bot candidate are a star.
    expect(scoreSubmission({ ...slow, bot: { candidates: [] } }, field, { answer: "track", marks: [at(1), at(4)] }).verdict.kind).toBe("static");
  });
  it("a bot candidate that is the known object gives `known` for that object, never bot_match", async () => {
    const { key, field } = await spot("fixture");
    // Marks on the bot's path but 2.5 px from the answer positions: not a direct hit.
    const r = scoreSubmission(
      { ...key, bot: { candidates: [{ ...key.bot.candidates[0], y: 18.5 }] } },
      field,
      { answer: "track", marks: [{ frame: 1, x: 10, y: 18.5 }, { frame: 4, x: 16, y: 18.5 }] },
    );
    expect(r.verdict.kind).toBe("known");
    expect(r.verdict.object_name).toBe("Fixture mover");
    expect(r.verdict.points).toBe(100);
    expect(r.matched?.find_key).toBe("object:fixture-1");
    expect(r.reveal).toEqual({ frame: 1, x: 10, y: 16 });
  });
});

describe("bot candidates on the real spots", () => {
  const have = (slug: string) => existsSync(path.join(root, "data", "answers", `${slug}.json`));
  const onBotPath = (key: AnswerKey, field: FieldForScoring, rank: number, frames: number[]): Mark[] => {
    const c = key.bot.candidates.find((b) => b.rank === rank)!;
    return frames.map((i) => {
      const t = field.frames.find((f) => f.i === i)!.mjd - key.t_ref_mjd;
      return { frame: i, x: c.x + c.vx_px_per_day * t, y: c.y + c.vy_px_per_day * t };
    });
  };

  it.runIf(have("hektor"))("hektor: marks on the bot's path are Hektor itself, so accurate marks cannot score it again", async () => {
    const { key, field } = await spot("hektor");
    const c = key.bot.candidates[0];
    expect(botCandidateObject(key, field, c)?.id).toBe("624");
    // Frames 2 and 5: the bot path is more than 2 px from JPL here, so this is not a direct hit.
    const marks = onBotPath(key, field, 1, [2, 5]);
    const jpl = key.objects[0].positions;
    const off = marks.map((m) => {
      const p = jpl.find((q) => q.frame === m.frame)!;
      return Math.hypot(m.x - p.x, m.y - p.y);
    });
    expect(Math.max(...off)).toBeGreaterThan(MATCH_RADIUS_PX);
    const viaBot = scoreSubmission(key, field, { answer: "track", marks });
    const direct = scoreSubmission(key, field, { answer: "track", marks: marksOn(key, [2, 5]) });
    expect(viaBot.verdict).toMatchObject({ kind: "known", object_name: "624 Hektor (A907 CF)", points: 250 });
    expect(direct.verdict).toMatchObject({ kind: "known", object_name: "624 Hektor (A907 CF)", points: 250 });
    expect(viaBot.matched?.find_key).toBe("object:624");
    expect(direct.matched?.find_key).toBe(viaBot.matched?.find_key); // one find, so the database scores it once
    expect(viaBot.reveal).toEqual(direct.reveal);
  });
  it.runIf(have("eris"))("eris: the bot's rank-2 candidate (6.24σ vs 5.9σ, no known object) is a bot match worth 0 points", async () => {
    const { key, field } = await spot("eris");
    const c = key.bot.candidates.find((b) => b.rank === 2)!;
    expect(botCandidateObject(key, field, c)).toBeNull();
    const r = scoreSubmission(key, field, { answer: "track", marks: onBotPath(key, field, 2, [1, 5]) });
    expect(r.verdict).toEqual({
      kind: "bot_match",
      points: 0,
      message: "Matches the bot: 6.2σ against a 5.9σ noise bar. Not a confirmed object, so no points.",
    });
    expect(r.matched?.find_key).toBe("bot:2");
  });
  it.runIf(have("eris"))("eris: the bot's rank-1 candidate is Eris, so it scores as Eris", async () => {
    const { key, field } = await spot("eris");
    expect(botCandidateObject(key, field, key.bot.candidates[0])?.id).toBe("136199");
    const r = scoreSubmission(key, field, { answer: "track", marks: onBotPath(key, field, 1, [1, 5]) });
    expect(r.verdict).toMatchObject({ kind: "known", points: 1000 });
    expect(r.matched?.find_key).toBe("object:136199");
  });
  it.runIf(have("eris"))("eris without its answer objects: the slow rank-1 candidate in frames 1 and 2 is bot_match, not static", async () => {
    const { key, field } = await spot("eris");
    const r = scoreSubmission({ ...key, objects: [] }, field, { answer: "track", marks: onBotPath(key, field, 1, [1, 2]) });
    expect(r.verdict.kind).toBe("bot_match");
  });
});

describe("marks and spots the server refuses", () => {
  it("refuses marks more than 2 px outside the picture, and huge numbers", async () => {
    const { key, field } = await spot("fixture");
    const at = (x: number, y: number) => ({ answer: "track" as const, marks: [{ frame: 1, x, y }, { frame: 4, x: 16, y: 16 }] });
    expect(() => scoreSubmission(key, field, at(-2, 16))).not.toThrow();
    expect(() => scoreSubmission(key, field, at(33, 33))).not.toThrow(); // W - 1 + 2
    for (const [x, y] of [[-2.01, 16], [33.01, 16], [10, -3], [10, 40], [1e308, 0], [-1e308, 0], [Infinity, 0], [NaN, 0]]) {
      expect(() => scoreSubmission(key, field, at(x, y))).toThrow(ScoringError);
    }
  });
  it("gives finite track numbers for every accepted submission", async () => {
    const { key, field } = await spot("fixture");
    const r = scoreSubmission(key, field, { answer: "track", marks: [{ frame: 1, x: -2, y: 33 }, { frame: 4, x: 33, y: -2 }] });
    expect(Object.values(r.track!).every(Number.isFinite)).toBe(true);
  });
  it("a listed spot whose files are missing is a server fault, not 'not found'", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "scoring-"));
    try {
      mkdirSync(path.join(tmp, "public", "fields"), { recursive: true });
      writeFileSync(path.join(tmp, "public", "fields", "index.json"), JSON.stringify([{ slug: "ghost" }]));
      const err = await checkSubmission("ghost", { answer: "nothing" }, tmp).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(ScoringError);
      // Not listed and no files: an ordinary unknown spot.
      await expect(checkSubmission("other", { answer: "nothing" }, tmp)).rejects.toMatchObject({ code: "not_found" });
      // No spot list at all: a server fault.
      rmSync(path.join(tmp, "public", "fields", "index.json"));
      const noIndex = await checkSubmission("other", { answer: "nothing" }, tmp).catch((e: unknown) => e);
      expect(noIndex).toBeInstanceOf(Error);
      expect(noIndex).not.toBeInstanceOf(ScoringError);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
  it("gives each correct verdict a stable find key", async () => {
    const fixture = await checkSubmission("fixture", { answer: "track", marks: [{ frame: 1, x: 10, y: 16 }, { frame: 4, x: 16, y: 16 }] }, root);
    expect(fixture.matched).toEqual({ find_key: "object:fixture-1", object_id: "fixture-1" });
    if (existsSync(path.join(root, "data", "answers", "cygnus.json"))) {
      expect((await checkSubmission("cygnus", { answer: "nothing" }, root)).matched).toEqual({ find_key: "nothing" });
    }
    expect((await checkSubmission("fixture", { answer: "nothing" }, root)).matched).toBeUndefined();
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
  it.runIf(have("eros"))("eros: positions outside the picture are refused, never matched", async () => {
    const { key } = await spot("eros");
    const out = key.objects[0].positions.filter((p) => !p.in_grid);
    expect(out.length).toBeGreaterThanOrEqual(2);
    await expect(
      checkSubmission(
        "eros",
        { answer: "track", marks: out.slice(0, 2).map((p) => ({ frame: p.frame, x: p.x, y: p.y })) },
        root,
      ),
    ).rejects.toMatchObject({ code: "bad_request" });
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
