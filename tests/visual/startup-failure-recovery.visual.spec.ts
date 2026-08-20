import { expect, test, type Page } from "@playwright/test";
import {
  downgradePersistedApplicationMetadata,
  readAllPersistedRecords,
  readMountedModelVersion,
} from "./support/persisted-upgrade.js";

const JOINTLY_CARE_EXAMPLE_DATABASE_NAME = "adl-jointly-care-example";

/**
 * Phase 84 -- the failure this whole phase exists for, reproduced against a
 * real browser and a real app URL:
 * `docs/phases/phase-84-startup-failure-recovery-ui.md`.
 *
 * Deliberately the *unrecoverable* case, not Phase 83's (already-covered)
 * prior-version case: persisted application metadata carrying the SAME
 * `modelVersion` the running app currently declares, but a MISMATCHED
 * `modelFingerprint`. No declared migration can reach this -- the version
 * hasn't changed, so nothing says the content did -- so the startup
 * compatibility guard refuses rather than guesses
 * (`RUNTIME_STARTUP_COMPATIBILITY_CODES.MODEL_FINGERPRINT_STALE`), and
 * before this phase that refusal became a genuinely uncaught promise
 * rejection: a blank page, not a message.
 *
 * `downgradePersistedApplicationMetadata` (Phase 83's helper) is reused for
 * the seeding half even though the assertion here is the opposite of
 * Phase 83's: that helper only overwrites the metadata row, so writing the
 * *current* live version alongside a wrong fingerprint reproduces this
 * phase's target failure using the exact same real, already-seeded dataset
 * Jointly Care's own persisted-upgrade test does.
 */
test.describe("startup failure recovery", () => {
  test("shows the fallback and recovers via Reset local data and reload for a same-version, mismatched-fingerprint failure", async ({
    page,
  }, testInfo) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openJointlyCareApp(page);
    const liveModelVersion = await readMountedModelVersion(page);
    const recordsBeforeCorruption = await readAllPersistedRecords(
      page,
      JOINTLY_CARE_EXAMPLE_DATABASE_NAME,
    );
    expect(recordsBeforeCorruption.length).toBeGreaterThan(0);

    // The unrecoverable case: same declared version, different content.
    await downgradePersistedApplicationMetadata(page, JOINTLY_CARE_EXAMPLE_DATABASE_NAME, {
      modelVersion: liveModelVersion,
      modelFingerprint: `sha256-${"f".repeat(64)}`,
    });

    await page.reload();

    // Not a blank page and not an uncaught exception: the fallback element
    // itself, rendered straight into `document.body`.
    const fallback = page.locator("adl-startup-error [data-startup-error]");
    await expect(fallback).toBeVisible();
    await expect(fallback).toHaveAttribute("data-startup-error-kind", "runtime-startup");
    await expect(fallback).toContainText(
      "This app's locally saved data doesn't match the version currently running",
    );
    // `<adl-app>` was never appended for this failure -- `mountReferenceDemo`
    // threw before `mountDemo`'s `document.body.append(app)` line ever ran.
    await expect(page.locator("adl-app")).toHaveCount(0);

    await page.screenshot({
      path: testInfo.outputPath(`startup-failure-${testInfo.project.name}-runtime-startup.png`),
      fullPage: true,
    });

    const resetButton = page.locator("[data-startup-error-reset]");
    await expect(resetButton).toBeVisible();
    await resetButton.click();

    // The click deletes all three IndexedDB databases and then *the app
    // itself* reloads the page; it starts with nothing local to read and
    // re-seeds itself, exactly as `seedIfEmpty` already does for a genuinely
    // first-ever install.
    //
    // Deliberately no `page.goto` here, and this is the whole point of the
    // assertion below. A test-issued navigation races the app-initiated
    // reload and loses -- `net::ERR_ABORTED at page.goto`, this spec's
    // long-standing flake (12/50 repeats before this was changed) -- and it
    // would also prove the wrong thing: what this test exists to show is that
    // the app's *own* reload recovers, not that a fresh visit to the URL
    // does. Waiting on the recovered app's markup is therefore both the
    // synchronisation and the assertion. It cannot pass against the
    // pre-reload document: that document has no `<adl-app>` at all (the
    // failure threw before one was ever appended, asserted above) and does
    // have `<adl-startup-error>`.
    await expectJointlyCareAppReady(page);
    await expect(page.locator("adl-startup-error")).toHaveCount(0);

    const recordsAfterReset = await readAllPersistedRecords(
      page,
      JOINTLY_CARE_EXAMPLE_DATABASE_NAME,
    );
    expect(recordsAfterReset.length).toBeGreaterThan(0);
    expect(await readMountedModelVersion(page)).toBe(liveModelVersion);
    expect(pageErrors).not.toEqual(
      expect.arrayContaining([expect.stringContaining("Persisted runtime data is incompatible")]),
    );

    await page.screenshot({
      path: testInfo.outputPath(`startup-failure-${testInfo.project.name}-recovered.png`),
      fullPage: true,
    });
  });

  /**
   * The other tier: a failure that has nothing to do with persisted data
   * (here, `IndexedDB.open` itself failing, standing in for any unexpected
   * startup exception -- a compile failure and an authority network failure
   * hit this exact same code path and would render identically). No "Reset
   * local data" action: clearing IndexedDB does nothing for this kind of
   * failure, and offering an action that does not fix the problem would be
   * worse than offering none.
   */
  test("shows the generic fallback, with no reset action, for a non-startup-compatibility failure", async ({
    page,
  }, testInfo) => {
    await page.addInitScript((databaseName: string) => {
      const realOpen = window.indexedDB.open.bind(window.indexedDB);
      window.indexedDB.open = (name: string, version?: number) => {
        if (name === databaseName) {
          throw new Error("Simulated local storage failure for the startup-failure recovery test.");
        }
        return realOpen(name, version);
      };
    }, JOINTLY_CARE_EXAMPLE_DATABASE_NAME);

    await page.goto("/?demo=jointly-care");

    const fallback = page.locator("adl-startup-error [data-startup-error]");
    await expect(fallback).toBeVisible();
    await expect(fallback).toHaveAttribute("data-startup-error-kind", "generic");
    await expect(fallback).toContainText("Something went wrong starting the app");
    await expect(fallback).toContainText("Simulated local storage failure");
    await expect(page.locator("[data-startup-error-reset]")).toHaveCount(0);
    await expect(page.locator("[data-startup-error-reload]")).toBeVisible();
    await expect(page.locator("adl-app")).toHaveCount(0);

    await page.screenshot({
      path: testInfo.outputPath(`startup-failure-${testInfo.project.name}-generic.png`),
      fullPage: true,
    });
  });
});

async function openJointlyCareApp(page: Page): Promise<void> {
  await page.goto("/?demo=jointly-care");
  await expectJointlyCareAppReady(page);
}

/**
 * The readiness half of `openJointlyCareApp`, separated so it can be awaited
 * after a navigation the *app* initiated rather than the test. Locator waits
 * are navigation-resilient, so this settles on whichever document finally
 * mounts `<adl-app>` -- which is exactly the reload being waited for.
 */
async function expectJointlyCareAppReady(page: Page): Promise<void> {
  await page.locator("adl-app").waitFor({ state: "attached" });
  await expect(page.getByRole("heading", { name: "Jointly Care ADL Example" })).toBeVisible();
}
