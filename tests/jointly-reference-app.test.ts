import { describe, expect, it } from "vitest";
import {
  PolicyDeniedError,
  RuntimeValidationError,
  validateApplicationModel,
} from "../src/index.js";
import {
  contextForCircle,
  createJointlyReferenceModel,
  createJointlyReferenceRuntime,
  jointlyReferenceSystemContext,
  seedJointlyReferenceRuntime,
} from "../src/reference/jointly-app.js";

async function createSeededJointlyReferenceRuntime() {
  const runtime = await createJointlyReferenceRuntime();
  return seedJointlyReferenceRuntime(runtime);
}

describe("jointly care reference app model", () => {
  it("validates the full care-coordination reference model", async () => {
    const model = await createJointlyReferenceModel();

    expect(validateApplicationModel(model)).toEqual([]);
    expect(model.modelVersion).toBe("1.3.0");
    expect(model.migrations).toContainEqual({ from: "1.0.0", to: "1.1.0", objects: [] });
    expect(model.migrations).toContainEqual({ from: "1.1.0", to: "1.2.0", objects: [] });
    expect(model.migrations).toContainEqual({ from: "1.2.0", to: "1.3.0", objects: [] });
    expect(model.app.startView).toBe("HomeDashboard");
    expect(model.objects.map((object) => object.name)).toEqual(
      expect.arrayContaining([
        "User",
        "Circle",
        "CircleMember",
        "CircleInvite",
        "Event",
        "Note",
        "Message",
        "Reminder",
      ]),
    );
    expect(model.contexts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Circle",
          membership: expect.objectContaining({
            object: "CircleMember",
            roles: ["CircleOwner", "CircleMember"],
          }),
        }),
      ]),
    );
    expect(model.commands?.map((command) => command.name)).toEqual(
      expect.arrayContaining(["CreateCircle", "AcceptCircleInvite", "DeclineCircleInvite"]),
    );
    expect(model.readModels?.map((readModel) => readModel.name)).toEqual(
      expect.arrayContaining([
        "HomeUpcomingEvents",
        "CircleCalendarItems",
        "MyPendingCircleInvites",
        "CircleMemberRoster",
        "CircleRecentNotes",
        "CircleRecentMessages",
      ]),
    );
  });

  it("seeds two overlapping circles plus a not-yet-joined invitee", async () => {
    const seeded = await createSeededJointlyReferenceRuntime();

    const members = await seeded.runtime.search("CircleMember", {}, seeded.firstCircleContext);
    expect(members.map((member) => member.values.User).sort()).toEqual(
      [seeded.carer.meta.guid, seeded.coCarer.meta.guid].sort(),
    );

    const secondCircleMembers = await seeded.runtime.search(
      "CircleMember",
      {},
      seeded.secondCircleContext,
    );
    expect(secondCircleMembers.map((member) => member.values.User)).toEqual([
      seeded.carer.meta.guid,
    ]);
  });

  it("scopes Circle-owned records to their own Circle: a CircleOwner may update their circle, a plain CircleMember may not", async () => {
    const seeded = await createSeededJointlyReferenceRuntime();

    const updated = await seeded.runtime.update(
      "Circle",
      seeded.firstCircle.meta.guid,
      { Description: "Updated description" },
      seeded.firstCircleContext,
    );
    expect(updated.values.Description).toBe("Updated description");

    await expect(
      seeded.runtime.update(
        "Circle",
        seeded.firstCircle.meta.guid,
        { Description: "Should be refused" },
        contextForCircle(seeded.coCarerContext, seeded.firstCircle.meta.guid),
      ),
    ).rejects.toBeInstanceOf(PolicyDeniedError);
  });

  it("denies reading a record in a Circle the caller never joined", async () => {
    const seeded = await createSeededJointlyReferenceRuntime();

    await expect(
      seeded.runtime.read("Event", seeded.secondEvent.meta.guid, seeded.coCarerContext),
    ).rejects.toBeInstanceOf(PolicyDeniedError);

    await expect(
      seeded.runtime.create(
        "CircleInvite",
        {
          Circle: seeded.secondCircle.meta.guid,
          InviteeEmail: "new-member@example.com",
          SentAt: "2026-08-16",
        },
        contextForCircle(seeded.coCarerContext, seeded.secondCircle.meta.guid),
      ),
    ).rejects.toBeInstanceOf(PolicyDeniedError);
  });

  it("brings a carer's events together across every circle they belong to", async () => {
    const seeded = await createSeededJointlyReferenceRuntime();

    const home = await seeded.runtime.executeReadModel("HomeUpcomingEvents", seeded.carerContext);
    expect(home.rows.map((row) => row.values.Title)).toEqual(["GP appointment", "Physio session"]);
    expect(home.rows.map((row) => row.values.CircleName)).toEqual([
      "Mum's Care Circle",
      "Dad's Care Circle",
    ]);
  });

  it("keeps the calendar and member roster scoped to the selected circle", async () => {
    const seeded = await createSeededJointlyReferenceRuntime();

    const calendar = await seeded.runtime.executeReadModel(
      "CircleCalendarItems",
      seeded.firstCircleContext,
    );
    expect(calendar.rows.map((row) => row.values.Title)).toEqual(["GP appointment"]);

    const roster = await seeded.runtime.executeReadModel(
      "CircleMemberRoster",
      seeded.firstCircleContext,
    );
    expect(roster.rows.map((row) => row.values.MemberEmail).sort()).toEqual(
      ["jordan@example.com", "sam@example.com"].sort(),
    );
  });

  it("surfaces a not-yet-joined invitee's own pending invite across circles", async () => {
    const seeded = await createSeededJointlyReferenceRuntime();

    const pending = await seeded.runtime.executeReadModel(
      "MyPendingCircleInvites",
      seeded.inviteeContext,
    );
    expect(pending.rows.map((row) => row.values)).toEqual([
      expect.objectContaining({
        InviteeEmail: "alex@example.com",
        Status: "pending",
      }),
    ]);
  });

  it("accepts a pending invite through AcceptCircleInvite, creating membership", async () => {
    const seeded = await createSeededJointlyReferenceRuntime();

    await expect(
      seeded.runtime.read("Circle", seeded.firstCircle.meta.guid, seeded.inviteeContext),
    ).rejects.toBeInstanceOf(PolicyDeniedError);

    // A `CONTEXT_GRANT`-admitted context still has to be selected, the same
    // way a membership-admitted one does: `withSelectedContext` is what
    // resolves `pendingCircleInvite`'s grant into `contextGrants`, which the
    // command's `UPDATE` step needs to clear the object-scope gate.
    const inviteeCircleContext = await seeded.runtime.withSelectedContext(
      "Circle",
      seeded.firstCircle.meta.guid,
      seeded.inviteeContext,
    );

    const result = await seeded.runtime.executeCommand(
      "AcceptCircleInvite",
      { Invite: seeded.pendingInvite.meta.guid },
      inviteeCircleContext,
    );
    expect(result.command.name).toBe("AcceptCircleInvite");

    const invite = await seeded.runtime.read(
      "CircleInvite",
      seeded.pendingInvite.meta.guid,
      inviteeCircleContext,
    );
    expect(invite?.values.Status).toBe("accepted");

    // Verified with the system context, not `inviteeCircleContext`: that
    // context's `contextRoles` were resolved before the command ran, so it
    // still does not know about the `CircleMember` the command's own
    // `AUTHORITY command` step just created.
    const members = await seeded.runtime.search(
      "CircleMember",
      {},
      contextForCircle(jointlyReferenceSystemContext, seeded.firstCircle.meta.guid),
    );
    expect(members.map((member) => member.values.User)).toContain(seeded.invitee.meta.guid);
  });

  it("declines a pending invite through DeclineCircleInvite without creating membership", async () => {
    const seeded = await createSeededJointlyReferenceRuntime();
    const decliner = await seeded.runtime.create(
      "User",
      { Email: "morgan@example.com", DisplayName: "Morgan Lee" },
      jointlyReferenceSystemContext,
    );
    const secondInvite = await seeded.runtime.create(
      "CircleInvite",
      {
        Circle: seeded.firstCircle.meta.guid,
        InvitedBy: seeded.carer.meta.guid,
        Invitee: decliner.meta.guid,
        InviteeEmail: "morgan@example.com",
        Status: "pending",
        SentAt: "2026-08-15",
      },
      contextForCircle(jointlyReferenceSystemContext, seeded.firstCircle.meta.guid),
    );
    const declinerContext = await seeded.runtime.withSelectedContext(
      "Circle",
      seeded.firstCircle.meta.guid,
      {
        userId: decliner.meta.guid,
        roles: [],
        channel: "api",
        now: jointlyReferenceSystemContext.now ?? new Date("2026-08-15T09:00:00.000Z"),
      },
    );

    await seeded.runtime.executeCommand(
      "DeclineCircleInvite",
      { Invite: secondInvite.meta.guid },
      declinerContext,
    );

    const invite = await seeded.runtime.read(
      "CircleInvite",
      secondInvite.meta.guid,
      declinerContext,
    );
    expect(invite?.values.Status).toBe("declined");

    const members = await seeded.runtime.search(
      "CircleMember",
      {},
      contextForCircle(jointlyReferenceSystemContext, seeded.firstCircle.meta.guid),
    );
    expect(members.map((member) => member.values.User)).not.toContain(decliner.meta.guid);
  });

  it("creates a circle and its founder membership through CreateCircle", async () => {
    const runtime = await createJointlyReferenceRuntime();
    const seeded = await seedJointlyReferenceRuntime(runtime);

    const result = await runtime.executeCommand(
      "CreateCircle",
      { Name: "Grandpa's Circle", Description: "A new circle." },
      seeded.carerContext,
    );
    expect(result.command.name).toBe("CreateCircle");

    const created = result.steps.find((step) => step.objectName === "Circle");
    if (created === undefined) {
      throw new Error("Expected CreateCircle to report the created Circle record.");
    }
    expect(created.record.values.Name).toBe("Grandpa's Circle");
    expect(created.record.values.Owner).toBe(seeded.carer.meta.guid);

    const newCircleContext = await runtime.withSelectedContext(
      "Circle",
      created.record.meta.guid,
      seeded.carerContext,
    );
    const founderMembership = await runtime.search("CircleMember", {}, newCircleContext);
    expect(founderMembership.map((member) => member.values.Role)).toEqual(["CircleOwner"]);
  });

  it("refuses a second Circle membership for the same user in the same circle", async () => {
    const seeded = await createSeededJointlyReferenceRuntime();

    await expect(
      seeded.runtime.create(
        "CircleMember",
        {
          Circle: seeded.firstCircle.meta.guid,
          User: seeded.coCarer.meta.guid,
          Role: "CircleMember",
        },
        contextForCircle(jointlyReferenceSystemContext, seeded.firstCircle.meta.guid),
      ),
    ).rejects.toMatchObject({
      name: "RuntimeValidationError",
      issues: [expect.objectContaining({ code: "ADL_RUNTIME_CONSTRAINT_UNIQUE" })],
    });
  });

  it("refuses removing a circle's last CircleOwner", async () => {
    const seeded = await createSeededJointlyReferenceRuntime();
    const members = await seeded.runtime.search("CircleMember", {}, seeded.secondCircleContext);
    const founderMembership = members.find(
      (member) => member.values.User === seeded.carer.meta.guid,
    );
    if (founderMembership === undefined) {
      throw new Error("Expected the seeded founder CircleMember record.");
    }
    expect(founderMembership.values.Role).toBe("CircleOwner");

    await expect(
      seeded.runtime.delete(
        "CircleMember",
        founderMembership.meta.guid,
        seeded.secondCircleContext,
      ),
    ).rejects.toBeInstanceOf(RuntimeValidationError);
  });

  it("rejects an event whose end is before its start", async () => {
    const seeded = await createSeededJointlyReferenceRuntime();

    await expect(
      seeded.runtime.create(
        "Event",
        {
          Circle: seeded.firstCircle.meta.guid,
          Title: "Backwards event",
          StartsAt: "2026-08-22T10:00:00.000Z",
          EndsAt: "2026-08-22T09:00:00.000Z",
        },
        seeded.firstCircleContext,
      ),
    ).rejects.toBeInstanceOf(RuntimeValidationError);
  });

  it("keeps a circle member's offline dataset to the circles they actually belong to", async () => {
    const seeded = await createSeededJointlyReferenceRuntime();

    // `carerContext`'s own dataset legitimately includes both events: `carer`
    // belongs to both circles, and `HomeUpcomingEvents` (`SCOPE
    // allAvailableContexts`) pulls every circle they belong to into the
    // dataset a locally-running home dashboard needs. `coCarer` belongs to
    // only `firstCircle`, so no read model gives them a path to
    // `secondEvent` -- the cleaner proof that the dataset stays bounded to
    // what a caller can actually reach, not just to `Event`'s own bare
    // `SYNC ... SCOPE currentContext`.
    const coCarerCircleContext = await seeded.runtime.withSelectedContext(
      "Circle",
      seeded.firstCircle.meta.guid,
      seeded.coCarerContext,
    );
    const dataset = await seeded.runtime.evaluateOfflineDataset(coCarerCircleContext);
    const eventRecordIds = dataset.records
      .filter((record) => record.objectName === "Event")
      .map((record) => record.recordId);
    expect(eventRecordIds).toEqual([seeded.firstEvent.meta.guid]);
    expect(eventRecordIds).not.toContain(seeded.secondEvent.meta.guid);

    const eventSearch = await seeded.runtime.searchLocalDataset(
      "Event",
      { text: "GP", fields: ["Title"] },
      coCarerCircleContext,
    );
    expect(eventSearch.map((record) => record.values.Title)).toEqual(["GP appointment"]);
  });
});
