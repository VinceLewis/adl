import { defineConfig, devices } from "@playwright/test";

/**
 * Two servers run for this suite.
 *
 * - The Vite dev server on 5173 hosts the `desktop`/`mobile` Giggle visual
 *   smoke projects. Service worker registration is production-gated, so the
 *   offline shell is deliberately absent there and those projects are unchanged
 *   by its existence.
 * - A production build served by `vite preview` on 4173 hosts the
 *   `offline-shell` project. The worker only registers in a built app, so the
 *   offline reload proof cannot be run against the dev server.
 *
 * Each project pins its own `testMatch` so a spec written for one server can
 * never be picked up by a project pointed at the other.
 */
const GIGGLE_VISUAL_SPEC = /giggle-band\.visual\.spec\.ts$/;
const OFFLINE_SHELL_SPEC = /offline-shell\.spec\.ts$/;

export default defineConfig({
  testDir: "./tests/visual",
  outputDir: "test-results/visual",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      testMatch: GIGGLE_VISUAL_SPEC,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "mobile",
      testMatch: GIGGLE_VISUAL_SPEC,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 393, height: 852 },
      },
    },
    {
      name: "offline-shell",
      testMatch: OFFLINE_SHELL_SPEC,
      timeout: 120_000,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://127.0.0.1:4173",
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
  webServer: [
    {
      command: "npm run dev -- --host 127.0.0.1",
      url: "http://127.0.0.1:5173/?demo=giggle-band",
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: "npm run build && npx vite preview --host 127.0.0.1 --port 4173",
      url: "http://127.0.0.1:4173/?demo=giggle-band",
      reuseExistingServer: true,
      timeout: 240_000,
    },
  ],
});
