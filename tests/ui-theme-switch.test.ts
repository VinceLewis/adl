// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ApplicationRuntime,
  InMemoryObjectStorageBackend,
  resolveApplicationModel,
} from "../src/index.js";
import { AdlAppElement } from "../src/ui/components/adl-app.js";
import { defineAdlComponents } from "../src/ui/components/register.js";
import type { PartialApplicationModel, RuntimeContext } from "../src/index.js";

/**
 * Phase 67's `themeSwitch` shell control: a dropdown over every theme in
 * `model.themes` (not a binary toggle, because a declared theme set is not
 * necessarily two-valued — the three built-in themes alone give this fixture
 * three options with no custom `THEME` block at all), backed by a device-local
 * override persisted in `localStorage` and read back across a fresh `model`
 * assignment the way a reload would produce.
 *
 * Exercised the same way `ui-pwa-install.test.ts` exercises `pwaInstall`: real
 * DOM events and rendered markup against a mounted `AdlAppElement` in
 * happy-dom. No separate pure-logic module is needed — the persistence
 * helpers already live on `adl-app.ts` next to the context-selection
 * persistence they were modelled on, and the state that matters
 * (`activeThemeName`, the rendered `<select>`, the applied theme dataset)
 * belongs together in the same component `pwaInstall`'s tests already cover
 * this way.
 */

const partialModel: PartialApplicationModel = {
  app: { name: "ThemeSwitchFixture", startView: "GigList", theme: "CorporateLight" },
  roles: [{ name: "Admin" }],
  shell: {
    controls: [{ name: "themeSwitch", kind: "themeSwitch", label: "Theme", placement: "topBar" }],
    topBar: { controls: ["themeSwitch"] },
  },
  objects: [
    {
      name: "Gig",
      businessKey: "Title",
      displayField: "Title",
      fields: [{ name: "Title", type: "text", required: true }],
      views: [{ name: "GigList", kind: "list", fields: ["Title"] }],
    },
  ],
  policies: [
    {
      name: "GigPolicy",
      object: "Gig",
      rules: [
        {
          name: "adminAll",
          effect: "allow",
          principal: { match: "specific", roles: ["Admin"] },
          action: "*",
        },
      ],
    },
  ],
};

const model = resolveApplicationModel(partialModel);
const adminContext: RuntimeContext = { userId: "user-42", roles: ["Admin"], channel: "ui" };

function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Expected to find '${selector}'.`);
  }
  return element;
}

async function flushUi(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function mountApp(): Promise<AdlAppElement> {
  const app = document.createElement("adl-app") as AdlAppElement;
  app.model = model;
  app.runtime = new ApplicationRuntime(model, { storage: new InMemoryObjectStorageBackend() });
  app.context = adminContext;
  document.body.append(app);
  await app.whenReady();
  await flushUi();
  return app;
}

function themeSelect(app: AdlAppElement): HTMLSelectElement {
  return requireElement<HTMLSelectElement>(app, "[data-theme-switch='true']");
}

describe("themeSwitch shell control", () => {
  beforeEach(() => {
    defineAdlComponents();
    document.body.innerHTML = "";
    globalThis.localStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("lists every declared theme, with the app's default theme selected", async () => {
    const app = await mountApp();
    const select = themeSelect(app);
    const optionValues = Array.from(select.options).map((option) => option.value);

    // The three built-in base themes are always present even though this
    // fixture declares no custom THEME block at all.
    expect(optionValues).toEqual(
      expect.arrayContaining(["CorporateLight", "CorporateDark", "MinimalLight"]),
    );
    expect(optionValues).toHaveLength(3);
    expect(select.value).toBe("CorporateLight");
    expect(app.dataset.adlTheme).toBe("CorporateLight");
  });

  it("applies the chosen theme immediately and re-renders the select as selected", async () => {
    const app = await mountApp();
    const select = themeSelect(app);

    select.value = "CorporateDark";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flushUi();

    expect(app.dataset.adlTheme).toBe("CorporateDark");
    expect(themeSelect(app).value).toBe("CorporateDark");
  });

  it("persists the choice to localStorage under an app-scoped key", async () => {
    const app = await mountApp();
    const select = themeSelect(app);

    select.value = "MinimalLight";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flushUi();

    expect(globalThis.localStorage.getItem("adl:ThemeSwitchFixture:theme")).toBe("MinimalLight");
  });

  it("restores the persisted theme across a fresh model assignment, as a reload would", async () => {
    const app = await mountApp();
    const select = themeSelect(app);
    select.value = "CorporateDark";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flushUi();

    // A fresh `model` assignment on the same element is this test's stand-in
    // for a page reload: a new AdlAppElement would read the same
    // localStorage entry at connect time.
    app.model = model;
    app.runtime = new ApplicationRuntime(model, { storage: new InMemoryObjectStorageBackend() });
    await app.whenReady();
    await flushUi();

    expect(app.dataset.adlTheme).toBe("CorporateDark");
    expect(themeSelect(app).value).toBe("CorporateDark");
  });

  it("falls back to the app's declared theme when a stored name no longer matches a declared theme", async () => {
    globalThis.localStorage.setItem("adl:ThemeSwitchFixture:theme", "NoLongerDeclared");
    const app = await mountApp();

    expect(app.dataset.adlTheme).toBe("CorporateLight");
    expect(themeSelect(app).value).toBe("CorporateLight");
  });

  /**
   * `renderShellControl`'s fewer-than-two-themes branch (the same
   * unavailable-control shape `pwaInstall` renders with no host capability
   * behind it) is not reachable through `resolveApplicationModel` today: the
   * resolver always injects the three built-in themes for any name not
   * already declared, so `model.themes` can never resolve to fewer than
   * three. The branch exists defensively, for a resolver that may one day let
   * an app suppress the built-ins; it is deliberately not exercised here
   * because there is no model this resolver produces that would reach it.
   */
});
