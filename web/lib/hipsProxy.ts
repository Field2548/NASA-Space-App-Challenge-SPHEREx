// Edge cache for the sky map's HiPS tiles. /api/hips/<src>/<path> fetches one file of an
// allowlisted HiPS and lets Vercel's CDN keep it, so each tile leaves IRSA or CDS once.
// Only the tiles in view are ever asked for: HiPS is cut into HEALPix tiles per zoom order.

/** Allowlisted HiPS bases, by the short name used in the proxy path. */
export const HIPS_SOURCES: Record<string, string> = {
  irsa: "https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube",
  cds: "https://alasky.cds.unistra.fr/SPHEREx/color",
  cdsbis: "https://alaskybis.cds.unistra.fr/SPHEREx/color",
};

/** Files a HiPS client reads: the properties file, the all-sky preview and the tiles (with an optional cube slice suffix). */
const PATH_RE = /^(properties|Norder\d{1,2}\/Allsky(_\d{1,3})?\.(png|jpg)|Norder\d{1,2}\/Dir\d{1,9}\/Npix\d{1,12}(_\d{1,3})?\.(png|jpg))$/;

/**
 * IRSA's cube seen as a plain one-band HiPS (tile suffix IRSA_BAND_SUFFIX, 0.81 um). Aladin draws a
 * cube with its HiPS3D renderer, which never falls back to the coarser tiles it already has, so every
 * zoom into a new order showed its grey clear colour until the new tiles arrived. As a plain HiPS it
 * keeps the previous picture until then.
 */
export const IRSA_BAND_SRC = "irsa-band";
const IRSA_BAND_SUFFIX = "_3";
/** The plain HiPS files, with no slice suffix (the proxy adds IRSA_BAND_SUFFIX). */
const BAND_PATH_RE = /^(properties|Norder\d{1,2}\/Allsky\.png|Norder\d{1,2}\/Dir\d{1,9}\/Npix\d{1,12}\.png)$/;

/** The cube's properties file as a plain image HiPS: no cube keys, no service URL to switch back to. */
export function bandProperties(text: string): string {
  return text
    .split("\n")
    .filter((l) => !/^\s*(hips_cube_|data_cube_|custom_tile_format|hips_service_url|hips_progenitor_url)/.test(l))
    .map((l) => l.replace(/^(\s*dataproduct_type\s*=\s*)cube\s*$/, "$1image"))
    .join("\n");
}

/** Upstream URL for a proxy request, or null when the source or path is not allowed. */
export function upstreamUrl(src: string, parts: string[]): string | null {
  const path = parts.join("/");
  if (src === IRSA_BAND_SRC) {
    if (!BAND_PATH_RE.test(path)) return null;
    return `${HIPS_SOURCES.irsa}/${path === "properties" ? path : path.replace(/\.png$/, `${IRSA_BAND_SUFFIX}.png`)}`;
  }
  const base = Object.hasOwn(HIPS_SOURCES, src) ? HIPS_SOURCES[src] : undefined;
  if (!base || !PATH_RE.test(path)) return null;
  return `${base}/${path}`;
}

/** Tiles never change once published: browsers keep them a day, the CDN a year. */
export const CACHE_OK = "public, max-age=86400, s-maxage=31536000, immutable";
/** A missing tile (sky outside the survey) is real but may be filled later. */
export const CACHE_MISSING = "public, max-age=3600, s-maxage=86400";
/** Upstream errors and timeouts are never cached (IRSA often answers 502/503 for a moment). */
export const CACHE_NONE = "no-store";

/** The proxy base for a HiPS base URL, or the URL unchanged when it is not allowlisted. */
export function edgeUrl(url: string, origin: string): string {
  const src = Object.keys(HIPS_SOURCES).find((k) => HIPS_SOURCES[k] === url);
  return src ? `${origin}/api/hips/${src}` : url;
}
