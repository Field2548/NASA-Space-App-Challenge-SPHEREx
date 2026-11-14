import { describe, expect, it } from "vitest";
import { arrangeRows, asciiEmpty, formatAccuracy, type Board, type Row } from "@/lib/scoreboard";

const bot: Row = { rank: 1, name: "Shift-and-stack bot", score: 1750, accuracy: 0.5, is_bot: true, is_me: false };
const nova: Row = { rank: 2, name: "nova", score: 1600, accuracy: 0.83, is_bot: false, is_me: false };
const kt: Row = { rank: 3, name: "kt", score: 1200, accuracy: 0.6, is_bot: false, is_me: true };
const lyra: Row = { rank: 4, name: "lyra", score: 900, accuracy: null, is_bot: false, is_me: false };

function board(overrides: Partial<Board> = {}): Board {
  return {
    scope: "all",
    slug: null,
    source: "db",
    updated_at: "2026-11-15T09:30:00Z",
    rows: [bot, nova, kt, lyra],
    ...overrides,
  };
}

describe("formatAccuracy", () => {
  it("shows a dash when there is no accuracy", () => {
    expect(formatAccuracy(null)).toBe("–");
  });

  it("shows 0% and 100% at the ends", () => {
    expect(formatAccuracy(0)).toBe("0%");
    expect(formatAccuracy(1)).toBe("100%");
  });

  it("rounds to a whole percent", () => {
    expect(formatAccuracy(0.834)).toBe("83%");
    expect(formatAccuracy(0.83)).toBe("83%");
  });
});

describe("arrangeRows", () => {
  it("puts me first when me is inside the top rows and pinned, rest in rank order", () => {
    const out = arrangeRows(board({ me: { rank: 3, name: "kt", score: 1200, accuracy: 0.6 } }), true);
    expect(out.map((r) => r.name)).toEqual(["kt", "Shift-and-stack bot", "nova", "lyra"]);
    expect(out[0]).toEqual(kt);
    expect(out.filter((r) => r.is_me)).toHaveLength(1);
  });

  it("builds my row from me when I am outside the top rows and pinned", () => {
    const me = { rank: 14, name: "kt", score: 350, accuracy: 0.5 };
    const out = arrangeRows(board({ rows: [bot, nova, lyra], me }), true);
    expect(out[0]).toEqual({ rank: 14, name: "kt", score: 350, accuracy: 0.5, is_bot: false, is_me: true });
    expect(out.slice(1).map((r) => r.name)).toEqual(["Shift-and-stack bot", "nova", "lyra"]);
  });

  it("returns the rows unchanged when there is no me, even if pinned", () => {
    const b = board({ rows: [bot, nova, lyra] });
    expect(arrangeRows(b, true)).toEqual([bot, nova, lyra]);
  });

  it("keeps the server order when pin is off", () => {
    const b = board({ me: { rank: 3, name: "kt", score: 1200, accuracy: 0.6 } });
    expect(arrangeRows(b, false)).toEqual([bot, nova, kt, lyra]);
  });

  it("does not mutate the board", () => {
    const b = board({ me: { rank: 3, name: "kt", score: 1200, accuracy: 0.6 } });
    const before = [...b.rows];
    arrangeRows(b, true);
    expect(b.rows).toEqual(before);
  });
});

describe("asciiEmpty", () => {
  it("is a 3 to 5 line plain-ASCII drawing", () => {
    const lines = asciiEmpty().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines.length).toBeLessThanOrEqual(5);
    expect(asciiEmpty()).toMatch(/^[\x20-\x7e\n]+$/);
  });
});
