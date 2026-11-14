// GET /api/info: catalog facts for the Inspect popup (owner: SERVER). Server only.
// Contract: docs/contracts/api.md sections 2 and 6. Build prompt: section 8.16 (radii, lock).
//
// The server decides the mode (api.md section 2). A position inside a ready spot is answered in
// full (explore) only when the caller asked for explore AND the signed unlock cookie covers that
// spot. Everything else gets the locked shape, which has exactly the keys mode, locked, position.
// Positions outside every ready spot are always explore, with live lookups skipped for now.
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
import { isUnlocked } from "@/lib/server/unlock";
import type { FieldWcs } from "@/lib/types";
import { pixelToSky, skyToPixel } from "@/lib/wcs";

/** Radii from BUILD_PROMPT 8.16 (api.md section 6). */
export const SIMBAD_RADIUS_ARCSEC = 9;
export const GAIA_RADIUS_ARCSEC = 6;
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
 * Work out where the call points. A spot plus x, y is used as given (after the 2 px margin
 * check). Otherwise ra, dec is converted into each ready spot's picture; the first one that
 * contains it wins. Returns null when the position is outside every ready spot.
 */
async function locate(q: InfoQuery, root?: string): Promise<Located | null> {
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
    return { slug: q.spot, field, x, y, ra, dec };
  }
  if (q.x !== undefined || q.y !== undefined) throw bad("x and y need a spot.");
  if (q.ra === undefined || q.dec === undefined) {
    throw bad("Give either spot with x and y, or ra and dec.");
  }
  for (const slug of await readySpotSlugs(root)) {
    const field = await readSpotField(slug, root);
    const [w, h] = field.size;
    const p = skyToPixel(field.wcs as FieldWcs, h, q.ra, q.dec);
    if (p && p[0] >= 0 && p[0] < w && p[1] >= 0 && p[1] < h) {
      return { slug, field, x: p[0], y: p[1], ra: q.ra, dec: q.dec };
    }
  }
  return null;
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

// ------------------------------------------------------------------ the answer

function lockedBody(position: Record<string, number>) {
  return { mode: "round", locked: true, position };
}

async function exploreReady(loc: Located, root?: string): Promise<Record<string, unknown>> {
  const [catalog, key] = await Promise.all([readCatalog(loc.slug, root), loadAnswerKey(loc.slug, root)]);
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
    ...(simbad.length
      ? [{ label: "SIMBAD", url: `https://simbad.cds.unistra.fr/simbad/sim-coo?Coord=${loc.ra}%20${loc.dec}&Radius=${SIMBAD_RADIUS_ARCSEC}&Radius.unit=arcsec` }]
      : []),
    IRSA_LINK,
  ];
  return {
    mode: "explore",
    locked: false,
    position: { ra: round(loc.ra, 6), dec: round(loc.dec, 6), x: loc.x, y: loc.y },
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
 * temporary one); by default the process working directory.
 */
export async function answerInfo(request: Request, q: InfoQuery, root?: string): Promise<Record<string, unknown>> {
  const asked = q.mode === "explore";
  const loc = await locate(q, root);

  if (!loc) {
    // Outside every ready spot: explore is always granted. Live SIMBAD, Gaia and JPL lookups
    // are not built yet, so they answer "skipped" with empty lists.
    const position = { ra: q.ra as number, dec: q.dec as number };
    if (!asked) return lockedBody(position);
    return {
      mode: "explore",
      locked: false,
      position,
      sources: SKIPPED,
      simbad: [],
      gaia: null,
      solar_system: [],
      links: [IRSA_LINK],
    };
  }

  const granted = asked && isUnlocked(request, loc.slug);
  const position = { ra: round(loc.ra, 6), dec: round(loc.dec, 6), x: loc.x, y: loc.y };
  if (!granted) return lockedBody(position);
  return exploreReady(loc, root);
}
