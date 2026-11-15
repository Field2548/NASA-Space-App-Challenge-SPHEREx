// TAN-SIP world <-> pixel for SPHEREx exposure headers (BUILD_PROMPT 8.20, quick look).
//
// PIXEL CONVENTION: every x, y in this file's API is a 0-BASED pixel coordinate, the same as
// astropy's `WCS.world_to_pixel` / `pixel_to_world` (origin 0): the centre of the first pixel in the
// file is (0, 0), x is the column (NAXIS1), y is the FITS row counted from the first row in the file.
// FITS keywords (CRPIX, the SIP polynomial's u, v) are 1-based; the conversion is done at the edges
// (`x = p1 - 1`). Nothing here flips rows: y grows in file order (upwards in the usual display).
//
// Steps (Calabretta & Greisen 2002 for TAN; Shupe et al. 2005 for SIP):
//   pixel -> world: u = p - CRPIX; (u', v') = (u + A(u, v), v + B(u, v)); (x, y) = CD (u', v') in deg;
//                   TAN deprojection -> native (phi, theta); rotate to (ra, dec) with LONPOLE.
//   world -> pixel: the reverse. The SIP inverse is solved by Newton iteration on the FORWARD A/B
//                   polynomials, started from the AP/BP inverse polynomial when the header has one.
//                   That matches astropy, whose world_to_pixel (all_world2pix) also inverts A/B
//                   iteratively and does not use AP/BP; AP/BP alone are only a fitted approximation.
//
// SIP is applied whenever A_ORDER/B_ORDER (or AP_ORDER/BP_ORDER) are present, even if CTYPE lacks
// the "-SIP" suffix: older SPHEREx headers carried the terms without it, and astropy applies them in
// that case too (it only logs an INFO message). Like astropy, every A_p_q with p + q <= A_ORDER is
// used, including the 0th and 1st order terms that SPHEREx headers do have (A_0_0 is about -0.4 px).

import type { FitsHeader, FitsValue } from "./fits";

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** SIP polynomial: coefficient of u^p v^q at c[p * (order + 1) + q]. */
interface Poly {
  order: number;
  c: Float64Array;
}

/** A header compiled once for fast repeated transforms. */
export interface SipWcs {
  /** 1-based reference pixel, as in the header. */
  crpix: [number, number];
  crval: [number, number];
  /** Linear matrix CD (deg per pixel), row-major [cd11, cd12, cd21, cd22]. */
  cd: [number, number, number, number];
  cdInv: [number, number, number, number];
  lonpole: number;
  a: Poly | null;
  b: Poly | null;
  ap: Poly | null;
  bp: Poly | null;
}

function numOr(h: FitsHeader, k: string, d: number): number {
  const v: FitsValue | undefined = h[k];
  return typeof v === "number" && Number.isFinite(v) ? v : d;
}

function readPoly(h: FitsHeader, prefix: "A" | "B" | "AP" | "BP"): Poly | null {
  const order = h[`${prefix}_ORDER`];
  if (typeof order !== "number" || !(order >= 0)) return null;
  const n = order + 1;
  const c = new Float64Array(n * n);
  for (let p = 0; p <= order; p++) {
    for (let q = 0; q <= order - p; q++) c[p * n + q] = numOr(h, `${prefix}_${p}_${q}`, 0);
  }
  return { order, c };
}

function evalPoly(poly: Poly, u: number, v: number): number {
  const n = poly.order + 1;
  let s = 0;
  let up = 1;
  for (let p = 0; p <= poly.order; p++) {
    let vq = 1;
    for (let q = 0; q <= poly.order - p; q++) {
      s += poly.c[p * n + q] * up * vq;
      vq *= v;
    }
    up *= u;
  }
  return s;
}

