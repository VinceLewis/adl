// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";
import { ApplicationRuntime, PolicyDeniedError, resolveApplicationModel } from "../src/index.js";
import {
  BROWSER_DEMO_DATABASE_NAME,
  browserDemoContext,
  createBrowserDemoModel,
  createBrowserDemoRuntime,
  seedBrowserDemoRuntime,
} from "../src/ui/demo-fixture.js";
import { createBandReferenceRuntime, seedBandReferenceRuntime } from "../src/reference/band-app.js";
import { AdlAppElement } from "../src/ui/components/adl-app.js";
import { AdlFormViewElement } from "../src/ui/components/adl-form-view.js";
import { defineAdlComponents } from "../src/ui/components/register.js";
import type {
  PartialApplicationModel,
  ResolvedApplicationModel,
  RuntimeContext,
  StoredObjectRecord,
} from "../src/index.js";
import { bandContextPartialModel } from "./fixtures/band-context-model.js";

const viewerUiContext: RuntimeContext = {
  userId: "viewer-ui",
  roles: ["Viewer"],
  channel: "ui",
  now: new Date("2026-07-07T08:00:00.000Z"),
};

describe("browser UI runtime", () => {
  beforeEach(() => {
    defineAdlComponents();
    document.body.innerHTML = "";
    globalThis.localStorage?.clear();
    globalThis.sessionStorage?.clear();
    globalThis.history.replaceState({}, "", "/");
  });

  it("renders the model-driven User list and supports search", async () => {
    const app = await mountApp();

    expect(app.querySelector("adl-form-view")).toBeNull();
    expect(requireElement<HTMLElement>(app, "[data-edit-container]").dataset.editContainer).toBe(
      "modal",
    );
    expect(app.textContent).toContain("Ada Lovelace");
    expect(app.textContent).toContain("Grace Hopper");
    expect(app.textContent).not.toContain("ada@example.com");
    expect(app.querySelectorAll("td[aria-label='Email masked']").length).toBeGreaterThan(0);

    const search = requireElement<HTMLInputElement>(app, "[data-list-search='true']");
    search.value = "Grace";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await flushUi();

    expect(app.textContent).not.toContain("Ada Lovelace");
    expect(app.textContent).toContain("Grace Hopper");
  });

  it("uses field policy for masked, hidden, and readonly presentation", async () => {
    const app = await mountApp();

    requireElement<HTMLTableRowElement>(app, "tr[data-record-id]").click();
    await flushUi();

    expect(app.querySelector(".adl-edit-container-modal")).not.toBeNull();
    const email = requireElement<HTMLInputElement>(
      app,
      "adl-field-renderer[data-field-name='Email'] input",
    );
    expect(email.value).toBe("••••••");
    expect(email.disabled).toBe(true);

    const role = requireElement<HTMLInputElement>(
      app,
      "adl-field-renderer[data-field-name='SystemRole'] input",
    );
    expect(role.readOnly).toBe(true);

    expect(app.textContent).not.toContain("Secret Note");
    expect(app.textContent).not.toContain("Founder account");
  });

  it("shows field validation messages from runtime save failures", async () => {
    const app = await mountApp();

    requireElement<HTMLButtonElement>(app, "[data-list-action='new']").click();
    await flushUi();

    expect(app.querySelector(".adl-edit-container-modal")).not.toBeNull();

    const name = requireElement<HTMLInputElement>(
      app,
      "adl-field-renderer[data-field-name='Name'] input",
    );
    name.value = "Incomplete User";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    const email = requireElement<HTMLInputElement>(
      app,
      "adl-field-renderer[data-field-name='Email'] input",
    );
    email.value = "not-an-email";
    email.dispatchEvent(new Event("input", { bubbles: true }));
    requireElement<HTMLButtonElement>(app, "button[data-action-name='save']").click();
    await flushUi();

    expect(app.textContent).toContain("Record for object 'User' is invalid.");
    expect(app.textContent).toContain("Field 'Email' must contain an email address.");
  });

  it("filters lifecycle actions by policy and current state", async () => {
    const app = await mountApp();

    requireElement<HTMLTableRowElement>(app, "tr[data-record-id]").click();
    await flushUi();

    expect(app.textContent).toContain("Activate");
    expect(app.textContent).not.toContain("Suspend");

    requireElement<HTMLButtonElement>(app, "button[data-action-name='activate']").click();
    await flushUi();

    expect(app.querySelector("adl-form-view")).toBeNull();

    requireElement<HTMLTableRowElement>(app, "tr[data-record-id]").click();
    await flushUi();

    expect(app.querySelector("button[data-action-name='activate']")).toBeNull();
    expect(app.querySelector("button[data-action-name='suspend']")).not.toBeNull();
    expect(
      requireElement<HTMLInputElement>(app, "adl-field-renderer[data-field-name='Status'] input")
        .value,
    ).toBe("Active");
  });

  it("opens default CRUD forms from explicit actions and returns to the list", async () => {
    const app = await mountApp();

    expect(app.querySelector("adl-form-view")).toBeNull();

    requireElement<HTMLTableRowElement>(app, "tr[data-record-id]").click();
    await flushUi();
    expect(app.querySelector(".adl-edit-container-modal adl-form-view")).not.toBeNull();

    requireElement<HTMLButtonElement>(app, "button[aria-label='Close form']").click();
    await flushUi();
    expect(app.querySelector("adl-form-view")).toBeNull();

    requireElement<HTMLTableRowElement>(app, "tr[data-record-id]").click();
    await flushUi();
    expect(app.querySelector(".adl-edit-container-modal adl-form-view")).not.toBeNull();

    requireElement<HTMLButtonElement>(app, "button[data-action-name='cancel']").click();
    await flushUi();
    expect(app.querySelector("adl-form-view")).toBeNull();

    requireElement<HTMLButtonElement>(app, "[data-list-action='new']").click();
    await flushUi();
    expect(app.textContent).toContain("New User");

    const name = requireElement<HTMLInputElement>(
      app,
      "adl-field-renderer[data-field-name='Name'] input",
    );
    name.value = "List First User";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    const email = requireElement<HTMLInputElement>(
      app,
      "adl-field-renderer[data-field-name='Email'] input",
    );
    email.value = "list-first@example.com";
    email.dispatchEvent(new Event("input", { bubbles: true }));

    requireElement<HTMLButtonElement>(app, "button[data-action-name='save']").click();
    await waitForText(app, "List First User");

    expect(app.textContent).toContain("User created.");
    expect(app.querySelector("adl-form-view")).toBeNull();
  });

  it("preserves explicit split-pane CRUD behavior", async () => {
    const model = createBrowserDemoModel();
    setUserListEditContainer(model, "splitPane");

    const app = await mountApp(model);

    expect(requireElement<HTMLElement>(app, "[data-edit-container]").dataset.editContainer).toBe(
      "splitPane",
    );
    expect(app.querySelector(".adl-workspace-split-pane adl-list-view")).not.toBeNull();
    expect(app.querySelector(".adl-workspace-split-pane adl-form-view")).not.toBeNull();
    expect(app.textContent).toContain("Ada Lovelace");
    expect(app.textContent).toContain("Activate");

    requireElement<HTMLButtonElement>(app, "[data-list-action='new']").click();
    await flushUi();

    expect(app.textContent).toContain("New User");
    expect(app.querySelector(".adl-workspace-split-pane adl-form-view")).not.toBeNull();
  });

  it("renders drawer and page edit containers from resolved view metadata", async () => {
    const drawerModel = createBrowserDemoModel();
    setUserListEditContainer(drawerModel, "drawer");
    const drawerApp = await mountApp(drawerModel);

    requireElement<HTMLTableRowElement>(drawerApp, "tr[data-record-id]").click();
    await flushUi();

    expect(drawerApp.querySelector(".adl-edit-container-drawer adl-form-view")).not.toBeNull();
    expect(
      requireElement<HTMLElement>(drawerApp, "[data-edit-container]").dataset.editContainer,
    ).toBe("drawer");

    document.body.innerHTML = "";

    const pageModel = createBrowserDemoModel();
    setUserListEditContainer(pageModel, "page");
    const pageApp = await mountApp(pageModel);

    requireElement<HTMLTableRowElement>(pageApp, "tr[data-record-id]").click();
    await flushUi();

    expect(pageApp.querySelector(".adl-workspace-page adl-form-view")).not.toBeNull();
    expect(pageApp.querySelector("adl-list-view")).toBeNull();
    requireElement<HTMLButtonElement>(pageApp, "button[aria-label='Back to list']").click();
    await flushUi();
    expect(pageApp.querySelector("adl-list-view")).not.toBeNull();
    expect(pageApp.querySelector("adl-form-view")).toBeNull();
  });

  it("hides lifecycle actions when the shared policy engine denies them", async () => {
    const model = createBrowserDemoModel();
    const runtime = createBrowserDemoRuntime();
    await seedBrowserDemoRuntime(runtime, browserDemoContext);

    const object = model.objects.find((candidate) => candidate.name === "User");
    const view = object?.views.find((candidate) => candidate.name === "UserForm");
    if (object === undefined || view === undefined) {
      throw new Error("Expected User form view in browser demo model.");
    }

    const records = await runtime.search(
      "User",
      { text: "Ada", fields: ["Name"] },
      viewerUiContext,
    );
    const form = document.createElement("adl-form-view") as AdlFormViewElement;
    form.runtime = runtime;
    form.object = object;
    form.view = view;
    form.context = viewerUiContext;
    form.record = records[0];
    form.mode = "edit";
    document.body.append(form);
    await flushUi();

    expect(form.querySelector("button[data-action-name='activate']")).toBeNull();
    expect(form.querySelector("button[data-action-name='save']")).toBeNull();
    expect(form.querySelector("button[data-action-name='cancel']")).not.toBeNull();
  });

  it("shows sync read-only and offline state in the form UI", async () => {
    const cacheModel = createBrowserDemoModel();
    setUserSyncMode(cacheModel, "cacheReadonly");
    const cacheForm = await renderUserForm(cacheModel, browserDemoContext);

    expect(cacheForm.textContent).toContain("Read-only cache");
    expect(cacheForm.querySelector("button[data-action-name='save']")).toBeNull();
    expect(
      requireElement<HTMLInputElement>(
        cacheForm,
        "adl-field-renderer[data-field-name='Name'] input",
      ).readOnly,
    ).toBe(true);

    const onlineRequiredModel = createBrowserDemoModel();
    setUserSyncMode(onlineRequiredModel, "onlineRequired");
    const offlineForm = await renderUserForm(onlineRequiredModel, {
      ...browserDemoContext,
      online: false,
    });

    expect(offlineForm.textContent).toContain("Offline");
    expect(offlineForm.querySelector("button[data-action-name='save']")).toBeNull();
  });

  it("applies the resolved application theme as CSS custom properties", async () => {
    const model = createBrowserDemoModel();
    model.app.theme = "CorporateDark";
    const theme = model.themes.find((candidate) => candidate.name === model.app.theme);
    if (theme === undefined) {
      throw new Error("Expected CorporateDark in browser demo model.");
    }

    const app = await mountApp(model);

    expect(app.dataset.adlTheme).toBe("CorporateDark");
    expect(app.dataset.adlDensity).toBe(theme.tokens.density);
    expect(app.dataset.adlNav).toBe(theme.tokens.nav);
    expect(app.style.getPropertyValue("--adl-color-primary")).toBe(theme.tokens.colorPrimary);
    expect(app.style.getPropertyValue("--adl-color-background")).toBe(theme.tokens.colorBackground);
    expect(app.style.getPropertyValue("--adl-color-border")).toBe(theme.tokens.colorBorder);
    expect(app.style.getPropertyValue("--adl-radius")).toBe("6px");
  });

  it("shows a required-context empty state when no context is available", async () => {
    const seeded = await createSeededBandUiRuntime({ memberships: "none" });
    const app = await mountApp(seeded.model, seeded.runtime, seeded.musicianContext);

    expect(app.textContent).toContain("No Band contexts are available for this view.");
    expect(app.querySelector("[data-context-empty='true']")).not.toBeNull();
    expect(app.querySelector("adl-list-view")).toBeNull();
  });

  it("auto-selects one available context when the model allows it", async () => {
    const seeded = await createSeededBandUiRuntime({ memberships: "one" });
    const app = await mountApp(seeded.model, seeded.runtime, seeded.musicianContext);

    expect(app.textContent).toContain("The Alphas");
    expect(app.textContent).toContain("Alpha Hall");
    expect(app.textContent).not.toContain("Beta Hall");
    expect(app.querySelector("[data-selected-context-id]")).not.toBeNull();
  });

  it("lets the user choose among multiple contexts for scoped views", async () => {
    const seeded = await createSeededBandUiRuntime();
    const app = await mountApp(seeded.model, seeded.runtime, seeded.musicianContext);

    expect(app.textContent).toContain("Choose a Band context to open this view.");
    const selector = requireElement<HTMLSelectElement>(app, "select[data-context-select='Band']");
    expect([...selector.options].map((option) => option.textContent?.trim())).toEqual([
      "Choose Band",
      "The Alphas",
      "The Betas",
    ]);

    requireElement<HTMLButtonElement>(app, "button[data-context-compact='true']").click();
    await flushUi();
    expect(app.querySelector(".adl-context-sheet")).not.toBeNull();
    requireElement<HTMLButtonElement>(
      app,
      `button[data-context-sheet-option='${seeded.firstBand.meta.guid}']`,
    ).click();
    await flushUi();

    expect(app.textContent).toContain("Alpha Hall");
    expect(app.textContent).not.toContain("Beta Hall");

    const resetSelector = requireElement<HTMLSelectElement>(
      app,
      "select[data-context-select='Band']",
    );
    resetSelector.value = "";
    resetSelector.dispatchEvent(new Event("change", { bubbles: true }));
    await flushUi();

    const refreshedFirstSelector = requireElement<HTMLSelectElement>(
      app,
      "select[data-context-select='Band']",
    );
    refreshedFirstSelector.value = seeded.firstBand.meta.guid;
    refreshedFirstSelector.dispatchEvent(new Event("change", { bubbles: true }));
    await flushUi();

    expect(app.textContent).toContain("Alpha Hall");
    expect(app.textContent).not.toContain("Beta Hall");

    const refreshedSelector = requireElement<HTMLSelectElement>(
      app,
      "select[data-context-select='Band']",
    );
    refreshedSelector.value = seeded.secondBand.meta.guid;
    refreshedSelector.dispatchEvent(new Event("change", { bubbles: true }));
    await flushUi();

    expect(app.textContent).not.toContain("Alpha Hall");
    expect(app.textContent).toContain("Beta Hall");
  });

  it("does not leak the selected context into all-context views", async () => {
    const seeded = await createSeededBandUiRuntime();
    const app = await mountApp(seeded.model, seeded.runtime, seeded.musicianContext);

    const selector = requireElement<HTMLSelectElement>(app, "select[data-context-select='Band']");
    selector.value = seeded.firstBand.meta.guid;
    selector.dispatchEvent(new Event("change", { bubbles: true }));
    await flushUi();
    expect(app.textContent).toContain("Alpha Hall");
    expect(app.textContent).not.toContain("Beta Hall");

    navigateWithDrawer(app, "HomeDashboard");
    await flushUi();

    expect(app.querySelector("adl-dashboard-view")).not.toBeNull();
    const dashboardRows = [...app.querySelectorAll("[data-read-model-row]")].map((row) =>
      row.textContent?.replace(/\s+/g, " ").trim(),
    );
    expect(dashboardRows).toEqual([
      expect.stringContaining("Alpha Hall"),
      expect.stringContaining("Beta Hall"),
    ]);
    expect(app.textContent).toContain("Alpha Hall");
    expect(app.textContent).toContain("Beta Hall");
    expect(app.textContent).toContain("The Alphas");
    expect(app.textContent).toContain("The Betas");
  });

  it("renders the Giggle composed home dashboard and filters it with local toggles", async () => {
    const seeded = await createSeededGiggleRuntime();
    const app = await mountApp(seeded.model, seeded.runtime, {
      ...seeded.musicianContext,
      channel: "ui",
    });

    expect(app.querySelector("adl-composed-view")).not.toBeNull();
    expect(app.querySelector("adl-list-view")).toBeNull();
    expect(
      [...app.querySelectorAll("[data-presentation-section]")].map(
        (section) => (section as HTMLElement).dataset.presentationSection,
      ),
    ).toEqual(["Welcome", "Filters", "Schedule", "Invitations"]);
    expect(app.textContent).toContain("Welcome Back!");
    expect(app.textContent).toContain("Schedule");
    expect(app.textContent).toContain("Invitations");
    expect(app.textContent).toContain("Sat 1 Aug");
    expect(app.textContent).toContain("8:00PM");
    expect(app.textContent).toContain("Alpha Hall");
    expect(app.textContent).toContain("The Alphas");
    expect(app.textContent).toContain("Canal Street headline");
    expect(app.textContent).toContain("New set rehearsal");
    expect(app.textContent).toContain("Unavailable - session prep");
    expect(app.textContent).toContain("No pending invitations");
    expect(app.querySelector(".adl-topbar-app")).not.toBeNull();
    expect(app.querySelector(".adl-menu-action")).not.toBeNull();
    expect(app.querySelector(".adl-view-switch")).toBeNull();
    expect(app.querySelector("select[data-context-select='Band']")).not.toBeNull();
    expect(app.querySelector("[data-shell-control-kind='syncStatus']")).not.toBeNull();
    expect(app.querySelector("[data-icon='music']")).not.toBeNull();
    expect(app.querySelector("[data-icon='microphone']")).not.toBeNull();
    expect(app.querySelector("[data-icon='x']")).not.toBeNull();
    expect(app.querySelector("[data-presentation-legend='ScheduleStatus']")).not.toBeNull();
    expect(
      requireElement<HTMLElement>(app, "[data-presentation-legend='ScheduleStatus']").textContent,
    ).toContain("Gig");
    expect(
      requireElement<HTMLElement>(
        app,
        "[data-presentation-row][data-status='event'] .adl-presentation-status",
      ).getAttribute("aria-label"),
    ).toBe("Gig event");
    expect(
      requireElement<HTMLElement>(
        app,
        "[data-presentation-row][data-status='rehearsal'] .adl-presentation-status",
      ).style.getPropertyValue("--adl-status-color"),
    ).toContain("--adl-color-status-rehearsal");

    const menu = requireElement<HTMLButtonElement>(app, "button[data-shell-menu='true']");
    requireElement<HTMLButtonElement>(app, "button[data-shell-menu='true']").click();
    await flushUi();
    expect(requireElement<HTMLElement>(app, ".adl-nav-drawer").classList.contains("active")).toBe(
      true,
    );
    expect(
      [...app.querySelectorAll("[data-nav-group]")].map((group) => group.textContent?.trim()),
    ).toEqual(expect.arrayContaining(["Main", "Library", "Admin"]));
    expect(
      requireElement<HTMLElement>(app, "[data-nav-item='HomeDashboard']").textContent,
    ).toContain("Home");
    expect(
      requireElement<HTMLElement>(app, "[data-nav-item='BandEventList']").textContent,
    ).toContain("Gigs");
    expect(app.querySelector("[data-nav-item='MyAvailabilityList']")).toBeNull();
    expect(app.querySelector("[data-shell-icon='home']")).not.toBeNull();
    expect(
      requireElement<HTMLButtonElement>(app, "button[data-view-nav='BandEventList']"),
    ).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await flushUi();
    expect(requireElement<HTMLElement>(app, ".adl-nav-drawer").classList.contains("active")).toBe(
      false,
    );

    const bandSelector = requireElement<HTMLSelectElement>(
      app,
      "select[data-context-select='Band']",
    );
    bandSelector.value = seeded.firstBand.meta.guid;
    bandSelector.dispatchEvent(new Event("change", { bubbles: true }));
    await flushUi();
    requireElement<HTMLButtonElement>(app, "button[data-shell-menu='true']").click();
    await flushUi();
    expect(
      requireElement<HTMLElement>(app, "[data-nav-item='MyAvailabilityList']").textContent,
    ).toContain("Availability");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await flushUi();
    expect(requireElement<HTMLElement>(app, ".adl-nav-drawer").classList.contains("active")).toBe(
      false,
    );

    menu.click();
    await flushUi();
    requireElement<HTMLButtonElement>(app, "button[data-shell-overlay='true']").click();
    await flushUi();
    expect(requireElement<HTMLElement>(app, ".adl-nav-drawer").classList.contains("active")).toBe(
      false,
    );

    const rehearsalToggle = requireElement<HTMLButtonElement>(
      app,
      "button[data-presentation-toggle='true'][data-state='showRehearsals']",
    );
    expect(rehearsalToggle.getAttribute("aria-checked")).toBe("true");

    rehearsalToggle.click();
    await flushUi();

    expect(
      requireElement<HTMLButtonElement>(
        app,
        "button[data-presentation-toggle='true'][data-state='showRehearsals']",
      ).getAttribute("aria-checked"),
    ).toBe("false");
    expect(app.textContent).toContain("Canal Street headline");
    expect(app.textContent).not.toContain("New set rehearsal");
    expect(app.textContent).toContain("Unavailable - session prep");
  });

  it("uses Giggle app shell chrome on CRUD pages", async () => {
    const seeded = await createSeededGiggleRuntime();
    const app = await mountApp(seeded.model, seeded.runtime, {
      ...seeded.firstBandContext,
      channel: "ui",
    });

    navigateWithDrawer(app, "BandEventList");
    await flushUi();

    expect(app.querySelector("adl-list-view")).not.toBeNull();
    expect(app.querySelector("adl-composed-view")).toBeNull();
    expect(app.querySelector(".adl-topbar-app")).not.toBeNull();
    expect(app.textContent).not.toContain("Model-driven browser runtime");
  });

  it("opens Giggle calendar availability rows as Availability records", async () => {
    const seeded = await createSeededGiggleRuntime();
    const app = await mountApp(seeded.model, seeded.runtime, {
      ...seeded.firstBandContext,
      channel: "ui",
    });

    navigateWithDrawer(app, "BandEventCalendar");
    await waitForText(app, "Mon 3 Aug");

    const unavailableDay = requireElement<HTMLElement>(
      app,
      "[data-calendar-agenda-day='2026-08-03']",
    );
    expect(unavailableDay.textContent).toContain("Unavailable - session prep");

    requireElement<HTMLButtonElement>(
      unavailableDay,
      "button[data-object-name='Availability'][data-record-id]",
    ).click();
    await waitForText(app, "Local first");

    expect(app.querySelector(".adl-edit-container-modal adl-form-view")).not.toBeNull();
    expect(
      requireElement<HTMLInputElement>(app, "adl-field-renderer[data-field-name='Notes'] input")
        .value,
    ).toBe("Unavailable - session prep");
  });

  it("renders composed list empty states from the presentation evaluator", async () => {
    const seeded = await createSeededGiggleRuntime();

    const app = await mountApp(seeded.model, seeded.runtime, {
      ...seeded.musicianContext,
      channel: "ui",
    });

    expect(app.querySelector("[data-presentation-empty='PendingInvitations']")).not.toBeNull();
    expect(app.textContent).toContain("No pending invitations");
  });

  it("dispatches composed command and navigation actions through runtime services", async () => {
    const model = createActionUiModel();
    const runtime = new ApplicationRuntime(model);
    const app = await mountApp(model, runtime, {
      userId: "admin",
      roles: ["Admin"],
      channel: "ui",
      now: new Date("2026-07-07T08:00:00.000Z"),
    });

    const add = requireElement<HTMLButtonElement>(
      app,
      "button[data-presentation-action='true'][data-command='CreateQuickNote']",
    );
    expect(add.disabled).toBe(false);
    add.click();
    await waitForText(app, "Quick note");

    const blocked = requireElement<HTMLButtonElement>(
      app,
      "button[data-presentation-action='true'][data-command='BlockedCommand']",
    );
    expect(blocked.disabled).toBe(true);

    requireElement<HTMLButtonElement>(
      app,
      "button[data-presentation-action='true'][data-view='NoteList']",
    ).click();
    await flushUi();

    expect(app.querySelector("adl-list-view")).not.toBeNull();
    expect(app.querySelector("adl-composed-view")).toBeNull();
  });

  it("renders composed matrix cells and dispatches cell cycling through runtime services", async () => {
    const model = createMatrixUiModel();
    const runtime = new ApplicationRuntime(model);
    const context: RuntimeContext = {
      userId: "admin",
      roles: ["Admin"],
      channel: "ui",
      now: new Date("2026-07-07T08:00:00.000Z"),
    };
    await runtime.create("Member", { User: "user-1", Name: "Avery" }, context);
    await runtime.create(
      "Availability",
      { User: "user-1", Date: "2026-08-01", Status: "Available" },
      context,
    );

    const app = await mountApp(model, runtime, context);
    const cell = requireElement<HTMLButtonElement>(
      app,
      "button[data-presentation-matrix-cell='true'][data-row-key='user-1'][data-column-key='2026-08-01']",
    );

    expect(app.querySelector("[data-presentation-matrix='AvailabilityMatrix']")).not.toBeNull();
    expect(cell.disabled).toBe(false);
    expect(cell.getAttribute("aria-label")).toContain("Available");

    cell.click();
    await waitForText(app, "Unavailable");

    expect((await runtime.search("Availability", {}, context))[0]?.values.Status).toBe(
      "Unavailable",
    );
  });

  it("renders composed calendars and opens date-prefilled create forms", async () => {
    const model = createCalendarUiModel();
    const runtime = new ApplicationRuntime(model);
    const context: RuntimeContext = {
      userId: "admin",
      roles: ["Admin"],
      channel: "ui",
      now: new Date("2026-08-02T09:00:00.000Z"),
    };
    await runtime.create(
      "Event",
      { Date: "2026-08-01", StartTime: "18:00", EventType: "Gig", Title: "First set" },
      context,
    );
    await runtime.create(
      "Event",
      { Date: "2026-08-01", StartTime: "19:00", EventType: "Rehearsal", Title: "Warm up" },
      context,
    );
    await runtime.create(
      "Event",
      { Date: "2026-08-01", StartTime: "20:00", EventType: "Gig", Title: "Headline" },
      context,
    );

    const app = await mountApp(model, runtime, context);

    expect(app.querySelector("[data-presentation-calendar='MonthPlanner']")).not.toBeNull();
    expect(app.textContent).toContain("August 2026");
    expect(app.querySelector("[data-calendar-cell='2026-08-01'] details")).not.toBeNull();
    expect(
      requireElement<HTMLElement>(app, "[data-calendar-cell='2026-08-01']").getAttribute(
        "aria-selected",
      ),
    ).toBe("true");
    expect(
      requireElement<HTMLElement>(app, "[data-calendar-cell='2026-08-01'] .adl-calendar-actions")
        .className,
    ).toContain("adl-calendar-actions-cell");
    const selectedDay = requireElement<HTMLElement>(
      app,
      "[data-calendar-selected-date='2026-08-01']",
    );
    expect(selectedDay.textContent).toContain("Sat 1 Aug");
    expect(selectedDay.textContent).toContain("3 events");
    expect(selectedDay.textContent).toContain("First set");
    expect(
      app.querySelector("[data-calendar-selected-date='2026-08-01'] button[data-record-id]"),
    ).not.toBeNull();
    expect(app.querySelector("[data-calendar-agenda-day='2026-08-01']")).not.toBeNull();
    expect(
      requireElement<HTMLElement>(app, "[data-calendar-agenda-day='2026-08-01'] time").textContent,
    ).toBe("Sat 1 Aug");
    expect(
      requireElement<HTMLElement>(app, "[data-calendar-agenda-day='2026-08-02']").className,
    ).toContain("empty");

    requireElement<HTMLElement>(app, "[data-calendar-cell='2026-08-04']").click();
    await waitForText(app, "Tue 4 Aug");
    expect(
      requireElement<HTMLElement>(app, "[data-calendar-cell='2026-08-04']").getAttribute(
        "aria-selected",
      ),
    ).toBe("true");
    expect(
      requireElement<HTMLElement>(app, "[data-calendar-selected-date='2026-08-04']").textContent,
    ).toContain("No events scheduled.");

    requireElement<HTMLButtonElement>(
      app,
      "[data-calendar-agenda-day='2026-08-01'] button[data-record-id]",
    ).click();
    await waitForText(app, "Local first");
    expect(app.querySelector(".adl-edit-container-modal adl-form-view")).not.toBeNull();
    expect(
      requireElement<HTMLInputElement>(app, "adl-field-renderer[data-field-name='Title'] input")
        .value,
    ).toBe("First set");

    requireElement<HTMLButtonElement>(app, "button[data-action-name='cancel']").click();
    await flushUi();

    requireElement<HTMLButtonElement>(app, "button[aria-label='Next month']").click();
    await waitForText(app, "September 2026");

    requireElement<HTMLButtonElement>(
      app,
      "[data-calendar-cell='2026-09-04'] button[data-create-object='Event']",
    ).click();
    await waitForText(app, "New Event");

    expect(app.querySelector(".adl-edit-container-modal adl-form-view")).not.toBeNull();
    expect(
      requireElement<HTMLInputElement>(app, "adl-field-renderer[data-field-name='Date'] input")
        .value,
    ).toBe("2026-09-04");
  });

  it("renders policy-shaped CRUD row actions from view action metadata", async () => {
    const model = createBrowserDemoModel();
    const userList = model.objects
      .find((object) => object.name === "User")
      ?.views.find((view) => view.name === "UserList");
    if (userList === undefined) {
      throw new Error("Expected UserList view in browser demo model.");
    }
    userList.actions = ["create", "read", "update", "delete"];
    const app = await mountApp(model);

    expect(app.querySelector("button[data-row-action='edit']")).not.toBeNull();
    expect(app.querySelector("button[data-row-action='delete']")).not.toBeNull();

    const firstRecord = requireElement<HTMLButtonElement>(app, "button[data-row-action='edit']");
    firstRecord.click();
    await flushUi();

    expect(app.querySelector(".adl-edit-container-modal adl-form-view")).not.toBeNull();
  });

  it("rejects invalid persisted and route-provided contexts", async () => {
    const persisted = await createSeededBandUiRuntime({
      selection: { persistence: "local" },
    });
    globalThis.localStorage.setItem("adl:BandOps:context:Band", "missing-band");
    const persistedApp = await mountApp(
      persisted.model,
      persisted.runtime,
      persisted.musicianContext,
    );

    expect(persistedApp.textContent).toContain("Band selection was cleared.");
    expect(globalThis.localStorage.getItem("adl:BandOps:context:Band")).toBeNull();
    expect(persistedApp.textContent).toContain("Choose a Band context to open this view.");

    document.body.innerHTML = "";
    globalThis.history.replaceState({}, "", "/?bandId=missing-band");
    const route = await createSeededBandUiRuntime({
      selection: { source: "route", routeParam: "bandId" },
    });
    const routeApp = await mountApp(route.model, route.runtime, route.musicianContext);

    expect(routeApp.textContent).toContain("Band selection was cleared.");
    expect(routeApp.textContent).toContain("Choose a Band context to open this view.");
  });

  it("runtime policy still blocks direct writes to readonly UI fields", async () => {
    const runtime = createBrowserDemoRuntime();
    const user = await runtime.create(
      "User",
      {
        Name: "Direct Bypass",
        Email: "bypass@example.com",
        SystemRole: "Standard",
      },
      browserDemoContext,
    );

    await expect(
      runtime.update("User", user.meta.guid, { SystemRole: "Admin" }, browserDemoContext),
    ).rejects.toBeInstanceOf(PolicyDeniedError);
  });

  it("persists browser demo records across IndexedDB-backed reloads", async () => {
    const restoreIndexedDb = installFakeIndexedDb();
    await deleteIndexedDbDatabase(BROWSER_DEMO_DATABASE_NAME);

    try {
      const firstApp = await mountApp();
      requireElement<HTMLButtonElement>(firstApp, "[data-list-action='new']").click();
      await flushUi();

      const name = requireElement<HTMLInputElement>(
        firstApp,
        "adl-field-renderer[data-field-name='Name'] input",
      );
      name.value = "Reload Persisted";
      name.dispatchEvent(new Event("input", { bubbles: true }));
      const email = requireElement<HTMLInputElement>(
        firstApp,
        "adl-field-renderer[data-field-name='Email'] input",
      );
      email.value = "reload@example.com";
      email.dispatchEvent(new Event("input", { bubbles: true }));
      requireElement<HTMLButtonElement>(firstApp, "button[data-action-name='save']").click();
      await waitForText(firstApp, "Reload Persisted");

      document.body.innerHTML = "";
      const secondApp = await mountApp();
      await waitForText(secondApp, "Reload Persisted");
    } finally {
      document.body.innerHTML = "";
      restoreIndexedDb();
    }
  });
});

