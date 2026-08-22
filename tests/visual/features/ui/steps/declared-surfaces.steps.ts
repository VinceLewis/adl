/**
 * Step definitions for qa-kit's `ui` Gherkin root.
 *
 * The Scenario carries the TEST id that `.qa-kit/pairs.json` maps; these steps
 * only drive the page. They use the same shell selectors the existing visual
 * specs use (`data-shell-menu`, `data-nav-item`) rather than inventing a second
 * navigation vocabulary.
 */

import { expect, mergeTests } from "@playwright/test";
import { test as bddTest, createBdd } from "playwright-bdd";
import { test as evidenceTest } from "../../../support/evidence.js";

// Acceptance Scenarios are browser tests like any other here, so they run under
// the same per-test evidence capture and review gates. Without the merge they
// would appear in EVIDENCE.md as "no evidence recorded" — a browser verdict
// nobody reviewed, which is the failure the evidence layer exists to prevent.
export const test = mergeTests(bddTest, evidenceTest);
const { Given, When, Then } = createBdd(test);

async function openDrawer(page: import("@playwright/test").Page): Promise<void> {
  const menu = page.locator("button[data-shell-menu='true']");
  await expect(menu).toBeVisible();
  await menu.click();
}

Given("the runtime demo is open on production files", async ({ page }) => {
  await page.goto("/");
  await page.locator("adl-app").waitFor({ state: "attached" });
  await expect(page.getByRole("heading", { name: "ADL Runtime Demo" })).toBeVisible();
});

When("the navigation drawer is opened", async ({ page }) => {
  await openDrawer(page);
});

When("the {string} surface is opened", async ({ page }, surface: string) => {
  await openDrawer(page);
  const item = page.locator(`button[data-nav-item='${surface}']`);
  await expect(item).toBeVisible();
  await item.click();
  await expect(page.locator(".adl-nav-drawer")).not.toHaveClass(/active/);
});

Then("the drawer offers the {string} surface", async ({ page }, surface: string) => {
  await expect(page.locator(`button[data-nav-item='${surface}']`)).toBeVisible();
});

Then("the surface heading is {string}", async ({ page }, heading: string) => {
  await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
});

Then("the surface lists the columns {string}", async ({ page }, columns: string) => {
  for (const column of columns.split(",").map((entry) => entry.trim())) {
    await expect(page.getByRole("columnheader", { name: column, exact: true })).toBeVisible();
  }
});

Then("the {string} surface is the active one", async ({ page }, surface: string) => {
  await expect(page.locator(`button[data-nav-item='${surface}']`)).toHaveClass(/active/);
});
