import { describe, expect, it } from "vitest";
import { formatDec, formatRA, parseCoordinates } from "./coords";

// WISE 0855-0714: 08h55m10.831s -07d14m42.53s = 133.795129, -7.245147
const RA = 133.795129;
const DEC = -7.245147;

function expectNear(input: string, ra: number, dec: number, tolDeg = 2e-4) {
  const r = parseCoordinates(input);
  if (!("ra" in r)) throw new Error(`${input} -> ${JSON.stringify(r)}`);
  expect(Math.abs(r.ra - ra)).toBeLessThan(tolDeg);
  expect(Math.abs(r.dec - dec)).toBeLessThan(tolDeg);
}

describe("parseCoordinates", () => {
  it.each([
    "133.795 -7.245",
    "133.795, -7.245",
    "133.795° -7.245°",
    "133.795d -7.245d",
    "  133.795   −7.245 ",
  ])("decimal degrees: %s", (s) => expectNear(s, 133.795, -7.245, 1e-9));

  it.each([
    "08h55m10.831s -07d14m42.53s",
    "08:55:10.831 -07:14:42.53",
    "08 55 10.831 -07 14 42.53",
    "08h 55m 10.831s, −07° 14′ 42.53″",
    "08:55:10.831 −07:14:42.53",
  ])("sexagesimal: %s", (s) => expectNear(s, RA, DEC));

  it("BP example 08:55:10.8 -07:14:42 lands within a pixel", () => expectNear("08:55:10.8 -07:14:42", RA, DEC, 6.15 / 3600));

  it("positive dec without sign and with +", () => {
    expectNear("13.2004 14.38", 13.2004, 14.38, 1e-9);
    expectNear("00h52m48.1s +14d22m48s", 13.2004, 14.38, 2e-4);
  });

  it.each(["Barnard's Star", "M101", "433 Eros", "Eris"])("names go to the resolver: %s", (s) => {
    expect(parseCoordinates(s)).toEqual({ name: s });
  });

  it.each([
    ["", "empty"],
    ["400 10", "ra range"],
    ["10 95", "dec range"],
    ["25:00:00 +10:00:00", "hours"],
    ["10:61:00 +10:00:00", "minutes"],
    ["10:00:00 +10:00:75", "seconds"],
    ["12.3", "one number"],
    ["1 2 3", "three numbers"],
  ])("rejects %s (%s)", (s) => {
    expect(parseCoordinates(s)).toHaveProperty("error");
  });
});

describe("formatRA / formatDec", () => {
  it("matches the BP display example", () => {
    expect(formatRA(RA)).toBe("08h55m10.83s");
    expect(formatDec(DEC)).toBe("−07°14′42.5″");
  });

  it("carries rounding instead of printing 60 seconds", () => {
    expect(formatRA(15 * (1 + 59 / 60 + 59.999 / 3600))).toBe("02h00m00.00s");
    expect(formatRA(359.99999999)).toBe("00h00m00.00s");
    expect(formatDec(10 + 59 / 60 + 59.99 / 3600)).toBe("+11°00′00.0″");
  });

  it("round-trips through the parser", () => {
    for (const [ra, dec] of [
      [0, 0],
      [13.2004, 14.38],
      [26.3271, -0.4338],
      [304.6935, 42.4437],
      [RA, DEC],
      [180, -89.5],
    ]) {
      expectNear(`${formatRA(ra)} ${formatDec(dec)}`, ra, dec, 1e-4);
    }
  });
});
