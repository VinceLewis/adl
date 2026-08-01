// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import {
  ApplicationRuntime,
  resolveApplicationModel,
  validateApplicationModel,
} from "../src/index.js";
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
    // One header control opens the picker, and a linking picker labels it
    // "Link" because the records it offers already exist.
    const open = requireElement<HTMLButtonElement>(app, "button[data-picker-open='SetLists']");
    expect(open.textContent?.trim()).toBe("Link");
    open.click();
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

/**
 * A picker that names a `candidateField` offers the thing the user believes
 * they are choosing — a song — and mints the child record that names it. The
 * link-only picker above can only re-parent an existing `SetListItem`, which
 * makes "add a song to this set list" inexpressible.
 *
 * Every case below therefore turns on the distinction between the candidate and
 * the child: what the picker offers, what exclusion compares, and what the
 * staged operation carries.
 */
describe("a relationship picker that mints children", () => {
  async function setListWithSongs(): Promise<{
    runtime: ApplicationRuntime;
    setListId: string;
    songs: Map<string, string>;
  }> {
    const runtime = new ApplicationRuntime(createMintingEditSurfaceModel());
    const setList = await runtime.create("SetList", { Name: "Main set" }, adminContext);
    const songs = new Map<string, string>();
    for (const title of ["Alpha", "Beta", "Gamma"]) {
      const song = await runtime.create("Song", { Title: title }, adminContext);
      songs.set(title, song.meta.guid);
    }
    runtime.syncQueue.clear();
    return { runtime, setListId: setList.meta.guid, songs };
  }

  function songId(songs: Map<string, string>, title: string): string {
    const id = songs.get(title);
    if (id === undefined) throw new Error(`Expected a seeded song '${title}'.`);
    return id;
  }

  it("offers records of the candidate object rather than of the child object", async () => {
    const { runtime, setListId } = await setListWithSongs();

    const picker = await runtime.evaluateRelationshipPicker({
      objectName: "SetList",
      viewName: "SetListForm",
      sectionName: "Items",
      recordId: setListId,
      context: adminContext,
    });

    expect(picker.picker.candidateField).toBe("Song");
    expect(picker.candidates.map((candidate) => candidate.label)).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
    ]);
    expect(new Set(picker.candidates.map((candidate) => candidate.source.objectName))).toEqual(
      new Set(["Song"]),
    );
  });

  /**
   * The child's own id is not what identifies the choice, so exclusion has to
   * compare the candidate each existing child *names*. Comparing child ids would
   * exclude nothing at all and offer a song already in the set list again.
   */
  it("excludes candidates the existing children already name", async () => {
    const { runtime, setListId, songs } = await setListWithSongs();
    const item = await runtime.create(
      "SetListItem",
      { SetList: setListId, Song: songId(songs, "Beta"), Position: 1 },
      adminContext,
    );

    const picker = await runtime.evaluateRelationshipPicker({
      objectName: "SetList",
      viewName: "SetListForm",
      sectionName: "Items",
      recordId: setListId,
      context: adminContext,
    });

    expect(picker.candidates.map((candidate) => candidate.label)).toEqual(["Alpha", "Gamma"]);
    // The excluded id is the song's, not the set-list item's — the item's own id
    // never identified anything the picker offers.
    expect(picker.candidates.map((candidate) => candidate.id)).not.toContain(item.meta.guid);
  });

  /**
   * The staged creates have not been committed, so nothing in storage names the
   * songs they carry. Offering them again would let one editing session put the
   * same song into the set list twice.
   */
  it("excludes candidates named by staged creates in the same session", async () => {
    const { runtime, setListId, songs } = await setListWithSongs();

    const picker = await runtime.evaluateRelationshipPicker({
      objectName: "SetList",
      viewName: "SetListForm",
      sectionName: "Items",
      recordId: setListId,
      context: adminContext,
      stagedChanges: [
        {
          id: "add-alpha",
          section: "Items",
          operation: "createChild",
          childObject: "SetListItem",
          values: { Song: songId(songs, "Alpha") },
        },
        {
          id: "add-beta",
          section: "Items",
          operation: "createChild",
          childObject: "SetListItem",
          values: { Song: songId(songs, "Beta") },
        },
      ],
    });

    expect(picker.candidates.map((candidate) => candidate.label)).toEqual(["Gamma"]);
  });

  /**
   * The payoff: several chosen songs become several children naming them, at
   * the end of the ordered collection in the order chosen, committed once.
   *
   * Nothing supplies a position — the picker knows only which songs were ticked
   * — so a required order field is only satisfiable if the runtime appends, and
   * appending must count forward within the batch rather than issuing the same
   * free position to every create in it.
   */
  it("applies staged creates as appended children naming the chosen candidates, in one batch", async () => {
    const { runtime, setListId, songs } = await setListWithSongs();
    await runtime.create(
      "SetListItem",
      { SetList: setListId, Song: songId(songs, "Beta"), Position: 1 },
      adminContext,
    );
    runtime.syncQueue.clear();

    const applied = await runtime.applyStagedChildChanges({
      objectName: "SetList",
      viewName: "SetListForm",
      parentRecordId: setListId,
      context: adminContext,
      stagedChanges: [
        {
          id: "add-gamma",
          section: "Items",
          operation: "createChild",
          childObject: "SetListItem",
          values: { Song: songId(songs, "Gamma") },
        },
        {
          id: "add-alpha",
          section: "Items",
          operation: "createChild",
          childObject: "SetListItem",
          values: { Song: songId(songs, "Alpha") },
        },
      ],
    });

    expect(applied.applied.map((operation) => operation.operation)).toEqual([
      "createChild",
      "createChild",
    ]);

    const items = await runtime.search(
      "SetListItem",
      { sort: [{ field: "Position", direction: "asc" }] },
      adminContext,
    );
    expect(
      items.map((record) => [
        [...songs].find(([, id]) => id === record.values.Song)?.[0],
        record.values.Position,
        record.values.SetList,
      ]),
    ).toEqual([
      ["Beta", 1, setListId],
      ["Gamma", 2, setListId],
      ["Alpha", 3, setListId],
    ]);

    // One transaction, so one queue entry — not one per song the user ticked.
    const entries = runtime.syncQueue.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.operation.operation).toBe("batch");
    expect(entries[0]?.operation.batch?.writes.map((write) => write.operation)).toEqual([
      "create",
      "create",
    ]);
  });
});

