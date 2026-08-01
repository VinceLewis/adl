// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import {
  AuthoritySyncClient,
  PolicyDeniedError,
  RuntimeValidationError,
  validateApplicationModel,
} from "../src/index.js";
import type { AuthorityOperationIntent, AuthorityTransport, RuntimeContext } from "../src/index.js";
import {
  bandReferenceSystemContext,
  createBandReferenceModel,
  createBandReferenceRuntime,
  createGiggleBandExampleModel,
  contextForBand,
  seedBandReferenceRuntime,
} from "../src/reference/band-app.js";
import { AdlAppElement } from "../src/ui/components/adl-app.js";
import { defineAdlComponents } from "../src/ui/components/register.js";

describe("band reference app model", () => {
  it("validates the full band-management reference model", () => {
    const model = createBandReferenceModel();
    const syncByObject = new Map(model.sync.map((sync) => [sync.object, sync]));

    expect(validateApplicationModel(model)).toEqual([]);
    expect(model.app.startView).toBe("HomeDashboard");
    expect(model.objects.map((object) => object.name)).toEqual(
      expect.arrayContaining([
        "User",
        "Band",
        "BandMember",
        "BandInvitation",
        "Event",
        "Availability",
        "Song",
        "SetList",
        "SetListItem",
        "StreamingLink",
      ]),
    );
    expect(model.contexts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Band",
          membership: expect.objectContaining({
            object: "BandMember",
            roles: ["BandAdmin", "BandMember"],
          }),
        }),
      ]),
    );
    expect(model.commands?.map((command) => command.name)).toContain("AcceptBandInvitation");
    expect(model.objects.find((object) => object.name === "BandInvitation")?.validations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "respondedAtRequiredAfterResponse" }),
      ]),
    );
    expect(
      model.objects.find((object) => object.name === "SetListItem")?.constraints,
    ).toContainEqual(
      expect.objectContaining({
        name: "orderedSetListItems",
        kind: "ordered",
        parentField: "SetList",
        positionField: "Position",
      }),
    );
    expect(model.objects.find((object) => object.name === "Song")?.constraints).toContainEqual(
      expect.objectContaining({
        name: "uniqueSongTitleInBand",
        kind: "unique",
        scopeFields: ["Band"],
        fields: ["Title"],
      }),
    );
    expect(syncByObject.get("User")).toMatchObject({ mode: "localFirst", scope: "currentUser" });
    expect(syncByObject.get("Event")).toMatchObject({
      mode: "localFirst",
      scope: "currentContext",
    });
    expect(syncByObject.get("Band")).toMatchObject({
      mode: "localFirst",
      scope: "allAvailableContexts",
    });
    expect(syncByObject.get("BandInvitation")).toMatchObject({
      mode: "onlineRequired",
      scope: "currentContext",
    });
    // Band-authored since Phase 56. It was `cacheReadonly` while being offered
    // as ordinary user-entered band data, and both could not be true: no local
    // write and no authority replay may create a `cacheReadonly` record, so
    // nobody using the deployed app could ever populate one.
    expect(syncByObject.get("StreamingLink")).toMatchObject({
      mode: "localFirst",
      scope: "currentContext",
    });
    expect(syncByObject.get("DevicePreference")).toMatchObject({
      mode: "localPrivate",
      scope: "currentUser",
    });
  });

  it("declares the set-list edit surface entirely in ADL", () => {
    const model = createBandReferenceModel();
    const setList = model.objects.find((object) => object.name === "SetList");
    const form = setList?.views.find((view) => view.name === "SetListForm");

    expect(validateApplicationModel(model)).toEqual([]);
    expect(form?.kind).toBe("form");
    expect(form?.editContainer).toBe("page");
    expect(form?.editSections).toEqual([
      {
        name: "Details",
        kind: "fields",
        heading: "Set list",
        fields: ["Name", "Description"],
      },
      {
        name: "Songs",
        kind: "childCollection",
        heading: "Songs",
        childObject: "SetListItem",
        parentField: "SetList",
        childView: "SetListItemList",
        operations: ["createChild", "updateChild", "remove", "reorder"],
        staged: true,
        orderField: "Position",
        emptyState: { text: "No songs in this set list yet." },
        picker: {
          name: "SongPicker",
          // The candidates are Songs, not set-list items: `CANDIDATE_FIELD Song`
          // makes each choice mint a `SetListItem` naming that song. That is why
          // the source is `Song` — for a minting picker the source must be the
          // candidate field's lookup target, not the child object.
          sourceKind: "object",
          source: "Song",
          candidateField: "Song",
          selection: "multiple",
          displayFields: ["Title", "Composer"],
          searchFields: ["Title", "Composer"],
          sort: [{ field: "Title", direction: "asc" }],
          excludeAlreadyLinked: true,
          emptyState: {
            text: "Every song in the library is already in this set list.",
          },
        },
      },
    ]);
    // The standalone list view and its shell nav entry survive this phase: it
    // adds in-place editing rather than replacing the separate surface.
    expect(
      model.objects.find((object) => object.name === "SetListItem")?.views.map((view) => view.name),
    ).toContain("SetListItemList");
    expect(model.shell.nav.items.map((item) => item.view)).toEqual(
      expect.arrayContaining(["SetListList", "SetListForm", "SetListItemList"]),
    );
    // The list that opens the surface has to agree about the container, because
    // the container is chosen by the view that is active when editing starts.
    expect(setList?.views.find((view) => view.name === "SetListList")?.editContainer).toBe("page");
    expect(model.commands?.map((command) => command.name)).toEqual(
      expect.arrayContaining(["AddSongsToSetList", "ReorderSetList"]),
    );
  });

  it("exposes the Giggle Band example as the same ADL model with an example app identity", () => {
    const model = createGiggleBandExampleModel();

    expect(validateApplicationModel(model)).toEqual([]);
    expect(model.app.name).toBe("Giggle Band ADL Example");
    expect(model.app.startView).toBe("HomeDashboard");
    expect(model.objects.map((object) => object.name)).toEqual(
      expect.arrayContaining(["Band", "Event", "Song", "SetList", "SetListItem"]),
    );
  });
});

