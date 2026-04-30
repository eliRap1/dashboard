import { expect, test } from "@playwright/test";

test("home renders pet zoo header", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Pet Zoo" })).toBeVisible();
});
test("watchers page renders form", async ({ page }) => {
  await page.goto("/watchers");
  await expect(page.getByRole("heading", { name: "Watchers" })).toBeVisible();
});