/**
 * The refusals that happen before anything is committed.
 *
 * Each of these is checked while the batch is still being planned, so the guard
 * being proved is not only that the caller was told: it is that a staged
 * operation the model does not permit cannot take the permitted operations
 * beside it into storage. Since Phase 59 the batch commits once, so a refusal
 * anywhere must leave storage and the sync queue untouched — the assertions
 * below are against both, never against the thrown error alone.
 */
describe("staged child changes the model does not permit", () => {
  async function eventWithRuntime(): Promise<{
    runtime: ApplicationRuntime;
    eventId: string;
  }> {
    const runtime = new ApplicationRuntime(createEditSurfaceModel());
    const event = await runtime.create("Event", { Title: "Launch" }, adminContext);
    runtime.syncQueue.clear();
    return { runtime, eventId: event.meta.guid };
  }

  async function expectNothingApplied(runtime: ApplicationRuntime): Promise<void> {
    expect(await runtime.search("SetList", {}, adminContext)).toEqual([]);
    expect(runtime.syncQueue.getEntries()).toEqual([]);
  }

  it("refuses a staged operation naming a child collection the view does not declare", async () => {
    const { runtime, eventId } = await eventWithRuntime();

    await expect(
      runtime.applyStagedChildChanges({
        objectName: "Event",
        viewName: "EventForm",
        parentRecordId: eventId,
        context: adminContext,
        stagedChanges: [
          {
            id: "valid",
            section: "SetLists",
            operation: "createChild",
            childObject: "SetList",
            values: { Title: "Opening set" },
          },
          {
            id: "unknown-section",
            section: "Encores",
            operation: "createChild",
            childObject: "SetList",
            values: { Title: "Encore" },
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "ADL_RUNTIME_VALIDATION_FAILED",
      issues: [expect.objectContaining({ code: "ADL_RUNTIME_EDIT_CHILD_OPERATION_UNSUPPORTED" })],
    });

    await expectNothingApplied(runtime);
  });

  /**
   * The section names the child object it manages, so a staged operation that
   * disagrees is refused rather than reinterpreted. Trusting the caller's
   * `childObject` would let a staged change reach an object the view never
   * declared, with the parent field of the one it did.
   */
  it("refuses a staged operation targeting a different child object than the section manages", async () => {
    const { runtime, eventId } = await eventWithRuntime();

    await expect(
      runtime.applyStagedChildChanges({
        objectName: "Event",
        viewName: "EventForm",
        parentRecordId: eventId,
        context: adminContext,
        stagedChanges: [
          {
            id: "wrong-object",
            section: "SetLists",
            operation: "createChild",
            childObject: "Event",
            values: { Title: "Nested event" },
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "ADL_RUNTIME_VALIDATION_FAILED",
      issues: [expect.objectContaining({ code: "ADL_RUNTIME_EDIT_CHILD_OPERATION_UNSUPPORTED" })],
    });

    await expectNothingApplied(runtime);
  });

  /**
   * `SetLists` declares createChild, linkExisting, updateChild and remove. The
   * runtime is the enforcement point for that list: the browser hides the
   * actions it did not declare, but hiding a control is not a check.
   */
  it("refuses an operation the model did not permit even when the runtime supports it", async () => {
    const { runtime, eventId } = await eventWithRuntime();
    const setList = await runtime.create(
      "SetList",
      { Event: eventId, Title: "Main set", Position: 1 },
      adminContext,
    );
    runtime.syncQueue.clear();

    await expect(
      runtime.applyStagedChildChanges({
        objectName: "Event",
        viewName: "EventForm",
        parentRecordId: eventId,
        context: adminContext,
        stagedChanges: [
          {
            id: "unlink",
            section: "SetLists",
            operation: "unlink",
            childObject: "SetList",
            childId: setList.meta.guid,
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "ADL_RUNTIME_VALIDATION_FAILED",
      issues: [
        expect.objectContaining({
          code: "ADL_RUNTIME_EDIT_CHILD_OPERATION_UNSUPPORTED",
          message: expect.stringContaining("does not support operation 'unlink'"),
        }),
      ],
    });

    // The child is still linked, and nothing was queued to say otherwise.
    expect(
      (await runtime.search("SetList", {}, adminContext)).map((record) => record.values.Event),
    ).toEqual([eventId]);
    expect(runtime.syncQueue.getEntries()).toEqual([]);
  });

  /**
   * An operation that names no child record cannot be planned. It is refused
   * mid-batch, after the create before it has already been planned, which is
   * exactly the position from which the pre-Phase-59 loop would have committed
   * that create and then failed.
   */
  it("refuses a staged operation that names no child record, without applying the batch", async () => {
    const { runtime, eventId } = await eventWithRuntime();

    await expect(
      runtime.applyStagedChildChanges({
        objectName: "Event",
        viewName: "EventForm",
        parentRecordId: eventId,
        context: adminContext,
        stagedChanges: [
          {
            id: "valid",
            section: "SetLists",
            operation: "createChild",
            childObject: "SetList",
            values: { Title: "Opening set" },
          },
          {
            id: "missing-child-id",
            section: "SetLists",
            operation: "updateChild",
            childObject: "SetList",
            values: { Title: "Renamed" },
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "ADL_RUNTIME_VALIDATION_FAILED",
      issues: [
        expect.objectContaining({
          code: "ADL_RUNTIME_EDIT_CHILD_OPERATION_UNSUPPORTED",
          message: expect.stringContaining("requires childId"),
        }),
      ],
    });

    await expectNothingApplied(runtime);
  });

  /**
   * The duplicate-link refusal, now proved to take the rest of the batch with
   * it. Two staged links to the same child would otherwise have committed the
   * create beside them before the duplicate was noticed.
   */
  it("refuses duplicate staged links without applying the rest of the batch", async () => {
    const { runtime, eventId } = await eventWithRuntime();
    const alpha = await runtime.create("SetList", { Title: "Alpha" }, adminContext);
    runtime.syncQueue.clear();

    await expect(
      runtime.applyStagedChildChanges({
        objectName: "Event",
        viewName: "EventForm",
        parentRecordId: eventId,
        context: adminContext,
        stagedChanges: [
          {
            id: "create",
            section: "SetLists",
            operation: "createChild",
            childObject: "SetList",
            values: { Title: "Opening set" },
          },
          {
            id: "link-alpha",
            section: "SetLists",
            operation: "linkExisting",
            childObject: "SetList",
            childId: alpha.meta.guid,
          },
          {
            id: "link-alpha-again",
            section: "SetLists",
            operation: "linkExisting",
            childObject: "SetList",
            childId: alpha.meta.guid,
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "ADL_RUNTIME_VALIDATION_FAILED",
      issues: [expect.objectContaining({ code: "ADL_RUNTIME_RELATIONSHIP_PICKER_DUPLICATE" })],
    });

    // Alpha is unlinked and the staged create never happened.
    expect(
      (await runtime.search("SetList", {}, adminContext)).map((record) => [
        record.values.Title,
        record.values.Event,
      ]),
    ).toEqual([["Alpha", undefined]]);
    expect(runtime.syncQueue.getEntries()).toEqual([]);
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

function createMintingEditSurfaceModel(): ResolvedApplicationModel {
  const model = resolveApplicationModel(createMintingPartialModel());
  // The declaration has to be a legal one, or the cases below would be proving
  // behaviour for a model no author could write.
  expect(validateApplicationModel(model)).toEqual([]);
  return model;
}

/**
 * A set list whose songs are added by choosing a `Song`. The child record is
 * the `SetListItem` that names the chosen song, which is the record no picker
 * could produce before `CANDIDATE_FIELD`.
 */
function createMintingPartialModel(): PartialApplicationModel {
  return {
    app: { name: "SetListDemo", startView: "SetListList" },
    roles: [{ name: "Admin" }],
    objects: [
      {
        name: "SetList",
        displayField: "Name",
        fields: [{ name: "Name", type: "text", required: true }],
        views: [
          {
            name: "SetListList",
            kind: "list",
            fields: ["Name"],
            actions: ["create", "read", "update", "delete"],
            editContainer: "modal",
          },
          {
            name: "SetListForm",
            kind: "form",
            fields: ["Name"],
            actions: ["save", "delete"],
            editSections: [
              { name: "Details", kind: "fields", fields: ["Name"] },
              {
                name: "Items",
                kind: "childCollection",
                heading: "Songs",
                childObject: "SetListItem",
                parentField: "SetList",
                childView: "SetListItemInline",
                // No `linkExisting`: a minting picker adds, it does not
                // re-parent, and the model is not obliged to permit both.
                operations: ["createChild", "updateChild", "remove", "reorder"],
                orderField: "Position",
                emptyState: { text: "No songs in this set list yet." },
                picker: {
                  name: "SongPicker",
                  sourceKind: "object",
                  source: "Song",
                  candidateField: "Song",
                  selection: "multiple",
                  displayFields: ["Title"],
                  searchFields: ["Title"],
                  sort: [{ field: "Title", direction: "asc" }],
                  emptyState: { text: "Every song is already in this set list." },
                },
              },
            ],
          },
        ],
      },
      {
        name: "SetListItem",
        displayField: "Song",
        constraints: [
          {
            name: "orderedSetListItems",
            kind: "ordered",
            parentField: "SetList",
            positionField: "Position",
            minPosition: 1,
            reorder: "shift",
            compaction: "onDelete",
          },
        ],
        fields: [
          {
            name: "SetList",
            type: "text",
            required: true,
            lookup: { targetObject: "SetList", displayField: "Name" },
          },
          {
            name: "Song",
            type: "text",
            required: true,
            lookup: { targetObject: "Song", displayField: "Title" },
          },
          { name: "Position", type: "number", required: true },
        ],
        views: [
          {
            name: "SetListItemInline",
            kind: "list",
            fields: ["Song", "Position"],
            actions: ["read", "update", "delete"],
          },
        ],
      },
      {
        name: "Song",
        displayField: "Title",
        fields: [{ name: "Title", type: "text", required: true }],
        views: [
          {
            name: "SongList",
            kind: "list",
            fields: ["Title"],
            actions: ["create", "read", "update", "delete"],
          },
        ],
      },
    ],
    policies: ["SetList", "SetListItem", "Song"].map((object) => ({
      name: `${object}Policy`,
      object,
      rules: [
        {
          name: `allowAdmins${object}`,
          effect: "allow" as const,
          principal: { match: "specific" as const, roles: ["Admin"] },
          action: "*" as const,
        },
      ],
    })),
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
