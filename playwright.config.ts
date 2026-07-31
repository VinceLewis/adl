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
 * - A third dev server on 5273 hosts the `passkey` project. It is the only one
 *   built with `VITE_ADL_AUTHORITY_URL` set, so it is the only one where
 *   session chrome renders at all — which is precisely why the other projects
 *   cannot cover the sign-in surface, and why this one exists. It uses
 *   `localhost` rather than `127.0.0.1` because an IP address is not a valid
 *   WebAuthn relying party id.
 *
 * Each project pins its own `testMatch` so a spec written for one server can
 * never be picked up by a project pointed at another.
 */
const GIGGLE_VISUAL_SPEC = /giggle-band\.visual\.spec\.ts$/;
const OFFLINE_SHELL_SPEC = /offline-shell\.spec\.ts$/;
const PASSKEY_SPEC = /passkey-sign-in\.spec\.ts$/;
const ADMINISTRATION_SPEC = /administration\.spec\.ts$/;

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
    {
      name: "passkey",
      testMatch: PASSKEY_SPEC,
      timeout: 120_000,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://localhost:5273",
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "administration",
      testMatch: ADMINISTRATION_SPEC,
      timeout: 120_000,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://localhost:5373",
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
    {
      command: "npm run dev -- --host localhost --port 5273",
      url: "http://localhost:5273/?demo=giggle-band",
      // The only server built with an authority configured, so the session
      // chrome the passkey spec drives actually renders.
      env: { VITE_ADL_AUTHORITY_URL: "http://localhost:8788" },
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: "npm run dev -- --host localhost --port 5373",
      url: "http://localhost:5373/?demo=giggle-band",
      // The administration chrome only renders with an authority configured, so
      // this project needs its own server pointed at its own throwaway authority
      // rather than sharing the passkey one — a bypassed identity deployment and
      // a passkey deployment cannot be the same process.
      env: { VITE_ADL_AUTHORITY_URL: "http://localhost:8789" },
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
