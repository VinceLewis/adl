import { expect, test, type Page } from "@playwright/test";

interface VisualPage {
  name: string;
  navItem: string;
  expectedText: string;
}

const gigglePages: VisualPage[] = [
  { name: "home", navItem: "HomeDashboard", expectedText: "Welcome Back!" },
  { name: "gigs", navItem: "BandEventList", expectedText: "Canal Street headline" },
  { name: "calendar", navItem: "BandEventCalendar", expectedText: "August 2026" },
  {
    name: "availability",
    navItem: "MyAvailabilityList",
    expectedText: "Unavailable - session prep",
  },
  { name: "songs", navItem: "SongLibrary", expectedText: "Neon Map" },
  { name: "set-lists", navItem: "SetListList", expectedText: "August headline" },
  { name: "bands", navItem: "BandDirectory", expectedText: "The Alphas" },
];

test.describe("Giggle Band visual smoke", () => {
  for (const pageSpec of gigglePages) {
    test(`captures ${pageSpec.name} on every configured viewport`, async ({ page }, testInfo) => {
      await openGiggleApp(page);
      await selectBandContext(page);
      await navigateTo(page, pageSpec);

      await expect(page.locator(".adl-workspace, .adl-composed-workspace")).toContainText(
        pageSpec.expectedText,
      );
      await expectAppReady(page);

      await page.screenshot({
        path: testInfo.outputPath(`giggle-${testInfo.project.name}-${pageSpec.name}.png`),
        fullPage: true,
      });

      await expectNoDocumentHorizontalOverflow(page);
      await expectNoVisibleElementOverflow(page);

      if (pageSpec.navItem === "HomeDashboard") {
        await expectHomeFeedSpacing(page);
      }
      if (pageSpec.navItem === "BandEventList") {
        await expect(page.locator("button[data-row-action]")).toHaveCount(0);
      }
    });
  }

  test("captures event create and edit surfaces on every configured viewport", async ({
    page,
  }, testInfo) => {
    await openGiggleApp(page);
    await selectBandContext(page);
    await navigateTo(page, {
      name: "gigs",
      navItem: "BandEventList",
      expectedText: "Canal Street headline",
    });

    await page.locator("button[data-list-action='new']").click();
    await expect(page.locator(".adl-edit-container adl-form-view")).toBeVisible();
    await expect(page.locator("button[data-action-name='delete']")).toHaveCount(0);
    await expectNoDocumentHorizontalOverflow(page);
    await expectNoVisibleElementOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`giggle-${testInfo.project.name}-event-create.png`),
      fullPage: true,
    });

    await page.locator("button[aria-label='Close form']").click();
    await expect(page.locator(".adl-edit-container")).toHaveCount(0);

    await page.locator("tr[data-record-id]").first().click();
    await expect(page.locator(".adl-edit-container adl-form-view")).toBeVisible();
    await expect(page.locator("button[data-action-name='delete']")).toBeVisible();
    await expectNoDocumentHorizontalOverflow(page);
    await expectNoVisibleElementOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`giggle-${testInfo.project.name}-event-edit.png`),
      fullPage: true,
    });
  });

  test("opens calendar availability records modally and returns to calendar", async ({
    page,
  }, testInfo) => {
    await openGiggleApp(page);
    await selectBandContext(page);
    await navigateTo(page, {
      name: "calendar",
      navItem: "BandEventCalendar",
      expectedText: "August 2026",
    });

    await clickFirstVisible(page, "button[data-object-name='Availability'][data-record-id]");
    await expect(page.locator(".adl-edit-container adl-form-view")).toBeVisible();
    await expect(page.locator("adl-field-renderer[data-field-name='Notes']")).toContainText(
      "Notes",
    );
    await expectNoDocumentHorizontalOverflow(page);
    await expectNoVisibleElementOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`giggle-${testInfo.project.name}-calendar-availability-edit.png`),
      fullPage: true,
    });

    await page.locator("button[aria-label='Close form']").click();
    await expect(page.locator(".adl-edit-container")).toHaveCount(0);
    await expect(page.locator("[data-presentation-calendar='MonthPlanner']")).toBeVisible();
    await expect(page.locator("adl-list-view")).toHaveCount(0);
    await expect(page.locator("[data-nav-item='BandEventCalendar']")).toHaveClass(/active/);
  });

  test("keeps shell and list controls visible while app content scrolls", async ({
    page,
  }, testInfo) => {
    await openGiggleApp(page);
    await selectBandContext(page);
    await seedExtraSongs(page, 28);
    await navigateTo(page, {
      name: "songs",
      navItem: "SongLibrary",
      expectedText: "Neon Map",
    });

    await expect(page.locator(".adl-list-panel")).toBeVisible();
    await expect(page.locator(".adl-scroll-region")).toBeVisible();

    const scrollable = await page.locator(".adl-scroll-region").evaluate((region) => {
      return region.scrollHeight > region.clientHeight + 24;
    });
    expect(scrollable).toBe(true);

    const topbarBefore = await boundingBox(page, ".adl-topbar");
    await page.locator(".adl-scroll-region").evaluate((region) => {
      region.scrollTop = 420;
    });
    await page.waitForTimeout(100);

    const documentScrollY = await page.evaluate(() => window.scrollY);
    expect(documentScrollY).toBe(0);

    const topbarAfter = await boundingBox(page, ".adl-topbar");
    expect(Math.abs(topbarAfter.top - topbarBefore.top)).toBeLessThan(1);
    await expect(page.locator(".adl-topbar")).toBeVisible();

    const listHeader = await boundingBox(page, ".adl-list-panel .adl-panel-header");
    const scrollRegion = await boundingBox(page, ".adl-scroll-region");
    expect(listHeader.top).toBeGreaterThanOrEqual(scrollRegion.top - 1);
    expect(listHeader.top).toBeLessThanOrEqual(scrollRegion.top + 1);

    if (testInfo.project.name === "desktop") {
      const tableHeader = await boundingBox(page, ".adl-list-panel .adl-table th:first-child");
      expect(tableHeader.top).toBeGreaterThanOrEqual(listHeader.bottom - 1);
      expect(tableHeader.top).toBeLessThanOrEqual(listHeader.bottom + 8);
    } else {
      const tableHeaderDisplay = await page
        .locator(".adl-list-panel .adl-table thead")
        .evaluate((thead) => getComputedStyle(thead).position);
      expect(tableHeaderDisplay).toBe("absolute");
    }

    await expectNoDocumentHorizontalOverflow(page);
    await expectNoVisibleElementOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`giggle-${testInfo.project.name}-songs-sticky-scroll.png`),
      fullPage: true,
    });
  });
});

