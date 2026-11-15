// The stage order shared by /stages and the result sheet: Easy -> Medium -> Hard -> Expert -> Boss
// -> Control, stable by public/fields/index.json order inside a group; numbers continue across groups.
import type { FieldSummary } from "@/lib/types";

export const GROUPS: { difficulty: FieldSummary["difficulty"]; label: string }[] = [
  { difficulty: "easy", label: "Easy" },
  { difficulty: "medium", label: "Medium" },
  { difficulty: "hard", label: "Hard" },
  { difficulty: "expert", label: "Expert" }, // not in the current index; kept so no stage is dropped
  { difficulty: "boss", label: "Boss" },
  { difficulty: "tool", label: "Tool tests" },
  { difficulty: "control", label: "Control" }, // legacy
];

/** Every spot in stage order, numbered from 1. */
export function orderedSpots(index: FieldSummary[]): { n: number; spot: FieldSummary }[] {
  let n = 0;
  return GROUPS.flatMap((g) => index.filter((s) => s.difficulty === g.difficulty)).map((spot) => ({ n: ++n, spot }));
}

/** Stage number, stage count and the next spot's slug (null on the last stage) for `slug`. */
export function stageInfo(index: FieldSummary[], slug: string): { n: number; total: number; next: string | null } | null {
  const all = orderedSpots(index);
  const at = all.findIndex((e) => e.spot.slug === slug);
  if (at < 0) return null;
  return { n: all[at].n, total: all.length, next: all[at + 1]?.spot.slug ?? null };
}
