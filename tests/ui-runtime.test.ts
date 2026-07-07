// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import { PolicyDeniedError } from "../src/index.js";
import { browserDemoContext, createBrowserDemoRuntime } from "../src/ui/demo-fixture.js";
import { AdlAppElement } from "../src/ui/components/adl-app.js";
import { defineAdlComponents } from "../src/ui/components/register.js";

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
});

async function mountApp(): Promise<AdlAppElement> {
  const app = document.createElement("adl-app") as AdlAppElement;
  document.body.append(app);
  await app.whenReady();
  await flushUi();
  return app;
}

async function flushUi(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing element for selector: ${selector}`);
  }

  return element;
}
