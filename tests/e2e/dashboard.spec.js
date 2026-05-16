// Dashboard ("pick a world") landing-page smoke tests.
//
// The dashboard is the public landing page — first impression. These
// tests assert the world tiles render and clicking through reaches the
// map, which catches the obvious regressions (broken tile renderer,
// dead links, JS error at module load).

import { test, expect } from "@playwright/test";

test.describe("dashboard", () => {
  test("renders world tiles", async ({ page }) => {
    await page.goto("/index.html");
    await expect(page.locator("h1")).toContainText("ski-home-map");
    const tiles = page.locator(".world-tile");
    await expect(tiles.first()).toBeVisible();
    // We ship ~60 worlds; a regression that wipes the catalogue would
    // show up as <5. We don't pin the exact number — the catalogue
    // grows — but it should be a non-trivial set.
    expect(await tiles.count()).toBeGreaterThan(20);
  });

  test("tignes tile links to the map view", async ({ page }) => {
    await page.goto("/index.html");
    const tignesTile = page.locator('a[href*="world=tignes"]').first();
    await expect(tignesTile).toBeVisible();
    await tignesTile.click();
    await expect(page).toHaveURL(/world=tignes/);
  });

  test("no console errors during dashboard load", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await page.goto("/index.html");
    // Give async module loads a moment to settle.
    await page.waitForLoadState("networkidle");
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
