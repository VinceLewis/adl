import { expect, test, type Page } from "@playwright/test";

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

test.describe("Jointly Care visual smoke", () => {
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
