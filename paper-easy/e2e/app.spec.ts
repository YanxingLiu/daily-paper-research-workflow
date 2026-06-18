import { expect, test } from "@playwright/test";

test("loads a unified arXiv feed and supports filtering", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".paper-row").first()).toBeVisible({ timeout: 45_000 });

  const rows = await page.locator(".paper-row").count();
  await expect(page.locator(".status-line")).toContainText("Unique:");
  expect(rows).toBeGreaterThan(0);

  await page.getByPlaceholder("Search").fill("zzzz-not-found");
  await expect(page.getByText("No matches")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".topbar")).toBeVisible();
});

test("shows the author watchlist view", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "arxiv-authors" }).click();
  await expect(page.getByPlaceholder("Search authors feed")).toBeVisible();
});

test("switches between light and dark themes", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: /Switch to dark mode|Switch to light mode/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", /light|dark/);
  await expect(page.getByRole("link", { name: "Papers Easy" })).toBeVisible();
});
