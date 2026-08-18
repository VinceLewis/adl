// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApplicationRuntime,
  InMemoryObjectStorageBackend,
  resolveApplicationModel,
} from "../src/index.js";
import { AdlAppElement } from "../src/ui/components/adl-app.js";
import { defineAdlComponents } from "../src/ui/components/register.js";
import type { PartialApplicationModel, RuntimeContext } from "../src/index.js";

/**
 * Phase 66's half of the `pwaInstall` shell control: capturing
 * `beforeinstallprompt`, prompting on click, and reflecting `appinstalled` —
 * all of it plain component state exercisable through real DOM events in
 * happy-dom, the same way `ui-authority-chrome.test.ts` exercises every other
 * shell control. No separate pure-logic module is needed here because, unlike
 * the service worker (a different global scope with no DOM at all), `adl-app`
 * already runs and dispatches real events inside this test environment.
 */

const partialModel: PartialApplicationModel = {
  app: { name: "PwaInstallFixture", startView: "GigList" },
  roles: [{ name: "Admin" }],
  shell: {
    controls: [{ name: "install", kind: "pwaInstall", label: "Install", placement: "topBar" }],
    topBar: { controls: ["install"] },
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

/** A structural stand-in for the Chromium-only `BeforeInstallPromptEvent`. */
interface FakeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function fakeInstallPromptEvent(outcome: "accepted" | "dismissed"): {
  event: FakeInstallPromptEvent;
  promptCalls: number[];
} {
  const promptCalls: number[] = [];
  const event = new Event("beforeinstallprompt", {
    cancelable: true,
  }) as unknown as FakeInstallPromptEvent;
  event.prompt = () => {
    promptCalls.push(1);
    return Promise.resolve();
  };
  event.userChoice = Promise.resolve({ outcome, platform: "web" });
  return { event, promptCalls };
}

async function flushUi(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Expected to find '${selector}'.`);
  }
  return element;
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

function installControl(app: AdlAppElement): HTMLButtonElement {
  return requireElement<HTMLButtonElement>(app, "[data-shell-control-kind='pwaInstall']");
}

describe("pwaInstall shell control", () => {
  beforeEach(() => {
    defineAdlComponents();
    document.body.innerHTML = "";
    // Neither signal says "already installed" unless a test says otherwise.
    vi.stubGlobal("matchMedia", (query: string) => ({ media: query, matches: false }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports the pre-offer unavailable reason before any prompt has been offered", async () => {
    const app = await mountApp();
    const control = installControl(app);
    expect(control.disabled).toBe(true);
    expect(control.title).toBe("Install is not available in this runtime.");
    expect(control.dataset.shellAction).toBeUndefined();
  });

  it("captures beforeinstallprompt, prevents its default, and becomes clickable", async () => {
    const app = await mountApp();
    const { event } = fakeInstallPromptEvent("accepted");
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");

    window.dispatchEvent(event);
    await flushUi();

    expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
    const control = installControl(app);
    expect(control.disabled).toBe(false);
    expect(control.dataset.shellAction).toBe("install");
  });

  it("prompts at most once per captured event, surfaces acceptance, and returns to unavailable", async () => {
    const app = await mountApp();
    const { event, promptCalls } = fakeInstallPromptEvent("accepted");
    window.dispatchEvent(event);
    await flushUi();

    installControl(app).click();
    // Clicking again immediately must not call prompt() a second time: the
    // control is already back to unavailable in the same synchronous turn.
    installControl(app).click();
    await flushUi();

    expect(promptCalls).toHaveLength(1);
    const control = installControl(app);
    expect(control.disabled).toBe(true);
    // Not yet "already installed": that fact is only known once `appinstalled`
    // fires, not merely because the user accepted the browser's own dialog.
    expect(control.title).toBe("Install is not available in this runtime.");
    expect(requireElement(app, "adl-message-area").textContent).toContain("Installing the app.");
  });

  it("does not surface a success message when the user dismisses the prompt", async () => {
    const app = await mountApp();
    const { event } = fakeInstallPromptEvent("dismissed");
    window.dispatchEvent(event);
    await flushUi();

    installControl(app).click();
    await flushUi();

    expect(installControl(app).disabled).toBe(true);
    expect(requireElement(app, "adl-message-area").textContent ?? "").not.toContain(
      "Installing the app.",
    );
  });

  it("reflects appinstalled by disabling the control with an install-specific reason", async () => {
    const app = await mountApp();
    const { event } = fakeInstallPromptEvent("accepted");
    window.dispatchEvent(event);
    await flushUi();
    expect(installControl(app).disabled).toBe(false);

    window.dispatchEvent(new Event("appinstalled"));
    await flushUi();

    const control = installControl(app);
    expect(control.disabled).toBe(true);
    expect(control.title).toBe("This app is already installed.");
  });

  it("ignores a beforeinstallprompt event once appinstalled has fired", async () => {
    const app = await mountApp();
    window.dispatchEvent(new Event("appinstalled"));
    await flushUi();

    const { event } = fakeInstallPromptEvent("accepted");
    window.dispatchEvent(event);
    await flushUi();

    const control = installControl(app);
    expect(control.disabled).toBe(true);
    expect(control.title).toBe("This app is already installed.");
  });

  it("starts already-installed when display-mode is standalone on connect", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      media: query,
      matches: query === "(display-mode: standalone)",
    }));

    const app = await mountApp();
    const control = installControl(app);
    expect(control.disabled).toBe(true);
    expect(control.title).toBe("This app is already installed.");
  });
});
