// Achievements: pure rules, no server imports and no answer data. The server passes in the
// spot list (kind and difficulty per slug) and what the player solved.

export type SolvedSpot = { slug: string; kind: string; difficulty: string; at: string | null };
export type SpotInfo = { slug: string; kind: string; difficulty: string };

export type Achievement = {
  id: string;
  title: string;
  description: string;
  progress: number;
  goal: number;
  unlocked: boolean;
  unlockedAt: string | null;
};

export type AchievementsResponse = {
  source: "account" | "guest";
  unlocked: number;
  total: number;
  achievements: Achievement[];
};

/** Total points that unlock the two points achievements (all stages together are about 3,350 base points). */
export const POINT_TIERS = { "points-1": 1000, "points-2": 2500 } as const;

type Def = {
  id: string;
  title: string;
  description: (goal: number) => string;
  /** Which solved spots count; null means a points tier. */
  match: ((s: SpotInfo) => boolean) | null;
  /** Goal given how many spots match; 0 omits the achievement. */
  goal: (n: number) => number;
};

const kind = (k: string) => (s: SpotInfo) => s.kind === k;
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const DEFS: Def[] = [
  { id: "first-light", title: "First light", description: () => "Solve your first stage.", match: () => true, goal: () => 1 },
  {
    id: "rock-hunter",
    title: "Rock hunter",
    description: (g) => `Find ${g} ${plural(g, "asteroid", "asteroids")}.`,
    match: kind("asteroid"),
    goal: (n) => Math.min(5, n),
  },
  {
    id: "far-out",
    title: "Far out",
    description: () => "Find a dwarf planet beyond Neptune.",
    match: kind("dwarf-planet"),
    goal: (n) => Math.min(1, n),
  },
  {
    id: "ice-giants-club",
    title: "Edge of the system",
    description: (g) => (g === 1 ? "Find the dwarf planet." : "Find every dwarf planet."),
    match: kind("dwarf-planet"),
    goal: (n) => n,
  },
  {
    id: "boss",
    title: "Boss fight",
    description: () => "Solve the boss stage.",
    match: (s) => s.difficulty === "boss",
    goal: (n) => n,
  },
  {
    id: "still-sky",
    title: "Nothing to see here",
    description: () => "Correctly say that nothing moved.",
    match: kind("control"),
    goal: (n) => Math.min(1, n),
  },
  {
    id: "tool-tester",
    title: "Tool tester",
    description: (g) => `Test your tool on ${g} ${plural(g, "star", "stars")}.`,
    match: kind("star"),
    goal: (n) => Math.min(3, n),
  },
  {
    id: "star-collector",
    title: "Star collector",
    description: () => "Test your tool on every star spot.",
    match: kind("star"),
    goal: (n) => n,
  },
  { id: "completionist", title: "Completionist", description: () => "Solve every stage.", match: () => true, goal: (n) => n },
  {
    id: "points-1",
    title: "Rising star",
    description: (g) => `Score ${g.toLocaleString("en-US")} points.`,
    match: null,
    goal: () => POINT_TIERS["points-1"],
  },
  {
    id: "points-2",
    title: "Sky master",
    description: (g) => `Score ${g.toLocaleString("en-US")} points.`,
    match: null,
    goal: () => POINT_TIERS["points-2"],
  },
];

const time = (iso: string) => Date.parse(iso);

export function computeAchievements(solved: SolvedSpot[], spots: SpotInfo[], points: number): Achievement[] {
  const known = new Map(spots.map((s) => [s.slug, s]));
  // One entry per spot (the earliest solve), only for spots that exist.
  const first = new Map<string, SolvedSpot>();
  for (const s of solved) {
    if (!known.has(s.slug)) continue;
    const prev = first.get(s.slug);
    if (!prev || (s.at !== null && (prev.at === null || time(s.at) < time(prev.at)))) first.set(s.slug, s);
  }
  const mine = [...first.values()].sort((a, b) =>
    a.at === null ? 1 : b.at === null ? -1 : time(a.at) - time(b.at),
  );

  const out: Achievement[] = [];
  for (const d of DEFS) {
    if (!d.match) {
      const goal = d.goal(0);
      const progress = Math.min(Math.max(0, Math.floor(points)), goal);
      out.push({
        id: d.id,
        title: d.title,
        description: d.description(goal),
        progress,
        goal,
        unlocked: progress >= goal,
        unlockedAt: null,
      });
      continue;
    }
    const goal = d.goal(spots.filter(d.match).length);
    if (goal <= 0) continue;
    const hits = mine.filter((s) => d.match!(s));
    const progress = Math.min(hits.length, goal);
    const unlocked = progress >= goal;
    out.push({
      id: d.id,
      title: d.title,
      description: d.description(goal),
      progress,
      goal,
      unlocked,
      unlockedAt: unlocked ? (hits[goal - 1]?.at ?? null) : null,
    });
  }
  return out;
}