/**
 * The drawer with its declared chrome open.
 *
 * Every other spec opens the drawer only to click through it and asserts it has
 * closed again, so the region itself was never captured. `ui.adl` now declares a
 * `NAV_DRAWER` title and a drawer-placed control, and a control placed there
 * used to parse, resolve and validate and then render nowhere at all — exactly
 * the kind of thing a screenshot catches and a unit test does not.
 */
test("captures the navigation drawer and its declared chrome", async ({ page }, testInfo) => {
  await openGiggleApp(page);
  await selectBandContext(page);

  const menuButton = page.locator("button[data-shell-menu='true']");
  await expect(menuButton).toBeVisible();
  await menuButton.click();

  const drawer = page.locator(".adl-nav-drawer");
  await expect(drawer).toHaveClass(/active/);
  // The declared title, not the application name it falls back to.
  await expect(drawer.locator("[data-shell-drawer-title]")).toHaveText("Giggle Band");
  await expect(drawer.locator("[data-shell-drawer-tools]")).toBeVisible();
  // Declared in `ui.adl` with `PLACEMENT navDrawer`, so it belongs here and
  // nowhere else.
  await expect(page.locator(".adl-topbar-tools")).not.toContainText("Sign out");
  await expect(drawer.locator("[data-nav-item='BandMemberAvailabilityBoard']")).toBeVisible();

  await page.screenshot({
    path: testInfo.outputPath(`giggle-${testInfo.project.name}-nav-drawer.png`),
    fullPage: false,
  });

  await expectNoDocumentHorizontalOverflow(page);
});

async function openGiggleApp(page: Page): Promise<void> {
  await page.goto("/?demo=giggle-band");
  await page.locator("adl-app").waitFor({ state: "attached" });
  await expect(page.getByRole("heading", { name: "Giggle Band ADL Example" })).toBeVisible();
}

