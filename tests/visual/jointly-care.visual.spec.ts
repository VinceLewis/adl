import { expect, test, type Page } from "@playwright/test";
import {
  downgradePersistedApplicationMetadata,
  readAllPersistedRecords,
  readMountedModelVersion,
  readPersistedApplicationMetadata,
} from "./support/persisted-upgrade.js";

interface VisualPage {
  name: string;
  navItem: string;
  expectedText: string;
}

const jointlyCarePages: VisualPage[] = [
  { name: "home", navItem: "HomeDashboard", expectedText: "GP appointment" },
  { name: "circle-overview", navItem: "CircleOverview", expectedText: "Who is here" },
  { name: "calendar", navItem: "CircleEventCalendar", expectedText: "August 2026" },
  { name: "my-invites", navItem: "MyPendingInvites", expectedText: "Your pending invites" },
];

const JOINTLY_CARE_EXAMPLE_DATABASE_NAME = "adl-jointly-care-example";

test.describe("Jointly Care visual smoke", () => {
  /**
   * Phase 82 (`03c41b8`) advanced Jointly Care from model version `1.0.0`
   * to `1.1.0` with an empty-object migration alongside Giggle Band's, but
   * shipped a real-browser persisted-upgrade regression for Giggle only.
   * Later, independent content changes advanced both apps further still
   * (see `src/reference/jointly-care/domain.adlj`'s declared migrations) --
   * this test seeds a real pre-`1.1.0` installation and asserts against
   * whatever `modelVersion` the app currently declares, so it does not go
   * stale the next time either app's model version advances. This is
   * Jointly Care's equivalent of Giggle Band's persisted-upgrade test, per
   * Phase 83 -- see AGENTS.md's "Persisted-state upgrade testing"
   * subsection.
   *
   * Unlike Giggle Band's test, this one seeds by mounting the real app
   * first and letting it seed its own real reference dataset (Users,
   * Circles, Events, Messages, ...), then rolling back only the metadata
   * row underneath that data -- proving the *entire* real dataset survives
   * a migration byte-identical, not one hand-picked record.
   */
  test("opens and migrates a persisted pre-1.1.0 installation", async ({ page }, testInfo) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openJointlyCareApp(page);
    await expectAppReady(page);
    const recordsBeforeDowngrade = await readAllPersistedRecords(
      page,
      JOINTLY_CARE_EXAMPLE_DATABASE_NAME,
    );
    expect(recordsBeforeDowngrade.length).toBeGreaterThan(0);

    // Reproduce a real pre-`1.1.0` installation: the same real records this
    // app just seeded itself, persisted under the oldest declared version's
    // metadata.
    await downgradePersistedApplicationMetadata(page, JOINTLY_CARE_EXAMPLE_DATABASE_NAME, {
      modelVersion: "1.0.0",
      modelFingerprint: `sha256-${"0".repeat(64)}`,
    });

    await page.reload();
    await expectAppReady(page);
    await expect(page.getByRole("heading", { name: "Jointly Care ADL Example" })).toBeVisible();
    expect(pageErrors).not.toEqual(
      expect.arrayContaining([expect.stringContaining("Persisted runtime data is incompatible")]),
    );

    // Asserted against the model's own current version rather than a
    // hard-coded string, so this test does not go stale the next time
    // Jointly Care's `modelVersion` advances for an unrelated reason.
    const liveModelVersion = await readMountedModelVersion(page);
    const metadata = await readPersistedApplicationMetadata(
      page,
      JOINTLY_CARE_EXAMPLE_DATABASE_NAME,
    );
    expect(metadata?.modelVersion).toBe(liveModelVersion);

    // Every declared migration for this app is an empty-object no-op, so
    // the whole real seeded dataset -- not just one hand-picked record --
    // survives the migration byte-identical.
    const recordsAfterMigration = await readAllPersistedRecords(
      page,
      JOINTLY_CARE_EXAMPLE_DATABASE_NAME,
    );
    expect(recordsAfterMigration).toEqual(recordsBeforeDowngrade);

    await page.screenshot({
      path: testInfo.outputPath(`jointly-care-${testInfo.project.name}-persisted-upgrade.png`),
      fullPage: true,
    });
  });

  for (const pageSpec of jointlyCarePages) {
    test(`captures ${pageSpec.name} on every configured viewport`, async ({ page }, testInfo) => {
      await openJointlyCareApp(page);
      if (pageSpec.navItem !== "HomeDashboard" && pageSpec.navItem !== "MyPendingInvites") {
        await selectCircleContext(page);
      }
      await navigateTo(page, pageSpec);

      await expect(
        page.locator(".adl-workspace, .adl-composed-workspace, .adl-dashboard"),
      ).toContainText(pageSpec.expectedText);
      await expectAppReady(page);

      await page.screenshot({
        path: testInfo.outputPath(`jointly-care-${testInfo.project.name}-${pageSpec.name}.png`),
        fullPage: true,
      });

      await expectNoDocumentHorizontalOverflow(page);
    });
  }
});

async function openJointlyCareApp(page: Page): Promise<void> {
  await page.goto("/?demo=jointly-care");
  await page.locator("adl-app").waitFor({ state: "attached" });
  await expect(page.getByRole("heading", { name: "Jointly Care ADL Example" })).toBeVisible();
}

async function selectCircleContext(page: Page): Promise<void> {
  const circleSelector = page.locator("select[data-context-select='Circle']");
  await circleSelector.waitFor({ state: "attached" });
  const selected = await circleSelector.evaluate((select) => {
    const htmlSelect = select as HTMLSelectElement;
    const option = [...htmlSelect.options].find(
      (candidate) => candidate.label === "Mum's Care Circle",
    );
    if (option === undefined) {
      return "";
    }
    htmlSelect.value = option.value;
    htmlSelect.dispatchEvent(new Event("change", { bubbles: true }));
    return htmlSelect.value;
  });
  expect(selected).not.toBe("");
}

async function navigateTo(page: Page, pageSpec: VisualPage): Promise<void> {
  const menuButton = page.locator("button[data-shell-menu='true']");
  await expect(menuButton).toBeVisible();
  await menuButton.click();

  const navItem = page.locator(`button[data-nav-item='${pageSpec.navItem}']`);
  await expect(navItem).toBeVisible();
  await navItem.click();

  await expect(page.locator(".adl-nav-drawer")).not.toHaveClass(/active/);
}

async function expectNoDocumentHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const scrollWidth = Math.max(root.scrollWidth, body.scrollWidth);
    const viewportWidth = window.innerWidth;
    return {
      scrollWidth,
      viewportWidth,
      overflowing: scrollWidth > viewportWidth + 4,
    };
  });

  expect(overflow, `document overflowed horizontally: ${JSON.stringify(overflow)}`).toMatchObject({
    overflowing: false,
  });
}

async function expectAppReady(page: Page): Promise<void> {
  const app = page.locator("adl-app");
  await expect(app).toBeVisible();
  await expect(app).not.toContainText("Loading");
}
