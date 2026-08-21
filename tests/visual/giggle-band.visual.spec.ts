import { expect, test } from "./support/evidence.js";
import { type Page } from "@playwright/test";
import { expectAbsentWithin } from "./support/expect-absence.js";
import {
  readAllPersistedRecords,
  downgradePersistedApplicationMetadata,
  readMountedModelVersion,
  readMountedPreviousModelVersion,
  readPersistedApplicationMetadata,
  seedStalePersistedInstallation,
} from "./support/persisted-upgrade.js";

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
  {
    // Renamed from `who-is-free` in Phase 92: the section heading is now
    // `Availability` (the list is an unfiltered whole-band roster, so the old
    // heading overclaimed), and the nav item is `Band Availability` so it does
    // not collide with `MyAvailabilityList`'s own `Availability` entry.
    name: "band-availability",
    navItem: "BandMemberAvailabilityBoard",
    expectedText: "Availability",
  },
  { name: "songs", navItem: "SongLibrary", expectedText: "Neon Map" },
  { name: "set-lists", navItem: "SetListList", expectedText: "August headline" },
  { name: "bands", navItem: "BandDirectory", expectedText: "The Alphas" },
  {
    name: "sent-invitations",
    navItem: "MyInvitationList",
    expectedText: "riley@example.com",
  },
  {
    // Phase 105's invitee surface. `CONTEXT ALL Band`, so unlike every other
    // entry here it renders without a selected band -- which is the point of
    // it: the person it exists for has joined nothing.
    name: "my-invitations",
    navItem: "MyBandInvitationList",
    expectedText: "Your invitations",
  },
];

