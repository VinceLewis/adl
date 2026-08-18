// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
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
    // The event history grows without bound, so it declares how much of itself a
    // device keeps. The window is authored in `domain.adl`, not defaulted —
    // before Phase 62 a `.adl` file could not say this at all, and `recent`
    // meant a hard-coded 30 days over `_updatedAt`.
    //
    // Phase 64 returned the *context* half to `currentContext`. Phase 62 had
    // widened it to `recent` for one reason only: a window was refused on any
    // other scope, so the bound could be had only by paying for it in context.
    // Nothing about this model ever wanted every available band's events held by
    // the object's own scope, and `HomeUpcomingEvents` already asks for the
    // cross-band ones by the route that means it.
    expect(syncByObject.get("Event")).toMatchObject({
      mode: "localFirst",
      scope: "currentContext",
      window: { field: "Date", days: 90, limit: 200 },
    });
    // The object that actually needed a bound and could not have one: one record
    // per user per date, growing for as long as the user keeps using the app.
    expect(syncByObject.get("Availability")).toMatchObject({
      mode: "localFirst",
      scope: "currentUser",
      window: { field: "Date", days: 90, limit: 400 },
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

  it("declares the last-admin-standing guard on BandMember's BandAdmin role", () => {
    const model = createBandReferenceModel();

    expect(
      model.objects.find((object) => object.name === "BandMember")?.constraints,
    ).toContainEqual(
      expect.objectContaining({
        name: "lastBandAdminStanding",
        kind: "protectedRole",
        scopeFields: ["Band"],
        roleField: "Role",
        roleValues: ["BandAdmin"],
        minCount: 1,
      }),
    );
  });
});

/**
 * Real-world motivation: a sibling app (giggle-new, a band-management app
 * built on this platform's ideas) enforced "don't remove the last admin"
 * client-side only, which is exactly the defect the platform boundary in
 * `AGENTS.md` exists to prevent. These tests prove the guard on the actual
 * Giggle Band reference model — direct CRUD, not a UI affordance — using the
 * real `BandMemberPolicy` rules that let a `BandAdmin` update or delete a
 * fellow member.
 */
