import { expect, test } from "@playwright/test";

const routes = ["/", "/tutorial", "/play", "/map", "/embed", "/about", "/credits", "/status"];

/** Host of a console message's source, or "" when it has none. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

for (const route of routes) {
  test(`route ${route} renders with no console errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const url = m.location().url;
      // /map: SkyMap probes the CDS SPHEREx HiPS mirrors, which answer 404 for now (SERVER, issue
      // #12); the browser logs each failed probe. The page shows its offline spot list instead.
      if (route === "/map" && hostOf(url).endsWith("cds.unistra.fr")) return;
      errors.push(m.text());
    });
    const res = await page.goto(route);
    expect(res?.status()).toBe(200);
    await expect(page.locator("h1")).toBeVisible();
    expect(errors).toEqual([]);
  });
}
