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

    const name = requireElement<HTMLInputElement>(
      app,
      "adl-field-renderer[data-field-name='Name'] input",
    );
    name.value = "Incomplete User";
    requireElement<HTMLButtonElement>(app, "button[data-action-name='save']").click();
    await flushUi();

    expect(app.textContent).toContain("Record for object 'User' is invalid.");
    expect(app.textContent).toContain("Field 'Email' is required on object 'User'.");
  });

  it("filters lifecycle actions by policy and current state", async () => {
    const app = await mountApp();

    expect(app.textContent).toContain("Activate");
    expect(app.textContent).not.toContain("Suspend");

    requireElement<HTMLButtonElement>(app, "button[data-action-name='activate']").click();
    await flushUi();

    expect(app.querySelector("button[data-action-name='activate']")).toBeNull();
    expect(app.querySelector("button[data-action-name='suspend']")).not.toBeNull();
    expect(
      requireElement<HTMLInputElement>(app, "adl-field-renderer[data-field-name='Status'] input")
        .value,
    ).toBe("Active");
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

    selector.value = seeded.firstBand.meta.guid;
    selector.dispatchEvent(new Event("change", { bubbles: true }));
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

    const viewSelector = requireElement<HTMLSelectElement>(app, "select[data-view-switch='true']");
    viewSelector.value = "HomeDashboard";
    viewSelector.dispatchEvent(new Event("change", { bubbles: true }));
    await flushUi();

    expect(app.textContent).toContain("Alpha Hall");
    expect(app.textContent).toContain("Beta Hall");
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

      requireElement<HTMLInputElement>(
        firstApp,
        "adl-field-renderer[data-field-name='Name'] input",
      ).value = "Reload Persisted";
      requireElement<HTMLInputElement>(
        firstApp,
        "adl-field-renderer[data-field-name='Email'] input",
      ).value = "reload@example.com";
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
