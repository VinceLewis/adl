// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import { ApplicationRuntime, resolveApplicationModel } from "../src/index.js";
import type { PartialApplicationModel, RuntimeContext } from "../src/index.js";
import { AdlAppElement } from "../src/ui/components/adl-app.js";
import { defineAdlComponents } from "../src/ui/components/register.js";

/**
 * The first-run onboarding surface (Phase 99, Amendment A).
 *
 * Before this, a person holding an identity and no membership saw exactly one
 * sentence — `No Group contexts are available for this view.` — and had no
 * affordance at all, because every view is scoped to a context they could not
 * reach and a presentation `ACTION`'s inputs are expressions over a row, so
 * nothing could ask them for a value a command requires.
 *
 * The fixture below is deliberately **not** either reference app: what is
 * under test is a general `COMMAND_ACTION` shell control running a declared
 * command, not a special case for `CreateBand`.
 */

const newcomer: RuntimeContext = { userId: "user-newcomer", roles: [], channel: "ui" };

const partialModel = {
  app: { name: "OnboardingFixture", startView: "ThingList", registration: "selfService" },
  shell: {
    nav: { items: [{ view: "ThingList", label: "Things" }] },
    controls: [
      {
        name: "createFirstGroup",
        kind: "commandAction",
        label: "Create a group",
        command: "MakeGroup",
        placement: "emptyState",
        visibility: { kind: "contextUnavailable", context: "Group" },
      },
    ],
  },
  roles: [{ name: "GroupOwner" }, { name: "GroupMember" }],
  contexts: [
    {
      name: "Group",
      object: "Group",
      selection: { mode: "required" },
      membership: {
        object: "GroupMember",
        userField: "User",
        contextField: "Group",
        roleField: "Role",
        roles: ["GroupOwner", "GroupMember"],
      },
    },
  ],
  objects: [
    {
      name: "Group",
      displayField: "Name",
      fields: [
        { name: "Name", type: "text", required: true },
        { name: "Notes", type: "text" },
        { name: "CreatedBy", type: "text", required: true },
      ],
    },
    {
      name: "GroupMember",
      scope: { context: "Group", field: "Group" },
      fields: [
        { name: "User", type: "text", required: true },
        {
          name: "Group",
          type: "text",
          required: true,
          lookup: { targetObject: "Group", displayField: "Name" },
        },
        { name: "Role", type: "text", required: true },
      ],
    },
    {
      name: "Thing",
      scope: { context: "Group", field: "Group" },
      displayField: "Title",
      fields: [
        {
          name: "Group",
          type: "text",
          required: true,
          lookup: { targetObject: "Group", displayField: "Name" },
        },
        { name: "Title", type: "text", required: true },
      ],
      views: [
        {
          name: "ThingList",
          kind: "list",
          context: { mode: "required", context: "Group" },
          fields: ["Title"],
          actions: ["read"],
        },
      ],
    },
  ],
  commands: [
    {
      name: "MakeGroup",
      label: "Create a group",
      inputs: [
        { name: "Name", type: "text", required: true },
        { name: "Notes", type: "text", required: false },
      ],
      steps: [
        {
          name: "makeGroup",
          action: "create",
          object: "Group",
          values: {
            Name: { kind: "input", name: "Name" },
            Notes: { kind: "input", name: "Notes" },
            CreatedBy: { kind: "runtime", property: "userId" },
          },
          establishesContext: "Group",
        },
        {
          name: "makeOwnerMembership",
          action: "create",
          object: "GroupMember",
          authority: "command",
          values: {
            User: { kind: "runtime", property: "userId" },
            Group: { kind: "stepMeta", step: "makeGroup", property: "guid" },
            Role: { kind: "literal", value: "GroupOwner" },
          },
        },
      ],
    },
  ],
  policies: [
    {
      name: "GroupPolicy",
      object: "Group",
      rules: [
        {
          name: "allowAuthenticatedCreateOwnGroup",
          effect: "allow",
          action: "create",
          principal: { match: "authenticated" },
          condition: "CreatedBy == runtime.userId",
        },
        {
          name: "allowGroupCreatorReadOwnGroup",
          effect: "allow",
          action: "read",
          principal: { match: "authenticated" },
          condition: "CreatedBy == runtime.userId",
        },
        {
          name: "allowMembersReadGroup",
          effect: "allow",
          action: "*",
          principal: { match: "specific", roles: ["GroupOwner", "GroupMember"] },
        },
      ],
    },
    {
      name: "GroupMemberPolicy",
      object: "GroupMember",
      rules: [
        {
          name: "allowMembersReadMembership",
          effect: "allow",
          action: "*",
          principal: { match: "specific", roles: ["GroupOwner", "GroupMember"] },
        },
      ],
    },
    {
      name: "ThingPolicy",
      object: "Thing",
      rules: [
        {
          name: "allowMembersEverything",
          effect: "allow",
          action: "*",
          principal: { match: "specific", roles: ["GroupOwner", "GroupMember"] },
        },
      ],
    },
  ],
};

