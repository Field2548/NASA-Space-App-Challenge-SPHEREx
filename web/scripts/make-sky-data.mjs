// Bakes the title-screen sky into web/lib/sky/skyData.json (run by hand: node scripts/make-sky-data.mjs).
// Reads two d3-celestial data files (BSD-3-Clause, Olaf Frohn) at pinned commits and keeps only what
// the page draws: stars to magnitude 5 (Hipparcos number, RA/Dec J2000 in degrees, V magnitude, B-V)
// and the constellation stick figures. Nothing is fetched at runtime. The Milky Way is computed from
// the galactic plane in lib/sky/project.ts, so no outline file is needed.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://raw.githubusercontent.com/ofrohn/d3-celestial";
const STARS = `${BASE}/6d5e96655e0f1fe70b1eb7cf9be0eed5290e1458/data/stars.6.json`;
const LINES = `${BASE}/d2e20e104b86429d90ac8227a5b021262b45d75a/data/constellations.lines.json`;
const MAG_LIMIT = 5.0;

const get = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
};
const ra = (lon) => (lon < 0 ? lon + 360 : lon); // d3-celestial stores RA as -180..180 degrees
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;

const [stars, lines] = await Promise.all([get(STARS), get(LINES)]);
const outStars = stars.features
  .filter((f) => f.properties.mag <= MAG_LIMIT)
  .map((f) => {
    const [lon, lat] = f.geometry.coordinates;
    const bv = Number.parseFloat(f.properties.bv);
    return [r2(ra(lon)), r2(lat), r2(f.properties.mag), Number.isFinite(bv) ? r2(bv) : 0.6, f.id];
  })
  .sort((a, b) => a[2] - b[2]); // brightest first
const outLines = lines.features.flatMap((f) =>
  f.geometry.coordinates.map((poly) => poly.map(([lon, lat]) => [r1(ra(lon)), r1(lat)])),
);

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "lib", "sky", "skyData.json");
await writeFile(out, JSON.stringify({ stars: outStars, lines: outLines }) + "\n");
console.log(`stars ${outStars.length}, polylines ${outLines.length} -> ${out}`);