async function renderUserForm(
  model: ResolvedApplicationModel,
  context: RuntimeContext,
): Promise<AdlFormViewElement> {
  const runtime = new ApplicationRuntime(model);
  const object = model.objects.find((candidate) => candidate.name === "User");
  const view = object?.views.find((candidate) => candidate.name === "UserForm");
  if (object === undefined || view === undefined) {
    throw new Error("Expected User form view in browser demo model.");
  }

  const form = document.createElement("adl-form-view") as AdlFormViewElement;
  form.runtime = runtime;
  form.object = object;
  form.view = view;
  form.context = context;
  form.mode = "create";
  document.body.append(form);
  await flushUi();
  return form;
}

function setUserSyncMode(
  model: ResolvedApplicationModel,
  mode: "cacheReadonly" | "onlineRequired",
): void {
  const user = model.objects.find((candidate) => candidate.name === "User");
  if (user === undefined) {
    throw new Error("Expected User object in browser demo model.");
  }

  user.sync = { ...user.sync, mode };
  model.sync = model.sync.map((sync) => (sync.object === "User" ? { ...sync, mode } : sync));
}

function setUserListEditContainer(
  model: ResolvedApplicationModel,
  editContainer: "modal" | "drawer" | "page" | "splitPane",
): void {
  const user = model.objects.find((candidate) => candidate.name === "User");
  const listView = user?.views.find((view) => view.name === "UserList");
  if (listView === undefined) {
    throw new Error("Expected UserList view in browser demo model.");
  }

  listView.editContainer = editContainer;
}

