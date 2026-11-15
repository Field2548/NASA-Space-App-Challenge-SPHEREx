import { describe, expect, it } from "vitest";
import { statusLabel } from "@/lib/statusLabel";

describe("statusLabel", () => {
  it("names a configured service by its status", () => {
    expect(statusLabel({ status: "green" })).toBe("Working");
    expect(statusLabel({ status: "amber", configured: true })).toBe("Slow");
    expect(statusLabel({ status: "red" })).toBe("Not answering");
  });

  it("says Not connected for configured === false, whatever the status", () => {
    expect(statusLabel({ status: "amber", configured: false })).toBe("Not connected");
    expect(statusLabel({ status: "red", configured: false })).toBe("Not connected");
  });

  it("treats an omitted configured as configured", () => {
    expect(statusLabel({ status: "green", configured: undefined })).toBe("Working");
  });
});
