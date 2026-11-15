// Leaderboard v2 helpers: typed fetchers for GET /api/leaderboard (period, region, country) and
// GET /api/player, plus small pure helpers (flags, country names, relative times, podium split,
// stage names). Shapes follow the leaderboard v2 API spec. Nothing here ever carries an object name.

import { authHeader } from "./supabase";
import type { MeRow, Row } from "./scoreboard";
import { GROUPS } from "./stageOrder";

export type Period = "all" | "week";
export type Region = "global" | "local";
/** What a board ranks by: distinct real movers found, or points. */
export type Metric = "movers" | "points";
/** The page opens on movers. (The API itself answers points when no metric is asked for.) */
export const DEFAULT_METRIC: Metric = "movers";
/** A metric from untrusted text (a query string, storage): anything unknown is the default. */
export function parseMetric(v: unknown): Metric {
  return v === "points" || v === "movers" ? v : DEFAULT_METRIC;
}
export type UnavailableReason = "no_database" | "no_country" | "not_installed";

/** One leaderboard row. `finds` (classifications) may be missing, and is null for the bot. */
export type BoardRow = Row & { finds?: number | null; movers?: number | null };
export type BoardMe = MeRow & { finds?: number | null; movers?: number | null };
export type CountryCount = { code: string; players: number };

/** An answer from GET /api/leaderboard, with every optional key filled in. */
export interface BoardV2 {
  scope: "spot" | "all";
  slug: string | null;
  source: "db" | "snapshot";
  updated_at: string | null;
  period: Period;
  region: Region;
  metric: Metric;
  country: string | null;
  detected_country: string | null;
  available: boolean;
  reason: UnavailableReason | null;
  countries: CountryCount[];
  rows: BoardRow[];
  me: BoardMe | null;
}

export interface BoardParams {
  period: Period;
  region: Region;
  /** Missing means the server default (points); the page always passes one. */
  metric?: Metric;
  /** Local boards only; null or missing means "the country the server detected". */
  country?: string | null;
}

/** A board plus whether the request carried a login token (a guest never gets a `me`). */
export interface BoardResult {
  board: BoardV2;
  signedIn: boolean;
}

/** The request URL for one board. Local boards send `country` only when one was chosen. */
export function boardUrl(p: BoardParams): string {
  const q = [`period=${p.period}`, `region=${p.region}`];
  if (p.region === "local" && p.country) q.push(`country=${encodeURIComponent(p.country)}`);
  if (p.metric) q.push(`metric=${p.metric}`);
  return `/api/leaderboard?${q.join("&")}`;
}

type Raw = Record<string, unknown>;
const isRecord = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function reasonOf(v: unknown): UnavailableReason {
  return v === "no_country" || v === "not_installed" ? v : "no_database";
}

function normaliseBoard(body: unknown): BoardV2 {
  if (!isRecord(body) || !Array.isArray(body.rows)) throw new Error("bad shape");
  const available = body.available !== false;
  const countries = Array.isArray(body.countries)
    ? body.countries.filter(isRecord).flatMap((c) => (typeof c.code === "string" ? [{ code: c.code.toUpperCase(), players: numOrNull(c.players) ?? 0 }] : []))
    : [];
  return {
    scope: body.scope === "spot" ? "spot" : "all",
    slug: strOrNull(body.slug),
    source: body.source === "snapshot" ? "snapshot" : "db",
    updated_at: strOrNull(body.updated_at),
    period: body.period === "week" ? "week" : "all",
    region: body.region === "local" ? "local" : "global",
    // An answer from before movers existed has no metric: it is a points board.
    metric: body.metric === "movers" ? "movers" : "points",
    country: strOrNull(body.country)?.toUpperCase() ?? null,
    detected_country: strOrNull(body.detected_country)?.toUpperCase() ?? null,
    available,
    reason: available ? null : reasonOf(body.reason),
    countries,
    rows: available ? (body.rows as BoardRow[]) : [],
    me: available && isRecord(body.me) ? (body.me as unknown as BoardMe) : null,
  };
}