describe("band reference app runtime", () => {
  /*
   * The acceptance criterion this phase is judged on, against the real reference
   * model rather than a fixture: a view declared entirely in ADL renders a child
   * collection and offers every operation it declared.
   *
   * `createChild` and `linkExisting` are the two that were invisible.
   * `SetListItem` is `SCOPE Band FIELD Band`, so evaluating them with a patch
   * that named only the parent left the policy engine with no context id to
   * resolve `ROLE BandAdmin` against, and the collection's Add and Link controls
   * did not render for a band admin who had been granted exactly that role. The
   * fix seeds the scope value from the caller's own selection, and the staged
   * create seeds the same value so the prediction and the write agree.
   */
  it("offers every declared child operation on the ADL-declared set-list surface", async () => {
    const seeded = await createSeededBandReferenceRuntime();

    const surface = await seeded.runtime.evaluateEditSurface(
      "SetList",
      "SetListForm",
      seeded.firstBandContext,
      { mode: "edit", recordId: seeded.firstSetList.meta.guid },
    );
    const section = surface.sections.find((candidate) => candidate.kind === "childCollection");
    if (section?.kind !== "childCollection") {
      throw new Error("Expected the ADL-declared child collection to be evaluated.");
    }

    expect(section.name).toBe("Songs");
    expect(section.rows.length).toBeGreaterThan(0);
    expect(
      section.actions.map((action) => [action.operation, action.visible, action.enabled]),
      // Row-level operations appear in the collection's action list too, marked
      // invisible: the collection offers Add and Link, and the rows offer the
      // rest. Both are stated so a regression in either direction is caught.
    ).toEqual([
      ["createChild", true, true],
      ["updateChild", false, false],
      ["remove", false, false],
      ["reorder", false, false],
    ]);
    // Every row operation the section declared is offered too, so the collection
    // is editable in place rather than merely listed.
    expect(
      section.rows[0]?.actions.map((action) => [action.operation, action.visible, action.enabled]),
    ).toEqual([
      ["updateChild", true, true],
      ["remove", true, true],
      ["reorder", true, true],
    ]);
  });

  it("stages a child create that carries the selected band scope", async () => {
    const seeded = await createSeededBandReferenceRuntime();

    const applied = await seeded.runtime.applyStagedChildChanges({
      objectName: "SetList",
      viewName: "SetListForm",
      parentRecordId: seeded.firstSetList.meta.guid,
      context: seeded.firstBandContext,
      stagedChanges: [
        {
          id: "staged-1",
          section: "Songs",
          operation: "createChild",
          childObject: "SetListItem",
          // Deliberately no `Band`: the child form never asks for a context the
          // user selected before opening the parent at all. Slow Tide is the one
          // song not already in this set list, so the exclusion guard permits it.
          values: { Song: seeded.fourthSong.meta.guid, Position: 4 },
        },
      ],
    });

    const created = await seeded.runtime.read(
      "SetListItem",
      applied.applied[0]?.recordId ?? "",
      seeded.firstBandContext,
    );
    expect(created?.values.Band).toBe(seeded.firstBand.meta.guid);
    expect(created?.values.SetList).toBe(seeded.firstSetList.meta.guid);
  });

  /*
   * The picker excludes songs already in the set list, but a picker is a *read* a
   * renderer performs. A caller that skips it must be refused too, or the
   * exclusion the model declares is enforced only by the UI — which this
   * repository's rules forbid as the sole enforcement point.
   */
  it("refuses a staged song the set list already holds, and a duplicate within one batch", async () => {
    const seeded = await createSeededBandReferenceRuntime();
    const context: RuntimeContext = { ...seeded.firstBandContext, channel: "ui" };
    const staged = (id: string, song: string) => ({
      id,
      section: "Songs",
      operation: "createChild" as const,
      childObject: "SetListItem",
      values: { Song: song },
    });

    await expect(
      seeded.runtime.applyStagedChildChanges({
        objectName: "SetList",
        viewName: "SetListForm",
        parentRecordId: seeded.firstSetList.meta.guid,
        context,
        // Neon Map is already in this set list.
        stagedChanges: [staged("staged-1", seeded.firstSong.meta.guid)],
      }),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: "ADL_RUNTIME_RELATIONSHIP_PICKER_DUPLICATE" })],
    });

    await expect(
      seeded.runtime.applyStagedChildChanges({
        objectName: "SetList",
        viewName: "SetListForm",
        parentRecordId: seeded.secondSetList.meta.guid,
        context,
        // The same song twice in one batch, neither of them already present.
        stagedChanges: [
          staged("staged-1", seeded.firstSong.meta.guid),
          staged("staged-2", seeded.firstSong.meta.guid),
        ],
      }),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: "ADL_RUNTIME_RELATIONSHIP_PICKER_DUPLICATE" })],
    });

    // Refused before anything was written, as every staged-batch refusal is.
    const items = await seeded.runtime.executeReadModel("SetListItemsByPosition", context);
    expect(
      items.rows.filter((row) => row.values.SetListName === "Rehearsal running order"),
    ).toHaveLength(1);
  });

  it("resolves one user as Admin in one band and Member in another", async () => {
    const seeded = await createSeededBandReferenceRuntime();

    const available = await seeded.runtime.listAvailableContexts("Band", seeded.musicianContext);

    expect(
      available.map((context) => ({
        label: context.label,
        roles: context.roles,
      })),
    ).toEqual([
      { label: "The Alphas", roles: ["BandAdmin"] },
      { label: "The Betas", roles: ["BandMember"] },
    ]);
    expect(seeded.firstBandContext.roles).toEqual([]);
    expect(seeded.firstBandContext.contextRoles).toEqual([
      expect.objectContaining({
        context: "Band",
        contextId: seeded.firstBand.meta.guid,
        role: "BandAdmin",
      }),
    ]);
  });

  it("filters band-scoped records and denies Admin-only operations to Members", async () => {
    const seeded = await createSeededBandReferenceRuntime();

    const firstBandEvents = await seeded.runtime.search(
      "Event",
      undefined,
      seeded.firstBandContext,
    );
    expect(firstBandEvents.map((record) => record.values.Title)).toEqual(["Canal Street headline"]);

    await expect(
      seeded.runtime.read("Event", seeded.secondEvent.meta.guid, seeded.firstBandContext),
    ).rejects.toMatchObject({
      decision: {
        reasons: [
          expect.objectContaining({
            policyName: "EventContextScope",
            ruleName: "requireRuntimeContextScope",
          }),
        ],
      },
    });

    const updated = await seeded.runtime.update(
      "Event",
      seeded.firstEvent.meta.guid,
      { VenueName: "Updated Alpha Hall" },
      seeded.firstBandContext,
    );
    expect(updated.values.VenueName).toBe("Updated Alpha Hall");

    await expect(
      seeded.runtime.update(
        "Event",
        seeded.secondEvent.meta.guid,
        { VenueName: "Member edit should fail" },
        seeded.secondBandContext,
      ),
    ).rejects.toBeInstanceOf(PolicyDeniedError);

    await expect(
      seeded.runtime.create(
        "BandInvitation",
        {
          Band: seeded.secondBand.meta.guid,
          Inviter: seeded.musician.meta.guid,
          InviteeEmail: "new-member@example.com",
          SentAt: "2026-07-08",
        },
        seeded.secondBandContext,
      ),
    ).rejects.toBeInstanceOf(PolicyDeniedError);
  });

  it("executes cross-band event dashboards and current-band set-list read models", async () => {
    const seeded = await createSeededBandReferenceRuntime();

    const home = await seeded.runtime.executeReadModel("HomeUpcomingEvents", {
      ...seeded.musicianContext,
      selectedContexts: { Band: seeded.firstBand.meta.guid },
    });
    expect(home.rows.map((row) => row.values)).toEqual([
      expect.objectContaining({
        EventDate: "2026-08-01",
        StartTime: "20:00",
        EventType: "Gig",
        Title: "Canal Street headline",
        VenueName: "Alpha Hall",
      }),
      expect.objectContaining({
        EventDate: "2026-08-02",
        StartTime: "18:30",
        EventType: "Rehearsal",
        Title: "New set rehearsal",
        VenueName: "Beta Rooms",
      }),
      expect.objectContaining({
        EventDate: "2026-08-03",
        EventType: "Unavailable",
        Title: "Unavailable - session prep",
      }),
    ]);
    expect(home.rows[2]?.sources).toEqual({
      availability: {
        objectName: "Availability",
        recordId: seeded.availability.meta.guid,
      },
    });

    const calendar = await seeded.runtime.executeReadModel(
      "CalendarPlanningItems",
      seeded.firstBandContext,
    );
    expect(calendar.rows.map((row) => row.values)).toEqual([
      expect.objectContaining({
        Date: "2026-08-01",
        StartTime: "20:00",
        CalendarStatus: "Gig",
        Title: "Canal Street headline",
        VenueName: "Alpha Hall",
      }),
      expect.objectContaining({
        Date: "2026-08-03",
        CalendarStatus: "Unavailable",
        Title: "Unavailable - session prep",
      }),
    ]);
    expect(calendar.rows[1]?.sources).toEqual({
      availability: {
        objectName: "Availability",
        recordId: seeded.availability.meta.guid,
      },
    });

    const setList = await seeded.runtime.executeReadModel(
      "SetListItemsByPosition",
      seeded.firstBandContext,
    );
    expect(setList.rows.map((row) => row.values)).toEqual(
      expect.arrayContaining([
        {
          Position: 1,
          SetListName: "August headline",
          SongTitle: "Neon Map",
          DurationSeconds: 214,
        },
        {
          Position: 2,
          SetListName: "August headline",
          SongTitle: "Late Signal",
          DurationSeconds: 188,
        },
        {
          Position: 3,
          SetListName: "August headline",
          SongTitle: "Harbour Lights",
          DurationSeconds: 236,
        },
        {
          Position: 1,
          SetListName: "Rehearsal running order",
          SongTitle: "Slow Tide",
          DurationSeconds: 245,
        },
      ]),
    );
    expect(setList.rows.map((row) => row.values.Position)).toEqual([1, 1, 2, 3]);
  });

  it("evaluates offline datasets for selected-band and cross-band views", async () => {
    const seeded = await createSeededBandReferenceRuntime();
    const selectedBaseContext: RuntimeContext = {
      ...seeded.musicianContext,
      selectedContexts: { Band: seeded.firstBand.meta.guid },
    };

    const dataset = await seeded.runtime.evaluateOfflineDataset(selectedBaseContext);
    const eventRecords = dataset.records.filter((record) => record.objectName === "Event");
    const invitationRecords = dataset.records.filter(
      (record) => record.objectName === "BandInvitation",
    );
    const availabilitySearch = await seeded.runtime.searchLocalDataset(
      "Availability",
      undefined,
      seeded.musicianContext,
    );
    const eventSearch = await seeded.runtime.searchLocalDataset(
      "Event",
      undefined,
      selectedBaseContext,
    );

    expect(new Set(eventRecords.map((record) => record.recordId))).toEqual(
      new Set([seeded.firstEvent.meta.guid, seeded.secondEvent.meta.guid]),
    );
    expect(
      eventRecords.find((record) => record.recordId === seeded.firstEvent.meta.guid)?.reasons,
    ).toEqual(
      expect.arrayContaining([
        { kind: "objectSync", mode: "localFirst", scope: "currentContext" },
        {
          kind: "readModelSource",
          readModel: "HomeUpcomingEvents",
          source: "event",
          sourceScope: "allAvailableContexts",
          mode: "localFirst",
        },
      ]),
    );
    expect(invitationRecords).toEqual([]);
    expect(eventSearch.map((record) => record.meta.guid)).toEqual([
      seeded.firstEvent.meta.guid,
      seeded.secondEvent.meta.guid,
    ]);
    expect(availabilitySearch.map((record) => record.meta.guid)).toEqual([
      seeded.availability.meta.guid,
    ]);
  });

  it("requires availability self-service writes to target the runtime user", async () => {
    const seeded = await createSeededBandReferenceRuntime();
    const guestContext: RuntimeContext = {
      ...seeded.musicianContext,
      userId: seeded.guest.meta.guid,
    };

    await expect(
      seeded.runtime.create(
        "Availability",
        {
          User: seeded.guest.meta.guid,
          Date: "2026-08-04",
          Status: "Available",
        },
        guestContext,
      ),
    ).resolves.toMatchObject({
      values: {
        User: seeded.guest.meta.guid,
      },
    });

    await expect(
      seeded.runtime.create(
        "Availability",
        {
          User: seeded.guest.meta.guid,
          Date: "2026-08-05",
          Status: "Available",
        },
        seeded.musicianContext,
      ),
    ).rejects.toBeInstanceOf(PolicyDeniedError);

    await expect(
      seeded.runtime.update(
        "Availability",
        seeded.availability.meta.guid,
        { User: seeded.guest.meta.guid },
        seeded.musicianContext,
      ),
    ).rejects.toBeInstanceOf(PolicyDeniedError);

    await expect(
      seeded.runtime.read("Availability", seeded.availability.meta.guid, guestContext),
    ).rejects.toBeInstanceOf(PolicyDeniedError);
  });

  it("accepts invitations with a generic transaction command", async () => {
    const seeded = await createSeededBandReferenceRuntime();
    const pendingInvitation = await createPendingInvitation(seeded);
    const inviteeContext: RuntimeContext = {
      userId: seeded.guest.meta.guid,
      roles: [],
      channel: "api",
      now: new Date("2026-07-08T10:00:00.000Z"),
      selectedContexts: { Band: seeded.firstBand.meta.guid },
    };

    await expect(
      seeded.runtime.create(
        "BandMember",
        {
          User: seeded.guest.meta.guid,
          Band: seeded.firstBand.meta.guid,
          Role: "BandMember",
        },
        inviteeContext,
      ),
    ).rejects.toBeInstanceOf(PolicyDeniedError);

    const result = await seeded.runtime.executeCommand(
      "AcceptBandInvitation",
      { Invitation: pendingInvitation.meta.guid },
      inviteeContext,
    );

    expect(result.steps.map((step) => [step.step, step.objectName])).toEqual([
      ["acceptInvitation", "BandInvitation"],
      ["createMembership", "BandMember"],
    ]);
    expect(result.steps[0]?.record.values).toMatchObject({
      Status: "Accepted",
      RespondedAt: "2026-07-08",
    });
    expect(result.steps[1]?.record.values).toMatchObject({
      User: seeded.guest.meta.guid,
      Band: seeded.firstBand.meta.guid,
      Role: "BandMember",
      JoinedAt: "2026-07-08",
    });
  });

  it("delivers a band invitation to the authority instead of stranding it on the device", async () => {
    const seeded = await createSeededBandReferenceRuntime();
    const bandContext = contextForBand(bandReferenceSystemContext, seeded.firstBand.meta.guid);
    const invitation = await createPendingInvitation(seeded);

    // `BandInvitation` is the reference app's only online-required object. This
    // write used to be validated, policy-checked, persisted and written to the
    // operation log, and then never sent to anyone.
    const queued = seeded.runtime.syncQueue
      .getEntries()
      .filter((entry) => entry.operation.object === "BandInvitation");
    expect(queued.map((entry) => entry.operation.recordId)).toContain(invitation.meta.guid);

    const sent: AuthorityOperationIntent[] = [];
    const transport: AuthorityTransport = {
      async replay(_sessionToken, intent) {
        sent.push(intent);
        return { status: "accepted", operationId: intent.operationId, records: [] };
      },
      async bootstrap() {
        return { records: [] };
      },
    };

    const outcomes = await new AuthoritySyncClient(seeded.runtime, transport).deliverPending(
      undefined,
      bandContext,
    );

    expect(outcomes.every((outcome) => outcome.status === "accepted")).toBe(true);
    // Only invitations go now. The seeded local-first work is allowed to wait
    // for the next reconcile, which is that mode's contract.
    expect(
      new Set(
        sent.map((intent) =>
          intent.kind === "command" || intent.kind === "batch" ? "" : intent.objectName,
        ),
      ),
    ).toEqual(new Set(["BandInvitation"]));
    expect(sent).toContainEqual(
      expect.objectContaining({
        kind: "create",
        objectName: "BandInvitation",
        recordId: invitation.meta.guid,
      }),
    );
    expect(
      seeded.runtime.syncQueue
        .getEntries()
        .filter((entry) => entry.operation.object === "BandInvitation"),
    ).toEqual([]);
  });

  it("keeps invitation acceptance atomic when membership creation violates uniqueness", async () => {
    const seeded = await createSeededBandReferenceRuntime();
    const pendingInvitation = await createPendingInvitation(seeded);
    const inviteeContext: RuntimeContext = {
      userId: seeded.guest.meta.guid,
      roles: [],
      channel: "api",
      now: new Date("2026-07-08T10:00:00.000Z"),
      selectedContexts: { Band: seeded.firstBand.meta.guid },
    };

    await seeded.runtime.executeCommand(
      "AcceptBandInvitation",
      { Invitation: pendingInvitation.meta.guid },
      inviteeContext,
    );
    const secondInvitation = await seeded.runtime.create(
      "BandInvitation",
      {
        Band: seeded.firstBand.meta.guid,
        Inviter: seeded.musician.meta.guid,
        Invitee: seeded.guest.meta.guid,
        InviteeEmail: "riley.alt@example.com",
        SentAt: "2026-07-08",
      },
      contextForBand(bandReferenceSystemContext, seeded.firstBand.meta.guid),
    );

    await expect(
      seeded.runtime.executeCommand(
        "AcceptBandInvitation",
        { Invitation: secondInvitation.meta.guid },
        inviteeContext,
      ),
    ).rejects.toMatchObject({
      issues: [
        expect.objectContaining({
          code: "ADL_RUNTIME_CONSTRAINT_UNIQUE",
          field: "User",
        }),
      ],
    });

    await expect(
      seeded.runtime.objectStore.getRecordForRuntime("BandInvitation", secondInvitation.meta.guid),
    ).resolves.toMatchObject({
      values: {
        Status: "Pending",
      },
    });
  });

  it("edits set-list items in place through the ADL-declared child collection", async () => {
    const seeded = await createSeededBandReferenceRuntime();
    const context: RuntimeContext = { ...seeded.firstBandContext, channel: "ui" };

    const surface = await seeded.runtime.evaluateEditSurface("SetList", "SetListForm", context, {
      mode: "edit",
      recordId: seeded.firstSetList.meta.guid,
    });
    const songs = surface.sections.find((section) => section.name === "Songs");
    if (songs?.kind !== "childCollection") {
      throw new Error("SetListForm must declare a 'Songs' child collection.");
    }

    expect(songs.childObject).toBe("SetListItem");
    expect(songs.parentField).toBe("SetList");
    expect(songs.orderField).toBe("Position");
    // `CHILD_VIEW SetListItemList` chooses the child columns, and the parent
    // field is never one of them.
    expect(songs.fields.map((field) => field.name)).toEqual(["Position", "Song", "Notes"]);
    expect(songs.rows.map((row) => row.values.Position)).toEqual([1, 2, 3]);
    expect(
      songs.rows.map((row) =>
        row.actions.filter((action) => action.visible).map((a) => a.operation),
      ),
    ).toEqual([
      ["updateChild", "remove", "reorder"],
      ["updateChild", "remove", "reorder"],
      ["updateChild", "remove", "reorder"],
    ]);

    const thirdRow = songs.rows[2];
    expect(thirdRow).toBeDefined();

    // One staged batch: the last song moves to the top, and the ORDERED
    // constraint's `REORDER shift` moves the two it displaced.
    await seeded.runtime.applyStagedChildChanges({
      objectName: "SetList",
      viewName: "SetListForm",
      parentRecordId: seeded.firstSetList.meta.guid,
      context,
      stagedChanges: [
        {
          id: "staged-reorder-1",
          section: "Songs",
          operation: "reorder",
          childObject: "SetListItem",
          childId: thirdRow?.id ?? "",
          position: 1,
        },
      ],
    });

    const reordered = await seeded.runtime.executeReadModel(
      "SetListItemsByPosition",
      seeded.firstBandContext,
    );
    expect(
      reordered.rows
        .filter((row) => row.values.SetListName === "August headline")
        .map((row) => [row.values.Position, row.values.SongTitle]),
    ).toEqual([
      [1, "Harbour Lights"],
      [2, "Neon Map"],
      [3, "Late Signal"],
    ]);
  });

  /*
   * What a person actually does: open a set list, press Add, and choose songs.
   * The picker offers songs — not set-list items — and never offers one that is
   * already in this set list.
   */
  it("offers only songs that are not already in the set list", async () => {
    const seeded = await createSeededBandReferenceRuntime();
    const context: RuntimeContext = { ...seeded.firstBandContext, channel: "ui" };

    const picker = await seeded.runtime.evaluateRelationshipPicker({
      objectName: "SetList",
      viewName: "SetListForm",
      sectionName: "Songs",
      context,
      recordId: seeded.firstSetList.meta.guid,
    });

    expect(picker.picker.sourceKind).toBe("object");
    expect(picker.picker.source).toBe("Song");
    expect(picker.picker.candidateField).toBe("Song");
    expect(picker.picker.selection).toBe("multiple");
    // Neon Map, Late Signal and Harbour Lights are already in this set list;
    // `EXCLUDE_LINKED` compares the *songs* the existing items name, not the
    // items' own ids, so exactly the remaining library is offered.
    expect(picker.candidates.map((candidate) => candidate.values.Title)).toEqual(["Slow Tide"]);
    expect(picker.candidates.every((candidate) => !candidate.alreadyLinked)).toBe(true);
    expect(picker.diagnostics).toEqual([]);
  });

  it("adds chosen songs to the end of the set list in one transaction", async () => {
    const seeded = await createSeededBandReferenceRuntime();
    const context: RuntimeContext = { ...seeded.firstBandContext, channel: "ui" };

    // Exactly what the browser stages when two candidates are ticked: a create
    // per song, carrying the song and nothing else. No position is supplied —
    // appending is the platform's job, not the caller's.
    await seeded.runtime.applyStagedChildChanges({
      objectName: "SetList",
      viewName: "SetListForm",
      // The other set list, which holds one song, so there are candidates to add.
      parentRecordId: seeded.secondSetList.meta.guid,
      context,
      stagedChanges: [
        {
          id: "staged-1",
          section: "Songs",
          operation: "createChild",
          childObject: "SetListItem",
          values: { Song: seeded.thirdSong.meta.guid },
        },
        {
          id: "staged-2",
          section: "Songs",
          operation: "createChild",
          childObject: "SetListItem",
          values: { Song: seeded.firstSong.meta.guid },
        },
      ],
    });

    const items = await seeded.runtime.executeReadModel("SetListItemsByPosition", context);
    expect(
      items.rows
        .filter((row) => row.values.SetListName === "Rehearsal running order")
        .map((row) => [row.values.Position, row.values.SongTitle]),
    ).toEqual([
      [1, "Slow Tide"],
      // Appended after the existing song, and after each other, in the order
      // they were chosen — ready to be reordered.
      [2, "Harbour Lights"],
      [3, "Neon Map"],
    ]);
  });

  it("enforces scoped uniqueness and ordered set-list positions", async () => {
    const seeded = await createSeededBandReferenceRuntime();

    await expect(
      seeded.runtime.create(
        "SetListItem",
        {
          Band: seeded.firstBand.meta.guid,
          SetList: seeded.firstSetList.meta.guid,
          Song: seeded.firstSong.meta.guid,
          Position: 0,
        },
        seeded.firstBandContext,
      ),
    ).rejects.toMatchObject({
      issues: [
        expect.objectContaining({
          code: "ADL_RUNTIME_FIELD_VALIDATOR",
          field: "Position",
        }),
      ],
    });
    // The set list declares `REORDER shift`, so landing on an occupied position
    // is a reorder rather than an error: the new item takes position 2 and the
    // sibling that held it moves along. `strict` still refuses a duplicate —
    // proven in `tests/ordered-collections.test.ts`, which exercises both modes.
    const displaced = await seeded.runtime.search(
      "SetListItem",
      undefined,
      seeded.firstBandContext,
    );
    const previouslySecond = displaced.find((item) => item.values.Position === 2);
    expect(previouslySecond).toBeDefined();

    const inserted = await seeded.runtime.create(
      "SetListItem",
      {
        Band: seeded.firstBand.meta.guid,
        SetList: seeded.firstSetList.meta.guid,
        Song: seeded.firstSong.meta.guid,
        Position: 2,
      },
      seeded.firstBandContext,
    );
    expect(inserted.values.Position).toBe(2);

    const afterInsert = await seeded.runtime.read(
      "SetListItem",
      previouslySecond?.meta.guid ?? "",
      seeded.firstBandContext,
    );
    expect(afterInsert?.values.Position).toBe(3);
    await expect(
      seeded.runtime.create(
        "Song",
        {
          Band: seeded.firstBand.meta.guid,
          Title: "Neon Map",
        },
        seeded.firstBandContext,
      ),
    ).rejects.toMatchObject({
      issues: [
        expect.objectContaining({
          code: "ADL_RUNTIME_CONSTRAINT_UNIQUE",
          field: "Title",
        }),
      ],
    });
    await expect(
      seeded.runtime.create(
        "SetList",
        {
          Band: seeded.firstBand.meta.guid,
          Name: "August headline",
        },
        seeded.firstBandContext,
      ),
    ).rejects.toBeInstanceOf(RuntimeValidationError);
  });
});