test.describe("Giggle Band visual smoke", () => {
  test("opens and migrates a persisted pre-explicit-navigation installation", async ({
    page,
  }, testInfo) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    // Establish this test context's app origin without mounting Giggle, then
    // reproduce the real pre-Phase-80 metadata in Giggle's actual database.
    await page.goto("/?demo=unregistered");
    await seedStalePersistedInstallation(page, {
      dbName: "adl-giggle-band-example",
      staleMetadata: {
        modelVersion: "1.0.0",
        modelFingerprint: `sha256-${"0".repeat(64)}`,
      },
    });

    await openGiggleApp(page);
    await expect(page.getByText("Welcome Back!", { exact: true })).toBeVisible();
    await expectAppReady(page);
    expect(pageErrors).not.toEqual(
      expect.arrayContaining([expect.stringContaining("Persisted runtime data is incompatible")]),
    );

    const metadata = await readPersistedApplicationMetadata(page, "adl-giggle-band-example");
    // Asserted against the model's own current version, not a hard-coded
    // string: Giggle Band's `modelVersion` has already advanced past the
    // `1.1.0` this test was first written against (later, independent
    // content changes -- see `src/reference/giggle-band/domain.adlj`'s
    // declared migrations), and `planModelMigration` chains through every
    // declared hop in one migration, so the seeded `1.0.0` install still
    // lands correctly on whatever version the app currently declares.
    expect(metadata?.modelVersion).toBe(await readMountedModelVersion(page));

    // Giggle Band gets its own browser-tab icon (Phase 86), not the generic
    // ADL mark every other reference app falls back to.
    await expect(page.locator("link#adl-app-favicon")).toHaveAttribute(
      "href",
      "/giggle-band-icon.svg",
    );

    await page.screenshot({
      path: testInfo.outputPath(`giggle-${testInfo.project.name}-persisted-upgrade.png`),
      fullPage: true,
    });
  });

  /**
   * Phase 101. `UserPolicy` grants a signed-in caller `FIELDS Name` and nothing
   * else — a rule that cannot match a whole-record read at all. Every path that
   * turns a stored `user-...` id into a name degrades silently on refusal, so
   * the only honest proof that the narrowing kept the app readable is the real
   * browser rendering a real name on both a read-model-backed surface (the
   * availability board) and an object-backed one (the member list).
   */
  test("shows band members by name on the availability board, never by raw user id", async ({
    page,
  }) => {
    await openGiggleApp(page);
    await selectBandContext(page);
    await navigateTo(page, {
      name: "band-availability",
      navItem: "BandMemberAvailabilityBoard",
      expectedText: "Availability",
    });

    const workspace = page.locator(".adl-workspace, .adl-composed-workspace, .adl-dashboard");
    await expect(workspace).toContainText("Casey Morgan");
    await expect(workspace).not.toContainText("user-");
    await expect(workspace).not.toContainText("@example.com");
  });

  for (const pageSpec of gigglePages) {
    test(`captures ${pageSpec.name} on every configured viewport`, async ({ page }, testInfo) => {
      await openGiggleApp(page);
      await selectBandContext(page);
      await navigateTo(page, pageSpec);

      await expect(
        page.locator(".adl-workspace, .adl-composed-workspace, .adl-dashboard"),
      ).toContainText(pageSpec.expectedText);
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

  /*
   * The surface this phase exists for: a set list editing its own items in
   * place, declared entirely in ADL. It is `EDIT_CONTAINER page`, so there is no
   * `.adl-edit-container` to look for — the form is the workspace.
   */
  test("captures the ADL-declared set-list edit surface on every configured viewport", async ({
    page,
  }, testInfo) => {
    await openGiggleApp(page);
    await selectBandContext(page);
    await navigateTo(page, {
      name: "set-lists",
      navItem: "SetListList",
      expectedText: "August headline",
    });

    // Named rather than positional: the two viewports do not agree on which row
    // is first, and this test is about one particular set list's contents.
    await page.locator("tr[data-record-id]").filter({ hasText: "August headline" }).click();
    await expect(page.locator("adl-form-view")).toBeVisible();

    // Scoped to the section element: `data-child-section` is also on every
    // control inside it, so the bare attribute selector is not unique.
    const songs = page.locator("section.adl-child-section[data-child-section='Songs']");
    await expect(songs).toBeVisible();
    // The declared heading, the child rows, and the reorder affordance the
    // section's `reorder` operation and `ORDER_FIELD` earn it.
    await expect(songs).toContainText("Songs");
    await expect(songs.locator("[data-child-row]")).not.toHaveCount(0);
    await expect(songs.locator("button[data-child-reorder]").first()).toBeVisible();
    // A lookup column shows the song's title, not its record id. The child-row
    // renderer resolves lookups asynchronously, so this also waits for it.
    await expect(songs).toContainText("Neon Map");
    // A set-list item is not a bare link to a song. The seeded arrangement and
    // rehearsal date are on screen beside it, which is what makes the collection
    // worth editing in place at all.
    await expect(songs).toContainText("Acoustic");
    await expect(songs).toContainText("Closes the night as the encore.");
    // Phase 87: each song's own `DurationSeconds` (Song, not SetListItem)
    // projected through the `Song` lookup, summed at the section's footer.
    // Neon Map (214s) + Late Signal (188s) + Harbour Lights (236s) = 638s.
    const summary = songs.locator("[data-child-collection-summary='Songs']");
    await expect(summary).toContainText("Total");
    await expect(summary).toContainText("10:38");
    // One control adds songs, and it opens a chooser rather than asking anyone to
    // type a record id. Its presence is also the visible proof that a
    // context-scoped child's create is permitted: the control renders only when
    // policy allows `createChild`, which needed the selected band scope to reach
    // the policy engine at all.
    const add = songs.locator("button[data-picker-open='Songs']");
    await expect(add).toBeVisible();
    await expect(add).toHaveText("Add");
    // The raw draft row is gone with it: choosing is how a song is added.
    await expect(page.locator("[data-child-draft='Songs']")).toHaveCount(0);

    await add.click();
    const picker = page.locator(".adl-relationship-picker");
    await expect(picker).toBeVisible();
    // Songs, not set-list items — and not the three already in this set list.
    await expect(picker).toContainText("Slow Tide");
    await expect(picker).not.toContainText("Neon Map");
    await expectNoDocumentHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`giggle-${testInfo.project.name}-set-list-song-picker.png`),
      fullPage: true,
    });
    // The whole point, end to end in a real browser: tick a song, add it, save,
    // and it is in the set list at the end — with no record id typed anywhere.
    await picker.locator("input[data-picker-candidate]").first().check();
    await picker.locator("button[data-picker-action='add']").click();
    await expect(page.locator(".adl-relationship-picker")).toHaveCount(0);
    await expect(songs).toContainText("Slow Tide");
    // Live, before Save: Slow Tide (245s) added to the previous 638s total.
    await expect(summary).toContainText("14:43");

    // Removing the just-staged row (not yet saved) takes it back out of the
    // total immediately too — the same live recomputation, the other
    // direction. `Remove` on a staged row un-stages it outright, matching
    // `RuntimeEditChildAction`'s `removeStagedAction` on a `source: "staged"`
    // row (as opposed to a persisted row's `remove`, which stages a delete
    // applied at Save and is not what this collection stages away
    // immediately -- see this file's own comments on `staged` rows above).
    const stagedRow = songs.locator("[data-child-row]").last();
    await expect(stagedRow).toContainText("Slow Tide");
    await stagedRow.locator("button[data-child-action='remove']").click();
    await expect(songs).not.toContainText("Slow Tide");
    await expect(summary).toContainText("10:38");

    // Re-add it so the rest of this test (Save, the saved row count, the
    // inline edit below) exercises the same flow it always has.
    await add.click();
    await expect(picker).toBeVisible();
    await picker.locator("input[data-picker-candidate]").first().check();
    await picker.locator("button[data-picker-action='add']").click();
    await expect(page.locator(".adl-relationship-picker")).toHaveCount(0);
    await expect(songs).toContainText("Slow Tide");
    await expect(summary).toContainText("14:43");

    await page.locator("button[data-action-name='save']").click();
    await expect(page.locator(".adl-message-area")).toContainText("SetList saved.");

    await page.locator("tr[data-record-id]").filter({ hasText: "August headline" }).click();
    const savedRows = page.locator(
      "section.adl-child-section[data-child-section='Songs'] [data-child-row]",
    );
    await expect(savedRows).toHaveCount(4);
    await expect(savedRows.nth(3)).toContainText("Slow Tide");
    await expect(savedRows.nth(3)).toHaveAttribute("data-child-row-position", "4");
    // The total survives the reload from storage, not just the in-session
    // staged computation above: 638s + Slow Tide's 245s = 883s = 14:43.
    await expect(
      page.locator(
        "section.adl-child-section[data-child-section='Songs'] [data-child-collection-summary='Songs']",
      ),
    ).toContainText("14:43");

    // Editing a row in place. `Edit` opens the row with the platform's real field
    // controls — the `Song` lookup is a chooser, not a box to type an id into —
    // and Save stages only what changed, committing inside the same batch.
    await savedRows.nth(3).locator("button[data-child-action='updateChild']").click();
    const editor = page.locator(".adl-child-row.adl-child-editor");
    await expect(editor).toBeVisible();
    const songChooser = editor.locator("adl-field-renderer[data-child-field-slot='Song'] select");
    await expect(songChooser).toBeVisible();
    /*
     * Every kind of child field the platform renders, in one row: the `IN`
     * validator is a select, the boolean a checkbox, the date a date control.
     * This is the capture the phase turns on — a child collection whose children
     * have fields of their own, rendered by the same path as a parent form's,
     * on desktop and on mobile.
     */
    const arrangement = editor.locator(
      "adl-field-renderer[data-child-field-slot='Arrangement'] select",
    );
    await expect(arrangement).toBeVisible();
    await expect(arrangement.locator("option")).toContainText([
      "Choose Arrangement",
      "Full",
      "Acoustic",
      "Instrumental",
    ]);
    await arrangement.selectOption("Acoustic");
    const encore = editor.locator(
      "adl-field-renderer[data-child-field-slot='Encore'] input[type='checkbox']",
    );
    await expect(encore).toBeVisible();
    await encore.check();
    const rehearsedOn = editor.locator(
      "adl-field-renderer[data-child-field-slot='RehearsedOn'] input",
    );
    await expect(rehearsedOn).toHaveAttribute("type", "date");
    await rehearsedOn.fill("2026-07-22");
    const notes = editor.locator("adl-field-renderer[data-child-field-slot='Notes'] input");
    await notes.fill("Encore candidate");
    await expectNoDocumentHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`giggle-${testInfo.project.name}-set-list-row-edit.png`),
      fullPage: true,
    });

    await editor.locator("button[data-child-edit='save']").click();
    await expect(page.locator(".adl-child-row.adl-child-editor")).toHaveCount(0);
    await page.locator("button[data-action-name='save']").click();
    await expect(page.locator(".adl-message-area")).toContainText("SetList saved.");

    await page.locator("tr[data-record-id]").filter({ hasText: "August headline" }).click();
    const editedRow = page
      .locator("section.adl-child-section[data-child-section='Songs'] [data-child-row]")
      .nth(3);
    await expect(editedRow).toContainText("Encore candidate");
    // The enum and the date the inline editor carried are committed and on
    // screen; the row is no longer the bare song-plus-position it was minted as.
    await expect(editedRow).toContainText("Acoustic");
    await expect(editedRow).toContainText("2026-07-22");
    // The boolean reads the way the child object's own list reads it.
    await expect(editedRow).toContainText("Yes");

    await expectAppReady(page);
    await expectNoDocumentHorizontalOverflow(page);
    await expectNoVisibleElementOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`giggle-${testInfo.project.name}-set-list-edit.png`),
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
 * closed again, so the region itself was never captured. `ui.adlj` now declares a
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
  // Declared in `ui.adlj` with `PLACEMENT navDrawer`, so it belongs here and
  // nowhere else.
  //
  // Anchored deliberately. `expect(page.locator(".adl-topbar-tools")).not
  // .toContainText("Sign out")` — what this line used to be — is satisfied when
  // `.adl-topbar-tools` does not exist at all, so it would have survived the
  // whole top bar disappearing. `expectAbsentWithin` requires the anchor.
  await expectAbsentWithin({
    within: page.locator(".adl-topbar"),
    present: page.locator(".adl-topbar-tools"),
    absent: page.locator(".adl-topbar-tools").getByText("Sign out"),
    because: "sign-out is declared PLACEMENT navDrawer, so it must not appear in the top bar",
  });
  // ...and it *is* in the drawer, which is the other half of the same claim.
  await expect(drawer.locator("[data-shell-drawer-tools]")).toContainText("Sign out");
  await expect(drawer.locator("[data-nav-item='BandMemberAvailabilityBoard']")).toBeVisible();

  // Icons are optional shell metadata. Exercise the generic no-icon branch
  // explicitly: a previous two-column grid still reserved the icon column,
  // squeezing labels into 22px and overlapping their object-name subtitles.
  await drawer.locator(".adl-nav-icon").evaluateAll((icons) => {
    for (const icon of icons) {
      icon.remove();
    }
  });
  await drawer.locator(".adl-nav-item").evaluateAll((items) => {
    for (const item of items) {
      item.classList.remove("has-icon");
    }
  });
  const iconlessItem = drawer.locator("[data-nav-item='BandMemberAvailabilityBoard']");
  const iconlessLayout = await iconlessItem.evaluate((item) => {
    const title = item.querySelector(":scope > span");
    const subtitle = item.querySelector("small");
    if (title === null || subtitle === null) {
      throw new Error("Expected a navigation title and subtitle.");
    }

    const titleBox = title.getBoundingClientRect();
    const subtitleBox = subtitle.getBoundingClientRect();
    return {
      titleWidth: titleBox.width,
      titleBottom: titleBox.bottom,
      subtitleTop: subtitleBox.top,
    };
  });
  expect(iconlessLayout.titleWidth).toBeGreaterThan(22);
  expect(iconlessLayout.subtitleTop).toBeGreaterThanOrEqual(iconlessLayout.titleBottom);

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