async function selectBandContext(page: Page): Promise<void> {
  const bandSelector = page.locator("select[data-context-select='Band']");
  await bandSelector.waitFor({ state: "attached" });
  const selected = await bandSelector.evaluate((select) => {
    const htmlSelect = select as HTMLSelectElement;
    const option = [...htmlSelect.options].find((candidate) => candidate.label === "The Alphas");
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

async function seedExtraSongs(page: Page, count: number): Promise<void> {
  await page.evaluate(async (extraSongCount) => {
    const app = document.querySelector("adl-app") as
      | (HTMLElement & {
          context: Record<string, unknown>;
          runtime: {
            withSelectedContext: (
              contextName: string,
              contextId: string,
              context: Record<string, unknown>,
            ) => Promise<Record<string, unknown>>;
            create: (
              objectName: string,
              values: Record<string, unknown>,
              context: Record<string, unknown>,
            ) => Promise<unknown>;
          };
        })
      | null;
    const bandSelector = document.querySelector<HTMLSelectElement>(
      "select[data-context-select='Band']",
    );
    const bandId = bandSelector?.value;

    if (app === null || bandId === undefined || bandId.length === 0) {
      throw new Error("Expected an active Giggle Band app and selected Band context.");
    }

    const context = await app.runtime.withSelectedContext("Band", bandId, app.context);

    for (let index = 0; index < extraSongCount; index += 1) {
      await app.runtime.create(
        "Song",
        {
          Band: bandId,
          Title: `Sticky Check ${String(index + 1).padStart(2, "0")}`,
          Composer: "Visual smoke",
          DurationSeconds: 180 + index,
        },
        context,
      );
    }
  }, count);
}

async function clickFirstVisible(page: Page, selector: string): Promise<void> {
  const matches = page.locator(selector);
  const count = await matches.count();

  for (let index = 0; index < count; index += 1) {
    const candidate = matches.nth(index);
    if (await candidate.isVisible()) {
      await candidate.click();
      return;
    }
  }

  throw new Error(`No visible element matched '${selector}'.`);
}

async function boundingBox(
  page: Page,
  selector: string,
): Promise<{
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}> {
  return page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        width: rect.width,
        height: rect.height,
      };
    });
}

async function expectHomeFeedSpacing(page: Page): Promise<void> {
  const schedule = page.locator("[data-presentation-list='UpcomingEvents']");
  await expect(schedule).toBeVisible();

  const text = normaliseWhitespace(await schedule.innerText());
  expect(text).toContain("8:00PM - Canal Street headline");
  expect(text).not.toContain("8:00PMCanal Street headline");

  const separatorWidths = await schedule
    .locator(".adl-fragment-plain")
    .evaluateAll((fragments) =>
      fragments
        .filter((fragment) => fragment.textContent === " - ")
        .map((fragment) => fragment.getBoundingClientRect().width),
    );
  expect(separatorWidths[0], "home feed separator should reserve visible spacing").toBeGreaterThan(
    10,
  );
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

async function expectNoVisibleElementOverflow(page: Page): Promise<void> {
  const overflowing = await page.evaluate(() => {
    const selectors = [
      "button",
      "select",
      ".adl-topbar",
      ".adl-presentation-row",
      ".adl-calendar-agenda-day",
      ".adl-calendar-cell",
      ".adl-list-header",
      ".adl-list-row",
      ".adl-form-field",
    ];
    const viewportWidth = window.innerWidth;

    return selectors
      .flatMap((selector) => [...document.querySelectorAll<HTMLElement>(selector)])
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          rect.left < viewportWidth &&
          rect.right > 0
        );
      })
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const visibleWidthOverflow =
          element.scrollWidth > element.clientWidth + 2 && style.overflowX === "visible";
        const visibleHeightOverflow =
          element.scrollHeight > element.clientHeight + 2 && style.overflowY === "visible";
        return visibleWidthOverflow || visibleHeightOverflow;
      })
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        className: element.className,
        text: element.textContent?.replace(/\s+/g, " ").trim().slice(0, 120),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      }));
  });

  expect(overflowing).toEqual([]);
}

function normaliseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

async function expectAppReady(page: Page): Promise<void> {
  const app = page.locator("adl-app");
  await expect(app).toBeVisible();
  await expect(app).not.toContainText("Loading");
}
