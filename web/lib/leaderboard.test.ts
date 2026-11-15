import { afterEach, describe, expect, it, vi } from "vitest";
import {
  boardUrl,
  countryName,
  difficultyRows,
  exactTime,
  fetchBoardV2,
  fetchPlayer,
  flagEmoji,
  formatPlayTime,
  PlayerError,
  relativeTime,
  splitPodium,
  stageTabs,
} from "./leaderboard";
import type { FieldSummary } from "./types";

vi.mock("./supabase", () => ({ authHeader: async () => ({ Authorization: "Bearer t" }) }));

afterEach(() => vi.unstubAllGlobals());

const spot = (slug: string, difficulty: FieldSummary["difficulty"]) =>
  ({ slug, title: "Field", ra: 1, dec: 2, fov_deg: 0.1, difficulty, kind: "spot", thumbnail: "t.webp" }) as FieldSummary;

describe("flagEmoji and countryName", () => {
  it("builds regional indicator letters", () => {
    expect(flagEmoji("TH")).toBe("\u{1F1F9}\u{1F1ED}");
    expect(flagEmoji("us")).toBe("\u{1F1FA}\u{1F1F8}");
  });
  it("returns an empty string for anything but two letters", () => {
    expect(flagEmoji(null)).toBe("");
    expect(flagEmoji("")).toBe("");
    expect(flagEmoji("USA")).toBe("");
    expect(flagEmoji("1A")).toBe("");
  });
  it("names countries in English and falls back to the code", () => {
    expect(countryName("TH")).toBe("Thailand");
    expect(countryName("us")).toBe("United States");
    expect(countryName("not a code")).toBe("NOT A CODE");
  });
});

describe("relativeTime and exactTime", () => {
  const now = Date.parse("2026-11-15T12:00:00Z");
  it("reads naturally", () => {
    expect(relativeTime("2026-11-15T11:59:50Z", now)).toBe("just now");
    expect(relativeTime("2026-11-15T11:59:00Z", now)).toBe("1 minute ago");
    expect(relativeTime("2026-11-15T11:15:00Z", now)).toBe("45 minutes ago");
    expect(relativeTime("2026-11-15T09:00:00Z", now)).toBe("3 hours ago");
    expect(relativeTime("2026-11-13T12:00:00Z", new Date(now))).toBe("2 days ago");
    expect(relativeTime("2026-08-15T12:00:00Z", now)).toBe("3 months ago");
    expect(relativeTime("2024-11-15T12:00:00Z", now)).toBe("2 years ago");
  });
  it("copes with a time in the future, missing and bad input", () => {
    expect(relativeTime("2026-11-16T12:00:00Z", now)).toBe("just now");
    expect(relativeTime(null, now)).toBe("–");
    expect(relativeTime("nonsense", now)).toBe("–");
  });
  it("gives an exact UTC time", () => {
    expect(exactTime("2026-11-15T09:28:12Z")).toBe("2026-11-15 09:28 UTC");
    expect(exactTime(null)).toBe("");
  });
});

describe("splitPodium", () => {
  it.each([0, 1, 2, 3, 4, 5])("splits %i rows", (n) => {
    const rows = Array.from({ length: n }, (_, i) => i + 1);
    const { podium, rest } = splitPodium(rows);
    expect(podium).toEqual(rows.slice(0, 3));
    expect(rest).toEqual(rows.slice(3));
    expect(podium.length + rest.length).toBe(n);
  });
});

describe("stageTabs and difficultyRows", () => {
  it("names stages by number and difficulty in stage order", () => {
    const tabs = stageTabs([spot("eris", "boss"), spot("eros", "easy"), spot("hektor", "medium")]);
    expect(tabs).toEqual([
      { slug: null, label: "All stages" },
      { slug: "eros", label: "Stage 1 (easy)" },
      { slug: "hektor", label: "Stage 2 (medium)" },
      { slug: "eris", label: "Stage 3 (boss)" },
    ]);
    expect(stageTabs([])).toEqual([{ slug: null, label: "All stages" }]);
  });
  it("orders difficulties and drops empty ones", () => {
    const rows = difficultyRows({ boss: { done: 0, total: 1 }, easy: { done: 1, total: 1 }, tool: { done: 3, total: 6 }, hard: { done: 0, total: 0 } });
    expect(rows.map((r) => `${r.key}:${r.done}/${r.total}`)).toEqual(["easy:1/1", "boss:0/1", "tool:3/6"]);
  });
});

