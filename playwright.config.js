// Playwright config for the ski-home-map E2E suite.
//
// The site is pure static files — no build step — so we just serve the
// repo root over python's http.server and point Playwright at it. One
// browser (Chromium) is enough; we're not browser-bug hunting, we're
// asserting our own UI behaviour.

import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : "html",
  timeout: 30_000,

  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1280, height: 800 },
  },

  webServer: {
    // python3 ships on every dev box and on GitHub's ubuntu-latest runner,
    // so we avoid pulling in serve/http-server as another npm dep.
    command: `python3 -m http.server ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
    stderr: "pipe",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
