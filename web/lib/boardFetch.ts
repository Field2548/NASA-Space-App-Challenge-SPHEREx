// GET /api/leaderboard (docs/contracts/api.md section 7) with the caller's token, for /leaderboard and /profile.
import { authHeader } from "./supabase";
import type { Board } from "./scoreboard";

export async function fetchBoard(slug: string | null = null): Promise<Board> {
  const url = slug ? `/api/leaderboard?scope=spot&slug=${encodeURIComponent(slug)}` : "/api/leaderboard?scope=all";
  const res = await fetch(url, { headers: await authHeader(), cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as Board;
  if (!Array.isArray(body.rows)) throw new Error("bad shape");
  return body;
}