describe("boardUrl", () => {
  it("builds global and local queries", () => {
    expect(boardUrl({ period: "all", region: "global" })).toBe("/api/leaderboard?period=all&region=global");
    expect(boardUrl({ period: "week", region: "global", slug: "eros" })).toBe("/api/leaderboard?period=week&region=global&scope=spot&slug=eros");
    expect(boardUrl({ period: "week", region: "local" })).toBe("/api/leaderboard?period=week&region=local");
    expect(boardUrl({ period: "all", region: "local", country: "TH", slug: "eros" })).toBe("/api/leaderboard?period=all&region=local&country=TH&scope=spot&slug=eros");
    // The country only applies to local boards.
    expect(boardUrl({ period: "all", region: "global", country: "TH" })).toBe("/api/leaderboard?period=all&region=global");
  });
});

describe("fetchBoardV2", () => {
  const stub = (body: unknown, status = 200) => {
    const f = vi.fn(async () => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal("fetch", f);
    return f;
  };

  it("sends the token and fills missing optional keys", async () => {
    const f = stub({ scope: "all", slug: null, source: "db", updated_at: "x", rows: [{ rank: 1, name: "a", score: 5, accuracy: null, is_bot: false, is_me: false }] });
    const { board, signedIn } = await fetchBoardV2({ period: "all", region: "global" });
    expect(signedIn).toBe(true);
    expect(f).toHaveBeenCalledWith("/api/leaderboard?period=all&region=global", expect.objectContaining({ headers: { Authorization: "Bearer t" } }));
    expect(board.available).toBe(true);
    expect(board.me).toBeNull();
    expect(board.countries).toEqual([]);
    expect(board.rows[0].finds).toBeUndefined();
  });

  it("normalises an unavailable board", async () => {
    stub({ scope: "all", slug: null, source: "db", available: false, reason: "no_country", detected_country: null, rows: [{ rank: 1 }], countries: [{ code: "th", players: 2 }] });
    const { board } = await fetchBoardV2({ period: "all", region: "local" });
    expect(board.available).toBe(false);
    expect(board.reason).toBe("no_country");
    expect(board.rows).toEqual([]);
    expect(board.countries).toEqual([{ code: "TH", players: 2 }]);
  });

  it("throws on an HTTP error or a bad shape", async () => {
    stub({}, 500);
    await expect(fetchBoardV2({ period: "all", region: "global" })).rejects.toThrow();
    stub({ nope: true });
    await expect(fetchBoardV2({ period: "all", region: "global" })).rejects.toThrow();
  });
});

describe("fetchPlayer", () => {
  it("encodes the name and parses a player", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ name: "a b", is_bot: false, is_me: true, country: "th", points: 5, by_difficulty: { easy: { done: 1, total: 1 } } }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    const p = await fetchPlayer("a b");
    expect(f).toHaveBeenCalledWith("/api/player?name=a%20b", expect.anything());
    expect(p.is_bot).toBe(false);
    if (!p.is_bot) {
      expect(p.country).toBe("TH");
      expect(p.points_week).toBeNull();
      expect(p.seconds_played).toBeNull();
      expect(p.seconds_week).toBeNull();
      expect(p.by_difficulty.easy).toEqual({ done: 1, total: 1 });
    }
  });
  it("parses play time, and keeps 0 as 0", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ name: "a", is_bot: false, seconds_played: 12000, seconds_week: 0 }), { status: 200 })));
    const p = await fetchPlayer("a");
    expect(!p.is_bot && [p.seconds_played, p.seconds_week]).toEqual([12000, 0]);
  });
  it("parses the bot and reports the HTTP status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ name: "Shift-and-stack bot", is_bot: true, points: 1750, about: "About." }), { status: 200 })));
    const bot = await fetchPlayer("Shift-and-stack bot");
    expect(bot.is_bot && bot.about).toBe("About.");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    await expect(fetchPlayer("x")).rejects.toEqual(expect.objectContaining({ status: 503 }));
    await expect(fetchPlayer("x")).rejects.toBeInstanceOf(PlayerError);
  });
});

describe("formatPlayTime", () => {
  it.each([
    [0, "under 1 min"],
    [59, "under 1 min"],
    [-30, "under 1 min"],
    [Number.NaN, "under 1 min"],
    [60, "1 min"],
    [2700, "45 min"],
    [3599, "59 min"],
    [3600, "1 h"],
    [12000, "3 h 20 min"],
    [12059, "3 h 20 min"],
    [90000, "25 h"],
  ])("%s s is %s", (seconds, text) => {
    expect(formatPlayTime(seconds)).toBe(text);
  });
});
