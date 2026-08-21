import { expect, test } from "./support/evidence.js";
import { type Page } from "@playwright/test";
import { allowSignedOutStartup } from "./support/authority-allowances.js";
import {
  ADMINISTRATION_ACCOUNT_PROOF,
  startAdministrationAuthority,
  type AdministrationAuthorityHarness,
} from "./administration-authority.js";

/**
 * The administration surfaces in a real browser.
 *
 * This project exists for the reason the passkey one does: `npm run verify:push`
 * screenshots the reference app with **no authority configured**, so authority
 * chrome does not render there at all. The administration components are
 * authority chrome, and the integration suite proves the endpoints behind them
 * against real PostgreSQL — what only a browser can prove is that the real
 * components, the real bridge and the real HTTP edge produce a surface an
 * operator can actually use.
 *
 * Two properties are asserted as well as photographed, because both are things
 * a screenshot alone would not catch:
 *
 * - Retention is **read-only** here. There is no control anywhere on the page
 *   that runs it, by design: retention is application-wide and every
 *   administration authorisation is scoped to one business context.
 * - A caller with no context selected is told there is nothing to administer,
 *   not that they were refused. Denial and absence must stay indistinguishable.
 */

let authority: AdministrationAuthorityHarness;

test.beforeAll(async () => {
  authority = await startAdministrationAuthority();
});

test.afterAll(async () => {
  await authority?.close();
});

test("reviews audit, access and reports from the browser", async ({ page, evidence }, testInfo) => {
  allowSignedOutStartup(evidence);
  await signIn(page);

  const chrome = page.locator("[data-administration-chrome]");
  await expect(chrome).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("administration-signed-in.png"),
    fullPage: true,
  });

  // With no business context selected there is nothing to administer. This is
  // not a permission answer and must not read like one.
  const auditReview = page.locator("adl-audit-review");
  await auditReview.locator("[data-administration-refresh='true']").click();
  await expect(auditReview).toHaveAttribute("data-administration-status", "unavailable", {
    timeout: 20_000,
  });
  await expect(auditReview).not.toContainText("permitted");
  await expect(auditReview).not.toContainText("denied");

  await selectBandContext(page, authority.bandName);
  await auditReview.locator("[data-administration-refresh='true']").click();
  await expect(auditReview).toHaveAttribute("data-administration-status", "loaded", {
    timeout: 20_000,
  });

  // Membership review shows the band's members, revoked ones included, and
  // offers to end an active member's sessions.
  const accessReview = page.locator("adl-access-review");
  await expect(accessReview).toContainText(authority.memberUserId);
  await expect(
    accessReview.locator(`[data-revoke-member='${authority.memberUserId}']`),
  ).toBeVisible();

  // Retention is presented, and presented only as status: the whole section is
  // free of controls, because retention is application-wide and everything an
  // operator can reach from here is scoped to one business context.
  const retention = accessReview.locator("[data-access-retention='true']");
  await expect(retention).toContainText("365");
  expect(await retention.locator("button, input, select").count()).toBe(0);

  await page.screenshot({
    path: testInfo.outputPath("administration-reviewed.png"),
    fullPage: true,
  });
  // The section on its own as well as the page. A full-page shot of the demo is
  // dominated by chrome that has nothing to do with this surface, and the point
  // of the screenshot is that a reviewer can see the surface.
  await chrome.screenshot({ path: testInfo.outputPath("administration-surface.png") });

  await expectNoDocumentHorizontalOverflow(page);
});

test("runs a report and offers it as a CSV export", async ({ page, evidence }, testInfo) => {
  allowSignedOutStartup(evidence);
  await signIn(page);
  await selectBandContext(page, authority.bandName);

  const runner = page.locator("adl-report-runner");
  await expect(runner).toBeVisible();
  const select = runner.locator("[data-report-select='true']");
  await select.selectOption("HomeUpcomingEvents");
  await runner.locator("[data-report-run='true']").click();
  await expect(runner).toHaveAttribute("data-report-status", "ready", { timeout: 20_000 });

  await page.screenshot({
    path: testInfo.outputPath("administration-report.png"),
    fullPage: true,
  });
  await runner.screenshot({ path: testInfo.outputPath("administration-report-surface.png") });

  // The export really produces a file. Its contents came from the authority,
  // which applied the ordinary export policy to every source record first.
  const download = page.waitForEvent("download", { timeout: 20_000 });
  await runner.locator("[data-report-export='true']").click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.csv$/u);

  await expectNoDocumentHorizontalOverflow(page);
});

test("ends a member's sessions from the membership review", async ({ page, evidence }) => {
  allowSignedOutStartup(evidence);
  await signIn(page);
  await selectBandContext(page, authority.bandName);

  const auditReview = page.locator("adl-audit-review");
  await auditReview.locator("[data-administration-refresh='true']").click();
  await expect(auditReview).toHaveAttribute("data-administration-status", "loaded", {
    timeout: 20_000,
  });

  const accessReview = page.locator("adl-access-review");
  await accessReview.locator(`[data-revoke-member='${authority.memberUserId}']`).click();
  // The surface reloads from the authority rather than removing anything
  // locally: an operator must never be shown a revocation that did not happen.
  // The confirmation is the shared administration message.
  await expect(auditReview.locator("[data-administration-message='true']")).toContainText(
    "session",
    { timeout: 20_000 },
  );
});

async function signIn(page: Page): Promise<void> {
  await page.goto("/?demo=giggle-band");
  const panel = page.locator("adl-session-panel");
  await expect(panel).toHaveAttribute("data-session-status", "signedOut", { timeout: 20_000 });
  await panel.locator("[data-session-account-proof='true']").fill(ADMINISTRATION_ACCOUNT_PROOF);
  await panel.locator("[data-session-sign-in='true']").click();
  await expect(panel).toHaveAttribute("data-session-status", "signedIn", { timeout: 20_000 });
}

/**
 * Selects the band the authority bootstrapped down, by label. The option only
 * exists once the membership the server wrote has reached this device, so this
 * is also the proof that the signed-in identity really is the seeded operator.
 */
async function selectBandContext(page: Page, bandName: string): Promise<void> {
  const selector = page.locator("select[data-context-select='Band']");
  await selector.waitFor({ state: "attached", timeout: 20_000 });
  await expect
    .poll(
      async () =>
        selector.evaluate(
          (element, label) =>
            [...(element as HTMLSelectElement).options].some(
              (option) => option.label === (label as string),
            ),
          bandName,
        ),
      { timeout: 20_000 },
    )
    .toBe(true);
  const selected = await selector.evaluate((element, label) => {
    const select = element as HTMLSelectElement;
    const option = [...select.options].find((candidate) => candidate.label === (label as string));
    if (option === undefined) return "";
    select.value = option.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return select.value;
  }, bandName);
  expect(selected).not.toBe("");
}

async function expectNoDocumentHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const element = document.documentElement;
    return element.scrollWidth - element.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
}
