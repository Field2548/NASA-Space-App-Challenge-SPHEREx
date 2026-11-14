import { expect, test } from "@playwright/test";

const routes = ["/", "/tutorial", "/play", "/embed", "/about", "/credits"];

for (const route of routes) {
  test(`route ${route} renders with no console errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    const res = await page.goto(route);
    expect(res?.status()).toBe(200);
    await expect(page.locator("h1")).toBeVisible();
    expect(errors).toEqual([]);
  });
}
