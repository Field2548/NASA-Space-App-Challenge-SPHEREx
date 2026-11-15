import { expect, test } from "@playwright/test";

test("/play?spot=eros loads a canvas and a click places a mark", async ({ page }) => {
  await page.goto("/play?spot=eros");
  const canvas = page.getByTestId("field-canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByText(/^0 marks in \d+ frames/)).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("canvas has no box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByText(/^1 mark in \d+ frames/)).toBeVisible();
  await expect(page.locator('svg [data-frame="1"]')).toHaveCount(1);
});

test("/play?spot=eros Inspect popup closes with its Close button", async ({ page }) => {
  await page.goto("/play?spot=eros");
  const canvas = page.getByTestId("field-canvas");
  await expect(canvas).toBeVisible();
  await page.keyboard.press("i");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("canvas has no box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const title = page.getByRole("heading", { name: /^INSPECT \/\/ px/ });
  await expect(title).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(title).toHaveCount(0);
});

test("/play?spot=eros marks by keyboard", async ({ page }) => {
  await page.goto("/play?spot=eros");
  await expect(page.getByTestId("field-canvas")).toBeVisible();
  const viewer = page.getByRole("group", { name: /Field viewer/ });
  await viewer.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/^1 mark in \d+ frames/)).toBeVisible();
});

test("/tutorial level 0 completes by keyboard", async ({ page }) => {
  await page.goto("/tutorial");
  await expect(page.getByTestId("field-canvas")).toBeVisible();
  const coach = page.getByTestId("coach-mark");
  await expect(coach).toContainText("These are real SPHEREx pictures");

  // The coach card takes focus when it first appears, so one Tab reaches its Next button.
  await page.keyboard.press("Tab");
  await expect(coach.getByRole("button", { name: "Next", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(coach).toContainText("Press Blink");

  await page.getByRole("button", { name: "Play blink" }).focus();
  await page.keyboard.press("Enter");
  await expect(coach).toContainText("Speed sets");
  await coach.getByRole("button", { name: "Next", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(coach).toContainText("Step by hand");
  await page.getByRole("button", { name: "Next frame" }).focus();
  await page.keyboard.press("Enter");
  await expect(coach).toContainText("Frames chooses");
  await coach.getByRole("button", { name: "Next", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(coach).toContainText("The Blink bar is different");
  await coach.getByRole("button", { name: "Next", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(coach).toContainText("Level 0 complete");
  await expect(page.getByRole("button", { name: "Start level 1" })).toBeVisible();
});
