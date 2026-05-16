// Mode-switch smoke tests.
//
// The map has three modes (Route / Sun / Discover). Switching between
// them flips body class names, swaps the active left-panel section, and
// toggles map behaviour (shadow layer on/off, pitch lock, etc.). This
// spec asserts the basic invariants of each transition.

import { test, expect } from "@playwright/test";

async function waitForGraphReady(page) {
  await page.waitForFunction(() => {
    const el = document.getElementById("stat-pistes");
    return el && el.textContent && el.textContent !== "—";
  }, null, { timeout: 20_000 });
}

test.describe("mode switching", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/map.html?world=tignes");
    await waitForGraphReady(page);
  });

  test("starts in route mode by default", async ({ page }) => {
    await expect(page.locator("body")).toHaveClass(/mode-route/);
    await expect(page.locator('[data-mode="route"]')).toHaveClass(/on/);
  });

  test("clicking Sun switches to sun mode", async ({ page }) => {
    await page.locator('[data-mode="sun"]').click();
    await expect(page.locator("body")).toHaveClass(/mode-sun/);
    await expect(page.locator("body")).not.toHaveClass(/mode-route/);
    await expect(page.locator("#sun-section")).toBeVisible();
  });

  test("clicking Discover switches to discover mode", async ({ page }) => {
    await page.locator('[data-mode="discover"]').click();
    await expect(page.locator("body")).toHaveClass(/mode-discover/);
    await expect(page.locator("#discover-section")).toBeVisible();
  });

  test("route → sun → route preserves the map and graph", async ({ page }) => {
    await page.locator('[data-mode="sun"]').click();
    await expect(page.locator("body")).toHaveClass(/mode-sun/);
    await page.locator('[data-mode="route"]').click();
    await expect(page.locator("body")).toHaveClass(/mode-route/);
    // Stats chip should still show the count — proves the graph wasn't lost.
    const pisteCount = await page.locator("#stat-pistes").textContent();
    expect(pisteCount).not.toBe("—");
  });
});
