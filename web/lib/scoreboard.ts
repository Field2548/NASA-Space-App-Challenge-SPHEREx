// Scoreboard helpers (pure, no React). Shape: docs/contracts/api.md section 7.

export type Row = {
  rank: number;
  name: string;
  score: number;
  accuracy: number | null;
  is_bot: boolean;
  is_me: boolean;
};

export type MeRow = {
  rank: number;
  name: string;
  score: number;
  accuracy: number | null;
};

export type Board = {
  scope: "spot" | "all";
  slug: string | null;
  source: "db" | "snapshot";
  updated_at: string;
  rows: Row[];
  me?: MeRow | null;
};

/** "83%" for 0.83, "0%" for 0, "–" when there are no counted submissions. */
export function formatAccuracy(a: number | null): string {
  if (a === null) return "–";
  return `${Math.round(a * 100)}%`;
}

/**
 * Rows in display order. With `pinMe` and a `me` on the board, my row comes first
 * (the row from `rows` if it is there, else built from `me`), then the rest in rank order.
 */
export function arrangeRows(board: Board, pinMe: boolean): Row[] {
  const rows = board.rows;
  const me = board.me;
  if (!pinMe || !me) return rows.slice();

  const mine: Row = rows.find((r) => r.is_me) ?? {
    rank: me.rank,
    name: me.name,
    score: me.score,
    accuracy: me.accuracy,
    is_bot: false,
    is_me: true,
  };
  const rest = rows.filter((r) => !r.is_me).sort((a, b) => a.rank - b.rank);
  return [mine, ...rest];
}

/** A small plain-ASCII "no scores yet" drawing. */
export function asciiEmpty(): string {
  return [
    "  +-----------------+",
    "  |   no scores     |",
    "  |   yet. . . .    |",
    "  +-----------------+",
  ].join("\n");
}