describe("band reference browser demo", () => {
  beforeEach(() => {
    defineAdlComponents();
    document.body.innerHTML = "";
    globalThis.localStorage?.clear();
    globalThis.sessionStorage?.clear();
    globalThis.history.replaceState({}, "", "/");
  });

  it("renders the cross-band home dashboard with generic ADL components", async () => {
    const seeded = await createSeededBandReferenceRuntime();
    const app = document.createElement("adl-app") as AdlAppElement;
    app.model = seeded.model;
    app.runtime = seeded.runtime;
    app.context = {
      ...seeded.musicianContext,
      channel: "ui",
    };

    document.body.append(app);
    await app.whenReady();
    await flushUi();

    expect(app.textContent).toContain("Giggle Band ADL Example");
    expect(app.querySelector("adl-composed-view")).not.toBeNull();
    expect(app.querySelector("[data-presentation-section='Schedule']")).not.toBeNull();
    expect(app.textContent).toContain("Canal Street headline");
    expect(app.textContent).toContain("New set rehearsal");
    expect(app.textContent).toContain("Unavailable - session prep");
    expect(app.textContent).toContain("No pending invitations");
    expect(app.textContent).toContain("The Alphas");
    expect(app.textContent).toContain("The Betas");
  });

  it("renders lookup choices for set-list item creation in the generic browser form", async () => {
    const seeded = await createSeededBandReferenceRuntime();
    const thirdSong = await seeded.runtime.create(
      "Song",
      {
        Band: seeded.firstBand.meta.guid,
        Title: "Glass Arcade",
        Composer: "The Alphas",
        DurationSeconds: 201,
      },
      seeded.firstBandContext,
    );
    const thirdItem = await seeded.runtime.create(
      "SetListItem",
      {
        Band: seeded.firstBand.meta.guid,
        SetList: seeded.firstSetList.meta.guid,
        Song: thirdSong.meta.guid,
        Position: 3,
      },
      seeded.firstBandContext,
    );
    const app = document.createElement("adl-app") as AdlAppElement;
    app.model = seeded.model;
    app.runtime = seeded.runtime;
    app.context = {
      ...seeded.firstBandContext,
      channel: "ui",
    };

    document.body.append(app);
    await app.whenReady();
    await flushUi();

    navigateWithDrawer(app, "SetListItemList");
    await flushUi();
    await waitForText(app, "Glass Arcade");

    // The standalone list survives Phase 59: adding the in-place child
    // collection to `SetListForm` does not remove the separate surface, and
    // both edit the same records.
    const rows = [...app.querySelectorAll("adl-list-view tbody tr")];
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.textContent?.replace(/\s+/g, " ").trim())).toEqual([
      expect.stringContaining("Neon Map"),
      expect.stringContaining("Slow Tide"),
      expect.stringContaining("Late Signal"),
      expect.stringContaining("Glass Arcade"),
      expect.stringContaining("Harbour Lights"),
    ]);
    expect(app.textContent).toContain("August headline");
    expect(app.textContent).not.toContain(seeded.firstSong.meta.guid);
    expect(app.textContent).not.toContain(seeded.firstSetList.meta.guid);
    expect(app.textContent).not.toContain(thirdItem.values.Song);

    requireElement<HTMLButtonElement>(app, "[data-list-action='new']").click();
    await flushUi();
    await flushUi();

    const setList = requireElement<HTMLSelectElement>(
      app,
      "adl-field-renderer[data-field-name='SetList'] select",
    );
    const song = requireElement<HTMLSelectElement>(
      app,
      "adl-field-renderer[data-field-name='Song'] select",
    );

    expect([...setList.options].map((option) => option.textContent?.trim())).toContain(
      "August headline",
    );
    expect([...song.options].map((option) => option.textContent?.trim())).toEqual(
      expect.arrayContaining(["Neon Map", "Late Signal"]),
    );
  });

  it("renders the set list's songs inside the set-list edit surface", async () => {
    const seeded = await createSeededBandReferenceRuntime();
    const app = document.createElement("adl-app") as AdlAppElement;
    app.model = seeded.model;
    app.runtime = seeded.runtime;
    app.context = {
      ...seeded.firstBandContext,
      channel: "ui",
    };

    document.body.append(app);
    await app.whenReady();
    await flushUi();

    // The shell nav entry this phase added is how the surface is reached: it
    // lists the band's set lists, and opening one shows the set list with its
    // songs edited in place.
    navigateWithDrawer(app, "SetListForm");
    await flushUi();
    await waitForText(app, "August headline");
    expect(app.textContent).toContain("Rehearsal running order");

    requireElement<HTMLTableRowElement>(
      app,
      `tr[data-record-id='${seeded.firstSetList.meta.guid}']`,
    ).click();
    await flushUi();
    await flushUi();

    // `EDIT_CONTAINER page` puts the parent-with-children surface on the page
    // rather than in the default modal.
    expect(app.querySelector("[data-edit-container='page']")).not.toBeNull();

    const section = requireElement<HTMLElement>(app, "[data-child-section='Songs']");
    expect(section.querySelector("h3")?.textContent?.trim()).toBe("Songs");

    const items = (
      await seeded.runtime.search("SetListItem", undefined, seeded.firstBandContext)
    ).filter((item) => item.values.SetList === seeded.firstSetList.meta.guid);
    const rows = [...section.querySelectorAll("[data-child-row]")];

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.getAttribute("data-child-row-position"))).toEqual(["1", "2", "3"]);
    expect(rows.map((row) => row.getAttribute("data-child-id"))).toEqual(
      [1, 2, 3].map(
        (position) => items.find((item) => item.values.Position === position)?.meta.guid,
      ),
    );
    // Reorder is declared on the collection and the ORDERED constraint backs
    // it, so every row offers the move controls.
    expect(section.querySelectorAll("button[data-child-reorder]")).toHaveLength(6);
    expect(section.textContent).not.toContain("No songs in this set list yet.");
    expect(section.textContent).not.toContain(seeded.firstSetList.meta.guid);
  });

  it("renders event records as plain save/delete forms without lifecycle actions", async () => {
    const seeded = await createSeededBandReferenceRuntime();
    const app = document.createElement("adl-app") as AdlAppElement;
    app.model = seeded.model;
    app.runtime = seeded.runtime;
    app.context = {
      ...seeded.firstBandContext,
      channel: "ui",
    };

    document.body.append(app);
    await app.whenReady();
    await flushUi();

    navigateWithDrawer(app, "BandEventList");
    await flushUi();
    await waitForText(app, "Canal Street headline");

    requireElement<HTMLTableRowElement>(app, "tr[data-record-id]").click();
    await flushUi();

    const actionLabels = [...app.querySelectorAll("adl-action-bar button")].map((button) =>
      button.textContent?.trim(),
    );

    expect(actionLabels).toEqual(["Save", "Delete", "Cancel"]);
    expect(app.querySelector("adl-field-renderer[data-field-name='Status']")).toBeNull();
    expect(app.querySelector("button[data-action-kind='lifecycle']")).toBeNull();
    expect(
      requireElement<HTMLButtonElement>(
        app,
        "button[data-action-name='cancel'][data-action-kind='command']",
      ).textContent?.trim(),
    ).toBe("Cancel");
  });

  it("keeps new event draft values and shows inline validation after save", async () => {
    const seeded = await createSeededBandReferenceRuntime();
    const app = document.createElement("adl-app") as AdlAppElement;
    app.model = seeded.model;
    app.runtime = seeded.runtime;
    app.context = {
      ...seeded.firstBandContext,
      channel: "ui",
    };

    document.body.append(app);
    await app.whenReady();
    await flushUi();

    navigateWithDrawer(app, "BandEventList");
    await flushUi();

    requireElement<HTMLButtonElement>(app, "[data-list-action='new']").click();
    await flushUi();

    expect(
      requireElement<HTMLLabelElement>(
        app,
        "adl-field-renderer[data-field-name='Title'] label",
      ).textContent?.trim(),
    ).toBe("Title *");
    expect(
      requireElement<HTMLLabelElement>(
        app,
        "adl-field-renderer[data-field-name='EventType'] label",
      ).textContent?.trim(),
    ).toBe("Event Type");
    expect(
      requireElement<HTMLElement>(app, "adl-field-renderer[data-field-name='Title']").textContent,
    ).not.toContain("Required");
    expect(requireElement<HTMLButtonElement>(app, "button[data-action-name='save']").disabled).toBe(
      false,
    );

    const eventType = requireElement<HTMLSelectElement>(
      app,
      "adl-field-renderer[data-field-name='EventType'] select",
    );
    const date = requireElement<HTMLInputElement>(
      app,
      "adl-field-renderer[data-field-name='Date'] input",
    );
    const venue = requireElement<HTMLInputElement>(
      app,
      "adl-field-renderer[data-field-name='VenueName'] input",
    );

    eventType.value = "Rehearsal";
    eventType.dispatchEvent(new Event("change", { bubbles: true }));
    date.value = "2026-09-03";
    date.dispatchEvent(new Event("input", { bubbles: true }));
    venue.value = "Practice Room";
    venue.dispatchEvent(new Event("input", { bubbles: true }));
    await flushUi();

    const save = requireElement<HTMLButtonElement>(app, "button[data-action-name='save']");
    expect(save.disabled).toBe(false);
    save.click();
    await flushUi();

    expect(app.textContent).toContain("Record for object 'Event' is invalid.");
    expect(
      requireElement<HTMLElement>(app, "adl-field-renderer[data-field-name='Title']").textContent,
    ).toContain("Field 'Title' is required on object 'Event'.");
    expect(
      requireElement<HTMLSelectElement>(
        app,
        "adl-field-renderer[data-field-name='EventType'] select",
      ).value,
    ).toBe("Rehearsal");
    expect(
      requireElement<HTMLInputElement>(app, "adl-field-renderer[data-field-name='Date'] input")
        .value,
    ).toBe("2026-09-03");
    expect(
      requireElement<HTMLInputElement>(app, "adl-field-renderer[data-field-name='VenueName'] input")
        .value,
    ).toBe("Practice Room");

    const title = requireElement<HTMLInputElement>(
      app,
      "adl-field-renderer[data-field-name='Title'] input",
    );
    title.value = "Wednesday rehearsal";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    await flushUi();

    requireElement<HTMLButtonElement>(app, "button[data-action-name='save']").click();
    await flushUi();

    expect(app.textContent).toContain("Event created.");
    await waitForText(app, "Wednesday rehearsal");
  });

  it("renders finite IN validators as select controls in generic forms", async () => {
    const seeded = await createSeededBandReferenceRuntime();
    const app = document.createElement("adl-app") as AdlAppElement;
    app.model = seeded.model;
    app.runtime = seeded.runtime;
    app.context = {
      ...seeded.firstBandContext,
      channel: "ui",
    };

    document.body.append(app);
    await app.whenReady();
    await flushUi();

    navigateWithDrawer(app, "BandInvitationList");
    await flushUi();

    requireElement<HTMLButtonElement>(app, "[data-list-action='new']").click();
    await flushUi();
    await flushUi();

    const role = requireElement<HTMLSelectElement>(
      app,
      "adl-field-renderer[data-field-name='Role'] select",
    );
    const status = requireElement<HTMLSelectElement>(
      app,
      "adl-field-renderer[data-field-name='Status'] select",
    );

    expect([...role.options].map((option) => option.value)).toEqual(["", "BandMember"]);
    expect([...status.options].map((option) => option.value)).toEqual([
      "",
      "Pending",
      "Accepted",
      "Declined",
    ]);
  });
});

async function createSeededBandReferenceRuntime() {
  const runtime = createBandReferenceRuntime();
  return seedBandReferenceRuntime(runtime);
}

async function createPendingInvitation(
  seeded: Awaited<ReturnType<typeof createSeededBandReferenceRuntime>>,
) {
  return seeded.runtime.create(
    "BandInvitation",
    {
      Band: seeded.firstBand.meta.guid,
      Inviter: seeded.musician.meta.guid,
      Invitee: seeded.guest.meta.guid,
      InviteeEmail: "riley.pending@example.com",
      SentAt: "2026-07-08",
    },
    contextForBand(bandReferenceSystemContext, seeded.firstBand.meta.guid),
  );
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

function navigateWithDrawer(root: ParentNode, viewName: string): void {
  requireElement<HTMLButtonElement>(root, "button[data-shell-menu='true']").click();
  requireElement<HTMLButtonElement>(root, `button[data-view-nav='${viewName}']`).click();
}
