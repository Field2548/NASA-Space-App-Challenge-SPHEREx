// Coordinate box parsing and display (BP 8.3). ICRS decimal degrees in, IAU-style text out.

export type ParsedCoordinates = { ra: number; dec: number } | { name: string } | { error: string };

const MINUS = /[−‒–—]/g; // typographic minus and dashes

function normalize(input: string): string {
  return input.trim().replace(MINUS, "-").replace(/\s+/g, " ");
}

const NUM = String.raw`\d+(?:\.\d*)?|\.\d+`;
const SIGNED = String.raw`[+-]?(?:${NUM})`;

// "133.795 -7.245", "133.795, -7.245", "133.795d -7.245d", "133.795° -7.245°"
const DECIMAL = new RegExp(String.raw`^(${NUM})\s*(?:d|deg|°)?\s*[ ,]\s*(${SIGNED})\s*(?:d|deg|°)?$`, "i");

// RA part: 08h55m10.831s | 08:55:10.8 | 08 55 10.8   Dec part: -07d14m42.53s | -07:14:42 | -07°14′42.5″ | -07 14 42
const RA_SEXA = String.raw`(\d{1,2})\s*[h: ]\s*(\d{1,2})\s*[m: ]\s*(${NUM})\s*s?`;
const DEC_SEXA = String.raw`([+-]?)(\d{1,2})\s*[d°: ]\s*(\d{1,2})\s*['′m: ]\s*(${NUM})\s*(?:["″s]|'')?`;
const SEXAGESIMAL = new RegExp(String.raw`^${RA_SEXA}\s*[ ,]?\s*${DEC_SEXA}$`, "i");

export function parseCoordinates(input: string): ParsedCoordinates {
  const s = normalize(input);
  if (!s) return { error: "Type a position (like 133.795 -7.245) or a name (like M101)." };

  const d = DECIMAL.exec(s);
  if (d) {
    const ra = Number(d[1]);
    const dec = Number(d[2]);
    if (!(ra >= 0 && ra < 360)) return { error: "RA must be from 0 to 360 degrees." };
    if (!(dec >= -90 && dec <= 90)) return { error: "Dec must be from -90 to +90 degrees." };
    return { ra, dec };
  }

  const m = SEXAGESIMAL.exec(s);
  if (m) {
    const [h, rm, rs] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const sign = m[4] === "-" ? -1 : 1;
    const [dd, dm, ds] = [Number(m[5]), Number(m[6]), Number(m[7])];
    if (h >= 24) return { error: "RA hours must be from 0 to 23." };
    if (rm >= 60 || rs >= 60 || dm >= 60 || ds >= 60) return { error: "Minutes and seconds must be under 60." };
    const ra = 15 * (h + rm / 60 + rs / 3600);
    const dec = sign * (dd + dm / 60 + ds / 3600);
    if (dec < -90 || dec > 90) return { error: "Dec must be from -90 to +90 degrees." };
    return { ra, dec };
  }

  // Anything containing a letter that is not a coordinate is treated as an object name (/api/resolve).
  if (/[a-z]/i.test(s) && s.length <= 80) return { name: s };
  return { error: "Could not read that. Try 133.795 -7.245, 08h55m10.8s -07d14m42s, or a name like M101." };
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/** Split a non-negative value into units, minutes, rounded seconds, carrying rounding up the chain. */
function sexagesimal(value: number, secDecimals: number): [number, number, string] {
  const factor = 10 ** secDecimals;
  let totalUnits = Math.round(value * 3600 * factor); // value in units -> integer tenths/hundredths of a second
  const unitsPart = Math.floor(totalUnits / (3600 * factor));
  totalUnits -= unitsPart * 3600 * factor;
  const minutes = Math.floor(totalUnits / (60 * factor));
  totalUnits -= minutes * 60 * factor;
  const sec = (totalUnits / factor).toFixed(secDecimals);
  const [whole, frac] = sec.split(".");
  return [unitsPart, minutes, frac ? `${pad(Number(whole), 2)}.${frac}` : pad(Number(whole), 2)];
}

/** "08h55m10.83s" */
export function formatRA(deg: number): string {
  const wrapped = ((deg % 360) + 360) % 360;
  let [h, m, s] = sexagesimal(wrapped / 15, 2);
  if (h === 24) [h, m, s] = [0, 0, "00.00"];
  return `${pad(h, 2)}h${pad(m, 2)}m${s}s`;
}

/** "−07°14′42.5″" (true minus sign, U+2212) */
export function formatDec(deg: number): string {
  const sign = deg < 0 ? "−" : "+";
  const [d, m, s] = sexagesimal(Math.abs(deg), 1);
  return `${sign}${pad(d, 2)}°${pad(m, 2)}′${s}″`;
}
