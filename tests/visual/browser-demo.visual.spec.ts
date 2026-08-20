import { expect, test, type Page } from "@playwright/test";
import {
  downgradePersistedApplicationMetadata,
  readAllPersistedRecords,
  readMountedModelVersion,
  readPersistedApplicationMetadata,
} from "./support/persisted-upgrade.js";

const BROWSER_DEMO_DATABASE_NAME = "adl-browser-runtime-demo";

/**
 * The generic persistent browser demo -- the app `src/ui/main.ts` mounts by
 * default when no `?demo=` id is present, backed by
 * `src/ui/demo-fixture.ts`'s `browserDemoPartialModel` and the
 * `adl-browser-runtime-demo` IndexedDB database. It has no `?demo=` id of
 * its own and therefore no other visual spec file: `offline-shell.spec.ts`
 * covers service-worker caching for Giggle Band, not this app's rendering,
 * and no other spec loads the bare `/` URL.
 *
 * Phase 82 (`03c41b8`) advanced this demo from model version `0.1.0` to
 * `0.2.0` with an empty-object migration, the same change it made to
 * Giggle Band and Jointly Care, but shipped a real-browser
 * persisted-upgrade regression for Giggle only. This file is this app's
 * equivalent, per Phase 83 -- see AGENTS.md's "Persisted-state upgrade
 * testing" subsection.
 *
 * Like Jointly Care's test, this seeds by mounting the real app first and
 * letting it seed its own real fixture data (Users, PurchaseOrders,
 * Workspaces, ...) via `seedBrowserDemoRuntimeIfEmpty`, then rolling back
 * only the metadata row underneath that data -- proving the entire real
 * seeded dataset survives a migration byte-identical, not one hand-picked
 * record.
 */
test.describe("generic persistent browser demo visual smoke", () => {
  test("opens and migrates a persisted pre-0.2.0 installation", async ({ page }, testInfo) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openBrowserDemoApp(page);
    await expectAppReady(page);
    const recordsBeforeDowngrade = await readAllPersistedRecords(page, BROWSER_DEMO_DATABASE_NAME);
    expect(recordsBeforeDowngrade.length).toBeGreaterThan(0);

    // Reproduce a real pre-`0.2.0` installation: the same real records this
    // demo just seeded itself, persisted under the previous declared
    // version's metadata.
    await downgradePersistedApplicationMetadata(page, BROWSER_DEMO_DATABASE_NAME, {
      modelVersion: "0.1.0",
      modelFingerprint: `sha256-${"0".repeat(64)}`,
    });

    await page.reload();
    await expectAppReady(page);
    await expect(page.getByRole("heading", { name: "ADL Runtime Demo" })).toBeVisible();
    expect(pageErrors).not.toEqual(
      expect.arrayContaining([expect.stringContaining("Persisted runtime data is incompatible")]),
    );

    // Asserted against the model's own current version rather than a
    // hard-coded string, so this test does not go stale the next time this
    // demo's `modelVersion` advances for an unrelated reason.
    const liveModelVersion = await readMountedModelVersion(page);
    const metadata = await readPersistedApplicationMetadata(page, BROWSER_DEMO_DATABASE_NAME);
    expect(metadata?.modelVersion).toBe(liveModelVersion);

    // The declared migration is an empty-object no-op, so the whole real
    // seeded dataset -- not just one hand-picked record -- survives the
    // migration byte-identical.
    const recordsAfterMigration = await readAllPersistedRecords(page, BROWSER_DEMO_DATABASE_NAME);
    expect(recordsAfterMigration).toEqual(recordsBeforeDowngrade);

    await page.screenshot({
      path: testInfo.outputPath(`browser-demo-${testInfo.project.name}-persisted-upgrade.png`),
      fullPage: true,
    });
  });
});

async function openBrowserDemoApp(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator("adl-app").waitFor({ state: "attached" });
  await expect(page.getByRole("heading", { name: "ADL Runtime Demo" })).toBeVisible();
}

async function expectAppReady(page: Page): Promise<void> {
  const app = page.locator("adl-app");
  await expect(app).toBeVisible();
  await expect(app).not.toContainText("Loading");
}