describe("band reference app last-admin-standing guard", () => {
  it("refuses deleting a band's sole BandAdmin", async () => {
    const seeded = await createSeededBandReferenceRuntime();
    const bandContext = contextForBand(bandReferenceSystemContext, seeded.firstBand.meta.guid);
    const members = await seeded.runtime.search("BandMember", {}, bandContext);
    const founderMembership = members.find(
      (record) => record.values.User === seeded.musician.meta.guid,
    );
    if (founderMembership === undefined) {
      throw new Error("Expected the seeded founder BandMember record.");
    }
    expect(founderMembership.values.Role).toBe("BandAdmin");

    await expect(
      seeded.runtime.delete("BandMember", founderMembership.meta.guid, bandContext),
    ).rejects.toMatchObject({
      name: "RuntimeValidationError",
      issues: [expect.objectContaining({ code: "ADL_RUNTIME_CONSTRAINT_PROTECTED_ROLE" })],
    });
  });

  it("refuses demoting a band's sole BandAdmin to BandMember", async () => {
    const seeded = await createSeededBandReferenceRuntime();
    const bandContext = contextForBand(bandReferenceSystemContext, seeded.firstBand.meta.guid);
    const members = await seeded.runtime.search("BandMember", {}, bandContext);
    const founderMembership = members.find(
      (record) => record.values.User === seeded.musician.meta.guid,
    );
    if (founderMembership === undefined) {
      throw new Error("Expected the seeded founder BandMember record.");
    }

    await expect(
      seeded.runtime.update(
        "BandMember",
        founderMembership.meta.guid,
        { Role: "BandMember" },
        bandContext,
      ),
    ).rejects.toBeInstanceOf(RuntimeValidationError);
  });

  it("allows removing a BandAdmin once another BandAdmin exists for the same band", async () => {
    const seeded = await createSeededBandReferenceRuntime();
    const bandContext = contextForBand(bandReferenceSystemContext, seeded.firstBand.meta.guid);
    const members = await seeded.runtime.search("BandMember", {}, bandContext);
    const founderMembership = members.find(
      (record) => record.values.User === seeded.musician.meta.guid,
    );
    if (founderMembership === undefined) {
      throw new Error("Expected the seeded founder BandMember record.");
    }

    const secondAdmin = await seeded.runtime.create(
      "BandMember",
      { User: seeded.guest.meta.guid, Band: seeded.firstBand.meta.guid, Role: "BandAdmin" },
      bandContext,
    );

    await expect(
      seeded.runtime.delete("BandMember", founderMembership.meta.guid, bandContext),
    ).resolves.toBeDefined();

    const remaining = await seeded.runtime.read("BandMember", secondAdmin.meta.guid, bandContext);
    expect(remaining?.values.Role).toBe("BandAdmin");
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
          // Phase 63: the source widened the context this event is held for; it
          // did not widen the declared 90-day window, and the reason says so.
          boundedBy: "window",
        },
      ]),
    );
    // Phase 64. `Event` is back to `SCOPE currentContext`, so the second band's
    // event is no longer held by the object's own scope while the first band is
    // selected — it is here because `HomeUpcomingEvents` declares a cross-band
    // input, which is the route that actually wants it. Under Phase 62's `recent`
    // this record carried an `objectSync` reason it had never asked for.
    expect(
      eventRecords.find((record) => record.recordId === seeded.secondEvent.meta.guid)?.reasons,
    ).toEqual([
      {
        kind: "readModelSource",
        readModel: "HomeUpcomingEvents",
        source: "event",
        sourceScope: "allAvailableContexts",
        mode: "localFirst",
        boundedBy: "window",
      },
    ]);
    expect(invitationRecords).toEqual([]);
    expect(eventSearch.map((record) => record.meta.guid)).toEqual([
      seeded.firstEvent.meta.guid,
      seeded.secondEvent.meta.guid,
    ]);
    expect(availabilitySearch.map((record) => record.meta.guid)).toEqual([
      seeded.availability.meta.guid,
    ]);
  });

  /**
   * Phase 63. `Event` declares `WINDOW Date 90 DAYS LIMIT 200` and two read
   * models source it, so before this an event seven years outside that window
   * stayed on the device — admitted by `CalendarPlanningItems` alone, with the
   * `objectSync` reason correctly absent. The window had done its job and the
   * read-model source had put the record back.
   */
  it("keeps an event outside the declared window off the device by every route", async () => {
    const seeded = await createSeededBandReferenceRuntime();
    const selectedBaseContext: RuntimeContext = {
      ...seeded.musicianContext,
      selectedContexts: { Band: seeded.firstBand.meta.guid },
    };

    const ancient = await seeded.runtime.create(
      "Event",
      {
        Band: seeded.firstBand.meta.guid,
        EventType: "Gig",
        Date: "2019-01-01",
        Title: "Seven years before the declared window",
        VenueName: "Nowhere",
      },
      contextForBand(bandReferenceSystemContext, seeded.firstBand.meta.guid),
    );

    const dataset = await seeded.runtime.evaluateOfflineDataset(selectedBaseContext);
    const events = dataset.records.filter((record) => record.objectName === "Event");

    expect(events.find((record) => record.recordId === ancient.meta.guid)).toBeUndefined();
    // The seeded events are inside the window and still held, so this excludes
    // the out-of-window record rather than every event.
    expect(new Set(events.map((record) => record.recordId))).toEqual(
      new Set([seeded.firstEvent.meta.guid, seeded.secondEvent.meta.guid]),
    );
  });

  /**
   * Phase 57 verified that a `SCOPE all` read-model source correctly admits a
   * bandmate's `Availability` into the founder's dataset, and
   * `learnings/implementation/offline-dataset-runtime.md` records that run.
   * Phase 63 bounds what a source may widen, so this guards the half it must
   * not touch. Phase 64 gave `Availability` the window it always needed, which
   * makes this guard sharper rather than weaker: the bandmate's record is inside
   * that window and its admission is unchanged, and the reason now says it was
   * bounded.
   */
  it("still admits a bandmate's availability through a cross-context read-model source", async () => {
    const seeded = await createSeededBandReferenceRuntime();
    const otherUserAvailability = await seeded.runtime.create(
      "Availability",
      {
        User: seeded.guest.meta.guid,
        Date: "2026-08-05",
        Status: "Available",
      },
      { ...seeded.musicianContext, userId: seeded.guest.meta.guid },
    );

    const dataset = await seeded.runtime.evaluateOfflineDataset(seeded.musicianContext);
    const row = dataset.records.find(
      (record) => record.recordId === otherUserAvailability.meta.guid,
    );

    expect(row).toBeDefined();
    expect(row?.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "readModelSource",
          readModel: "BandMemberAvailability",
          source: "availability",
          sourceScope: "all",
          // The bandmate's record is not selected by `Availability`'s own
          // `currentUser` scope, so this source is its only route; the declared
          // window still gated it, and the reason says so.
          boundedBy: "window",
        }),
      ]),
    );
    expect(row?.reasons.some((reason) => reason.kind === "objectSync")).toBe(false);
  });

  /**
   * Phase 64. `Availability` grows by one record per user per date and could not
   * be bounded before, because a window was refused on `currentUser` and moving
   * it to `recent` would have widened it from one user's records to every
   * available band's. The bound and the context scope are now independent.
   */
  it("keeps availability outside the declared window off the device by every route", async () => {
    const seeded = await createSeededBandReferenceRuntime();
    const ancient = await seeded.runtime.create(
      "Availability",
      {
        User: seeded.musician.meta.guid,
        Date: "2019-04-02",
        Status: "Available",
        Notes: "Seven years outside the declared 90-day window.",
      },
      seeded.musicianContext,
    );
    const bandmateAncient = await seeded.runtime.create(
      "Availability",
      {
        User: seeded.guest.meta.guid,
        Date: "2019-04-03",
        Status: "Available",
      },
      { ...seeded.musicianContext, userId: seeded.guest.meta.guid },
    );

    const dataset = await seeded.runtime.evaluateOfflineDataset(seeded.musicianContext);
    const availability = dataset.records.filter((record) => record.objectName === "Availability");

    expect(availability.map((record) => record.recordId)).not.toContain(ancient.meta.guid);
    // And the cross-context source does not put the bandmate's back, which is
    // the Phase 63 rule holding on an object that could not declare a bound then.
    expect(availability.map((record) => record.recordId)).not.toContain(bandmateAncient.meta.guid);
    expect(availability.map((record) => record.recordId)).toContain(seeded.availability.meta.guid);
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
    // field is never one of them. A set-list item is not a bare link to a song:
    // the arrangement, the encore flag and the rehearsal date belong to the item
    // and are what make this collection's inline editor an enum, a boolean and a
    // date beside the song chooser.
    expect(songs.fields.map((field) => field.name)).toEqual([
      "Position",
      "Song",
      "Arrangement",
      "Encore",
      "RehearsedOn",
      "Notes",
    ]);
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

  /*
   * The phase's acceptance criterion, in the browser, against the real Giggle
   * Band model rather than a fixture.
   *
   * A set-list item has fields of its own — a song lookup, an enum, a boolean, a
   * date and a note — so this is the case the platform's field renderer exists
   * for. A person adds a song by choosing it, edits the row in place, and every
   * one of those changes reaches storage as one transaction and one queued
   * `batch`. No record id is typed anywhere.
   */
  it("adds a chosen song and edits set-list rows in place inside one staged batch", async () => {
    const seeded = await createSeededBandReferenceRuntime();
    const app = await mountBandApp(seeded);

    await openSetList(app, seeded.firstSetList.meta.guid);
    // The staged batch as the runtime receives it: the DOM event a picker emits
    // names the chosen candidates, and it is the form that turns each of them
    // into a child create carrying the declared candidate field.
    const applyStaged = vi.spyOn(seeded.runtime, "applyStagedChildChanges");
    // Cleared after the seed's own writes, so every queue assertion below
    // describes exactly what saving this form did.
    seeded.runtime.syncQueue.clear();
    const loggedBefore = seeded.runtime.operationLog.getOperations().length;

    // Adding a song is choosing one. Slow Tide is the only song in the library
    // that this set list does not already hold, so it is the only candidate.
    openChildPicker(app, "Songs");
    await flushUi();
    const picker = requireElement<HTMLElement>(app, ".adl-relationship-picker");
    // Labelled by the picker's declared `DISPLAY Title Composer`, so a person
    // chooses a song rather than a record id.
    expect(
      [...picker.querySelectorAll(".adl-relationship-picker-row span")].map((element) =>
        element.textContent?.trim(),
      ),
    ).toEqual(["Slow Tide - The Alphas"]);
    requireElement<HTMLInputElement>(picker, "input[data-picker-candidate]").checked = true;
    requireElement<HTMLButtonElement>(app, "button[data-picker-action='add']").click();
    await flushUi();

    // And editing an item is editing the row. The first row is Neon Map, seeded
    // acoustic with a rehearsal date and a note; the note and the song are left
    // alone so the staged patch can be shown to carry neither.
    const firstRow = childRowIdAt(app, "Songs", 0);
    openChildRowEditor(app, "Songs", 0);
    await flushUi();
    await flushUi();
    setChildEditorValue(app, "Songs", firstRow, "Arrangement", "Instrumental");
    setChildEditorValue(app, "Songs", firstRow, "Encore", true);
    setChildEditorValue(app, "Songs", firstRow, "RehearsedOn", "2026-07-20");
    clickChildRowEditControl(app, "Songs", firstRow, "save");
    await flushUi();

    // Staged, not written: nothing has reached storage or the queue yet.
    expect(applyStaged).not.toHaveBeenCalled();
    expect(seeded.runtime.syncQueue.getEntries()).toEqual([]);

    requireElement<HTMLButtonElement>(app, "button[data-action-name='save']").click();
    await flushUi();
    await flushUi();

    // The chosen song crosses as a value in the declared candidate field, never
    // as a `childId`, which would have named the song's record as though it were
    // a set-list item. The inline edit carries only the three fields that
    // changed: the song and the note it never touched stay out of the patch.
    expect(
      (applyStaged.mock.calls[0]?.[0].stagedChanges ?? []).map((operation) => [
        operation.operation,
        operation.childId,
        operation.values,
      ]),
    ).toEqual([
      ["createChild", undefined, { Song: seeded.fourthSong.meta.guid }],
      [
        "updateChild",
        seeded.firstSetListItem.meta.guid,
        { Arrangement: "Instrumental", Encore: true, RehearsedOn: "2026-07-20" },
      ],
    ]);

    // One local transaction: two records written, and one `batch` logged over
    // them. A create and an edit that each wrote on their own would log two.
    const logged = seeded.runtime.operationLog.getOperations().slice(loggedBefore);
    expect(logged.filter((operation) => operation.operation === "batch")).toHaveLength(1);
    expect(logged.filter((operation) => operation.operation !== "batch")).toHaveLength(2);

    // And one queued operation for the whole thing.
    const entries = seeded.runtime.syncQueue.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.operation.operation).toBe("batch");
    expect(
      entries[0]?.operation.batch?.writes.map((write) => [write.operation, write.objectName]),
    ).toEqual([
      ["create", "SetListItem"],
      ["update", "SetListItem"],
    ]);
    expect(entries[0]?.operation.batch?.writes[1]).toMatchObject({
      recordId: seeded.firstSetListItem.meta.guid,
      patch: { Arrangement: "Instrumental", Encore: true, RehearsedOn: "2026-07-20" },
    });

    const items = await storedSetListItems(seeded, seeded.firstSetList.meta.guid);
    expect(items.map((item) => [item.values.Position, item.values.Arrangement])).toEqual([
      [1, "Instrumental"],
      [2, "Full"],
      [3, "Instrumental"],
      // Appended, and on the declared defaults: the picker mints the child, it
      // does not invent values for it.
      [4, "Full"],
    ]);
    expect(items[0]?.values).toMatchObject({
      Song: seeded.firstSong.meta.guid,
      Encore: true,
      RehearsedOn: "2026-07-20",
      // Untouched by an edit that never named them.
      Notes: "Opens on the acoustic guitar.",
    });
    expect(items[3]?.values).toMatchObject({
      Song: seeded.fourthSong.meta.guid,
      Encore: false,
    });

    /*
     * Now the row the person just added, edited in place the same way. A staged
     * create has no record for an edit to name, so this is the flow: the song is
     * chosen, saved, and the item it minted is then filled in.
     */
    await openSetList(app, seeded.firstSetList.meta.guid);
    seeded.runtime.syncQueue.clear();
    applyStaged.mockClear();
    const loggedBeforeEdit = seeded.runtime.operationLog.getOperations().length;

    const addedRow = childRowIdAt(app, "Songs", 3);
    expect(childRecordIdAt(app, "Songs", 3)).toBe(items[3]?.meta.guid);
    openChildRowEditor(app, "Songs", 3);
    await flushUi();
    await flushUi();
    setChildEditorValue(app, "Songs", addedRow, "Arrangement", "Acoustic");
    setChildEditorValue(app, "Songs", addedRow, "Encore", true);
    setChildEditorValue(app, "Songs", addedRow, "RehearsedOn", "2026-07-22");
    // Every field of a freshly minted item is filled in here, including the
    // note, because a minted child carries only the song that was chosen. What
    // the patch must not carry is the song itself, which nothing touched.
    setChildEditorValue(app, "Songs", addedRow, "Notes", "Added from the song picker.");
    clickChildRowEditControl(app, "Songs", addedRow, "save");
    await flushUi();

    requireElement<HTMLButtonElement>(app, "button[data-action-name='save']").click();
    await flushUi();
    await flushUi();

    expect(
      (applyStaged.mock.calls[0]?.[0].stagedChanges ?? []).map((operation) => [
        operation.operation,
        operation.childId,
        operation.values,
      ]),
    ).toEqual([
      [
        "updateChild",
        items[3]?.meta.guid,
        {
          Arrangement: "Acoustic",
          Encore: true,
          RehearsedOn: "2026-07-22",
          Notes: "Added from the song picker.",
        },
      ],
    ]);

    const afterEdit = seeded.runtime.operationLog.getOperations().slice(loggedBeforeEdit);
    expect(afterEdit.filter((operation) => operation.operation === "batch")).toHaveLength(1);
    expect(afterEdit.filter((operation) => operation.operation !== "batch")).toHaveLength(1);
    const editEntries = seeded.runtime.syncQueue.getEntries();
    expect(editEntries).toHaveLength(1);
    expect(editEntries[0]?.operation.operation).toBe("batch");

    const edited = await storedSetListItems(seeded, seeded.firstSetList.meta.guid);
    expect(edited[3]?.values).toMatchObject({
      Song: seeded.fourthSong.meta.guid,
      Position: 4,
      Arrangement: "Acoustic",
      Encore: true,
      RehearsedOn: "2026-07-22",
      Notes: "Added from the song picker.",
    });
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

async function mountBandApp(
  seeded: Awaited<ReturnType<typeof createSeededBandReferenceRuntime>>,
): Promise<AdlAppElement> {
  const app = document.createElement("adl-app") as AdlAppElement;
  app.model = seeded.model;
  app.runtime = seeded.runtime;
  app.context = { ...seeded.firstBandContext, channel: "ui" };
  document.body.append(app);
  await app.whenReady();
  await flushUi();
  return app;
}

/** Reaches the ADL-declared edit surface the way the shell offers it. */
async function openSetList(app: AdlAppElement, recordId: string): Promise<void> {
  navigateWithDrawer(app, "SetListForm");
  await flushUi();
  await waitForText(app, "August headline");
  requireElement<HTMLTableRowElement>(app, `tr[data-record-id='${recordId}']`).click();
  await flushUi();
  await flushUi();
}

/**
 * Clicks the section's one picker control.
 *
 * Exactly one, because a minting picker replaces the draft row rather than
 * joining it: two ways to add, one of them requiring a typed record id, is worse
 * than one that works.
 */
function openChildPicker(app: AdlAppElement, sectionName: string): void {
  const controls = [
    ...app.querySelectorAll<HTMLButtonElement>(`button[data-picker-open='${sectionName}']`),
  ];
  if (controls.length !== 1) {
    throw new Error(
      `Expected exactly one control opening the '${sectionName}' picker, found ${controls.length}.`,
    );
  }

  controls[0]?.click();
}

function childRowAt(app: AdlAppElement, sectionName: string, index: number): HTMLElement {
  const section = requireElement<HTMLElement>(app, `[data-child-section='${sectionName}']`);
  const row = [...section.querySelectorAll<HTMLElement>(".adl-child-row")][index];
  if (row === undefined) {
    throw new Error(`No child row at index ${index} in section '${sectionName}'.`);
  }

  return row;
}

function childRowIdAt(app: AdlAppElement, sectionName: string, index: number): string {
  const id = childRowAt(app, sectionName, index).dataset.childRow;
  if (id === undefined) {
    throw new Error(`Child row ${index} carries no row id.`);
  }

  return id;
}

function childRecordIdAt(app: AdlAppElement, sectionName: string, index: number): string {
  const id = childRowAt(app, sectionName, index).dataset.childId;
  if (id === undefined) {
    throw new Error(`Child row ${index} names no persisted record.`);
  }

  return id;
}

/** The row's `Edit` control, which opens the row rather than staging anything. */
function openChildRowEditor(app: AdlAppElement, sectionName: string, index: number): void {
  requireElement<HTMLButtonElement>(
    childRowAt(app, sectionName, index),
    "button[data-child-action='updateChild']",
  ).click();
}

function clickChildRowEditControl(
  app: AdlAppElement,
  sectionName: string,
  row: string,
  kind: "save" | "cancel",
): void {
  requireElement<HTMLButtonElement>(
    app,
    `button[data-child-edit='${kind}'][data-child-section='${sectionName}'][data-child-action-row='${row}']`,
  ).click();
}

/**
 * Types into one field of an open row editor.
 *
 * A child field is an `adl-field-renderer`, so the value goes on the control the
 * renderer reads back through `getValue()` — a select for the enum, a checkbox
 * for the boolean, a date control for the date. Focus is load-bearing rather
 * than decorative: the form decides whether an input belongs to the parent draft
 * or to a surface it owns by asking where focus is, and without it a parent
 * draft change would recreate the form and wipe what is being typed.
 */
function setChildEditorValue(
  app: AdlAppElement,
  sectionName: string,
  row: string,
  fieldName: string,
  value: string | boolean,
): void {
  const section = requireElement<HTMLElement>(app, `[data-child-section='${sectionName}']`);
  const input = requireElement<HTMLInputElement | HTMLSelectElement>(
    requireElement<HTMLElement>(
      section,
      `adl-field-renderer[data-child-editor='${sectionName}'][data-child-editor-row='${row}'][data-child-field-slot='${fieldName}']`,
    ),
    "[data-field-input]",
  );

  input.focus();
  if (typeof value === "boolean") {
    (input as HTMLInputElement).checked = value;
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function storedSetListItems(
  seeded: Awaited<ReturnType<typeof createSeededBandReferenceRuntime>>,
  setListId: string,
) {
  const items = await seeded.runtime.search("SetListItem", undefined, seeded.firstBandContext);
  return items
    .filter((item) => item.values.SetList === setListId)
    .sort((left, right) => Number(left.values.Position) - Number(right.values.Position));
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
