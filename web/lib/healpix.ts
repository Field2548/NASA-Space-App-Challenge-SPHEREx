// Thin wrapper over @hscmap/healpix for the NESTED scheme only.
// The library works in colatitude theta (= 90 - dec) and longitude phi (= ra), in radians;
// this module takes and returns degrees, ra in [0, 360), dec in [-90, 90].

import { ang2pix_nest, corners_nest, pix2ang_nest, vec2ang } from "@hscmap/healpix";

const DEG = Math.PI / 180;
const MAX_ORDER = 15;

function assertOrder(order: number, name = "order"): void {
  if (!Number.isInteger(order) || order < 0 || order > MAX_ORDER) {
    throw new RangeError(`${name} must be an integer from 0 to ${MAX_ORDER}, got ${order}`);
  }
}

function assertIpix(ipix: number, order: number): void {
  const npix = 12 * 4 ** order;
  if (!Number.isInteger(ipix) || ipix < 0 || ipix >= npix) {
    throw new RangeError(`ipix must be an integer from 0 to ${npix - 1} at order ${order}, got ${ipix}`);
  }
}

function normRa(deg: number): number {
  const r = ((deg % 360) + 360) % 360;
  return r >= 360 ? 0 : r; // guards against -tiny rounding up to 360
}

/** NESTED pixel index of a sky position (degrees). Default order 12 (cells about 0.86 arcmin). */
export function hpxNest(ra: number, dec: number, order: number = 12): number {
  assertOrder(order);
  if (!Number.isFinite(ra)) throw new RangeError(`ra must be a finite number, got ${ra}`);
  if (!Number.isFinite(dec) || dec < -90 || dec > 90) {
    throw new RangeError(`dec must be a finite number from -90 to 90, got ${dec}`);
  }
  const theta = (90 - dec) * DEG;
  const phi = normRa(ra) * DEG;
  return ang2pix_nest(2 ** order, theta, phi);
}

/** Parent cell at a coarser order: ipix >> 2*(fromOrder - toOrder). Must be exact for order 12 (indices up to 12*4^12 ≈ 2.0e8 fit in 32 bits, but do NOT use 32-bit shifts blindly: use Math.floor(ipix / 4 ** (fromOrder - toOrder)) so it is safe for larger orders too). Throws RangeError if toOrder > fromOrder or orders are not integers in 0..15. */
export function parent(ipix: number, fromOrder: number, toOrder: number): number {
  assertOrder(fromOrder, "fromOrder");
  assertOrder(toOrder, "toOrder");
  if (toOrder > fromOrder) {
    throw new RangeError(`toOrder (${toOrder}) must not exceed fromOrder (${fromOrder})`);
  }
  assertIpix(ipix, fromOrder);
  return Math.floor(ipix / 4 ** (fromOrder - toOrder));
}

function toRaDec(theta: number, phi: number): [number, number] {
  const dec = Math.min(90, Math.max(-90, 90 - theta / DEG));
  return [normRa(phi / DEG), dec];
}

/** The 4 corners of a cell as [ra, dec] in degrees, ra in [0, 360). */
export function cellCorners(ipix: number, order: number): [number, number][] {
  assertOrder(order);
  assertIpix(ipix, order);
  return corners_nest(2 ** order, ipix).map((v) => {
    const { theta, phi } = vec2ang(v);
    return toRaDec(theta, phi);
  });
}

/** Centre of a cell as [ra, dec] in degrees. */
export function cellCenter(ipix: number, order: number): [number, number] {
  assertOrder(order);
  assertIpix(ipix, order);
  const { theta, phi } = pix2ang_nest(2 ** order, ipix);
  return toRaDec(theta, phi);
}
