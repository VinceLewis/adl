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
    expect(syncByObject.get("StreamingLink")).toMatchObject({
      mode: "cacheReadonly",
      scope: "currentContext",
    });
    expect(syncByObject.get("DevicePreference")).toMatchObject({
      mode: "localPrivate",
      scope: "currentUser",
    });
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

    expect(app.textContent).toContain("Giggle Band ADL Example");
    expect(app.querySelector("adl-composed-view")).not.toBeNull();
    expect(app.querySelector("[data-presentation-section='Schedule']")).not.toBeNull();
    expect(app.textContent).toContain("Canal Street headline");
    expect(app.textContent).toContain("New set rehearsal");
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

    const viewSelector = requireElement<HTMLSelectElement>(app, "select[data-view-switch='true']");
    viewSelector.value = "SetListItemList";
    viewSelector.dispatchEvent(new Event("change", { bubbles: true }));
    await flushUi();
    await waitForText(app, "Glass Arcade");

    const rows = [...app.querySelectorAll("adl-list-view tbody tr")];
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.textContent?.replace(/\s+/g, " ").trim())).toEqual([
      expect.stringContaining("Neon Map"),
      expect.stringContaining("Late Signal"),
      expect.stringContaining("Glass Arcade"),
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

    const viewSelector = requireElement<HTMLSelectElement>(app, "select[data-view-switch='true']");
    viewSelector.value = "BandEventList";
    viewSelector.dispatchEvent(new Event("change", { bubbles: true }));
    await flushUi();
    await waitForText(app, "Canal Street headline");

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

    const viewSelector = requireElement<HTMLSelectElement>(app, "select[data-view-switch='true']");
    viewSelector.value = "BandEventList";
    viewSelector.dispatchEvent(new Event("change", { bubbles: true }));
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

    const viewSelector = requireElement<HTMLSelectElement>(app, "select[data-view-switch='true']");
    viewSelector.value = "BandInvitationList";
    viewSelector.dispatchEvent(new Event("change", { bubbles: true }));
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
