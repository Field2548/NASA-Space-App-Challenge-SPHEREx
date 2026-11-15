// GET /api/info: catalog facts for the Inspect popup (owner: SERVER). Server only.
// Contract: docs/contracts/api.md sections 2 and 6. Build prompt: section 8.16 (radii, lock).
//
// The server decides the mode (api.md section 2). A position inside a ready spot is answered in
// full (explore) only when the caller asked for explore AND the signed unlock cookie covers every
// ready spot whose picture contains it. Everything else gets the locked shape, which has exactly the keys mode, locked, position.
// Positions outside every ready spot are always explore: SIMBAD and Gaia are asked live (liveCatalog.ts),
// JPL is skipped because there is no observation time here.
//
// Files read (all server-only, never served): web/data/catalog/<slug>.json (pre-made catalog),
// web/data/answers/<slug>.json (the reveal block only), web/public/fields/index.json and
// <slug>/field.json (the picture and its WCS).

import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { angularSeparationDeg } from "@/components/skymap/geometry";
import { loadAnswerKey } from "@/lib/scoring";
import { ApiFail } from "@/lib/server/http";
import { GAIA_RADIUS_ARCSEC, type LiveDeps, lookupLive, SIMBAD_RADIUS_ARCSEC } from "@/lib/server/liveCatalog";
import { isUnlocked } from "@/lib/server/unlock";
import type { FieldWcs } from "@/lib/types";
import { pixelToSky, skyToPixel } from "@/lib/wcs";

/** The radii (BUILD_PROMPT 8.16) live in liveCatalog.ts. Re-exported for the callers that used them here. */
export { GAIA_RADIUS_ARCSEC, SIMBAD_RADIUS_ARCSEC };
export const SOLAR_RADIUS_PX = 2;
/** A pixel may sit this far outside the picture (api.md section 3, MARK_MARGIN_PX). */
const MARGIN_PX = 2;

export const IRSA_LINK = {
  label: "IRSA Spectrophotometry Tool",
  url: "https://irsa.ipac.caltech.edu/applications/spherex/tool-spectrophotometry",
};

/** What the route passes in: already validated by zod, but the combinations are checked here. */
export type InfoQuery = {
  spot?: string;
  x?: number;
  y?: number;
  ra?: number;
  dec?: number;
  mode?: string;
};

// ------------------------------------------------------------------ file shapes

const WcsSchema = z.object({
  ctype: z.tuple([z.string(), z.string()]),
  crval: z.tuple([z.number(), z.number()]),
  crpix: z.tuple([z.number(), z.number()]),
  cdelt: z.tuple([z.number(), z.number()]),
  rows: z.string(),
});

const FieldSchema = z.object({
  size: z.tuple([z.number().int(), z.number().int()]),
  pixel_arcsec: z.number(),
  wcs: WcsSchema,
});

const OptNum = z.number().nullable().optional();
const OptStr = z.string().nullable().optional();

/** One star from the catalog's stars[] (api.md draft, field-schema section 9). Unknown keys are ignored. */
const StarSchema = z.object({
  source: z.string(),
  id: OptStr,
  name: OptStr,
  otype: OptStr,
  sp_type: OptStr,
  z: OptNum,
  ra: z.number(),
  dec: z.number(),
  pmra: OptNum,
  pmdec: OptNum,
  plx: OptNum,
  plx_over_err: OptNum,
  g_mag: OptNum,
  xy: z.array(z.tuple([z.number(), z.number()])).optional(),
});

const ObjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  source: z.string().optional(),
  r_au: z.array(OptNum).optional(),
  delta_au: z.array(OptNum).optional(),
});

const AsteroidSchema = z.object({
  name: z.string(),
  positions: z.array(z.object({ frame: z.number().int(), x: z.number(), y: z.number() })),
});

const SourceBlock = z.object({
  status: z.string().optional(),
  service: z.string().optional(),
});

const CatalogSchema = z.object({
  frames: z.array(z.object({ i: z.number().int() })).optional(),
  sources: z.record(z.string(), SourceBlock).optional(),
  stars: z.array(StarSchema).default([]),
  objects: z.array(ObjectSchema).default([]),
  asteroids: z.array(AsteroidSchema).default([]),
});

type Catalog = z.infer<typeof CatalogSchema>;
type Star = z.infer<typeof StarSchema>;

/** The status words of api.md section 6 that a catalog file can produce. */
export type SourceStatus = "ok" | "premade" | "empty" | "timeout" | "error" | "skipped";

// ------------------------------------------------------------------ file access

/** Root of the Next.js app (the web/ folder). Tests may pass another root. */
function webRoot(root?: string): string {
  return root ?? process.cwd();
}

