// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";
import { RuntimeStartupError } from "../src/index.js";
import type { RuntimeStartupDiagnostic } from "../src/index.js";
import {
  AdlStartupErrorElement,
  defineAdlStartupError,
} from "../src/ui/components/adl-startup-error.js";

/**
 * `<adl-startup-error>` (Phase 84): the one fallback rendered when
 * `src/ui/main.ts`'s `mountDemo()` fails before ever producing a working
 * `<adl-app>`. Two tiers, unit-tested directly against the element rather
 * than through `main.ts`'s catch wiring, matching this repo's existing
 * pattern for `<adl-sync-recovery>` (`tests/ui-sync-recovery.test.ts`): a
 * `RuntimeStartupError` gets the specific message and the "Reset local data
 * and reload" action, anything else gets the generic message, the raw error
 * visible, and a plain "Reload" with no reset action at all.
 *
 * The real end-to-end recovery flow -- a real browser, real IndexedDB, the
 * button actually clearing all three databases and the app actually
 * restarting clean -- is proven separately by
 * `tests/visual/startup-failure-recovery.visual.spec.ts`; this file proves
 * the element's own rendering and click wiring in isolation.
 */
describe("adl-startup-error", () => {
  beforeEach(() => {
    defineAdlStartupError();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the specific message and a reset action for a RuntimeStartupError with a database name", () => {
    const element = mount();
    element.error = staleFingerprintError();
    element.databaseName = "adl-example-app";

    expect(
      element.querySelector("[data-startup-error]")?.getAttribute("data-startup-error-kind"),
    ).toBe("runtime-startup");
    expect(element.textContent).toContain(
      "This app's locally saved data doesn't match the version currently running and can't be automatically updated.",
    );

    const resetButton = requireElement<HTMLButtonElement>(element, "[data-startup-error-reset]");
    expect(resetButton.textContent?.trim()).toBe("Reset local data and reload");
    expect(
      requireElement<HTMLButtonElement>(element, "[data-startup-error-reload]").textContent?.trim(),
    ).toBe("Reload");
    // The generic-failure detail disclosure is not shown for the specific,
    // actionable tier -- it names exactly what's wrong already.
    expect(element.querySelector("[data-startup-error-reload]")).not.toBeNull();
  });

  it("falls back to the generic tier for a RuntimeStartupError with no database name", () => {
    // No `?demo=` match -> no app-specific local data to offer resetting,
    // per the Decision section: only the generic fallback renders.
    const element = mount();
    element.error = staleFingerprintError();
    element.databaseName = undefined;

    expect(
      element.querySelector("[data-startup-error]")?.getAttribute("data-startup-error-kind"),
    ).toBe("generic");
    expect(element.querySelector("[data-startup-error-reset]")).toBeNull();
  });

  it("shows the generic message, the raw error, and only a plain reload for a non-RuntimeStartupError failure", () => {
    const element = mount();
    element.error = new Error("Failed to connect to authority: network unreachable");
    element.databaseName = "adl-example-app";

    expect(
      element.querySelector("[data-startup-error]")?.getAttribute("data-startup-error-kind"),
    ).toBe("generic");
    expect(element.textContent).toContain("Something went wrong starting the app");
    expect(element.textContent).toContain("Failed to connect to authority: network unreachable");
    expect(element.querySelector("[data-startup-error-reset]")).toBeNull();
    expect(
      requireElement<HTMLButtonElement>(element, "[data-startup-error-reload]").textContent?.trim(),
    ).toBe("Reload");
  });

  it("shows the raw value of a thrown non-Error", () => {
    const element = mount();
    element.error = "a plain string rejection";
    element.databaseName = undefined;

    expect(element.textContent).toContain("a plain string rejection");
    expect(element.querySelector("[data-startup-error-reset]")).toBeNull();
  });

  it("reloads without offering a reset when the plain Reload button is clicked", () => {
    const element = mount();
    element.error = staleFingerprintError();
    element.databaseName = "adl-example-app";
    const reload = vi.spyOn(globalThis.location, "reload").mockImplementation(() => undefined);

    requireElement<HTMLButtonElement>(element, "[data-startup-error-reload]").click();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  describe("reset action", () => {
    let restoreIndexedDb: () => void;

    beforeEach(() => {
      restoreIndexedDb = installFakeIndexedDb();
    });

    afterEach(() => {
      restoreIndexedDb();
    });

    it("deletes all three of the app's IndexedDB databases and reloads", async () => {
      const databaseName = "adl-example-app";
      await seedThreeDatabases(databaseName);
      expect(await databaseExists(databaseName)).toBe(true);
      expect(await databaseExists(`${databaseName}-sync-state`)).toBe(true);
      expect(await databaseExists(`${databaseName}-session-identity`)).toBe(true);

      const element = mount();
      element.error = staleFingerprintError();
      element.databaseName = databaseName;
      const reload = vi.spyOn(globalThis.location, "reload").mockImplementation(() => undefined);

      requireElement<HTMLButtonElement>(element, "[data-startup-error-reset]").click();
      await flushMicrotasks();

      expect(await databaseExists(databaseName)).toBe(false);
      expect(await databaseExists(`${databaseName}-sync-state`)).toBe(false);
      expect(await databaseExists(`${databaseName}-session-identity`)).toBe(false);
      expect(reload).toHaveBeenCalledTimes(1);
    });
  });
});

function mount(): AdlStartupErrorElement {
  const element = document.createElement("adl-startup-error");
  document.body.append(element);
  if (!(element instanceof AdlStartupErrorElement)) {
    throw new Error("adl-startup-error did not upgrade to its custom element class.");
  }

  return element;
}

function staleFingerprintError(): RuntimeStartupError {
  const diagnostic: RuntimeStartupDiagnostic = {
    severity: "error",
    code: "ADL_PERSISTED_MODEL_FINGERPRINT_STALE",
    message:
      "The model declares version '1.0.0', which persisted data already carries, but its content has changed.",
    path: "metadata.modelFingerprint",
    expected: "sha256-current",
    actual: "sha256-stale",
  };

  return new RuntimeStartupError([diagnostic]);
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

async function seedThreeDatabases(databaseName: string): Promise<void> {
  for (const name of [
    databaseName,
    `${databaseName}-sync-state`,
    `${databaseName}-session-identity`,
  ]) {
    await new Promise<void>((resolve, reject) => {
      const request = fakeIndexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("store");
      };
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }
}

async function databaseExists(name: string): Promise<boolean> {
  // IDBFactory has no direct "does this exist" check; opening without a
  // version bump and checking whether `upgradeneeded` fired distinguishes a
  // fresh (just-created) database from one that was already there.
  return new Promise((resolve, reject) => {
    let existed = true;
    const request = fakeIndexedDB.open(name);
    request.onupgradeneeded = () => {
      existed = false;
    };
    request.onsuccess = () => {
      request.result.close();
      resolve(existed);
    };
    request.onerror = () => reject(request.error);
  });
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