interface SeededBandUiRuntime {
  model: ResolvedApplicationModel;
  runtime: ApplicationRuntime;
  musicianContext: RuntimeContext;
  firstBand: StoredObjectRecord;
  secondBand: StoredObjectRecord;
}

interface SeededBandUiRuntimeOptions {
  memberships?: "none" | "one" | "two";
  selection?: {
    persistence?: "none" | "session" | "local";
    source?: "runtime" | "route";
    routeParam?: string;
  };
}

async function createSeededBandUiRuntime(
  options: SeededBandUiRuntimeOptions = {},
): Promise<SeededBandUiRuntime> {
  const model = resolveApplicationModel(createBandUiPartialModel(options.selection));
  const runtime = new ApplicationRuntime(model);
  const systemContext: RuntimeContext = {
    userId: "system-admin",
    roles: ["SystemAdmin"],
    channel: "api",
    now: new Date("2026-07-07T08:00:00.000Z"),
  };

  const musician = await runtime.create(
    "User",
    { Name: "Casey Morgan", Email: "casey@example.com" },
    systemContext,
  );
  const firstBand = await runtime.create("Band", { Name: "The Alphas" }, systemContext);
  const secondBand = await runtime.create("Band", { Name: "The Betas" }, systemContext);

  if ((options.memberships ?? "two") !== "none") {
    await runtime.create(
      "BandMember",
      { User: musician.meta.guid, Band: firstBand.meta.guid, Role: "BandAdmin" },
      bandContext(systemContext, firstBand.meta.guid),
    );
  }

  if ((options.memberships ?? "two") === "two") {
    await runtime.create(
      "BandMember",
      { User: musician.meta.guid, Band: secondBand.meta.guid, Role: "BandMember" },
      bandContext(systemContext, secondBand.meta.guid),
    );
  }

  await runtime.create(
    "Gig",
    { Band: firstBand.meta.guid, Date: "2026-08-01", Venue: "Alpha Hall" },
    bandContext(systemContext, firstBand.meta.guid),
  );
  await runtime.create(
    "Gig",
    { Band: secondBand.meta.guid, Date: "2026-08-02", Venue: "Beta Hall" },
    bandContext(systemContext, secondBand.meta.guid),
  );

  return {
    model,
    runtime,
    musicianContext: {
      userId: musician.meta.guid,
      roles: [],
      channel: "ui",
      now: new Date("2026-07-07T08:00:00.000Z"),
    },
    firstBand,
    secondBand,
  };
}

