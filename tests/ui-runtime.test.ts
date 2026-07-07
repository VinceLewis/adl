// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";
import { PolicyDeniedError } from "../src/index.js";
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
import type { ResolvedApplicationModel, RuntimeContext } from "../src/index.js";

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

async function mountApp(model?: ResolvedApplicationModel): Promise<AdlAppElement> {
  const app = document.createElement("adl-app") as AdlAppElement;
  if (model !== undefined) {
    app.model = model;
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
