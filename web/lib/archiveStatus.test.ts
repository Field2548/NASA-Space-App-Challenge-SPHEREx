import { afterEach, describe, expect, it, vi } from "vitest";
import { archiveFromHealth, archiveMessage, getArchiveStatus, resetArchiveStatus } from "./archiveStatus";

afterEach(() => {
  resetArchiveStatus();
  vi.unstubAllGlobals();
});

const body = (sia: string, s3: string) => ({ services: [{ id: "irsa_sia", status: sia }, { id: "irsa_s3", status: s3 }, { id: "supabase", status: "red" }] });

describe("archiveFromHealth", () => {
  it("is down when an IRSA service is red, up otherwise", () => {
    expect(archiveFromHealth(body("red", "green"))).toBe("down");
    expect(archiveFromHealth(body("green", "red"))).toBe("down");
    expect(archiveFromHealth(body("green", "amber"))).toBe("up");
  });
  it("is unknown for a body without IRSA services", () => {
    expect(archiveFromHealth(null)).toBe("unknown");
    expect(archiveFromHealth({ services: [] })).toBe("unknown");
  });
});

describe("getArchiveStatus", () => {
  it("asks once and reuses the answer", async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => body("red", "green") }));
    vi.stubGlobal("fetch", f);
    expect(await getArchiveStatus()).toBe("down");
    expect(await getArchiveStatus()).toBe("down");
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("is unknown when the fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    expect(await getArchiveStatus()).toBe("unknown");
  });
});

describe("archiveMessage", () => {
  it("says the right thing for each state", () => {
    expect(archiveMessage("down", 7)).toMatch(/IRSA archive is not responding.*7 frames loaded/);
    expect(archiveMessage("up", 7)).toBe("This spot comes with 7 frames, and they're all shown.");
    expect(archiveMessage("unknown", 7)).toMatch(/couldn't check/);
  });
});