async function createSeededGiggleRuntime() {
  const runtime = createBandReferenceRuntime();
  return seedBandReferenceRuntime(runtime);
}

function createBandUiPartialModel(
  selection: SeededBandUiRuntimeOptions["selection"] = {},
): PartialApplicationModel {
  return {
    ...bandContextPartialModel,
    app: {
      ...bandContextPartialModel.app,
      startView: "BandGigList",
    },
    contexts: (bandContextPartialModel.contexts ?? []).map((context) =>
      context.name === "Band"
        ? {
            ...context,
            selection: {
              mode: "optional",
              autoSelect: true,
              persistence: selection.persistence ?? "none",
              source: selection.source ?? "runtime",
              ...(selection.routeParam === undefined ? {} : { routeParam: selection.routeParam }),
            },
          }
        : context,
    ),
    roles: [
      { name: "SystemAdmin" },
      { name: "BandMember" },
      { name: "BandAdmin", inherits: ["BandMember"] },
    ],
    policies: [
      {
        name: "UserBandUiPolicy",
        object: "User",
        rules: [
          {
            name: "allowSystemAdminAllUserOps",
            effect: "allow",
            principal: { match: "specific", roles: ["SystemAdmin"] },
            action: "*",
          },
        ],
      },
      {
        name: "BandUiPolicy",
        object: "Band",
        rules: [
          {
            name: "allowSystemAdminAllBandOps",
            effect: "allow",
            principal: { match: "specific", roles: ["SystemAdmin"] },
            action: "*",
          },
          {
            name: "allowBandMemberReadBand",
            effect: "allow",
            principal: { match: "specific", roles: ["BandMember"] },
            action: "read",
          },
        ],
      },
      {
        name: "BandMemberUiPolicy",
        object: "BandMember",
        rules: [
          {
            name: "allowSystemAdminAllBandMemberOps",
            effect: "allow",
            principal: { match: "specific", roles: ["SystemAdmin"] },
            action: "*",
          },
        ],
      },
      {
        name: "GigUiPolicy",
        object: "Gig",
        rules: [
          {
            name: "allowSystemAdminAllGigOps",
            effect: "allow",
            principal: { match: "specific", roles: ["SystemAdmin"] },
            action: "*",
          },
          {
            name: "allowBandMemberReadGig",
            effect: "allow",
            principal: { match: "specific", roles: ["BandMember"] },
            action: "read",
          },
          {
            name: "allowBandMemberSearchGig",
            effect: "allow",
            principal: { match: "specific", roles: ["BandMember"] },
            action: "search",
          },
          {
            name: "allowBandAdminCreateGig",
            effect: "allow",
            principal: { match: "specific", roles: ["BandAdmin"] },
            action: "create",
          },
          {
            name: "allowBandAdminUpdateGig",
            effect: "allow",
            principal: { match: "specific", roles: ["BandAdmin"] },
            action: "update",
          },
          {
            name: "allowBandAdminDeleteGig",
            effect: "allow",
            principal: { match: "specific", roles: ["BandAdmin"] },
            action: "delete",
          },
        ],
      },
    ],
  };
}

