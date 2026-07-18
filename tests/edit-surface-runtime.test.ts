// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import { ApplicationRuntime, resolveApplicationModel } from "../src/index.js";
import type {
  PartialApplicationModel,
  ResolvedApplicationModel,
  RuntimeContext,
} from "../src/index.js";
import { defineAdlComponents } from "../src/ui/components/register.js";
import type { AdlAppElement } from "../src/ui/components/adl-app.js";

const adminContext: RuntimeContext = {
  userId: "admin",
  roles: ["Admin"],
  channel: "ui",
  now: new Date("2026-07-07T08:00:00.000Z"),
};

const editorContext: RuntimeContext = {
  userId: "editor",
  roles: ["Editor"],
  channel: "ui",
  now: new Date("2026-07-07T08:00:00.000Z"),
};

describe("parent-child edit surfaces", () => {
  beforeEach(() => {
    defineAdlComponents();
    document.body.innerHTML = "";
  });

  it("evaluates existing parent child rows with policy-shaped row actions", async () => {
    const runtime = new ApplicationRuntime(createEditSurfaceModel());
    const event = await runtime.create("Event", { Title: "Launch" }, adminContext);
    await runtime.create(
      "SetList",
      { Event: event.meta.guid, Title: "Main set", Position: 1 },
      adminContext,
    );

    const surface = await runtime.evaluateEditSurface("Event", "EventForm", adminContext, {
      mode: "edit",
      recordId: event.meta.guid,
    });
    const childSection = surface.sections.find((section) => section.kind === "childCollection");

    expect(childSection?.rows.map((row) => row.values.Title)).toEqual(["Main set"]);
    expect(childSection?.rows[0]?.actions).toEqual([
      expect.objectContaining({ operation: "updateChild", visible: true, enabled: true }),
      expect.objectContaining({ operation: "remove", visible: true, enabled: true }),
    ]);
  });

  it("stages child rows for a new parent and applies them after parent creation", async () => {
    const runtime = new ApplicationRuntime(createEditSurfaceModel());
    const stagedChanges = [
      {
        id: "staged-1",
        section: "SetLists",
        operation: "createChild" as const,
        childObject: "SetList",
        values: { Title: "Opening set", Position: 1 },
      },
    ];

    const createSurface = await runtime.evaluateEditSurface("Event", "EventForm", adminContext, {
      mode: "create",
      stagedChanges,
    });
    const childSection = createSurface.sections.find(
      (section) => section.kind === "childCollection",
    );

    expect(childSection?.rows).toEqual([
      expect.objectContaining({
        source: "staged",
        values: { Title: "Opening set", Position: 1 },
      }),
    ]);

    const parent = await runtime.create("Event", { Title: "New event" }, adminContext);
    await runtime.applyStagedChildChanges({
      objectName: "Event",
      viewName: "EventForm",
      parentRecordId: parent.meta.guid,
      context: adminContext,
      stagedChanges,
    });

    const children = await runtime.search("SetList", {}, adminContext);
    expect(children.map((record) => record.values)).toEqual([
      expect.objectContaining({ Event: parent.meta.guid, Title: "Opening set", Position: 1 }),
    ]);
  });

  it("applies staged child removal through runtime delete enforcement", async () => {
    const runtime = new ApplicationRuntime(createEditSurfaceModel());
    const event = await runtime.create("Event", { Title: "Launch" }, adminContext);
    const setList = await runtime.create(
      "SetList",
      { Event: event.meta.guid, Title: "Main set", Position: 1 },
      adminContext,
    );

    await runtime.applyStagedChildChanges({
      objectName: "Event",
      viewName: "EventForm",
      parentRecordId: event.meta.guid,
      context: adminContext,
      stagedChanges: [
        {
          id: "remove-1",
          section: "SetLists",
          operation: "remove",
          childObject: "SetList",
          childId: setList.meta.guid,
        },
      ],
    });

    expect(await runtime.search("SetList", {}, adminContext)).toEqual([]);
  });

  it("hides child row actions when child policy denies the operation", async () => {
    const runtime = new ApplicationRuntime(createEditSurfaceModel());
    const event = await runtime.create("Event", { Title: "Launch" }, adminContext);
    await runtime.create(
      "SetList",
      { Event: event.meta.guid, Title: "Main set", Position: 1 },
      adminContext,
    );

    const surface = await runtime.evaluateEditSurface("Event", "EventForm", editorContext, {
      mode: "edit",
      recordId: event.meta.guid,
    });
    const childSection = surface.sections.find((section) => section.kind === "childCollection");

    expect(childSection?.rows[0]?.actions).toContainEqual(
      expect.objectContaining({ operation: "remove", visible: false, enabled: false }),
    );
  });

  it("browser cancel discards staged children and save applies staged children", async () => {
    const model = createEditSurfaceModel();
    const runtime = new ApplicationRuntime(model);
    const app = await mountApp(model, runtime);

    requireElement<HTMLButtonElement>(app, "[data-list-action='new']").click();
    await flushUi();
    fillInput(app, "adl-field-renderer[data-field-name='Title'] input", "Cancelled");
    fillInput(app, "input[data-child-draft-field='Title']", "Discarded child");
    requireElement<HTMLButtonElement>(app, "button[data-child-action='createChild']").click();
    await flushUi();
    expect(app.textContent).toContain("Discarded child");

    requireElement<HTMLButtonElement>(app, "button[data-action-name='cancel']").click();
    await flushUi();
    expect(await runtime.search("SetList", {}, adminContext)).toEqual([]);

    requireElement<HTMLButtonElement>(app, "[data-list-action='new']").click();
    await flushUi();
    fillInput(app, "adl-field-renderer[data-field-name='Title'] input", "Saved");
    fillInput(app, "input[data-child-draft-field='Title']", "Saved child");
    requireElement<HTMLButtonElement>(app, "button[data-child-action='createChild']").click();
    await flushUi();
    requireElement<HTMLButtonElement>(app, "button[data-action-name='save']").click();
    await flushUi();

    expect(
      (await runtime.search("SetList", {}, adminContext)).map((record) => record.values.Title),
    ).toEqual(["Saved child"]);
  });
});

