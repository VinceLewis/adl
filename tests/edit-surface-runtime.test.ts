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

const viewerContext: RuntimeContext = {
  userId: "viewer",
  roles: ["Viewer"],
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

  it("evaluates sorted relationship picker candidates after excluding already linked rows", async () => {
    const runtime = new ApplicationRuntime(createEditSurfaceModel());
    const event = await runtime.create("Event", { Title: "Launch" }, adminContext);
    await runtime.create(
      "SetList",
      { Event: event.meta.guid, Title: "Already linked", Position: 1 },
      adminContext,
    );
    await runtime.create("SetList", { Title: "Beta", Position: 2 }, adminContext);
    await runtime.create("SetList", { Title: "Alpha", Position: 3 }, adminContext);

    const picker = await runtime.evaluateRelationshipPicker({
      objectName: "Event",
      viewName: "EventForm",
      sectionName: "SetLists",
      recordId: event.meta.guid,
      context: adminContext,
    });

    expect(picker.candidates.map((candidate) => candidate.label)).toEqual(["Alpha", "Beta"]);
    expect(picker.diagnostics).toEqual([]);
  });

  it("filters relationship picker candidates through read policy before picker filtering", async () => {
    const runtime = new ApplicationRuntime(createEditSurfaceModel());
    const event = await runtime.create("Event", { Title: "Launch" }, adminContext);
    await runtime.create("SetList", { Title: "Public set", Visibility: "Public" }, adminContext);
    await runtime.create("SetList", { Title: "Private set", Visibility: "Private" }, adminContext);

    const picker = await runtime.evaluateRelationshipPicker({
      objectName: "Event",
      viewName: "EventForm",
      sectionName: "SetLists",
      recordId: event.meta.guid,
      context: viewerContext,
    });

    expect(picker.candidates.map((candidate) => candidate.label)).toEqual(["Public set"]);
  });

  it("evaluates relationship picker candidates from read models", async () => {
    const model = createEditSurfaceModel();
    const eventForm = model.objects
      .find((object) => object.name === "Event")
      ?.views.find((view) => view.name === "EventForm");
    const setLists = eventForm?.editSections.find((section) => section.kind === "childCollection");
    if (setLists?.kind !== "childCollection" || setLists.picker === undefined) {
      throw new Error("Expected relationship picker fixture.");
    }
    setLists.picker.sourceKind = "readModel";
    setLists.picker.source = "SetListCandidates";

    const runtime = new ApplicationRuntime(model);
    const event = await runtime.create("Event", { Title: "Launch" }, adminContext);
    await runtime.create("SetList", { Title: "Beta" }, adminContext);
    await runtime.create("SetList", { Title: "Alpha" }, adminContext);

    const picker = await runtime.evaluateRelationshipPicker({
      objectName: "Event",
      viewName: "EventForm",
      sectionName: "SetLists",
      recordId: event.meta.guid,
      context: adminContext,
    });

    expect(picker.candidates.map((candidate) => [candidate.label, candidate.source.kind])).toEqual([
      ["Alpha", "readModel"],
      ["Beta", "readModel"],
    ]);
  });

  it("filters relationship picker candidates by search text", async () => {
    const runtime = new ApplicationRuntime(createEditSurfaceModel());
    const event = await runtime.create("Event", { Title: "Launch" }, adminContext);
    await runtime.create("SetList", { Title: "Acoustic set" }, adminContext);
    await runtime.create("SetList", { Title: "Electric set" }, adminContext);

    const picker = await runtime.evaluateRelationshipPicker({
      objectName: "Event",
      viewName: "EventForm",
      sectionName: "SetLists",
      recordId: event.meta.guid,
      context: adminContext,
      query: { text: "aco" },
    });

    expect(picker.candidates.map((candidate) => candidate.label)).toEqual(["Acoustic set"]);
  });

  it("applies multi-select relationship picker links in staged order", async () => {
    const runtime = new ApplicationRuntime(createEditSurfaceModel());
    const event = await runtime.create("Event", { Title: "Launch" }, adminContext);
    const alpha = await runtime.create("SetList", { Title: "Alpha" }, adminContext);
    const beta = await runtime.create("SetList", { Title: "Beta" }, adminContext);
    const stagedChanges = [
      {
        id: "link-alpha",
        section: "SetLists",
        operation: "linkExisting" as const,
        childObject: "SetList",
        childId: alpha.meta.guid,
      },
      {
        id: "link-beta",
        section: "SetLists",
        operation: "linkExisting" as const,
        childObject: "SetList",
        childId: beta.meta.guid,
      },
    ];

    const surface = await runtime.evaluateEditSurface("Event", "EventForm", adminContext, {
      mode: "edit",
      recordId: event.meta.guid,
      stagedChanges,
    });
    const childSection = surface.sections.find((section) => section.kind === "childCollection");
    expect(childSection?.rows.map((row) => [row.source, row.values.Title])).toEqual([
      ["staged", "Alpha"],
      ["staged", "Beta"],
    ]);

    const result = await runtime.applyStagedChildChanges({
      objectName: "Event",
      viewName: "EventForm",
      parentRecordId: event.meta.guid,
      context: adminContext,
      stagedChanges,
    });

    expect(result.applied.map((operation) => operation.operationId)).toEqual([
      "link-alpha",
      "link-beta",
    ]);
    expect(
      (
        await runtime.search(
          "SetList",
          { sort: [{ field: "Title", direction: "asc" }] },
          adminContext,
        )
      ).map((record) => [record.values.Title, record.values.Event]),
    ).toEqual([
      ["Alpha", event.meta.guid],
      ["Beta", event.meta.guid],
    ]);
  });

  it("rejects stale duplicate relationship links at runtime", async () => {
    const runtime = new ApplicationRuntime(createEditSurfaceModel());
    const event = await runtime.create("Event", { Title: "Launch" }, adminContext);
    const setList = await runtime.create(
      "SetList",
      { Event: event.meta.guid, Title: "Already linked" },
      adminContext,
    );

    await expect(
      runtime.applyStagedChildChanges({
        objectName: "Event",
        viewName: "EventForm",
        parentRecordId: event.meta.guid,
        context: adminContext,
        stagedChanges: [
          {
            id: "stale-link",
            section: "SetLists",
            operation: "linkExisting",
            childObject: "SetList",
            childId: setList.meta.guid,
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "ADL_RUNTIME_VALIDATION_FAILED",
      issues: [expect.objectContaining({ code: "ADL_RUNTIME_RELATIONSHIP_PICKER_DUPLICATE" })],
    });
  });

  it("returns an empty relationship picker state without treating it as an error", async () => {
    const runtime = new ApplicationRuntime(createEditSurfaceModel());
    const event = await runtime.create("Event", { Title: "Launch" }, adminContext);
    await runtime.create(
      "SetList",
      { Event: event.meta.guid, Title: "Already linked" },
      adminContext,
    );

    const picker = await runtime.evaluateRelationshipPicker({
      objectName: "Event",
      viewName: "EventForm",
      sectionName: "SetLists",
      recordId: event.meta.guid,
      context: adminContext,
    });

    expect(picker.candidates).toEqual([]);
    expect(picker.diagnostics).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: "ADL_RUNTIME_RELATIONSHIP_PICKER_EMPTY",
      }),
    ]);
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

  it("browser relationship picker stages and saves multiple linked children", async () => {
    const model = createEditSurfaceModel();
    const runtime = new ApplicationRuntime(model);
    await runtime.create("SetList", { Title: "Beta" }, adminContext);
    await runtime.create("SetList", { Title: "Alpha" }, adminContext);
    const app = await mountApp(model, runtime);

    requireElement<HTMLButtonElement>(app, "[data-list-action='new']").click();
    await flushUi();
    fillInput(app, "adl-field-renderer[data-field-name='Title'] input", "With linked sets");
    requireElement<HTMLButtonElement>(app, "button[data-child-action='linkExisting']").click();
    await flushUi();

    const candidates = [...app.querySelectorAll<HTMLInputElement>("input[data-picker-candidate]")];
    expect(candidates.map((candidate) => candidate.closest("label")?.textContent?.trim())).toEqual([
      "Alpha",
      "Beta",
    ]);
    for (const candidate of candidates) {
      candidate.checked = true;
    }
    requireElement<HTMLButtonElement>(app, "button[data-picker-action='add']").click();
    await flushUi();
    expect(app.textContent).toContain("Alpha");
    expect(app.textContent).toContain("Beta");
    requireElement<HTMLButtonElement>(app, "button[data-action-name='save']").click();
    await flushUi();

    const linked = await runtime.search(
      "SetList",
      { sort: [{ field: "Title", direction: "asc" }] },
      adminContext,
    );
    expect(linked.map((record) => [record.values.Title, record.values.Event])).toEqual([
      ["Alpha", expect.any(String)],
      ["Beta", expect.any(String)],
    ]);
    expect(linked[0]?.values.Event).toBe(linked[1]?.values.Event);
  });
});

