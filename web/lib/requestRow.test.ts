import { describe, expect, it } from "vitest";
import { formatRequestPosition, formatRequestTime } from "./requestRow";

describe("formatRequestPosition", () => {
  it("formats numbers", () => {
    expect(formatRequestPosition({ ra: 12.3456, dec: -1, fov: 0.1 })).toBe("RA 12.346°, Dec -1.000°, field of view 0.1°");
  });
  it("accepts numeric strings (database numeric columns)", () => {
    expect(formatRequestPosition({ ra: "26.3271", dec: "-0.4338", fov: "0.1" })).toBe(
      "RA 26.327°, Dec -0.434°, field of view 0.1°",
    );
  });
  it("shows a dash for null, empty, non-numeric and missing values", () => {
    expect(formatRequestPosition({ ra: null, dec: "abc", fov: undefined })).toBe("RA –°, Dec –°, field of view –°");
    expect(formatRequestPosition({ ra: "", dec: NaN, fov: {} })).toBe("RA –°, Dec –°, field of view –°");
    expect(formatRequestPosition({})).toBe("RA –°, Dec –°, field of view –°");
  });
});

describe("formatRequestTime", () => {
  it("shows a dash when it is not a date", () => {
    expect(formatRequestTime(null)).toBe("–");
    expect(formatRequestTime("not a date")).toBe("–");
    expect(formatRequestTime("2026-01-06T00:47:00Z")).not.toBe("–");
  });
});