/** GET /api/leaderboard for one board, with the caller's token. Throws on a bad answer. */
export async function fetchBoardV2(params: BoardParams): Promise<BoardResult> {
  const headers = await authHeader();
  const res = await fetch(boardUrl(params), { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { board: normaliseBoard(await res.json()), signedIn: Object.keys(headers).length > 0 };
}

// ---------------------------------------------------------------------------------------------
// Player stats

export interface DifficultyProgress {
  done: number;
  total: number;
}

export interface PlayerStats {
  is_bot: false;
  name: string;
  is_me: boolean;
  country: string | null;
  member_since: string | null;
  last_active: string | null;
  points: number | null;
  points_week: number | null;
  rank_all: number | null;
  rank_week: number | null;
  classifications: number | null;
  correct: number | null;
  accuracy: number | null;
  stages_completed: number | null;
  stages_total: number | null;
  by_difficulty: Record<string, DifficultyProgress>;
  first_finds: number | null;
  patches_solved: number | null;
  active_days: number | null;
  /** Seconds played, all time / last 7 days. Null when the server did not send them (hide the stat). */
  seconds_played: number | null;
  seconds_week: number | null;
}

/** The bot only shows its points and a short description. */
export interface BotStats {
  is_bot: true;
  name: string;
  is_me: boolean;
  points: number | null;
  about: string;
}

export type PlayerResult = PlayerStats | BotStats;

/** A failed /api/player call; `status` is the HTTP status (0 when the answer was unusable). */
export class PlayerError extends Error {
  status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

function normalisePlayer(body: unknown): PlayerResult {
  if (!isRecord(body) || typeof body.name !== "string") throw new PlayerError(0);
  if (body.is_bot === true) {
    return {
      is_bot: true,
      name: body.name,
      is_me: body.is_me === true,
      points: numOrNull(body.points),
      about: typeof body.about === "string" ? body.about : "",
    };
  }
  const by: Record<string, DifficultyProgress> = {};
  if (isRecord(body.by_difficulty)) {
    for (const [key, v] of Object.entries(body.by_difficulty)) {
      if (isRecord(v) && numOrNull(v.total) !== null) by[key] = { done: numOrNull(v.done) ?? 0, total: numOrNull(v.total) ?? 0 };
    }
  }
  return {
    is_bot: false,
    name: body.name,
    is_me: body.is_me === true,
    country: strOrNull(body.country)?.toUpperCase() ?? null,
    member_since: strOrNull(body.member_since),
    last_active: strOrNull(body.last_active),
    points: numOrNull(body.points),
    points_week: numOrNull(body.points_week),
    rank_all: numOrNull(body.rank_all),
    rank_week: numOrNull(body.rank_week),
    classifications: numOrNull(body.classifications),
    correct: numOrNull(body.correct),
    accuracy: numOrNull(body.accuracy),
    stages_completed: numOrNull(body.stages_completed),
    stages_total: numOrNull(body.stages_total),
    by_difficulty: by,
    first_finds: numOrNull(body.first_finds),
    patches_solved: numOrNull(body.patches_solved),
    active_days: numOrNull(body.active_days),
    seconds_played: numOrNull(body.seconds_played),
    seconds_week: numOrNull(body.seconds_week),
  };
}

/** GET /api/player?name= with the caller's token. Throws PlayerError on a non-200 answer. */
export async function fetchPlayer(name: string): Promise<PlayerResult> {
  const res = await fetch(`/api/player?name=${encodeURIComponent(name)}`, { headers: await authHeader(), cache: "no-store" });
  if (!res.ok) throw new PlayerError(res.status);
  return normalisePlayer(await res.json());
}

/** The stage bars for a player: stage order, a difficulty with no stages left out. */
export function difficultyRows(by: Record<string, DifficultyProgress>): { key: string; label: string; done: number; total: number }[] {
  const known = GROUPS.filter((g) => by[g.difficulty]).map((g) => ({ key: g.difficulty as string, label: g.label }));
  const extra = Object.keys(by)
    .filter((k) => !GROUPS.some((g) => g.difficulty === k))
    .map((k) => ({ key: k, label: k }));
  return [...known, ...extra].filter((e) => by[e.key].total > 0).map((e) => ({ ...e, done: by[e.key].done, total: by[e.key].total }));
}

// ---------------------------------------------------------------------------------------------
// Pure helpers

/** Flag emoji from a two-letter country code ("TH"), or "" when the code is not two letters. */
export function flagEmoji(code: string | null | undefined): string {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return "";
  return [...code.toUpperCase()].map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)).join("");
}

/** English country name for a two-letter code; the upper-case code itself when it is unknown. */
export function countryName(code: string): string {
  const up = code.toUpperCase();
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(up) ?? up;
  } catch {
    return up;
  }
}

/** "3 hours ago" style text for an ISO time; "–" when the time is missing or not a date. */
export function relativeTime(iso: string | null | undefined, now: number | Date): string {
  if (!iso) return "–";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "–";
  const seconds = Math.max(0, Math.round(((typeof now === "number" ? now : now.getTime()) - then) / 1000));
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return plural(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return plural(hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 30) return plural(days, "day");
  if (days < 365) return plural(Math.floor(days / 30), "month");
  return plural(Math.floor(days / 365), "year");
}

/** Play time for the stats dialog: "3 h 20 min", "3 h", "45 min" or "under 1 min" (whole minutes, rounded down). */
export function formatPlayTime(seconds: number): string {
  const minutes = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds / 60) : 0;
  if (minutes < 1) return "under 1 min";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** The exact time, in UTC, for a tooltip: "2026-11-15 09:28 UTC". Empty when not a date. */
export function exactTime(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return "";
  return `${new Date(t).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** The first three rows (the podium) and everything after them. */
export function splitPodium<T>(rows: readonly T[]): { podium: T[]; rest: T[] } {
  return { podium: rows.slice(0, 3), rest: rows.slice(3) };
}
