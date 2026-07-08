// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import {
  PolicyDeniedError,
  RuntimeValidationError,
  validateApplicationModel,
} from "../src/index.js";
import type { RuntimeContext } from "../src/index.js";
import {
  createBandReferenceModel,
  createBandReferenceRuntime,
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

  it("represents ordered set-list items with a validated position field", async () => {
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
          Position: 0,
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
