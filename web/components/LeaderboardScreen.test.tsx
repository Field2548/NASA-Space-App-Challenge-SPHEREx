// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ header: {} as Record<string, string> }));
vi.mock("@/lib/supabase", () => ({ authHeader: async () => auth.header }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import LeaderboardScreen from "./LeaderboardScreen";

/** Most tests below are about the points board, so they open on it; the movers tests use the real default. */
const PointsScreen = () => <LeaderboardScreen initialMetric="points" />;

const spot = (slug: string, difficulty: string) => ({ slug, title: "Field", ra: 1, dec: 2, fov_deg: 0.1, difficulty, kind: "spot", thumbnail: `${slug}/t.webp` });
const INDEX = [spot("eros", "easy"), spot("eris", "boss"), spot("hektor", "medium")];

type Row = { rank: number; name: string; score: number; accuracy: number | null; finds?: number | null; is_bot: boolean; is_me: boolean };
const row = (rank: number, name: string, score: number, extra: Partial<Row> = {}): Row => ({ rank, name, score, accuracy: 0.5, finds: rank + 1, is_bot: false, is_me: false, ...extra });

const GLOBAL_ROWS = [row(1, "nova", 900), row(2, "vega", 700), row(3, "orion", 500), row(4, "kt", 350, { is_me: true }), row(5, "lyra", 200)];
const GLOBAL_ME = { rank: 4, name: "kt", score: 350, accuracy: 0.5, finds: 6 };
const LOCAL_ROWS = [row(1, "tara", 450), row(2, "kt", 350, { is_me: true })];
const LOCAL_ME = { rank: 2, name: "kt", score: 350, accuracy: 0.5, finds: 3 };

const withMovers = (rows: Row[], counts: number[]) => rows.map((r, i) => ({ ...r, movers: counts[i] ?? 0 }));
const GLOBAL_MOVERS = withMovers(GLOBAL_ROWS, [12, 9, 1, 4, 2]);
const GLOBAL_MOVERS_ME = { ...GLOBAL_ME, movers: 4 };
const LOCAL_MOVERS = withMovers(LOCAL_ROWS, [7, 4]);
const LOCAL_MOVERS_ME = { ...LOCAL_ME, movers: 4 };

type Over = Record<string, unknown>;
/** The default API answer for a leaderboard URL: a logged-in "kt" with a rank on both boards. */
function boardFor(u: string, over: Over = {}) {
  const q = new URL(u, "http://x").searchParams;
  const local = q.get("region") === "local";
  const movers = q.get("metric") === "movers";
  const base = {
    scope: q.get("scope") === "spot" ? "spot" : "all",
    slug: q.get("slug"),
    source: "db",
    updated_at: "2026-11-15T09:30:00Z",
    period: q.get("period"),
    region: local ? "local" : "global",
    country: local ? (q.get("country") ?? "TH").toUpperCase() : null,
    detected_country: "TH",
    available: true,
    ...(local ? { countries: [{ code: "TH", players: 4 }, { code: "US", players: 2 }] } : {}),
    metric: q.get("metric") ?? "points",
    rows: movers ? (local ? LOCAL_MOVERS : GLOBAL_MOVERS) : local ? LOCAL_ROWS : GLOBAL_ROWS,
    me: movers ? (local ? LOCAL_MOVERS_ME : GLOBAL_MOVERS_ME) : local ? LOCAL_ME : GLOBAL_ME,
  };
  return { ...base, ...over };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

let respond: (u: string) => Response | Promise<Response>;
let calls: string[];
const boardCalls = (needle: string) => calls.filter((c) => c.startsWith("/api/leaderboard") && c.includes(needle));

beforeEach(() => {
  calls = [];
  auth.header = { Authorization: "Bearer t" };
  respond = (u) => json(boardFor(u));
  // jsdom has no modal dialog support. Like a browser, close() fires the close event.
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      calls.push(u);
      if (u.endsWith("/fields/index.json")) return json(INDEX);
      return respond(u);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const globalBoard = () => screen.getByRole("region", { name: "Global" });
const localBoard = () => screen.getByRole("region", { name: /^Local/ });
const standing = () => screen.getByRole("region", { name: "Your standing" });
const viewBtn = (name: string) => screen.getByRole("button", { name: `View stats for ${name}` });

describe("LeaderboardScreen boards", () => {
  it("renders the global and local boards, each with a podium and a table", async () => {
    render(<PointsScreen />);
    const nova = await within(await screen.findByRole("region", { name: "Global" })).findByRole("button", { name: "View stats for nova" });
    expect(nova.closest("li")?.getAttribute("data-medal")).toBe("gold");
    expect(within(globalBoard()).getByRole("button", { name: "View stats for orion" }).closest("li")?.getAttribute("data-medal")).toBe("bronze");
    // Ranks 4 and 5 are table rows; my row is highlighted.
    const kt = within(globalBoard()).getByRole("button", { name: "View stats for kt" });
    expect(kt.closest("tr")?.getAttribute("data-me")).toBe("true");
    expect(within(kt.closest("tr")!).getByText("350")).toBeTruthy();
    expect(within(globalBoard()).getByRole("button", { name: "View stats for lyra" }).closest("tr")?.getAttribute("data-me")).toBe("false");
    expect(within(globalBoard()).getByRole("table", { name: "Global ranking" })).toBeTruthy();
    expect(within(globalBoard()).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Rank", "Player", "Points", "Accuracy", "Classifications"]);
    // Local: heading with the country, podium of the two rows, and the small print.
    const local = await screen.findByRole("region", { name: "Local Thailand" });
    expect(within(local).getByRole("button", { name: "View stats for tara" }).closest("li")?.getAttribute("data-medal")).toBe("gold");
    expect(within(local).queryByRole("table")).toBeNull();
    expect(within(local).getByText(/never your IP address/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Back/ })).toBeTruthy();
    expect(boardCalls("period=all&region=global")).toHaveLength(1);
    expect(boardCalls("period=all&region=local")).toHaveLength(1);
  });

  it("labels the bot and a saved copy, and survives rows without finds", async () => {
    respond = (u) =>
      json(
        boardFor(u, u.includes("region=global") ? { source: "snapshot", rows: [row(1, "Shift-and-stack bot", 1750, { is_bot: true, finds: null }), { rank: 2, name: "nova", score: 5, accuracy: null, is_bot: false, is_me: false }], me: null } : {}),
      );
    render(<PointsScreen />);
    expect(await screen.findByText(/Showing a saved copy/)).toBeTruthy();
    expect(within(globalBoard()).getByText("bot")).toBeTruthy();
    expect(within(globalBoard()).queryByRole("table")).toBeNull(); // only podium rows, no pinned me
  });

  it("pins my row at the bottom, after a gap marker, when I am outside the rows shown", async () => {
    respond = (u) => json(boardFor(u, u.includes("region=global") ? { rows: GLOBAL_ROWS.map((r) => ({ ...r, is_me: false })), me: { rank: 14, name: "kt", score: 40, accuracy: null, finds: 2 } } : {}));
    render(<PointsScreen />);
    const mine = (await within(await screen.findByRole("region", { name: "Global" })).findByText("14")).closest("tr")!;
    expect(mine.getAttribute("data-me")).toBe("true");
    expect(within(mine).getByRole("button", { name: "View stats for kt" })).toBeTruthy();
    const body = mine.parentElement!;
    expect(body.lastElementChild).toBe(mine);
    expect(mine.previousElementSibling?.textContent).toBe("⋮");
  });

  it("shows an honest empty state", async () => {
    respond = (u) => json(boardFor(u, { rows: [], me: null }));
    render(<PointsScreen />);
    expect((await within(await screen.findByRole("region", { name: "Global" })).findByText("No scores yet.")).tagName).toBe("P");
    fireEvent.click(screen.getByRole("button", { name: "This week" }));
    expect(await within(globalBoard()).findByText("No scores this week yet.")).toBeTruthy();
  });

  it("shows an error for a board that fails to load", async () => {
    respond = () => new Response("x", { status: 500 });
    render(<PointsScreen />);
    expect(await screen.findByText("The global board could not be loaded.")).toBeTruthy();
    expect(screen.getByText("The local board could not be loaded.")).toBeTruthy();
    expect(within(standing()).getByRole("alert").textContent).toMatch(/could not be loaded/);
  });
});

describe("LeaderboardScreen controls", () => {
  it("switching to This week refetches both boards with period=week", async () => {
    render(<PointsScreen />);
    await screen.findByRole("button", { name: "View stats for nova" });
    const all = screen.getByRole("button", { name: "All time" });
    expect(all.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "This week" }));
    await waitFor(() => {
      expect(boardCalls("period=week&region=global")).toHaveLength(1);
      expect(boardCalls("period=week&region=local")).toHaveLength(1);
    });
    expect(screen.getByRole("button", { name: "This week" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("the country select sends country= for the local board only", async () => {
    render(<PointsScreen />);
    const select = (await screen.findByLabelText("Country")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("TH"));
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual([expect.stringContaining("Thailand"), expect.stringContaining("United States")]);
    fireEvent.change(select, { target: { value: "US" } });
    await waitFor(() => expect(boardCalls("region=local&country=US")).toHaveLength(1));
    expect(boardCalls("region=global")).toHaveLength(1);
    expect(await screen.findByRole("region", { name: "Local United States" })).toBeTruthy();
  });

  it("ignores a late answer for an older selection", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    respond = async (u) => {
      if (u.includes("period=all&region=global")) {
        await gate;
        return json(boardFor(u, { rows: [row(1, "oldrow", 1)], me: null }));
      }
      if (u.includes("period=week&region=global")) return json(boardFor(u, { rows: [row(1, "weekrow", 2)], me: null }));
      return json(boardFor(u));
    };
    render(<PointsScreen />);
    await screen.findByRole("button", { name: "View stats for tara" }); // local loaded, global still waiting
    fireEvent.click(screen.getByRole("button", { name: "This week" }));
    expect(await screen.findByRole("button", { name: "View stats for weekrow" })).toBeTruthy();
    await act(async () => {
      release();
      await gate;
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.queryByRole("button", { name: "View stats for oldrow" })).toBeNull();
    expect(screen.getByRole("button", { name: "View stats for weekrow" })).toBeTruthy();
  });
});

describe("LeaderboardScreen unavailable boards", () => {
  it("not_installed: weekly and local boards are being set up", async () => {
    respond = (u) => json(boardFor(u, { available: false, reason: "not_installed", rows: [], me: undefined }));
    render(<PointsScreen />);
    const msgs = await screen.findAllByText("Weekly and local boards are being set up. All-time global scores are shown.");
    expect(msgs).toHaveLength(2);
  });

  it("no_database: live scores are unavailable", async () => {
    respond = (u) => json(boardFor(u, { available: false, reason: "no_database", rows: [], me: undefined }));
    render(<PointsScreen />);
    expect(await screen.findAllByText("Live scores are unavailable right now.")).toHaveLength(2);
    expect(within(standing()).getByText("Your rank is not available right now.")).toBeTruthy();
  });

  it("no_country with countries: asks to pick one, and the choice is sent", async () => {
    respond = (u) => {
      const local = u.includes("region=local");
      if (local && !u.includes("country=")) return json(boardFor(u, { available: false, reason: "no_country", country: null, detected_country: null, rows: [], me: undefined }));
      return json(boardFor(u));
    };
    render(<PointsScreen />);
    expect(await screen.findByText("We could not tell which country you are in. Pick one:")).toBeTruthy();
    const select = screen.getByLabelText("Country") as HTMLSelectElement;
    expect(select.value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Local" }));
    expect(within(standing()).getByText("Pick a country on the Local board to see your local rank.")).toBeTruthy();
    fireEvent.change(select, { target: { value: "US" } });
    await waitFor(() => expect(boardCalls("region=local&country=US")).toHaveLength(1));
    expect(await screen.findByRole("button", { name: "View stats for tara" })).toBeTruthy();
  });

  it("no_country with no countries: says local boards appear once players have scores", async () => {
    respond = (u) => json(boardFor(u, u.includes("region=local") ? { available: false, reason: "no_country", country: null, detected_country: null, countries: [], rows: [], me: undefined } : {}));
    render(<PointsScreen />);
    expect(await screen.findByText(/Local boards appear once players from a country have scores/)).toBeTruthy();
    expect(screen.queryByLabelText("Country")).toBeNull();
  });
});

describe("LeaderboardScreen standing card", () => {
  it("tells a guest to log in and never invents a rank", async () => {
    auth.header = {};
    respond = (u) => json(boardFor(u, { me: undefined, rows: GLOBAL_ROWS.map((r) => ({ ...r, is_me: false })) }));
    render(<PointsScreen />);
    expect(await within(standing()).findByText("Log in to get a rank")).toBeTruthy();
    expect(within(standing()).getByText(/Log in button at the top right/)).toBeTruthy();
    expect(within(standing()).queryByText(/^#/)).toBeNull();
    // No rank to compare, so no Global/Local toggle.
    expect(screen.queryByRole("group", { name: "Compare my rank with" })).toBeNull();
  });

  it("shows my rank, points, accuracy and classifications, and switches between global and local", async () => {
    render(<PointsScreen />);
    expect(await within(standing()).findByText("#4")).toBeTruthy();
    expect(within(standing()).getByText("350")).toBeTruthy();
    expect(within(standing()).getByText("50%")).toBeTruthy();
    expect(within(standing()).getByText("6")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Global", pressed: true })).toBeTruthy();
    const before = calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Local" }));
    expect(within(standing()).getByText("#2")).toBeTruthy();
    expect(within(standing()).getByText("3")).toBeTruthy();
    expect(within(standing()).queryByText("#4")).toBeNull();
    expect(calls.length).toBe(before); // the toggle reuses the boards already loaded
  });

  it("says plainly when I am logged in with no points", async () => {
    respond = (u) => json(boardFor(u, { me: undefined, rows: GLOBAL_ROWS.map((r) => ({ ...r, is_me: false })) }));
    render(<PointsScreen />);
    expect(await within(standing()).findByText(/You have no points yet\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "This week" }));
    expect(await within(standing()).findByText(/You have no points this week yet\./)).toBeTruthy();
  });
});

describe("LeaderboardScreen player dialog", () => {
  const PLAYER = {
    name: "vega", is_bot: false, is_me: false, country: "US", member_since: "2026-11-01T00:00:00Z", last_active: new Date().toISOString(),
    points: 700, points_week: 100, rank_all: 2, rank_week: 1, classifications: 9, correct: 7, accuracy: 0.78, stages_completed: 3, stages_total: 11,
    by_difficulty: { easy: { done: 1, total: 1 }, medium: { done: 2, total: 2 } }, first_finds: 1, patches_solved: 2, active_days: 4,
  };

  it("opens from a name, fetches /api/player, shows stats, closes with Escape and returns focus", async () => {
    const base = respond;
    respond = (u) => (u.startsWith("/api/player") ? json(PLAYER) : base(u));
    render(<PointsScreen />);
    const button = await within(await screen.findByRole("region", { name: "Global" })).findByRole("button", { name: "View stats for vega" });
    button.focus();
    fireEvent.click(button);
    const dialog = await screen.findByRole("dialog", { name: /vega/ });
    expect(calls).toContain("/api/player?name=vega");
    expect(await within(dialog).findByText("Sky patches solved")).toBeTruthy();
    expect(within(dialog).getByText("Stages completed:", { exact: false }).textContent).toMatch(/3 \/ 11/);
    // A browser turns Esc into a close event on the dialog; jsdom has no Esc handling.
    fireEvent(dialog, new Event("close"));
    await waitFor(() => expect(screen.queryByRole("dialog", { hidden: true })).toBeNull());
    expect(document.activeElement).toBe(button);
  });

  it("closes with the Close button and returns focus to the name", async () => {
    const base = respond;
    respond = (u) => (u.startsWith("/api/player") ? json(PLAYER) : base(u));
    render(<PointsScreen />);
    const button = await within(await screen.findByRole("region", { name: "Global" })).findByRole("button", { name: "View stats for lyra" });
    fireEvent.click(button);
    fireEvent.click(await screen.findByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { hidden: true })).toBeNull());
    expect(document.activeElement).toBe(button);
  });

  it("shows the bot's description and no stage bars", async () => {
    const base = respond;
    respond = (u) =>
      u.startsWith("/api/player") ? json({ name: "Shift-and-stack bot", is_bot: true, is_me: false, points: 1750, about: "An automatic search that plays every stage." }) : base(u);
    render(<PointsScreen />);
    fireEvent.click(await within(await screen.findByRole("region", { name: "Global" })).findByRole("button", { name: "View stats for nova" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/plays every stage/)).toBeTruthy();
    expect(within(dialog).queryByText(/Stages completed/)).toBeNull();
    expect(within(dialog).queryByRole("list")).toBeNull();
  });

  it("explains a 503", async () => {
    const base = respond;
    respond = (u) => (u.startsWith("/api/player") ? json({ error: { code: "db_unavailable", message: "x" } }, 503) : base(u));
    render(<PointsScreen />);
    fireEvent.click(await within(await screen.findByRole("region", { name: "Global" })).findByRole("button", { name: "View stats for nova" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Player stats are not available right now.");
  });

  it("every name in the podium and the table is a button", async () => {
    render(<PointsScreen />);
    await screen.findByRole("button", { name: "View stats for nova" });
    for (const n of ["nova", "vega", "orion", "lyra", "tara"]) expect(viewBtn(n)).toBeTruthy();
    expect(within(localBoard()).getAllByRole("button", { name: /^View stats for/ }).length).toBeGreaterThan(0);
  });
});

describe("LeaderboardScreen movers metric", () => {
  it("opens on Movers found, with no stage filter, and asks the API for metric=movers", async () => {
    render(<LeaderboardScreen />);
    await screen.findByRole("button", { name: "View stats for nova" });
    expect(screen.getByRole("button", { name: "Movers found", pressed: true })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Points", pressed: false })).toBeTruthy();
    expect(screen.queryByLabelText("Stage")).toBeNull();
    expect(screen.queryByText("All stages")).toBeNull();
    expect(boardCalls("period=all&region=global&metric=movers")).toHaveLength(1);
    expect(boardCalls("period=all&region=local&metric=movers")).toHaveLength(1);
    expect(calls.some((c) => c.includes("scope=") || c.includes("slug="))).toBe(false);
    expect(screen.getAllByText("All time · Movers found", { selector: "p" })).toHaveLength(2); // Global and Local captions
  });

  it("shows movers on the podium and in the table, with Points and Accuracy beside them", async () => {
    render(<LeaderboardScreen />);
    await screen.findByRole("button", { name: "View stats for nova" });
    const nova = within(globalBoard()).getByRole("button", { name: "View stats for nova" }).closest("li")!;
    expect(within(nova).getByText("12 movers")).toBeTruthy();
    expect(within(nova).getByText("900", { exact: false })).toBeTruthy();
    // One mover is singular.
    expect(within(within(globalBoard()).getByRole("button", { name: "View stats for orion" }).closest("li")!).getByText("1 mover")).toBeTruthy();
    expect(within(globalBoard()).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Rank", "Player", "Movers", "Points", "Accuracy"]);
    const kt = within(globalBoard()).getByRole("button", { name: "View stats for kt" }).closest("tr")!;
    expect(within(kt).getAllByRole("cell").map((c) => c.textContent)).toEqual(["4", expect.stringContaining("kt"), "4", "350", "50%"]);
  });

  it("shows my standing in movers mode, on both boards", async () => {
    render(<LeaderboardScreen />);
    expect(await within(standing()).findByText("#4")).toBeTruthy();
    expect(within(standing()).getByText("Movers found")).toBeTruthy();
    expect(within(standing()).getByText("350")).toBeTruthy();
    expect(within(standing()).queryByText("Classifications")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Local" }));
    expect(within(standing()).getByText("#2")).toBeTruthy();
    expect(within(standing()).getByText("Local, Thailand · All time · Movers found")).toBeTruthy();
  });

  it("Points switches the boards back to points and refetches", async () => {
    render(<LeaderboardScreen />);
    await screen.findByRole("button", { name: "View stats for nova" });
    fireEvent.click(screen.getByRole("button", { name: "Points" }));
    await waitFor(() => {
      expect(boardCalls("region=global&metric=points")).toHaveLength(1);
      expect(boardCalls("region=local&metric=points")).toHaveLength(1);
    });
    await waitFor(() => expect(within(globalBoard()).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Rank", "Player", "Points", "Accuracy", "Classifications"]));
    expect(screen.getByRole("button", { name: "Points", pressed: true })).toBeTruthy();
  });

  it("works with This week, and keeps the metric when the period changes", async () => {
    render(<LeaderboardScreen />);
    await screen.findByRole("button", { name: "View stats for nova" });
    fireEvent.click(screen.getByRole("button", { name: "This week" }));
    await waitFor(() => expect(boardCalls("period=week&region=global&metric=movers")).toHaveLength(1));
    expect(await within(standing()).findByText("This week", { exact: false })).toBeTruthy();
  });

  it("asks the guest to log in, as on the points board", async () => {
    auth.header = {};
    respond = (u) => json(boardFor(u, { me: undefined, rows: GLOBAL_MOVERS.map((r) => ({ ...r, is_me: false })) }));
    render(<LeaderboardScreen />);
    expect(await within(standing()).findByText("Log in to get a rank")).toBeTruthy();
  });

  it("has honest empty states in movers mode", async () => {
    respond = (u) => json(boardFor(u, { rows: [], me: undefined }));
    render(<LeaderboardScreen />);
    expect(await within(await screen.findByRole("region", { name: "Global" })).findByText("No movers found yet.")).toBeTruthy();
    expect(within(standing()).getByText(/You have no movers found yet\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "This week" }));
    expect(await within(globalBoard()).findByText("No movers found this week yet.")).toBeTruthy();
  });

  it("says the movers ranking is being set up when the database function is missing", async () => {
    respond = (u) => json(boardFor(u, { available: false, reason: "not_installed", rows: [], me: undefined }));
    render(<LeaderboardScreen />);
    expect(await screen.findAllByText("The movers ranking is being set up. Switch to Points to see scores.")).toHaveLength(2);
  });

  it("shows a saved copy of the bot in movers mode", async () => {
    respond = (u) =>
      json(boardFor(u, u.includes("region=global") ? { source: "snapshot", rows: [{ ...row(1, "Shift-and-stack bot", 1750, { is_bot: true, finds: null }), movers: 3 }], me: null } : {}));
    render(<LeaderboardScreen />);
    expect(await screen.findByText(/Showing a saved copy/)).toBeTruthy();
    expect(within(globalBoard()).getByText("3 movers")).toBeTruthy();
  });
});
