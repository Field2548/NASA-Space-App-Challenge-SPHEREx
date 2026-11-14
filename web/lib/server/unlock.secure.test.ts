import { NextResponse } from "next/server";
import { describe, expect, it } from "vitest";
import { grantUnlock } from "@/lib/server/unlock";

function setCookie(url: string, headers: Record<string, string> = {}): string {
  const res = NextResponse.json({});
  grantUnlock(new Request(url, { headers }), res, ["eros"]);
  return res.headers.get("set-cookie") ?? "";
}

describe("unlock cookie Secure flag", () => {
  it("is not Secure on plain http", () => {
    expect(setCookie("http://localhost/api/check")).not.toMatch(/;\s*Secure/i);
  });
  it("is Secure behind an https proxy", () => {
    expect(setCookie("http://localhost/api/check", { "x-forwarded-proto": "https" })).toMatch(/;\s*Secure/i);
    expect(setCookie("http://localhost/api/check", { "x-forwarded-proto": "https, http" })).toMatch(/;\s*Secure/i);
  });
  it("is Secure on an https URL", () => {
    expect(setCookie("https://example.com/api/check")).toMatch(/;\s*Secure/i);
  });
});
