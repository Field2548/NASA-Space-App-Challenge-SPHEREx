// Overlays for the Explore view (owner: DATA). Server only. Contract: field-schema.md section 11.
//
// Two layers can be drawn on top of a spot's picture once the player may see answers:
//   - amber diamonds: known asteroids and comets (from the catalog's `asteroids`), one mark per
//     frame where the body is inside the picture;
//   - teal rings: catalog stars (Gaia and SIMBAD), at their frame 1 position, with the per-frame
//     path in `xy` so a moving star can be followed.
//
// The lock rule, in plain words: the names give the game away (a body called "433 Eros" tells
// the player what the mover is). So names, counts and positions are sent only in explore mode
// AND only when the caller's signed unlock cookie covers this spot. Anyone else, in any mode,
// gets exactly `{ locked: true, asteroids: [], stars: [] }`. The server decides the mode: the
// `mode` given to buildOverlay is the one answerOverlay already decided, never the raw query.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ApiFail } from "@/lib/server/http";
import { isUnlocked } from "@/lib/server/unlock";

export type OverlayPosition = { frame: number; x: number; y: number; vmag: number | null };
export type OverlayAsteroid = { name: string; positions: OverlayPosition[] };
export type OverlayStar = {
  name: string;
  source: string;
  x: number;
  y: number;
  pm_arcsec_yr: number | null;
  g_mag: number | null;
  xy: [number, number][];
};
export type OverlayResponse = { locked: boolean; asteroids: OverlayAsteroid[]; stars: OverlayStar[] };
export type OverlayMode = "round" | "explore";

/** The locked answer. Always take a fresh copy with `emptyOverlay()` (callers may mutate). */
export const EMPTY_OVERLAY: Readonly<OverlayResponse> = Object.freeze({
  locked: true,
  asteroids: [],
  stars: [],
});

export function emptyOverlay(): OverlayResponse {
  return { locked: true, asteroids: [], stars: [] };
}

// ------------------------------------------------------------------ catalog shape (what is read)

const OptNum = z.number().nullable().optional();
const OptStr = z.string().nullable().optional();

const CatalogSchema = z.object({
  stars: z
    .array(
      z.object({
        source: z.string(),
        id: OptStr,
        name: OptStr,
        pmra: OptNum,
        pmdec: OptNum,
        g_mag: OptNum,
        xy: z.array(z.tuple([z.number(), z.number()])).optional(),
      }),
    )
    .default([]),
  asteroids: z
    .array(
      z.object({
        name: z.string(),
        positions: z.array(z.object({ frame: z.number().int(), x: z.number(), y: z.number(), vmag: OptNum })),
      }),
    )
    .default([]),
});

export type OverlayCatalog = z.input<typeof CatalogSchema>;

const FieldSchema = z.object({ size: z.tuple([z.number(), z.number()]) });

// ------------------------------------------------------------------ pure part

const round4 = (v: number): number => Math.round(v * 1e4) / 1e4;

/**
 * The response for a catalog. `mode` is the mode the server already decided: "round" returns the
 * locked answer and copies nothing from the catalog. `size` is [W, H] of the picture in pixels.
 * Does not change its arguments.
 */
export function buildOverlay(catalog: OverlayCatalog, size: readonly [number, number], mode: OverlayMode): OverlayResponse {
  if (mode !== "explore") return emptyOverlay();
  const [w, h] = size;
  const inside = (x: number, y: number) => x >= -0.5 && x <= w - 0.5 && y >= -0.5 && y <= h - 0.5;

  const asteroids: OverlayAsteroid[] = [];
  for (const a of catalog.asteroids ?? []) {
    const positions = (a.positions ?? [])
      .filter((p) => inside(p.x, p.y))
      .map((p) => ({ frame: p.frame, x: p.x, y: p.y, vmag: p.vmag ?? null }));
    if (positions.length > 0) asteroids.push({ name: a.name, positions });
  }

  const stars: OverlayStar[] = [];
  for (const s of catalog.stars ?? []) {
    const xy = s.xy;
    if (!xy || xy.length === 0 || !xy.some(([x, y]) => inside(x, y))) continue;
    const name = typeof s.name === "string" && s.name !== "" ? s.name : (s.id ?? "");
    const pm =
      typeof s.pmra === "number" && typeof s.pmdec === "number" ? round4(Math.hypot(s.pmra, s.pmdec) / 1000) : null;
    stars.push({
      name,
      source: s.source,
      x: xy[0][0],
      y: xy[0][1],
      pm_arcsec_yr: pm,
      g_mag: s.g_mag ?? null,
      xy: xy.map(([x, y]) => [x, y] as [number, number]),
    });
  }
  return { locked: false, asteroids, stars };
}

// ------------------------------------------------------------------ files (same way as lib/server/info.ts)

const SLUG = /^[a-z0-9-]{1,40}$/;

async function readJsonFile(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/** Root of the Next.js app (the web/ folder). Tests may pass another root. */
const webRoot = (root?: string): string => root ?? process.cwd();

/**
 * The route's answer: loads the catalog and the picture size, decides the mode and builds the
 * response. Unknown slug, or a spot with no catalog file (e.g. `fixture`): not_found.
 */
export async function answerOverlay(
  request: Request,
  query: { spot?: string; mode?: string },
  root?: string,
): Promise<OverlayResponse> {
  const slug = query.spot;
  if (slug === undefined || !SLUG.test(slug)) throw new ApiFail("bad_request", "Give a spot name of letters, digits and dashes.");
  const notFound = new ApiFail("not_found", `No overlay for a spot called "${slug}".`);

  const rawCatalog = await readJsonFile(path.join(webRoot(root), "data", "catalog", `${slug}.json`));
  if (rawCatalog === null) throw notFound;
  const rawField = await readJsonFile(path.join(webRoot(root), "public", "fields", slug, "field.json"));
  if (rawField === null) throw notFound;

  const catalog = CatalogSchema.safeParse(rawCatalog);
  if (!catalog.success) throw new Error(`The catalog file for "${slug}" is not in the expected shape.`);
  const field = FieldSchema.safeParse(rawField);
  if (!field.success) throw new Error(`Spot "${slug}" has an invalid field.json on the server.`);

  const mode: OverlayMode = query.mode === "explore" && isUnlocked(request, slug) ? "explore" : "round";
  return buildOverlay(catalog.data, field.data.size, mode);
}
