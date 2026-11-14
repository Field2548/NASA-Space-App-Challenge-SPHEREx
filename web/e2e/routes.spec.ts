import { expect, test } from "@playwright/test";

const routes = ["/", "/tutorial", "/play", "/embed", "/about", "/credits", "/status"];

for (const route of routes) {
  test(`route ${route} renders with no console errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      // /status probes /api/check on purpose; until SERVER's routes merge that probe is a 404.
      if (m.type() === "error" && !m.location().url.endsWith("/api/check")) errors.push(m.text());
    });
    const res = await page.goto(route);
    expect(res?.status()).toBe(200);
    await expect(page.locator("h1")).toBeVisible();
    expect(errors).toEqual([]);
  });
}