/**
 * Phase 105's `1.12.0 -> 1.13.0` hop, against a real browser and the real app
 * URL, per `AGENTS.md`'s persisted-state upgrade rule.
 *
 * The seeded version and the expected version are both **read from the mounted
 * model** rather than written down: the hop is `previous -> current`, and both
 * ends move the next time this app's content changes for an unrelated reason.
 * The hop is an empty-object migration, so the whole real dataset the app
 * seeded for itself has to survive byte-identical -- asserted on every record,
 * not on one hand-picked row.
 */
test("opens and migrates an installation persisted one declared version back", async ({
  page,
}, testInfo) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await openGiggleApp(page);
  await expectAppReady(page);
  const currentVersion = await readMountedModelVersion(page);
  const previousVersion = await readMountedPreviousModelVersion(page);
  expect(previousVersion).not.toBe(currentVersion);

  const recordsBefore = await readAllPersistedRecords(page, "adl-giggle-band-example");
  expect(recordsBefore.length).toBeGreaterThan(0);

  await downgradePersistedApplicationMetadata(page, "adl-giggle-band-example", {
    modelVersion: previousVersion,
    modelFingerprint: `sha256-${"0".repeat(64)}`,
  });

  await page.reload();
  await expectAppReady(page);
  // The real start view, not a blank page and not a startup error: the
  // fail-closed guard firing here would be the bug, not the fix.
  await expect(page.getByText("Welcome Back!", { exact: true })).toBeVisible();
  expect(pageErrors).not.toEqual(
    expect.arrayContaining([expect.stringContaining("Persisted runtime data is incompatible")]),
  );

  const metadata = await readPersistedApplicationMetadata(page, "adl-giggle-band-example");
  expect(metadata?.modelVersion).toBe(currentVersion);
  expect(await readAllPersistedRecords(page, "adl-giggle-band-example")).toEqual(recordsBefore);

  await page.screenshot({
    path: testInfo.outputPath(`giggle-${testInfo.project.name}-previous-version-upgrade.png`),
    fullPage: true,
  });
});