const model = resolveApplicationModel(partialModel as unknown as PartialApplicationModel);

describe("first-run onboarding", () => {
  beforeEach(() => {
    defineAdlComponents();
    document.body.innerHTML = "";
    globalThis.localStorage?.clear();
    globalThis.sessionStorage?.clear();
    globalThis.history.replaceState({}, "", "/");
  });

  it("turns the context empty state into the entry point rather than a dead end", async () => {
    const app = await mountApp();

    const empty = app.querySelector("[data-empty-state='true']");
    expect(empty?.textContent).toContain("No Group contexts are available for this view.");
    const control = empty?.querySelector<HTMLButtonElement>(
      "[data-shell-command-control='createFirstGroup']",
    );
    expect(control).not.toBeNull();
    expect(control?.textContent?.trim()).toBe("Create a group");
    // Not a form until it is asked for.
    expect(app.querySelector("[data-command-form]")).toBeNull();
  });

  it("opens a form for the command's own declared inputs when the control is used", async () => {
    const app = await mountApp();
    click(app, "[data-shell-command-control='createFirstGroup']");
    await flushUi();

    expect(
      [...app.querySelectorAll<HTMLInputElement>("[data-command-input]")].map(
        (input) => input.dataset.commandInput,
      ),
    ).toEqual(["Name", "Notes"]);
    // The message the empty state used to be is still there beside the form.
    expect(app.textContent).toContain("No Group contexts are available for this view.");
  });

  /*
   * The whole point. After the command commits, the person is a member of the
   * context it established — and the shell re-reads the available contexts and
   * selects the new one, so they land inside it rather than back on the empty
   * state that offered them the control. No reload, no re-sign-in.
   */
  it("runs the command and lands the person inside the group they just created", async () => {
    const app = await mountApp();
    click(app, "[data-shell-command-control='createFirstGroup']");
    await flushUi();
    typeInto(app, "Name", "The Newcomers");
    submit(app);
    await flushUi();
    await flushUi();

    expect(app.querySelector("[data-empty-state='true']")).toBeNull();
    expect(app.querySelector("[data-command-form]")).toBeNull();
    expect(app.querySelector("adl-list-view")).not.toBeNull();
    expect(app.textContent).toContain("Create a group completed.");

    // Read back out of the runtime, not out of the DOM: the founder membership
    // is what confers the context role, and the group is owned by the caller.
    const runtime = app.runtime;
    const groups = await runtime.search("Group", {}, { ...newcomer, roles: ["GroupOwner"] });
    expect(groups.map((record) => record.values.Name)).toEqual(["The Newcomers"]);
    const groupId = groups[0]?.meta.guid ?? "";
    const memberships = await runtime.search(
      "GroupMember",
      {},
      { ...newcomer, roles: ["GroupOwner"], selectedContexts: { Group: groupId } },
    );
    expect(memberships.map((record) => record.values)).toEqual([
      expect.objectContaining({ User: newcomer.userId, Group: groupId, Role: "GroupOwner" }),
    ]);
  });

  /*
   * The construct is general, not an onboarding special case: the same control
   * kind renders and works from ordinary chrome, where there is no empty state
   * at all. Its form opens above the content it is about to change.
   */
  it("renders and runs the same control kind from the top bar", async () => {
    const chromeModel = resolveApplicationModel({
      ...partialModel,
      shell: {
        ...partialModel.shell,
        controls: [
          {
            ...partialModel.shell.controls[0],
            placement: "topBar",
            visibility: { kind: "always" },
          },
        ],
        topBar: { controls: ["createFirstGroup"] },
      },
    } as unknown as PartialApplicationModel);
    const app = document.createElement("adl-app") as AdlAppElement;
    app.model = chromeModel;
    app.runtime = new ApplicationRuntime(chromeModel);
    app.context = newcomer;
    document.body.append(app);
    await app.whenReady();
    await flushUi();

    const control = app.querySelector<HTMLButtonElement>(
      ".adl-topbar [data-shell-command-control='createFirstGroup']",
    );
    expect(control).not.toBeNull();
    expect(control?.disabled).toBe(false);

    control?.click();
    await flushUi();
    expect(app.querySelector(".adl-chrome-command-form [data-command-form]")).not.toBeNull();

    typeInto(app, "Name", "Chrome Group");
    submit(app);
    await flushUi();
    await flushUi();

    expect(app.querySelector("[data-command-form]")).toBeNull();
    const groups = await app.runtime.search("Group", {}, { ...newcomer, roles: ["GroupOwner"] });
    expect(groups.map((record) => record.values.Name)).toEqual(["Chrome Group"]);
  });

  it("keeps a refusal on the form, beside the values that produced it", async () => {
    const app = await mountApp();
    click(app, "[data-shell-command-control='createFirstGroup']");
    await flushUi();
    // A caller with no user id cannot satisfy `authenticated`, so the create
    // policy refuses and the form must say so rather than closing.
    app.context = { ...newcomer, userId: "" };
    typeInto(app, "Name", "The Newcomers");
    submit(app);
    await flushUi();
    await flushUi();

    expect(app.querySelector("[data-command-form-error='true']")).not.toBeNull();
    expect(app.querySelector("[data-command-form]")).not.toBeNull();
    expect(inputFor(app, "Name").value).toBe("The Newcomers");
  });

  it("takes the control away once the person belongs to a group", async () => {
    const app = await mountApp();
    click(app, "[data-shell-command-control='createFirstGroup']");
    await flushUi();
    typeInto(app, "Name", "The Newcomers");
    submit(app);
    await flushUi();
    await flushUi();

    // `VISIBLE WHEN CONTEXT Group UNAVAILABLE` is what makes this true: the
    // onboarding surface is for people who have nothing, and stops existing the
    // moment they have something.
    expect(app.querySelector("[data-shell-command-control='createFirstGroup']")).toBeNull();
  });
});

async function mountApp(): Promise<AdlAppElement> {
  const app = document.createElement("adl-app") as AdlAppElement;
  app.model = model;
  app.runtime = new ApplicationRuntime(model);
  app.context = newcomer;
  document.body.append(app);
  await app.whenReady();
  await flushUi();
  return app;
}

function click(root: ParentNode, selector: string): void {
  const element = root.querySelector<HTMLButtonElement>(selector);
  if (element === null) throw new Error(`Expected to find '${selector}'.`);
  element.click();
}

function inputFor(root: ParentNode, name: string): HTMLInputElement {
  const input = root.querySelector<HTMLInputElement>(`[data-command-input='${name}']`);
  if (input === null) throw new Error(`Expected an input for '${name}'.`);
  return input;
}

function typeInto(root: ParentNode, name: string, value: string): void {
  inputFor(root, name).value = value;
}

function submit(root: ParentNode): void {
  root
    .querySelector("[data-command-form]")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

async function flushUi(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