function createActionUiModel(): ResolvedApplicationModel {
  return resolveApplicationModel({
    app: { name: "ActionUi", startView: "Home" },
    roles: [{ name: "Admin" }],
    objects: [
      {
        name: "Note",
        fields: [
          { name: "Title", type: "text", required: true },
          { name: "Pinned", type: "boolean", defaultValue: false },
        ],
        views: [
          {
            name: "Home",
            kind: "composite",
            fields: ["Title", "Pinned"],
            presentation: {
              sections: [
                {
                  name: "Main",
                  heading: "Notes",
                  controls: [
                    {
                      name: "quickAdd",
                      kind: "action",
                      label: "Add Note",
                      placement: "primary",
                      command: "CreateQuickNote",
                    },
                    {
                      name: "blockedAdd",
                      kind: "action",
                      label: "Blocked",
                      command: "BlockedCommand",
                    },
                    {
                      name: "openList",
                      kind: "action",
                      label: "Open List",
                      view: "NoteList",
                    },
                  ],
                  lists: [
                    {
                      name: "Notes",
                      sourceKind: "object",
                      source: "Note",
                      fields: ["Title", "Pinned"],
                      emptyState: { text: "No notes yet" },
                      row: { fragments: [{ kind: "field", field: "Title" }] },
                    },
                  ],
                },
              ],
            },
          },
          {
            name: "NoteList",
            kind: "list",
            fields: ["Title", "Pinned"],
            actions: ["create", "read", "update", "delete"],
          },
        ],
      },
    ],
    commands: [
      {
        name: "CreateQuickNote",
        label: "Add Note",
        steps: [
          {
            name: "createNote",
            action: "create",
            object: "Note",
            authority: "command",
            values: {
              Title: { kind: "literal", value: "Quick note" },
              Pinned: { kind: "literal", value: false },
            },
          },
        ],
      },
      {
        name: "BlockedCommand",
        preconditions: [
          {
            name: "blocked",
            expression: { kind: "literal", value: false },
            message: "Blocked for this user.",
          },
        ],
        steps: [],
      },
    ],
    policies: [
      {
        name: "NotePolicy",
        object: "Note",
        rules: [
          {
            name: "allowAdminAllNoteActions",
            effect: "allow",
            principal: { match: "specific", roles: ["Admin"] },
            action: "*",
          },
        ],
      },
    ],
  });
}

