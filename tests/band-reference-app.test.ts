// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import {
  PolicyDeniedError,
  RuntimeValidationError,
  validateApplicationModel,
} from "../src/index.js";
import type { RuntimeContext } from "../src/index.js";
import {
  bandReferenceSystemContext,
  createBandReferenceModel,
  createBandReferenceRuntime,
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
    expect(syncByObject.get("StreamingLink")).toMatchObject({
      mode: "cacheReadonly",
      scope: "currentContext",
    });
    expect(syncByObject.get("DevicePreference")).toMatchObject({
      mode: "localPrivate",
      scope: "currentUser",
    });
  });
});

describe("band reference app runtime", () => {
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
      {
        EventDate: "2026-08-01",
        StartTime: "20:00",
        EventType: "Gig",
        Title: "Canal Street headline",
        VenueName: "Alpha Hall",
        BandName: "The Alphas",
      },
      {
        EventDate: "2026-08-02",
        StartTime: "18:30",
        EventType: "Rehearsal",
        Title: "New set rehearsal",
        VenueName: "Beta Rooms",
        BandName: "The Betas",
      },
    ]);

    const setList = await seeded.runtime.executeReadModel(
      "SetListItemsByPosition",
      seeded.firstBandContext,
    );
    expect(setList.rows.map((row) => row.values)).toEqual([
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
    ]);
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
      { Invitation: seeded.invitation.meta.guid },
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

  it("keeps invitation acceptance atomic when membership creation violates uniqueness", async () => {
    const seeded = await createSeededBandReferenceRuntime();
    const inviteeContext: RuntimeContext = {
      userId: seeded.guest.meta.guid,
      roles: [],
      channel: "api",
      now: new Date("2026-07-08T10:00:00.000Z"),
      selectedContexts: { Band: seeded.firstBand.meta.guid },
    };

    await seeded.runtime.executeCommand(
      "AcceptBandInvitation",
      { Invitation: seeded.invitation.meta.guid },
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
    await expect(
      seeded.runtime.create(
        "SetListItem",
        {
          Band: seeded.firstBand.meta.guid,
          SetList: seeded.firstSetList.meta.guid,
          Song: seeded.firstSong.meta.guid,
          Position: 2,
        },
        seeded.firstBandContext,
      ),
    ).rejects.toMatchObject({
      issues: [
        expect.objectContaining({
          code: "ADL_RUNTIME_CONSTRAINT_ORDERED_DUPLICATE",
          field: "Position",
        }),
      ],
    });
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

    expect(app.textContent).toContain("Band Reference");
    expect(app.querySelector("adl-dashboard-view")).not.toBeNull();
    expect(app.textContent).toContain("Canal Street headline");
    expect(app.textContent).toContain("New set rehearsal");
    expect(app.textContent).toContain("The Alphas");
    expect(app.textContent).toContain("The Betas");
  });
});

async function createSeededBandReferenceRuntime() {
  const runtime = createBandReferenceRuntime();
  return seedBandReferenceRuntime(runtime);
}

async function flushUi(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