async function readJsonFile(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/** Slugs of the ready spots in web/public/fields/index.json. A missing or broken list is a server fault. */
async function readySpotSlugs(root?: string): Promise<string[]> {
  const file = path.join(webRoot(root), "public", "fields", "index.json");
  const raw = await readJsonFile(file);
  if (!Array.isArray(raw)) throw new Error(`Cannot read the spot list ${file}.`);
  return raw.flatMap((s) => (s && typeof s.slug === "string" ? [s.slug as string] : []));
}

type SpotField = z.infer<typeof FieldSchema>;

/** A ready spot's field.json. Missing or broken for a listed spot is a server fault (500). */
async function readSpotField(slug: string, root?: string): Promise<SpotField> {
  const file = path.join(webRoot(root), "public", "fields", slug, "field.json");
  const raw = await readJsonFile(file);
  if (raw === null) throw new Error(`Spot "${slug}" is listed but has no field.json on the server.`);
  const parsed = FieldSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Spot "${slug}" has an invalid field.json on the server.`);
  return parsed.data;
}

/** The pre-made catalog for a spot, or null when its file does not exist yet. */
async function readCatalog(slug: string, root?: string): Promise<Catalog | null> {
  const file = path.join(webRoot(root), "data", "catalog", `${slug}.json`);
  const raw = await readJsonFile(file);
  if (raw === null) return null;
  const parsed = CatalogSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`The catalog file ${file} is not in the expected shape.`);
  return parsed.data;
}

// ------------------------------------------------------------------ helpers

const round = (v: number, digits: number): number => {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
};

const bad = (message: string) => new ApiFail("bad_request", message);

/** A spot the position belongs to: the slug, its picture and the pixel on it. */
type Located = { slug: string; field: SpotField; x: number; y: number; ra: number; dec: number };

/**
 * Pixels of guard band around every ready spot's picture (all four sides). Pixel centres sit at
 * integers, so the picture covers [-0.5, W-0.5). A catalog lookup reaches SIMBAD_RADIUS_ARCSEC
 * (9 arcsec, 1.46 px) around its position, so a live lookup just outside the picture could return
 * a star that lies inside the spot. Every position within ceil(radius / pixel) + 1 px of the
 * picture is therefore treated as inside the spot, and never asked live.
 */
export function guardBandPx(pixelArcsec: number): number {
  return Math.ceil(SIMBAD_RADIUS_ARCSEC / pixelArcsec) + 1;
}

/** True when pixel (x, y) is on the picture or in its guard band. */
function inBand(field: SpotField, x: number, y: number): boolean {
  const [w, h] = field.size;
  const g = guardBandPx(field.pixel_arcsec);
  return x >= -0.5 - g && x < w - 0.5 + g && y >= -0.5 - g && y < h - 0.5 + g;
}

/** The nearest pixel on the picture, for catalog searches of a position in the guard band. */
function clampToPicture(field: SpotField, x: number, y: number): { x: number; y: number } {
  const [w, h] = field.size;
  return { x: Math.min(Math.max(x, 0), w - 1), y: Math.min(Math.max(y, 0), h - 1) };
}

/**
 * Work out where the call points. A spot plus x, y is used as given (after the 2 px margin
 * check), giving one entry. Otherwise ra, dec is converted into every ready spot's picture and
 * each spot whose picture or guard band (see guardBandPx) contains it is returned, in index order.
 * An empty list means the position is outside every ready spot.
 */
async function locate(q: InfoQuery, root?: string): Promise<Located[]> {
  if (q.spot !== undefined) {
    if (q.x === undefined || q.y === undefined) {
      throw bad("A spot needs x and y, the pixel on its picture.");
    }
    const slugs = await readySpotSlugs(root);
    if (!slugs.includes(q.spot)) throw new ApiFail("not_found", `No spot called "${q.spot}".`);
    const field = await readSpotField(q.spot, root);
    const [w, h] = field.size;
    const { x, y } = { x: q.x, y: q.y };
    if (x < -MARGIN_PX || y < -MARGIN_PX || x > w - 1 + MARGIN_PX || y > h - 1 + MARGIN_PX) {
      throw bad("That pixel is more than 2 px outside the picture.");
    }
    const [ra, dec] = pixelToSky(field.wcs as FieldWcs, h, x, y);
    return [{ slug: q.spot, field, x, y, ra, dec }];
  }
  if (q.x !== undefined || q.y !== undefined) throw bad("x and y need a spot.");
  if (q.ra === undefined || q.dec === undefined) {
    throw bad("Give either spot with x and y, or ra and dec.");
  }
  const found: Located[] = [];
  for (const slug of await readySpotSlugs(root)) {
    const field = await readSpotField(slug, root);
    const h = field.size[1];
    const p = skyToPixel(field.wcs as FieldWcs, h, q.ra, q.dec);
    if (p && inBand(field, p[0], p[1])) {
      found.push({ slug, field, x: p[0], y: p[1], ra: q.ra, dec: q.dec });
    }
  }
  return found;
}

/** Nearest SIMBAD objects within 9 arcsec of the sky position, nearest first. */
function simbadNear(catalog: Catalog, ra: number, dec: number) {
  const hits: { name: string; otype?: string | null; sp_type?: string | null; z?: number | null; sep_arcsec: number; url: string }[] = [];
  for (const s of catalog.stars) {
    if (s.source !== "simbad" || !s.name) continue;
    const sep = angularSeparationDeg(ra, dec, s.ra, s.dec) * 3600;
    if (sep > SIMBAD_RADIUS_ARCSEC) continue;
    hits.push({
      name: s.name,
      otype: s.otype,
      sp_type: s.sp_type,
      z: s.z,
      sep_arcsec: round(sep, 2),
      url: `https://simbad.cds.unistra.fr/simbad/sim-id?Ident=${encodeURIComponent(s.name)}`,
    });
  }
  return hits.sort((a, b) => a.sep_arcsec - b.sep_arcsec);
}