function createEditSurfaceModel(): ResolvedApplicationModel {
  return resolveApplicationModel(createEditSurfacePartialModel());
}

function createEditSurfacePartialModel(): PartialApplicationModel {
  return {
    app: { name: "EditSurfaceDemo", startView: "EventList" },
    roles: [{ name: "Admin" }, { name: "Editor" }, { name: "Viewer" }],
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
                operations: ["createChild", "linkExisting", "updateChild", "remove"],
                emptyState: { text: "No set lists" },
                picker: {
                  sourceKind: "object",
                  source: "SetList",
                  selection: "multiple",
                  displayFields: ["Title"],
                  searchFields: ["Title"],
                  sort: [{ field: "Title", direction: "asc" }],
                  emptyState: { text: "No set lists available" },
                },
              },
            ],
          },
        ],
      },
      {
        name: "SetList",
        displayField: "Title",
        constraints: [
          {
            name: "UniqueSetListTitlePerEvent",
            kind: "unique",
            fields: ["Title"],
            scopeFields: ["Event"],
          },
        ],
        fields: [
          {
            name: "Event",
            type: "text",
            lookup: { targetObject: "Event", displayField: "Title" },
          },
          { name: "Title", type: "text", required: true },
          { name: "Position", type: "number", defaultValue: 1 },
          { name: "Visibility", type: "text", defaultValue: "Public" },
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
            principal: { match: "specific", roles: ["Editor", "Viewer"] },
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
          {
            name: "allowViewersSearchSetLists",
            effect: "allow",
            principal: { match: "specific", roles: ["Viewer"] },
            action: "search",
          },
          {
            name: "allowViewersReadPublicSetLists",
            effect: "allow",
            principal: { match: "specific", roles: ["Viewer"] },
            action: "read",
            condition: {
              kind: "binary",
              operator: "==",
              left: { kind: "field", field: "Visibility" },
              right: { kind: "literal", value: "Public" },
            },
          },
        ],
      },
    ],
    readModels: [
      {
        name: "SetListCandidates",
        sources: [{ object: "SetList" }],
        fields: [
          { name: "Title", type: "text", source: "SetList", field: "Title" },
          { name: "Visibility", type: "text", source: "SetList", field: "Visibility" },
        ],
        sort: [{ field: "Title", direction: "asc" }],
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