/** Partial derivatives (d/du, d/dv) of the polynomial. */
function gradPoly(poly: Poly, u: number, v: number): [number, number] {
  const n = poly.order + 1;
  let du = 0;
  let dv = 0;
  for (let p = 0; p <= poly.order; p++) {
    for (let q = 0; q <= poly.order - p; q++) {
      const c = poly.c[p * n + q];
      if (c === 0) continue;
      if (p > 0) du += c * p * Math.pow(u, p - 1) * Math.pow(v, q);
      if (q > 0) dv += c * q * Math.pow(u, p) * Math.pow(v, q - 1);
    }
  }
  return [du, dv];
}

/** Compile a header (needs CRPIX, CRVAL, and CD or PC + CDELT; SIP terms optional). */
export function compileSipWcs(h: FitsHeader): SipWcs {
  for (const k of ["CRPIX1", "CRPIX2", "CRVAL1", "CRVAL2"]) {
    if (typeof h[k] !== "number") throw new Error(`Header has no ${k}`);
  }
  for (const k of ["CTYPE1", "CTYPE2"]) {
    const t = h[k];
    if (typeof t === "string" && !t.includes("-TAN")) throw new Error(`Only TAN projections are supported (${k} = ${t})`);
  }
  let cd: [number, number, number, number];
  if (typeof h["CD1_1"] === "number" || typeof h["CD2_2"] === "number") {
    cd = [numOr(h, "CD1_1", 0), numOr(h, "CD1_2", 0), numOr(h, "CD2_1", 0), numOr(h, "CD2_2", 0)];
  } else {
    // CD_ij = CDELT_i * PC_ij; PC defaults to the identity.
    const c1 = numOr(h, "CDELT1", 1);
    const c2 = numOr(h, "CDELT2", 1);
    cd = [c1 * numOr(h, "PC1_1", 1), c1 * numOr(h, "PC1_2", 0), c2 * numOr(h, "PC2_1", 0), c2 * numOr(h, "PC2_2", 1)];
  }
  const det = cd[0] * cd[3] - cd[1] * cd[2];
  if (!(Math.abs(det) > 0)) throw new Error("Singular CD matrix");
  const cdInv: [number, number, number, number] = [cd[3] / det, -cd[1] / det, -cd[2] / det, cd[0] / det];
  const crval: [number, number] = [h["CRVAL1"] as number, h["CRVAL2"] as number];
  // Zenithal projections: default LONPOLE is 180 deg unless the reference point is the pole itself.
  const lonpole = numOr(h, "LONPOLE", crval[1] >= 90 ? 0 : 180);
  return {
    crpix: [h["CRPIX1"] as number, h["CRPIX2"] as number],
    crval,
    cd,
    cdInv,
    lonpole,
    a: readPoly(h, "A"),
    b: readPoly(h, "B"),
    ap: readPoly(h, "AP"),
    bp: readPoly(h, "BP"),
  };
}

// Compiling parses ~50 keys; quick look calls the transform 1681 times per exposure, so remember it.
const compiled = new WeakMap<FitsHeader, SipWcs>();

function asWcs(h: FitsHeader | SipWcs): SipWcs {
  if ("cdInv" in h && Array.isArray(h.cdInv)) return h as SipWcs;
  const header = h as FitsHeader;
  let w = compiled.get(header);
  if (!w) {
    w = compileSipWcs(header);
    compiled.set(header, w);
  }
  return w;
}

/** Native spherical (phi, theta) in radians -> celestial (ra, dec) in degrees. */
function nativeToCelestial(w: SipWcs, phi: number, theta: number): { ra: number; dec: number } {
  const ap = w.crval[0] * D2R;
  const dp = w.crval[1] * D2R;
  const dphi = phi - w.lonpole * D2R;
  const st = Math.sin(theta);
  const ct = Math.cos(theta);
  const sdp = Math.sin(dp);
  const cdp = Math.cos(dp);
  const dec = Math.asin(Math.max(-1, Math.min(1, st * sdp + ct * cdp * Math.cos(dphi))));
  const ra = ap + Math.atan2(-ct * Math.sin(dphi), st * cdp - ct * sdp * Math.cos(dphi));
  return { ra: ((((ra * R2D) % 360) + 360) % 360), dec: dec * R2D };
}

