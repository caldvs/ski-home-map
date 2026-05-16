// Route-mode smoke tests.
//
// Asserts the end-to-end "drop pin A, drop pin B, see a route" flow on a
// known-good world (tignes). Pin drops are fired through MapLibre's
// click event so the test doesn't depend on canvas pixel coordinates,
// which would be brittle across viewport sizes / zoom states.

import { test, expect } from "@playwright/test";

// Helper: wait until the graph has finished loading. The piste-count
// chip transitions from "—" to a number; that's our ready signal.
async function waitForGraphReady(page) {
  await page.waitForFunction(() => {
    const el = document.getElementById("stat-pistes");
    return el && el.textContent && el.textContent !== "—" && !isNaN(parseInt(el.textContent, 10));
  }, null, { timeout: 20_000 });
}

// Fire a map click at given lng/lat. MapLibre's click handler in
// js/ui.js consumes ev.lngLat + ev.point — we project the lngLat to a
// screen point so both fields are well-formed.
async function dropPin(page, lon, lat) {
  await page.evaluate(([lon, lat]) => {
    const map = window._ski && window._ski.map;
    if (!map) throw new Error("window._ski.map not set");
    const point = map.project([lon, lat]);
    map.fire("click", {
      lngLat: { lng: lon, lat: lat },
      point: point,
      originalEvent: new MouseEvent("click"),
    });
  }, [lon, lat]);
}

test.describe("route mode (tignes)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/map.html?world=tignes");
    await waitForGraphReady(page);
  });

  test("dropping two pins produces a route", async ({ page }) => {
    // Two points clearly in the tignes ski area, ~3 km apart.
    // (lng, lat). Coords picked from inside the bbox; the router will
    // snap them to the nearest graph node.
    await dropPin(page, 6.9000, 45.4510);  // near Val Claret
    await dropPin(page, 6.9810, 45.4490);  // near Val d'Isère Centre

    // Wait for an itinerary leg row to appear in the panel.
    const itinPane = page.locator('.tab-pane[data-tab-pane="itin"]');
    await expect(itinPane.locator(".leg, .itin-leg, .itinerary-leg, li").first())
      .toBeVisible({ timeout: 10_000 });

    // The route summary chips should reveal themselves once a route exists.
    await expect(page.locator("#route-summary-chips")).toBeVisible();

    // body.has-route is toggled when a route is drawn — used by CSS to
    // un-hide the Clear / Copy buttons.
    await expect(page.locator("body")).toHaveClass(/has-route/);
  });

  test("Clear route button wipes the route", async ({ page }) => {
    await dropPin(page, 6.9000, 45.4510);
    await dropPin(page, 6.9810, 45.4490);
    await expect(page.locator("body")).toHaveClass(/has-route/);

    await page.locator("#clear-route-btn").click();
    await expect(page.locator("body")).not.toHaveClass(/has-route/);
  });

  test("difficulty filter persists in URL or state", async ({ page }) => {
    // Default is Advanced; click Easy and the segment control should reflect.
    const seg = page.locator("#user-difficulty-seg");
    await expect(seg).toBeVisible();
    const easy = seg.locator('button:has-text("Easy")');
    await easy.click();
    await expect(easy).toHaveClass(/active|on|selected/);
  });
});