/**
 * The nearest Gaia source within 6 arcsec, or null. A star with per-frame positions (`xy`) is
 * measured in pixels, taking the smallest separation over the frames; otherwise on the sky.
 */
function gaiaNear(catalog: Catalog, loc: Located) {
  const arcsecPerPx = loc.field.pixel_arcsec;
  let best: { star: Star; sep: number } | null = null;
  for (const s of catalog.stars) {
    if (s.source !== "gaia") continue;
    const sep = s.xy?.length
      ? Math.min(...s.xy.map(([sx, sy]) => Math.hypot(sx - loc.x, sy - loc.y) * arcsecPerPx))
      : angularSeparationDeg(loc.ra, loc.dec, s.ra, s.dec) * 3600;
    if (sep <= GAIA_RADIUS_ARCSEC && (!best || sep < best.sep)) best = { star: s, sep };
  }
  if (!best) return null;
  const s = best.star;
  return {
    id: s.id,
    g_mag: s.g_mag,
    plx: s.plx,
    plx_over_err: s.plx_over_err,
    pmra: s.pmra,
    pmdec: s.pmdec,
    sep_arcsec: round(best.sep, 2),
  };
}

/**
 * Known asteroids with a per-frame position within 2 px of the pixel, one entry per asteroid
 * (its nearest frame). Distances from the matching catalog object are added for that frame only.
 */
function solarSystemNear(catalog: Catalog, x: number, y: number) {
  const out: Record<string, unknown>[] = [];
  for (const ast of catalog.asteroids) {
    let best: { frame: number; sep: number } | null = null;
    for (const p of ast.positions) {
      const sep = Math.hypot(p.x - x, p.y - y);
      if (sep <= SOLAR_RADIUS_PX && (!best || sep < best.sep)) best = { frame: p.frame, sep };
    }
    if (!best) continue;
    const obj = catalog.objects.find((o) => o.name === ast.name);
    const idx = catalog.frames ? catalog.frames.findIndex((f) => f.i === best.frame) : best.frame - 1;
    const r = obj?.r_au?.[idx];
    const d = obj?.delta_au?.[idx];
    const source = obj?.source ?? catalog.sources?.jpl?.service;
    out.push({
      name: ast.name,
      frame: best.frame,
      sep_px: round(best.sep, 2),
      ...(typeof r === "number" && idx >= 0 ? { r_au: r } : {}),
      ...(typeof d === "number" && idx >= 0 ? { delta_au: d } : {}),
      ...(source ? { source } : {}),
    });
  }
  return out.sort((a, b) => (a.sep_px as number) - (b.sep_px as number));
}

/**
 * Status of one source for api.md section 6. A file that lacks the source block: skipped.
 * The file's own "unavailable" (CDS was down when it was made) is an error. Otherwise premade
 * when the file gave something near the pixel, empty when it had the source but nothing is near.
 */
function sourceStatus(block: { status?: string } | undefined, hits: number): SourceStatus {
  if (!block) return "skipped";
  if (block.status === "timeout") return "timeout";
  if (block.status === "unavailable" || block.status === "error") return "error";
  return hits > 0 ? "premade" : "empty";
}

const SKIPPED = { simbad: "skipped", gaia: "skipped", jpl: "skipped" } as const;

