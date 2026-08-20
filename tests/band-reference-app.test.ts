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
  it("validates the full band-management reference model", async () => {
    const model = await createBandReferenceModel();
    const syncByObject = new Map(model.sync.map((sync) => [sync.object, sync]));

    expect(validateApplicationModel(model)).toEqual([]);
    expect(model.modelVersion).toBe("1.5.0");
    expect(model.migrations).toContainEqual({ from: "1.0.0", to: "1.1.0", objects: [] });
    expect(model.migrations).toContainEqual({ from: "1.1.0", to: "1.2.0", objects: [] });
    expect(model.migrations).toContainEqual({ from: "1.2.0", to: "1.3.0", objects: [] });
    // Not an empty-object hop: `1.3.0 -> 1.4.0` replaced `Event.SetList` (a
    // single lookup) with the `EventSetList` link object, so a persisted event
    // carries a field the model no longer declares until this step drops it.
    expect(model.migrations).toContainEqual({
      from: "1.3.0",
      to: "1.4.0",
      objects: [
        {
          object: "Event",
          steps: [{ kind: "dropField", field: "SetList" }],
        },
      ],
    });
    // Also not an empty-object hop: `1.4.0 -> 1.5.0` adds `Event.CreatedBy`
    // (matching `Band.CreatedBy`/`SetList.CreatedBy`), so a persisted event
    // needs the field backfilled with a default before the model will read it.
    expect(model.migrations).toContainEqual({
      from: "1.4.0",
      to: "1.5.0",
      objects: [
        {
          object: "Event",
          steps: [{ kind: "addField", field: "CreatedBy", defaultValue: null }],
        },
      ],
    });
    // A tripwire, not a meaningful value: this fingerprint is a pure function of
    // resolved-model content, so ANY content change -- domain or UI, intentional
    // or not -- flips it and fails this assertion in the fast suite, before a
    // browser is ever involved. That is the point. Three real commits in one
    // session (010dfc8, cf12207, 517f874) changed Giggle Band's content without
    // bumping modelVersion, each shipping a fail-closed startup refusal to every
    // existing browser install; none of them would have passed `npm test` with
    // this assertion in place. When this fails on a legitimate content change,
    // update it to the new value printed in the failure diff -- that update is
    // your reminder to also bump modelVersion and add a migration step, not a
    // license to paste the new value and move on.
    expect(model.modelFingerprint).toBe(
      "sha256-50d483a4c31be8e36c7046127c6415b6f20c5d3efd1ff92c232d221960648569",
    );
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
        "EventSetList",
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
    expect(model.commands?.map((command) => command.name)).toEqual(
      expect.arrayContaining(["AcceptBandInvitation", "RevokeBandInvitation"]),
    );
    expect(model.readModels?.map((readModel) => readModel.name)).toEqual(
      expect.arrayContaining(["PendingInvitations", "SentBandInvitations"]),
    );
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
    // `Event` now carries an explicit `CreatedBy` lookup, matching
    // `Band.CreatedBy` and `SetList.CreatedBy`'s exact shape, instead of
    // relying solely on the automatic `_createdBy` metadata field.
    expect(
      model.objects
        .find((object) => object.name === "Event")
        ?.fields.find((field) => field.name === "CreatedBy"),
    ).toMatchObject({
      type: "text",
      required: false,
      readonly: false,
      lookup: { targetObject: "User", displayField: "Name" },
    });
    expect(model.readModels?.map((readModel) => readModel.name)).toEqual(
      expect.arrayContaining(["EventAvailabilityConflicts"]),
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
      window: { field: "Date", days: 90, limit: 200, windowSource: "authored" },
    });
    // The object that actually needed a bound and could not have one: one record
    // per user per date, growing for as long as the user keeps using the app.
    expect(syncByObject.get("Availability")).toMatchObject({
      mode: "localFirst",
      scope: "currentUser",
      window: { field: "Date", days: 90, limit: 400, windowSource: "authored" },
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

  it("declares the set-list edit surface entirely in ADL", async () => {
    const model = await createBandReferenceModel();
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
    // The standalone view remains available as a model surface, but explicit
    // shell navigation no longer promotes that implementation view into the
    // user-facing drawer by default.
    expect(
      model.objects.find((object) => object.name === "SetListItem")?.views.map((view) => view.name),
    ).toContain("SetListItemList");
    expect(model.shell.nav.items.map((item) => item.view)).toEqual(
      expect.arrayContaining(["SetListList", "SetListForm"]),
    );
    expect(model.shell.nav.items.map((item) => item.view)).not.toContain("SetListItemList");
    // The list that opens the surface has to agree about the container, because
    // the container is chosen by the view that is active when editing starts.
    expect(setList?.views.find((view) => view.name === "SetListList")?.editContainer).toBe("page");
    expect(model.commands?.map((command) => command.name)).toEqual(
      expect.arrayContaining(["AddSongsToSetList", "ReorderSetList"]),
    );
  });

  it("exposes the Giggle Band example as the same ADL model with an example app identity", async () => {
    const model = await createGiggleBandExampleModel();

    expect(validateApplicationModel(model)).toEqual([]);
    expect(model.app.name).toBe("Giggle Band ADL Example");
    expect(model.app.startView).toBe("HomeDashboard");
    expect(model.objects.map((object) => object.name)).toEqual(
      expect.arrayContaining(["Band", "Event", "Song", "SetList", "SetListItem"]),
    );
  });

  it("declares the last-admin-standing guard on BandMember's BandAdmin role", async () => {
    const model = await createBandReferenceModel();

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
      // Casey's own "double-booked" availability entry on the same date as the
      // gig above: a separate union row, not merged with it, because it comes
      // from a different source. This is the genuine conflict
      // `EventAvailabilityConflicts` (`domain.adlj`) correlates for
      // `BandEventCalendar`'s `conflict` status; see
      // `learnings/implementation/reference-app-models.md`.
      expect.objectContaining({
        EventDate: "2026-08-01",
        EventType: "Unavailable",
        Title: "Forgot I already booked this date.",
      }),
      expect.objectContaining({
        EventDate: "2026-08-02",
        StartTime: "18:30",
        EventType: "Rehearsal",
        Title: "New set rehearsal",
        VenueName: "Beta Rooms",
      }),
      // Casey's own "thought I was free" availability entry on the same date as
      // the cross-band rehearsal above: a separate union row, not merged with
      // it, because it comes from a different source
      // (`BandMemberAvailabilityBoard`'s cross-band overlay is what visually
      // resolves this clash; see `learnings/implementation/reference-app-models.md`).
      expect.objectContaining({
        EventDate: "2026-08-02",
        EventType: "Available",
        Title: "Thought this evening was free.",
      }),
      expect.objectContaining({
        EventDate: "2026-08-03",
        EventType: "Unavailable",
        Title: "Unavailable - session prep",
      }),
    ]);
    expect(home.rows[1]?.sources).toEqual({
      availability: {
        objectName: "Availability",
        recordId: seeded.conflictAvailability.meta.guid,
      },
    });
    expect(home.rows[4]?.sources).toEqual({
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
      // Casey's own genuine double-booking on the gig's own date -- see the
      // `HomeUpcomingEvents` assertion above for the same fact.
      expect.objectContaining({
        Date: "2026-08-01",
        CalendarStatus: "Unavailable",
        Title: "Forgot I already booked this date.",
      }),
      // `CalendarPlanningItems` sources `Event SCOPE currentContext`, so
      // `secondEvent` (the Betas rehearsal) never appears while the Alphas are
      // selected — only Casey's own availability entry on the same date does.
      expect.objectContaining({
        Date: "2026-08-02",
        CalendarStatus: "Available",
        Title: "Thought this evening was free.",
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
        recordId: seeded.conflictAvailability.meta.guid,
      },
    });
    expect(calendar.rows[3]?.sources).toEqual({
      availability: {
        objectName: "Availability",
        recordId: seeded.availability.meta.guid,
      },
    });

    // The genuine gig/unavailability correlation `BandEventCalendar`'s
    // `conflict` status needs, and the reason a plain union of `Event` and
    // `Availability` (as `CalendarPlanningItems` above stays) can never
    // produce it on its own: see `EventAvailabilityConflicts`'s own comment
    // in `domain.adlj`.
    const conflicts = await seeded.runtime.executeReadModel(
      "EventAvailabilityConflicts",
      seeded.firstBandContext,
    );
    expect(conflicts.rows.map((row) => row.values)).toEqual([
      {
        Date: "2026-08-01",
        EventType: "Gig",
        AvailabilityStatus: "Unavailable",
        IsConflict: true,
      },
    ]);

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
    //
    // `MyAvailabilityWithGigs` (the cross-band availability overlay) is a second
    // such route: it also sources `Event SCOPE allAvailableContexts`, so it
    // independently admits the same record. Two cross-band read-model sources
    // wanting the same event is not a defect — each reason names the read model
    // that actually asked for it.
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
      {
        kind: "readModelSource",
        readModel: "MyAvailabilityWithGigs",
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
      seeded.crossBandAvailability.meta.guid,
      seeded.conflictAvailability.meta.guid,
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

  it("runs a gig's set lists in order through EventSetList, and enforces the rich gig field validators", async () => {
    const seeded = await createSeededBandReferenceRuntime();
    const bandContext = contextForBand(bandReferenceSystemContext, seeded.firstBand.meta.guid);

    // A night runs several set lists in order -- giggle-new's own
    // `gig_set_lists` is what this mirrors -- so the link is its own object,
    // not a single lookup on `Event`.
    const links = await seeded.runtime.search("EventSetList", undefined, bandContext);
    expect(
      links
        .filter((link) => link.values.Event === seeded.firstEvent.meta.guid)
        .sort((left, right) => Number(left.values.Position) - Number(right.values.Position))
        .map((link) => [link.values.Position, link.values.SetList]),
    ).toEqual([
      [1, seeded.firstSetList.meta.guid],
      [2, seeded.secondSetList.meta.guid],
    ]);

    // `(gig_id, set_list_id)` is `gig_set_lists`' primary key: the same set
    // list cannot be attached to one event twice.
    await expect(
      seeded.runtime.create(
        "EventSetList",
        {
          Band: seeded.firstBand.meta.guid,
          Event: seeded.firstEvent.meta.guid,
          SetList: seeded.firstSetList.meta.guid,
          Position: 3,
        },
        bandContext,
      ),
    ).rejects.toMatchObject({
      issues: [
        expect.objectContaining({
          code: "ADL_RUNTIME_CONSTRAINT_UNIQUE",
          field: "SetList",
        }),
      ],
    });

    const wellFormed = await seeded.runtime.create(
      "Event",
      {
        Band: seeded.firstBand.meta.guid,
        EventType: "Gig",
        Date: "2026-09-01",
        Title: "September support slot",
        ContactName: "Sam Rivers",
        ContactPhone: "+44 161 496 0018",
        ContactEmail: "sam@venue.example.com",
        Amount: 300,
        PaymentMethod: "Cash",
        Agent: "Riverside Bookings",
      },
      bandContext,
    );
    expect(wellFormed.values).toMatchObject({
      PaymentMethod: "Cash",
      Amount: 300,
    });

    await expect(
      seeded.runtime.create(
        "Event",
        {
          Band: seeded.firstBand.meta.guid,
          EventType: "Gig",
          Date: "2026-09-02",
          Title: "Bad contact phone",
          ContactPhone: "call me maybe",
        },
        bandContext,
      ),
    ).rejects.toBeInstanceOf(RuntimeValidationError);

    await expect(
      seeded.runtime.create(
        "Event",
        {
          Band: seeded.firstBand.meta.guid,
          EventType: "Gig",
          Date: "2026-09-03",
          Title: "Bad contact email",
          ContactEmail: "not-an-email",
        },
        bandContext,
      ),
    ).rejects.toBeInstanceOf(RuntimeValidationError);

    await expect(
      seeded.runtime.create(
        "Event",
        {
          Band: seeded.firstBand.meta.guid,
          EventType: "Gig",
          Date: "2026-09-04",
          Title: "Bad payment method",
          PaymentMethod: "Venmo",
        },
        bandContext,
      ),
    ).rejects.toBeInstanceOf(RuntimeValidationError);
  });

  /**
   * The Fix 1 acceptance criterion: `Event` now populates `CreatedBy` at
   * create time, matching `Band`/`SetList` exactly -- both seeded directly in
   * `band-app.ts`, since none of the three has a dedicated create command
   * (`CreateBand`'s command step is the one exception, but its own
   * `createFounderMembership` step never touches `Band.CreatedBy` either).
   */
  it("populates Event.CreatedBy the same way Band.CreatedBy and SetList.CreatedBy already do", async () => {
    const seeded = await createSeededBandReferenceRuntime();

    expect(seeded.firstEvent.values.CreatedBy).toBe(seeded.musician.meta.guid);
    expect(seeded.secondEvent.values.CreatedBy).toBe(seeded.musician.meta.guid);
    expect(seeded.firstBand.values.CreatedBy).toBeUndefined();
    expect(seeded.firstSetList.values.CreatedBy).toBe(seeded.musician.meta.guid);
  });

  it("names a repeat booking's earlier gig through the self-referencing PreviousGig lookup", async () => {
    const seeded = await createSeededBandReferenceRuntime();
    const bandContext = contextForBand(bandReferenceSystemContext, seeded.firstBand.meta.guid);

    const earlierGig = await seeded.runtime.create(
      "Event",
      {
        Band: seeded.firstBand.meta.guid,
        EventType: "Gig",
        Date: "2026-05-01",
        Title: "Spring warm-up show",
        VenueName: "Alpha Hall",
      },
      bandContext,
    );
    const repeatBooking = await seeded.runtime.create(
      "Event",
      {
        Band: seeded.firstBand.meta.guid,
        EventType: "Gig",
        Date: "2026-10-01",
        Title: "Alpha Hall return date",
        VenueName: "Alpha Hall",
        PreviousGig: earlierGig.meta.guid,
      },
      bandContext,
    );

    const read = await seeded.runtime.read("Event", repeatBooking.meta.guid, bandContext);
    expect(read?.values.PreviousGig).toBe(earlierGig.meta.guid);
  });

  it("prefills a duplicate-gig create action from an existing gig's own fields, blanking only Date", async () => {
    const seeded = await createSeededBandReferenceRuntime();

    const presentation = await seeded.runtime.evaluatePresentationView(
      "Event",
      "BandEventCalendar",
      seeded.firstBandContext,
    );
    const section = presentation.sections.find((candidate) => candidate.name === "DuplicateGig");
    const list = section?.lists.find((candidate) => candidate.name === "PreviousGigs");
    const row = list?.rows.find(
      (candidate) => candidate.id === `Event:${seeded.firstEvent.meta.guid}`,
    );
    const action = row?.actions.find((candidate) => candidate.name === "duplicateGig");

    expect(action).toBeDefined();
    expect(action?.create).toEqual({ object: "Event" });
    expect(action?.input).not.toHaveProperty("Date");
    expect(action?.input).toMatchObject({
      EventType: "Gig",
      Title: "Canal Street headline",
      VenueName: "Alpha Hall",
      VenueLocation: "Canal Street",
      ContactName: "Jordan Blake",
      ContactPhone: "+44 20 7946 0958",
      ContactEmail: "jordan@alphahall.example.com",
      Amount: 450,
      PaymentMethod: "Bank Transfer",
      Agent: "Riverside Bookings",
    });

    // `action.input` deliberately carries no `Band`: the browser save flow
    // injects the selected context's scope field at save time (see
    // `AdlAppElement`'s create-draft handling), the same way `addEventOnDate`'s
    // resolved input never carries one either. A direct `runtime.create` call
    // has to supply it itself, matching what that save path would have done.
    const duplicate = await seeded.runtime.create(
      "Event",
      { ...action!.input, Band: seeded.firstBand.meta.guid, Date: "2026-11-01" },
      contextForBand(bandReferenceSystemContext, seeded.firstBand.meta.guid),
    );
    expect(duplicate.values).toMatchObject({
      Date: "2026-11-01",
      Title: "Canal Street headline",
      VenueName: "Alpha Hall",
    });
  });

  /**
   * The fix this proves: `BandEventCalendar`'s `conflict` status used to be
   * declared but unreachable -- `CalendarPlanningItems`' `CalendarEventTypeStatus`
   * statusMap only ever produced `event`/`rehearsal`/`unavailable`, because a
   * `UNION` read model can never correlate its two sources on the same row (see
   * `EventAvailabilityConflicts`'s own comment in `domain.adlj`). This proves
   * the whole path end to end: a real day with both a booked gig and a
   * separately-marked unavailable note resolves the calendar *cell* to
   * `conflict` (precedence 100, beating both `event` and `unavailable`), and a
   * day with only one of the two facts still resolves to its ordinary status.
   */
  it("wires BandEventCalendar's conflict status to a real gig/unavailability correlation", async () => {
    const seeded = await createSeededBandReferenceRuntime();

    const presentation = await seeded.runtime.evaluatePresentationView(
      "Event",
      "BandEventCalendar",
      seeded.firstBandContext,
    );
    const section = presentation.sections.find(
      (candidate) => candidate.name === "PlanningCalendar",
    );
    const calendar = section?.calendars.find((candidate) => candidate.name === "MonthPlanner");

    // Casey booked the Canal Street gig and separately marked themselves
    // unavailable that same date (`conflictAvailability`) -- a genuine
    // double-booking, not merely two unrelated facts sharing a day.
    const conflictCell = calendar?.cells.find((candidate) => candidate.date === "2026-08-01");
    expect(conflictCell?.status?.name).toBe("conflict");
    expect(conflictCell?.hasConflict).toBe(true);
    expect(conflictCell?.items.map((item) => item.status?.name)).toEqual(
      expect.arrayContaining(["event", "unavailable", "conflict"]),
    );

    // A day with only an unavailable note and no gig still resolves to the
    // ordinary `unavailable` status, not `conflict` -- the overlay marks only
    // the dates `EventAvailabilityConflicts` itself names.
    const unavailableOnlyCell = calendar?.cells.find(
      (candidate) => candidate.date === "2026-08-03",
    );
    expect(unavailableOnlyCell?.status?.name).toBe("unavailable");
    expect(unavailableOnlyCell?.hasConflict).toBe(false);
  });

  it("overlays a cross-band gig on the availability board with a higher-precedence status", async () => {
    const seeded = await createSeededBandReferenceRuntime();

    const presentation = await seeded.runtime.evaluatePresentationView(
      "Availability",
      "BandMemberAvailabilityBoard",
      seeded.firstBandContext,
    );
    const teamSection = presentation.sections.find(
      (candidate) => candidate.name === "TeamAvailability",
    );
    // The whole-band roster is untouched by the overlay: still backed by
    // `BandMemberAvailability`, still every member's own rows.
    expect(teamSection?.lists[0]?.rows.length).toBeGreaterThan(0);

    const scheduleSection = presentation.sections.find(
      (candidate) => candidate.name === "MySchedule",
    );
    const calendar = scheduleSection?.calendars.find(
      (candidate) => candidate.name === "MyScheduleCalendar",
    );
    // `secondEvent` (a Betas rehearsal, a different band) and Casey's own
    // "Available" availability entry both fall on 2026-08-02. The gig-derived
    // `conflict` status (PRECEDENCE 100) must win the cell over `available`
    // (PRECEDENCE 10).
    const cell = calendar?.cells.find((candidate) => candidate.date === "2026-08-02");
    expect(cell?.status?.name).toBe("conflict");
    // And a date with only an availability fact, no cross-band gig, resolves to
    // the lower-precedence status instead.
    const availableOnlyCell = calendar?.cells.find((candidate) => candidate.date === "2026-08-03");
    expect(availableOnlyCell?.status?.name).toBe("unavailable");
  });

  it("adds the four new streaming platforms while still enforcing the closed enum", async () => {
    const seeded = await createSeededBandReferenceRuntime();
    const bandContext = contextForBand(bandReferenceSystemContext, seeded.firstBand.meta.guid);

    const tidalLink = await seeded.runtime.create(
      "StreamingLink",
      {
        Band: seeded.firstBand.meta.guid,
        Song: seeded.firstSong.meta.guid,
        Platform: "Tidal",
        Url: "https://tidal.com/browse/track/1",
      },
      bandContext,
    );
    expect(tidalLink.values.Platform).toBe("Tidal");

    await expect(
      seeded.runtime.create(
        "StreamingLink",
        {
          Band: seeded.firstBand.meta.guid,
          Song: seeded.secondSong.meta.guid,
          Platform: "Napster",
          Url: "https://napster.example.com/track/1",
        },
        bandContext,
      ),
    ).rejects.toBeInstanceOf(RuntimeValidationError);
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

  it("revokes a pending invitation as any band admin, not only its original sender", async () => {
    const seeded = await createSeededBandReferenceRuntime();
    const bandContext = contextForBand(bandReferenceSystemContext, seeded.firstBand.meta.guid);
    const pendingInvitation = await createPendingInvitation(seeded);

    // Promote the guest to a second `BandAdmin` for this band -- distinct from
    // `seeded.musician`, who is both the founding admin and this invitation's
    // `Inviter` -- to prove revocation is not restricted to the sender.
    await seeded.runtime.create(
      "BandMember",
      { User: seeded.guest.meta.guid, Band: seeded.firstBand.meta.guid, Role: "BandAdmin" },
      bandContext,
    );
    // `withSelectedContext` is what actually resolves and stamps
    // `contextRoles` from the membership just created; a `RuntimeContext`
    // built by hand with only `selectedContexts` (as `inviteeContext` is
    // elsewhere in this file) never carries a `ROLE` a policy rule can match.
    const secondAdminContext = await seeded.runtime.withSelectedContext(
      "Band",
      seeded.firstBand.meta.guid,
      {
        userId: seeded.guest.meta.guid,
        roles: [],
        channel: "api",
        now: new Date("2026-07-08T10:00:00.000Z"),
      },
    );

    const result = await seeded.runtime.executeCommand(
      "RevokeBandInvitation",
      { Invitation: pendingInvitation.meta.guid },
      secondAdminContext,
    );

    expect(result.steps.map((step) => [step.step, step.objectName])).toEqual([
      ["revokeInvitation", "BandInvitation"],
    ]);
    // Revoking a still-pending invitation is not a response from the invitee,
    // so `RespondedAt` must stay unset -- exactly what
    // `respondedAtRequiredAfterResponse` now allows for `Status == 'Revoked'`.
    expect(result.steps[0]?.record.values).toMatchObject({ Status: "Revoked" });
    expect(result.steps[0]?.record.values.RespondedAt ?? null).toBeNull();

    const sent = await seeded.runtime.executeReadModel("SentBandInvitations", secondAdminContext);
    expect(sent.rows.map((row) => row.values)).toContainEqual(
      expect.objectContaining({
        InviteeEmail: "riley.pending@example.com",
        Status: "Revoked",
        IsSender: false,
      }),
    );
  });

  it("wires MyInvitationList's Revoke row action to the exact invitation it renders, and hides it once no longer pending", async () => {
    const seeded = await createSeededBandReferenceRuntime();
    const pendingInvitation = await createPendingInvitation(seeded);

    const presentation = await seeded.runtime.evaluatePresentationView(
      "BandInvitation",
      "MyInvitationList",
      seeded.firstBandContext,
    );
    const section = presentation.sections.find((candidate) => candidate.name === "SentInvitations");
    const list = section?.lists.find((candidate) => candidate.name === "SentInvitationsList");
    const row = list?.rows.find(
      (candidate) => candidate.values.InviteeEmail === "riley.pending@example.com",
    );
    const action = row?.actions.find((candidate) => candidate.name === "revoke");

    expect(action).toBeDefined();
    expect(action?.command).toBe("RevokeBandInvitation");
    // Phase 69's row identity fix: `INPUT Invitation FROM id` resolves to
    // this row's own real record id (`meta.guid`), not the read model's
    // synthetic `readModel:source:guid` row key.
    expect(action?.input).toEqual({ Invitation: pendingInvitation.meta.guid });

    if (action?.input === undefined) {
      throw new Error("expected revoke action input");
    }

    // End-to-end: invoking the command with exactly the input the row action
    // computed revokes the invitation the row was rendered from.
    const result = await seeded.runtime.executeCommand(
      "RevokeBandInvitation",
      action.input,
      seeded.firstBandContext,
    );
    expect(result.steps[0]?.record.values).toMatchObject({ Status: "Revoked" });

    // `WHEN Status == 'Pending'` -- once revoked, the row no longer offers
    // the action at all (invisible actions are dropped from the row's
    // `actions` array, not merely marked `visible: false`).
    const afterRevoke = await seeded.runtime.evaluatePresentationView(
      "BandInvitation",
      "MyInvitationList",
      seeded.firstBandContext,
    );
    const afterSection = afterRevoke.sections.find(
      (candidate) => candidate.name === "SentInvitations",
    );
    const afterList = afterSection?.lists.find(
      (candidate) => candidate.name === "SentInvitationsList",
    );
    const afterRow = afterList?.rows.find(
      (candidate) => candidate.values.InviteeEmail === "riley.pending@example.com",
    );
    expect(afterRow?.values.Status).toBe("Revoked");
    expect(afterRow?.actions.find((candidate) => candidate.name === "revoke")).toBeUndefined();
  });

  it("refuses revoking a band invitation once it is no longer pending", async () => {
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

    // `seeded.musicianContext` is a genuine `BandAdmin`, so this isolates the
    // step's own `REQUIRE Status == 'Pending'` precondition rather than an
    // authorization failure.
    await expect(
      seeded.runtime.executeCommand(
        "RevokeBandInvitation",
        { Invitation: pendingInvitation.meta.guid },
        seeded.musicianContext,
      ),
    ).rejects.toBeInstanceOf(PolicyDeniedError);
  });

  it("refuses revoking a band invitation for a caller who is not a band admin", async () => {
    const seeded = await createSeededBandReferenceRuntime();
    const pendingInvitation = await createPendingInvitation(seeded);
    // The invitee holds no membership in the band at all before accepting, so
    // this proves `BandInvitationPolicy` denies revocation the same way it
    // denies every other admin-only `BandInvitation` operation -- being the
    // named `Invitee` grants no revoke rights, only `allowInviteeAcceptInvitation`
    // does, and only toward `Status == 'Accepted'`.
    const inviteeContext: RuntimeContext = {
      userId: seeded.guest.meta.guid,
      roles: [],
      channel: "api",
      now: new Date("2026-07-08T10:00:00.000Z"),
      selectedContexts: { Band: seeded.firstBand.meta.guid },
    };

    await expect(
      seeded.runtime.executeCommand(
        "RevokeBandInvitation",
        { Invitation: pendingInvitation.meta.guid },
        inviteeContext,
      ),
    ).rejects.toBeInstanceOf(PolicyDeniedError);
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
   * The gig form's own child collection, and the reason `Event.SetList` is gone:
   * giggle-new's gig form runs several set lists in a dragged order out of
   * `gig_set_lists(gig_id, set_list_id, position)`, which one lookup could never
   * express. Same declaration shape as `SetListForm`'s `Songs` collection above.
   */
  it("runs a gig's set lists in order through the gig form's child collection", async () => {
    const seeded = await createSeededBandReferenceRuntime();
    const context: RuntimeContext = { ...seeded.firstBandContext, channel: "ui" };

    const surface = await seeded.runtime.evaluateEditSurface("Event", "BandEventForm", context, {
      mode: "edit",
      recordId: seeded.firstEvent.meta.guid,
    });
    const setLists = surface.sections.find((section) => section.name === "SetLists");
    if (setLists?.kind !== "childCollection") {
      throw new Error("BandEventForm must declare a 'SetLists' child collection.");
    }

    expect(setLists.childObject).toBe("EventSetList");
    expect(setLists.parentField).toBe("Event");
    expect(setLists.orderField).toBe("Position");
    expect(setLists.rows.map((row) => row.values.Position)).toEqual([1, 2]);

    // The picker offers set lists, not link rows.
    const picker = await seeded.runtime.evaluateRelationshipPicker({
      objectName: "Event",
      viewName: "BandEventForm",
      sectionName: "SetLists",
      context,
      recordId: seeded.firstEvent.meta.guid,
    });
    expect(picker.picker.candidateField).toBe("SetList");
    // Both of this band's set lists are already attached to this event, so the
    // picker has nothing left to offer -- the modelled form of the dropdown
    // giggle-new rebuilds by hand to respect `(gig_id, set_list_id)`.
    expect(picker.candidates.map((candidate) => candidate.values.Name)).toEqual([]);
    expect(picker.diagnostics).toEqual([
      {
        code: "ADL_RUNTIME_RELATIONSHIP_PICKER_EMPTY",
        message: "Every set list this band has is already attached to this event.",
        section: "SetLists",
        severity: "warning",
      },
    ]);

    const secondRow = setLists.rows[1];
    expect(secondRow).toBeDefined();

    await seeded.runtime.applyStagedChildChanges({
      objectName: "Event",
      viewName: "BandEventForm",
      parentRecordId: seeded.firstEvent.meta.guid,
      context,
      stagedChanges: [
        {
          id: "staged-set-list-reorder-1",
          section: "SetLists",
          operation: "reorder",
          childObject: "EventSetList",
          childId: secondRow?.id ?? "",
          position: 1,
        },
      ],
    });

    const reordered = await seeded.runtime.search("EventSetList", undefined, context);
    expect(
      reordered
        .filter((link) => link.values.Event === seeded.firstEvent.meta.guid)
        .sort((left, right) => Number(left.values.Position) - Number(right.values.Position))
        .map((link) => [link.values.Position, link.values.SetList]),
    ).toEqual([
      [1, seeded.secondSetList.meta.guid],
      [2, seeded.firstSetList.meta.guid],
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
    // giggle-new's `set_list_songs` carries `UNIQUE (set_list_id, song_id)`:
    // the same song twice in one set list is refused by the object itself, not
    // merely hidden by `SongPicker`'s `EXCLUDE_LINKED`.
    await expect(
      seeded.runtime.create(
        "SetListItem",
        {
          Band: seeded.firstBand.meta.guid,
          SetList: seeded.firstSetList.meta.guid,
          Song: seeded.firstSong.meta.guid,
          Position: 4,
        },
        seeded.firstBandContext,
      ),
    ).rejects.toMatchObject({
      issues: [
        expect.objectContaining({
          code: "ADL_RUNTIME_CONSTRAINT_UNIQUE",
          field: "Song",
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

    // A song not already in this set list -- `uniqueSongInSetList` now refuses
    // a repeat, so the reorder-on-collision behaviour has to be shown with a
    // genuinely new song rather than a duplicate of the one at position 1.
    const inserted = await seeded.runtime.create(
      "SetListItem",
      {
        Band: seeded.firstBand.meta.guid,
        SetList: seeded.firstSetList.meta.guid,
        Song: seeded.fourthSong.meta.guid,
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
    // This behavioral test deliberately opts the standalone implementation
    // view into its local test shell. The reference app itself leaves it out.
    seeded.model.shell.nav.items.push({
      name: "SetListItemList",
      view: "SetListItemList",
      label: "Set list items",
      order: 999,
      activeWhen: ["SetListItemList"],
      visibility: { kind: "always" },
    });
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
    // The reference drawer intentionally omits this generic implementation
    // view; this test opts it in locally to exercise its form renderer.
    seeded.model.shell.nav.items.push({
      name: "BandInvitationList",
      view: "BandInvitationList",
      label: "Band invitations",
      order: 999,
      activeWhen: ["BandInvitationList"],
      visibility: { kind: "always" },
    });
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
      "Revoked",
    ]);
  });
});

async function createSeededBandReferenceRuntime() {
  const runtime = await createBandReferenceRuntime();
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
