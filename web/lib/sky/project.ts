// Title-screen sky maths: stereographic projection of RA/Dec (J2000, degrees), the galactic plane
// as a band, and the star / line / band lists the TitleScreen draws. Pure and deterministic, so the
// server and the client print the same SVG.

import data from "./skyData.json";

const D = Math.PI / 180;

export type View = { ra: number; dec: number; scale: number };
/** Title view: the north celestial pole at the origin, turned so Orion (RA ~83 deg) lies to the right of it. */
export const TITLE_VIEW: View = { ra: 173, dec: 90, scale: 40 };
/** The drawing covers a disc of this radius (SVG units); stars and line points beyond it are dropped. */
export const FIELD_RADIUS = 150;

export type Star = { ra: number; dec: number; mag: number; bv: number; hip: number };
export const STARS: Star[] = (data.stars as number[][]).map(([ra, dec, mag, bv, hip]) => ({ ra, dec, mag, bv, hip }));
export const LINES: number[][][] = data.lines as number[][][];

/**
 * Stereographic projection about the view centre, as seen looking up at the sky: north is up and
 * east (growing RA) is to the left. Returns SVG-style coordinates (y grows downward) and k, the local
 * scale factor (angular size on the sphere times k times view.scale gives SVG units).
 */
export function project(ra: number, dec: number, view: View): { x: number; y: number; k: number } {
  const d0 = view.dec * D;
  const d = dec * D;
  const dra = (ra - view.ra) * D;
  const k = 2 / (1 + Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(dra));
  const east = k * Math.cos(d) * Math.sin(dra);
  const north = k * (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(dra));
  return { x: -east * view.scale, y: -north * view.scale, k };
}

/** Galactic (l, b) to equatorial J2000 (RA, Dec), degrees. */
export function galacticToEquatorial(l: number, b: number): { ra: number; dec: number } {
  const ngpRa = 192.85948 * D;
  const ngpDec = 27.12825 * D;
  const lNcp = 122.93192 * D;
  const lr = l * D;
  const br = b * D;
  const sinDec = Math.sin(br) * Math.sin(ngpDec) + Math.cos(br) * Math.cos(ngpDec) * Math.cos(lNcp - lr);
  const y = Math.cos(br) * Math.sin(lNcp - lr);
  const x = Math.sin(br) * Math.cos(ngpDec) - Math.cos(br) * Math.sin(ngpDec) * Math.cos(lNcp - lr);
  const ra = ((Math.atan2(y, x) + ngpRa) / D + 360) % 360;
  return { ra, dec: Math.asin(sinDec) / D };
}

const f1 = (v: number) => (Math.round(v * 10) / 10).toString();

/** Constellation figures as one SVG path; a polyline is cut where it leaves the drawn disc. */
export function linesPath(view: View = TITLE_VIEW): string {
  const parts: string[] = [];
  for (const poly of LINES) {
    let pen = false;
    for (const [ra, dec] of poly) {
      const p = project(ra, dec, view);
      if (p.k < 0 || Math.hypot(p.x, p.y) > FIELD_RADIUS) {
        pen = false;
        continue;
      }
      parts.push(`${pen ? "L" : "M"}${f1(p.x)} ${f1(p.y)}`);
      pen = true;
    }
  }
  return parts.join("");
}

export type PlacedStar = { x: number; y: number; mag: number; bv: number; hip: number };

/** Stars inside the drawn disc, brightest first. */
export function placedStars(view: View = TITLE_VIEW): PlacedStar[] {
  const out: PlacedStar[] = [];
  for (const s of STARS) {
    const p = project(s.ra, s.dec, view);
    if (p.k < 0 || Math.hypot(p.x, p.y) > FIELD_RADIUS) continue;
    out.push({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, mag: s.mag, bv: s.bv, hip: s.hip });
  }
  return out;
}

export type BandBlob = { x: number; y: number; r: number; o: number };

/**
 * The Milky Way as soft blobs along the galactic equator, brighter and wider toward the galactic
 * centre (l = 0, in Sagittarius). An approximation drawn from the plane geometry, not a survey image.
 */
export function milkyWayBlobs(view: View = TITLE_VIEW, step = 4): BandBlob[] {
  const out: BandBlob[] = [];
  for (let l = 0; l < 360; l += step) {
    const { ra, dec } = galacticToEquatorial(l, 0);
    const p = project(ra, dec, view);
    if (p.k < 0 || Math.hypot(p.x, p.y) > FIELD_RADIUS + 20) continue;
    const toCentre = 0.5 + 0.5 * Math.cos(l * D); // 1 at the galactic centre, 0 opposite
    const halfWidth = 7 + 6 * toCentre; // degrees
    out.push({
      x: Math.round(p.x * 10) / 10,
      y: Math.round(p.y * 10) / 10,
      r: Math.round(halfWidth * D * p.k * view.scale * 10) / 10,
      o: Math.round((0.1 + 0.25 * toCentre) * 100) / 100,
    });
  }
  return out;
}