/** SIMBAD's coordinate search page for a position. */
function simbadCoordLink(ra: number, dec: number) {
  return {
    label: "SIMBAD",
    url: `https://simbad.cds.unistra.fr/simbad/sim-coo?Coord=${ra}%20${dec}&Radius=${SIMBAD_RADIUS_ARCSEC}&Radius.unit=arcsec`,
  };
}

// ------------------------------------------------------------------ the answer

/** Inspect answers in full for every caller (no unlock cookie needed). INSPECT_LOCK=1 restores the old lock. */
function inspectAlwaysOpen(): boolean {
  return process.env.INSPECT_LOCK !== "1";
}

function lockedBody(position: Record<string, number>) {
  return { mode: "round", locked: true, position };
}

async function exploreReady(asked: Located, root?: string): Promise<Record<string, unknown>> {
  const [catalog, key] = await Promise.all([readCatalog(asked.slug, root), loadAnswerKey(asked.slug, root)]);
  // The catalog is searched at the nearest pixel on the picture (a position in the guard band or
  // a little outside it is answered like an edge pixel). The answer echoes the position asked.
  const near = clampToPicture(asked.field, asked.x, asked.y);
  const [sra, sdec] =
    near.x === asked.x && near.y === asked.y
      ? [asked.ra, asked.dec]
      : pixelToSky(asked.field.wcs as FieldWcs, asked.field.size[1], near.x, near.y);
  const loc: Located = { ...asked, x: near.x, y: near.y, ra: sra, dec: sdec };
  const simbad = catalog ? simbadNear(catalog, loc.ra, loc.dec) : [];
  const gaia = catalog ? gaiaNear(catalog, loc) : null;
  const solar = catalog ? solarSystemNear(catalog, loc.x, loc.y) : [];
  const sources = catalog
    ? {
        simbad: sourceStatus(catalog.sources?.simbad, simbad.length),
        gaia: sourceStatus(catalog.sources?.gaia, gaia ? 1 : 0),
        jpl: sourceStatus(catalog.sources?.jpl, solar.length),
      }
    : SKIPPED;
  const links = [
    ...(simbad.length ? [simbadCoordLink(loc.ra, loc.dec)] : []),
    IRSA_LINK,
  ];
  return {
    mode: "explore",
    locked: false,
    position: { ra: round(asked.ra, 6), dec: round(asked.dec, 6), x: asked.x, y: asked.y },
    sources,
    simbad,
    gaia,
    solar_system: solar,
    links,
    ...(key?.reveal
      ? { spot_reveal: { title: key.reveal.title, kind: key.reveal.kind, difficulty: key.reveal.difficulty } }
      : {}),
  };
}

/**
 * The response for one call (api.md sections 2 and 6). `root` is the app folder (tests pass a
 * temporary one); by default the process working directory. `live` lets tests inject the fetch.
 */
export async function answerInfo(
  request: Request,
  q: InfoQuery,
  root?: string,
  live?: LiveDeps,
): Promise<Record<string, unknown>> {
  // User decision 2026-11-15: Inspect shows everything from the start, in a round too
  // ("on inspect, unlocked all information"). The mode is still read but no longer locks.
  const open = inspectAlwaysOpen();
  const asked = open || q.mode === "explore";
  const hits = await locate(q, root);

  if (hits.length === 0) {
    // Outside every ready spot and its guard band: explore is always granted, and only then is anything asked live.
    // A round answer returns before any network call. JPL is skipped: this lookup has no time.
    const position = { ra: q.ra as number, dec: q.dec as number };
    if (!asked) return lockedBody(position);
    const found = await lookupLive(position.ra, position.dec, live);
    return {
      mode: "explore",
      locked: false,
      position,
      sources: { simbad: found.simbad.status, gaia: found.gaia.status, jpl: "skipped" },
      simbad: found.simbad.rows,
      gaia: found.gaia.row,
      solar_system: [],
      links: [...(found.simbad.rows.length ? [simbadCoordLink(position.ra, position.dec)] : []), IRSA_LINK],
    };
  }

  // Inside ready spots: locked unless the cookie covers EVERY spot that contains the position.
  // The answer is built from the first containing spot the cookie covers.
  const first = hits[0];
  const position = { ra: round(first.ra, 6), dec: round(first.dec, 6), x: first.x, y: first.y };
  if (open) return exploreReady(first, root);
  const covered = (h: Located) => isUnlocked(request, h.slug);
  const granted = asked && hits.every(covered);
  if (!granted) return lockedBody(position);
  return exploreReady(hits.find(covered) as Located, root);
}