function createMatrixUiModel(): ResolvedApplicationModel {
  return resolveApplicationModel({
    app: { name: "MatrixUi", startView: "AvailabilityPlanner" },
    roles: [{ name: "Admin" }],
    objects: [
      {
        name: "Member",
        fields: [
          { name: "User", type: "text", required: true },
          { name: "Name", type: "text", required: true },
        ],
        views: [
          {
            name: "AvailabilityPlanner",
            kind: "composite",
            fields: ["User", "Name"],
            presentation: {
              statuses: [
                { name: "available", label: "Available", precedence: 10 },
                { name: "unavailable", label: "Unavailable", precedence: 20 },
              ],
              statusMaps: [
                {
                  name: "AvailabilityStatus",
                  field: "Status",
                  values: [
                    { value: "Available", status: "available" },
                    { value: "Unavailable", status: "unavailable" },
                  ],
                },
              ],
              sections: [
                {
                  name: "Availability",
                  matrices: [
                    {
                      name: "AvailabilityMatrix",
                      rowSource: {
                        sourceKind: "object",
                        source: "Member",
                        keyField: "User",
                        labelField: "Name",
                        fields: ["User", "Name"],
                      },
                      columnAxis: { start: "2026-08-01", end: "2026-08-01" },
                      cellSource: {
                        sourceKind: "object",
                        source: "Availability",
                        rowField: "User",
                        columnField: "Date",
                        fields: ["User", "Date", "Status"],
                      },
                      cell: {
                        status: { candidates: [{ kind: "map", map: "AvailabilityStatus" }] },
                      },
                      edit: {
                        object: "Availability",
                        rowField: "User",
                        columnField: "Date",
                        valueField: "Status",
                        cycle: ["Available", "Unavailable"],
                      },
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
      {
        name: "Availability",
        fields: [
          { name: "User", type: "text", required: true },
          { name: "Date", type: "date", required: true },
          { name: "Status", type: "text", required: true },
        ],
      },
    ],
    policies: [
      {
        name: "MemberPolicy",
        object: "Member",
        rules: [
          {
            name: "allowAdminAllMembers",
            effect: "allow",
            principal: { match: "specific", roles: ["Admin"] },
            action: "*",
          },
        ],
      },
      {
        name: "AvailabilityPolicy",
        object: "Availability",
        rules: [
          {
            name: "allowAdminAllAvailability",
            effect: "allow",
            principal: { match: "specific", roles: ["Admin"] },
            action: "*",
          },
        ],
      },
    ],
  });
}

function createCalendarUiModel(): ResolvedApplicationModel {
  return resolveApplicationModel({
    app: { name: "CalendarUi", startView: "Calendar" },
    roles: [{ name: "Admin" }],
    objects: [
      {
        name: "Event",
        fields: [
          { name: "Date", type: "date", required: true },
          { name: "StartTime", type: "time" },
          { name: "EventType", type: "text", required: true },
          { name: "Title", type: "text", required: true },
        ],
        views: [
          {
            name: "Calendar",
            kind: "composite",
            fields: ["Date", "StartTime", "EventType", "Title"],
            presentation: {
              state: [{ name: "visibleMonth", type: "date", defaultValue: "2026-08-01" }],
              iconMaps: [
                {
                  name: "EventIcon",
                  field: "EventType",
                  values: [
                    { value: "Gig", icon: "music" },
                    { value: "Rehearsal", icon: "microphone" },
                  ],
                  defaultIcon: "calendar",
                },
              ],
              statuses: [
                {
                  name: "event",
                  label: "Gig",
                  icon: { kind: "map", map: "EventIcon", value: "Gig" },
                },
                {
                  name: "rehearsal",
                  label: "Rehearsal",
                  icon: { kind: "map", map: "EventIcon", value: "Rehearsal" },
                },
              ],
              statusMaps: [
                {
                  name: "EventTypeStatus",
                  field: "EventType",
                  values: [
                    { value: "Gig", status: "event" },
                    { value: "Rehearsal", status: "rehearsal" },
                  ],
                },
              ],
              sections: [
                {
                  name: "Calendar",
                  calendars: [
                    {
                      name: "MonthPlanner",
                      sourceKind: "object",
                      source: "Event",
                      dateField: "Date",
                      titleField: "Title",
                      summaryFields: ["StartTime"],
                      sort: [
                        { field: "Date", direction: "asc" },
                        { field: "StartTime", direction: "asc" },
                      ],
                      month: { state: "visibleMonth", weekStart: "monday" },
                      status: { candidates: [{ kind: "map", map: "EventTypeStatus" }] },
                      actions: [
                        {
                          name: "addEventOnDate",
                          kind: "action",
                          label: "Add Event",
                          create: { object: "Event" },
                          input: { Date: { kind: "field", field: "Date" } },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          },
          {
            name: "EventList",
            kind: "list",
            fields: ["Date", "StartTime", "EventType", "Title"],
            actions: ["create", "read", "update", "delete"],
          },
          {
            name: "EventForm",
            kind: "form",
            fields: ["Date", "StartTime", "EventType", "Title"],
            actions: ["save"],
          },
        ],
      },
    ],
    policies: [
      {
        name: "EventPolicy",
        object: "Event",
        rules: [
          {
            name: "allowAdminAllEventActions",
            effect: "allow",
            principal: { match: "specific", roles: ["Admin"] },
            action: "*",
          },
        ],
      },
    ],
  });
}

function bandContext(context: RuntimeContext, bandId: string): RuntimeContext {
  return {
    ...context,
    selectedContexts: {
      ...(context.selectedContexts ?? {}),
      Band: bandId,
    },
  };
}

async function mountApp(
  model?: ResolvedApplicationModel,
  runtime?: ApplicationRuntime,
  context?: RuntimeContext,
): Promise<AdlAppElement> {
  const app = document.createElement("adl-app") as AdlAppElement;
  if (model !== undefined) {
    app.model = model;
  }
  if (runtime !== undefined) {
    app.runtime = runtime;
  }
  if (context !== undefined) {
    app.context = context;
  }
  document.body.append(app);
  await app.whenReady();
  await flushUi();
  return app;
}

async function flushUi(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForText(root: ParentNode, text: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await flushUi();
    if (root.textContent?.includes(text) === true) {
      return;
    }
  }

  expect(root.textContent).toContain(text);
}

function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing element for selector: ${selector}`);
  }

  return element;
}

function navigateWithDrawer(root: ParentNode, viewName: string): void {
  requireElement<HTMLButtonElement>(root, "button[data-shell-menu='true']").click();
  requireElement<HTMLButtonElement>(root, `button[data-view-nav='${viewName}']`).click();
}

function installFakeIndexedDb(): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: fakeIndexedDB,
  });

  return () => {
    if (descriptor === undefined) {
      Reflect.deleteProperty(globalThis, "indexedDB");
      return;
    }

    Object.defineProperty(globalThis, "indexedDB", descriptor);
  };
}

function deleteIndexedDbDatabase(databaseName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.deleteDatabase(databaseName);
    request.onsuccess = () => {
      resolve();
    };
    request.onerror = () => {
      reject(request.error);
    };
    request.onblocked = () => {
      reject(new Error(`Deleting IndexedDB database '${databaseName}' was blocked.`));
    };
  });
}
