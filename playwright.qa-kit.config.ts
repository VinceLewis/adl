import { defineConfig, devices } from "@playwright/test";

/**
 * qa-kit browser tiers have no webServer entries. env:up already ran `vite
 * build` and started `vite preview`; qa-kit health-checks that descriptor before
 * Playwright begins. A development server cannot silently replace the artefact.
 *
 * `ui` is production-file smoke coverage. `journey` runs the established,
 * sequential passkey flows over production files. Its authority is the existing
 * in-process fixture, not a claimed deployed/PostgreSQL authority proof.
 */
const UI_SPECS = [
  /giggle-band\.visual\.spec\.ts$/,
  /jointly-care\.visual\.spec\.ts$/,
  /browser-demo\.visual\.spec\.ts$/,
  /offline-shell\.spec\.ts$/,
];

export default defineConfig({
  testDir: "./tests",
  outputDir: "test-results/visual",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  globalSetup: "./tests/visual/support/evidence-globals.ts",
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["./tests/visual/support/evidence-reporter.ts"],
  ],
  use: { trace: "retain-on-failure" },
  projects: [
    {
      // Existing smoke specs distinguish their desktop-specific assertions by
      // this project name. It is the runner's `ui` capability, not a dev server.
      name: "desktop",
      testDir: "./tests/visual",
      testMatch: UI_SPECS,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://127.0.0.1:4173",
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "journey",
      testDir: "./tests/visual",
      testMatch: /passkey-sign-in\.spec\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        // localhost is a browser secure context; the fixture verifies real WebAuthn signatures.
        baseURL: "http://localhost:5273",
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "login",
      testDir: "./tests",
      testMatch: /qa-kit-run\.login\.spec\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        ...(process.env.QA_KIT_LOGIN_URL === undefined
          ? {}
          : { baseURL: process.env.QA_KIT_LOGIN_URL }),
        ...(process.env.QA_KIT_LOGIN_STORAGE_STATE === undefined
          ? {}
          : { storageState: process.env.QA_KIT_LOGIN_STORAGE_STATE }),
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
});