function createEditSurfaceModel(): ResolvedApplicationModel {
  return resolveApplicationModel(createEditSurfacePartialModel());
}

function createEditSurfacePartialModel(): PartialApplicationModel {
  return {
    app: { name: "EditSurfaceDemo", startView: "EventList" },
    roles: [{ name: "Admin" }, { name: "Editor" }],
    objects: [
      {
        name: "Event",
        displayField: "Title",
        fields: [{ name: "Title", type: "text", required: true }],
        views: [
          {
            name: "EventList",
            kind: "list",
            fields: ["Title"],
            actions: ["create", "read", "update", "delete"],
            editContainer: "modal",
          },
          {
            name: "EventForm",
            kind: "form",
            fields: ["Title"],
            actions: ["save", "delete"],
            editSections: [
              { name: "Details", kind: "fields", fields: ["Title"] },
              {
                name: "SetLists",
                kind: "childCollection",
                heading: "Set lists",
                childObject: "SetList",
                parentField: "Event",
                childView: "SetListInline",
                operations: ["createChild", "updateChild", "remove"],
                emptyState: { text: "No set lists" },
              },
            ],
          },
        ],
      },
      {
        name: "SetList",
        displayField: "Title",
        fields: [
          {
            name: "Event",
            type: "text",
            lookup: { targetObject: "Event", displayField: "Title" },
          },
          { name: "Title", type: "text", required: true },
          { name: "Position", type: "number", defaultValue: 1 },
        ],
        views: [
          {
            name: "SetListInline",
            kind: "list",
            fields: ["Title", "Position"],
            actions: ["read", "update", "delete"],
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
            name: "allowAdminsAllEvents",
            effect: "allow",
            principal: { match: "specific", roles: ["Admin"] },
            action: "*",
          },
          {
            name: "allowEditorsReadEvents",
            effect: "allow",
            principal: { match: "specific", roles: ["Editor"] },
            action: "read",
          },
        ],
      },
      {
        name: "SetListPolicy",
        object: "SetList",
        rules: [
          {
            name: "allowAdminsAllSetLists",
            effect: "allow",
            principal: { match: "specific", roles: ["Admin"] },
            action: "*",
          },
          {
            name: "allowEditorsReadSetLists",
            effect: "allow",
            principal: { match: "specific", roles: ["Editor"] },
            action: "read",
          },
          {
            name: "allowEditorsSearchSetLists",
            effect: "allow",
            principal: { match: "specific", roles: ["Editor"] },
            action: "search",
          },
          {
            name: "allowEditorsUpdateSetLists",
            effect: "allow",
            principal: { match: "specific", roles: ["Editor"] },
            action: "update",
          },
        ],
      },
    ],
  };
}

async function mountApp(
  model: ResolvedApplicationModel,
  runtime: ApplicationRuntime,
): Promise<AdlAppElement> {
  const app = document.createElement("adl-app") as AdlAppElement;
  app.model = model;
  app.runtime = runtime;
  app.context = adminContext;
  document.body.append(app);
  await app.whenReady();
  await flushUi();
  return app;
}

function fillInput(root: ParentNode, selector: string, value: string): void {
  const input = requireElement<HTMLInputElement>(root, selector);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function flushUi(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Expected element '${selector}' to exist.`);
  }
  return element;
}