/** Celestial (ra, dec) in degrees -> native (phi, theta) in radians. */
function celestialToNative(w: SipWcs, ra: number, dec: number): { phi: number; theta: number } {
  const ap = w.crval[0] * D2R;
  const dp = w.crval[1] * D2R;
  const a = ra * D2R - ap;
  const d = dec * D2R;
  const sd = Math.sin(d);
  const cd = Math.cos(d);
  const sdp = Math.sin(dp);
  const cdp = Math.cos(dp);
  const theta = Math.asin(Math.max(-1, Math.min(1, sd * sdp + cd * cdp * Math.cos(a))));
  const phi = w.lonpole * D2R + Math.atan2(-cd * Math.sin(a), sd * cdp - cd * sdp * Math.cos(a));
  return { phi, theta };
}

/**
 * Pixel -> sky. x, y are 0-BASED pixel coordinates (astropy origin 0). Returns ICRS degrees,
 * ra in [0, 360).
 */
export function sipPixelToWorld(h: FitsHeader | SipWcs, x: number, y: number): { ra: number; dec: number } {
  const w = asWcs(h);
  const u = x + 1 - w.crpix[0]; // to 1-based FITS pixels, relative to CRPIX
  const v = y + 1 - w.crpix[1];
  const up = w.a ? u + evalPoly(w.a, u, v) : u;
  const vp = w.b ? v + evalPoly(w.b, u, v) : v;
  const ix = w.cd[0] * up + w.cd[1] * vp; // intermediate world coordinates, degrees
  const iy = w.cd[2] * up + w.cd[3] * vp;
  const r = Math.hypot(ix, iy);
  const phi = r === 0 ? 0 : Math.atan2(ix, -iy);
  const theta = Math.atan2(R2D, r); // TAN: R = (180/pi) cot(theta)
  return nativeToCelestial(w, phi, theta);
}

/**
 * Sky -> pixel. Returns 0-BASED pixel coordinates (astropy `world_to_pixel`). Returns NaNs for a
 * point on the far side of the sky (more than 90 degrees from the reference point).
 */
export function sipWorldToPixel(h: FitsHeader | SipWcs, ra: number, dec: number): { x: number; y: number } {
  const w = asWcs(h);
  const { phi, theta } = celestialToNative(w, ra, dec);
  if (!(theta > 0)) return { x: NaN, y: NaN };
  const r = R2D / Math.tan(theta);
  const ix = r * Math.sin(phi);
  const iy = -r * Math.cos(phi);
  // Undo CD: (U, V) are the distorted ("focal plane") pixel offsets u', v'.
  const U = w.cdInv[0] * ix + w.cdInv[1] * iy;
  const V = w.cdInv[2] * ix + w.cdInv[3] * iy;
  let u = w.ap ? U + evalPoly(w.ap, U, V) : U;
  let v = w.bp ? V + evalPoly(w.bp, U, V) : V;
  if (w.a || w.b) {
    // Newton: solve u + A(u, v) = U, v + B(u, v) = V. Converges in 2-3 steps from the AP/BP guess.
    for (let it = 0; it < 50; it++) {
      const fu = u + (w.a ? evalPoly(w.a, u, v) : 0) - U;
      const fv = v + (w.b ? evalPoly(w.b, u, v) : 0) - V;
      const [au, av] = w.a ? gradPoly(w.a, u, v) : [0, 0];
      const [bu, bv] = w.b ? gradPoly(w.b, u, v) : [0, 0];
      const j11 = 1 + au;
      const j12 = av;
      const j21 = bu;
      const j22 = 1 + bv;
      const det = j11 * j22 - j12 * j21;
      if (!(Math.abs(det) > 1e-12)) break;
      const du = (j22 * fu - j12 * fv) / det;
      const dv = (-j21 * fu + j11 * fv) / det;
      u -= du;
      v -= dv;
      if (Math.abs(du) < 1e-10 && Math.abs(dv) < 1e-10) break;
    }
  }
  return { x: u + w.crpix[0] - 1, y: v + w.crpix[1] - 1 };
}