/**
 * The invitee screen, in a real browser, for a caller who is nobody's invitee.
 *
 * The demo signs in as Casey, who is a member of both seeded bands and the
 * `Invitee` of no outstanding invitation -- so the honest thing for this screen
 * to show them is its declared empty state and no action at all. That is the
 * real-browser half of the negative the unit suite pins as
 * `expectAcceptAbsentOnSomeoneElsesInvitation`: a row action gated on
 * `WHEN Invitee == RUNTIME.userId` must not render for anybody else.
 *
 * The heading is the present anchor. Without it, "no Accept button" would pass
 * on a screen that failed to render.
 */
test("offers no Accept on the invitations screen to a caller who is nobody's invitee", async ({
  page,
}) => {
  await openGiggleApp(page);
  await navigateTo(page, {
    name: "my-invitations",
    navItem: "MyBandInvitationList",
    expectedText: "Your invitations",
  });

  const workspace = page.locator(".adl-workspace, .adl-composed-workspace, .adl-dashboard");
  await expect(workspace).toContainText("Your invitations");
  // The list's own declared empty state, so the screen is genuinely working
  // rather than silently degraded into a diagnostic.
  await expect(workspace).toContainText("No invitations");
  await expect(page.locator("button[data-presentation-action='true']")).toHaveCount(0);
  await expect(workspace).not.toContainText("Policy denied");
  await expect(workspace).not.toContainText("could not bind source");
});
