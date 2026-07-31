import { describe, expect, it } from "vitest";
import { ApplicationRuntime, PolicyDeniedError, resolveApplicationModel } from "../src/index.js";
import type {
  PartialApplicationModel,
  PartialPolicyModel,
  RuntimeContext,
  StoredObjectRecord,
} from "../src/index.js";

const fixedNow = new Date("2026-07-07T08:00:00.000Z");

describe("read model declared joins", () => {
  it("fans out a many join through a junction object", async () => {
    const seeded = await createSeededJoinRuntime();

    const result = await seeded.runtime.executeReadModel(
      "BandMemberAvailability",
      seeded.alphaContext,
    );

    // One upstream BandMember row becomes one row per matching Availability,
    // which the id-based lookup join could never produce.
    expect(result.rows.map((row) => row.values)).toEqual([
      { MemberName: "Casey Morgan", Date: "2026-08-01", Status: "Public" },
      { MemberName: "Casey Morgan", Date: "2026-08-02", Status: "Public" },
      { MemberName: "Robin Fox", Date: "2026-08-01", Status: "Public" },
    ]);
  });

  it("keeps every produced row's sources correct across a fan-out", async () => {
    const seeded = await createSeededJoinRuntime();

    const result = await seeded.runtime.executeReadModel(
      "BandMemberAvailability",
      seeded.alphaContext,
    );

    expect(result.rows.map((row) => row.sources)).toEqual([
      {
        member: { objectName: "BandMember", recordId: seeded.caseyAlphaMember.meta.guid },
        user: { objectName: "User", recordId: seeded.casey.meta.guid },
        availability: { objectName: "Availability", recordId: seeded.caseyFirst.meta.guid },
      },
      {
        member: { objectName: "BandMember", recordId: seeded.caseyAlphaMember.meta.guid },
        user: { objectName: "User", recordId: seeded.casey.meta.guid },
        availability: { objectName: "Availability", recordId: seeded.caseySecond.meta.guid },
      },
      {
        member: { objectName: "BandMember", recordId: seeded.robinAlphaMember.meta.guid },
        user: { objectName: "User", recordId: seeded.robin.meta.guid },
        availability: { objectName: "Availability", recordId: seeded.robinFirst.meta.guid },
      },
    ]);
    expect(new Set(result.rows.map((row) => row.id)).size).toBe(3);
  });

  it("drops upstream rows whose many join matches nothing", async () => {
    const seeded = await createSeededJoinRuntime();

    const result = await seeded.runtime.executeReadModel(
      "BandMemberAvailability",
      seeded.alphaContext,
    );

    // Sam is a member of the selected band with no availability at all.
    expect(result.rows.some((row) => row.values.MemberName === "Sam Blake")).toBe(false);
    expect(
      result.rows.some((row) => row.sources.member?.recordId === seeded.samAlphaMember.meta.guid),
    ).toBe(false);
  });

  it("keeps the row count unchanged for a one join and drops rows with no match", async () => {
    const seeded = await createSeededJoinRuntime();

    const result = await seeded.runtime.executeReadModel("UserProfileDirectory", seeded.caseyBase);

    // Four users exist; only the two with a profile survive the one join, and
    // neither of them produces more than one row.
    expect(result.rows.map((row) => row.values)).toEqual([
      { Name: "Casey Morgan", Nickname: "Case" },
      { Name: "Robin Fox", Nickname: "Rob" },
    ]);
  });

  it("joins on the record id on both sides", async () => {
    const seeded = await createSeededJoinRuntime();

    const result = await seeded.runtime.executeReadModel("UserProfileDirectory", seeded.caseyBase);

    // UserProfile carries no user field: the profile record's own id is the
    // user's own id, and the join says so on both sides.
    expect(result.rows.map((row) => row.sources)).toEqual([
      {
        user: { objectName: "User", recordId: seeded.casey.meta.guid },
        profile: { objectName: "UserProfile", recordId: seeded.casey.meta.guid },
      },
      {
        user: { objectName: "User", recordId: seeded.robin.meta.guid },
        profile: { objectName: "UserProfile", recordId: seeded.robin.meta.guid },
      },
    ]);
  });

  it("excludes joined records the caller may not read", async () => {
    const seeded = await createSeededJoinRuntime();
    const permissive = await createSeededJoinRuntime(createPermissiveAvailabilityPartialModel());

    const restricted = await seeded.runtime.executeReadModel(
      "BandMemberAvailability",
      seeded.alphaContext,
    );
    const unrestricted = await permissive.runtime.executeReadModel(
      "BandMemberAvailability",
      permissive.alphaContext,
    );

    // The same record set differs only by the read policy on Availability, so
    // the private row is excluded by policy and not by an absent record.
    expect(restricted.rows.filter((row) => row.values.MemberName === "Casey Morgan")).toHaveLength(
      2,
    );
    expect(
      unrestricted.rows.filter((row) => row.values.MemberName === "Casey Morgan"),
    ).toHaveLength(3);
    expect(restricted.rows.some((row) => row.values.Status === "Private")).toBe(false);
    expect(restricted.rows.some((row) => row.values.Date === "2026-08-03")).toBe(false);
    expect(
      restricted.rows.some(
        (row) => row.sources.availability?.recordId === seeded.caseyPrivate.meta.guid,
      ),
    ).toBe(false);
  });

  it("refuses a caller without the search action on a joined object", async () => {
    const seeded = await createSeededJoinRuntime(createUnsearchableAvailabilityPartialModel());

    // A fan-out join enumerates a set, so it must not become a way around the
    // search grant the caller was never given.
    await expect(
      seeded.runtime.executeReadModel("BandMemberAvailability", seeded.alphaContext),
    ).rejects.toBeInstanceOf(PolicyDeniedError);
    await expect(
      seeded.runtime.executeReadModel("BandMemberAvailability", seeded.alphaContext),
    ).rejects.toThrow("Policy denied search on object 'Availability'.");

    // The same caller and model still project everything that does not depend
    // on searching the joined object, so the refusal is the join and nothing
    // else.
    const unaffected = await seeded.runtime.executeReadModel("MemberBands", seeded.alphaContext);
    expect(unaffected.rows).toHaveLength(3);
  });

  it("keeps joined records inside the selected context", async () => {
    const seeded = await createSeededJoinRuntime();

    const alpha = await seeded.runtime.executeReadModel(
      "BandMemberAvailability",
      seeded.alphaContext,
    );
    const beta = await seeded.runtime.executeReadModel(
      "BandMemberAvailability",
      seeded.betaContext,
    );

    // Availability is not context-scoped; the junction source is, so selecting a
    // context is what decides whose availability may be seen.
    expect(alpha.rows.map((row) => row.values.MemberName)).toEqual([
      "Casey Morgan",
      "Casey Morgan",
      "Robin Fox",
    ]);
    expect(beta.rows.map((row) => row.values.MemberName)).toEqual([
      "Casey Morgan",
      "Casey Morgan",
      "Taylor Reed",
    ]);
    expect(alpha.rows.some((row) => row.values.MemberName === "Taylor Reed")).toBe(false);
    expect(beta.rows.some((row) => row.values.MemberName === "Robin Fox")).toBe(false);
    expect(
      beta.rows.every((row) => row.sources.member?.recordId !== seeded.robinAlphaMember.meta.guid),
    ).toBe(true);
  });

  it("leaves an undeclared lookup-joined source exactly as it was", async () => {
    const seeded = await createSeededJoinRuntime();

    const result = await seeded.runtime.executeReadModel("MemberBands", seeded.alphaContext);

    // Ordered by row id here rather than by the read model's sort, because two
    // of these members share a role and the sort tie-breaks on generated ids.
    expect(sortRowsById(result.rows)).toEqual(
      sortRowsById([
        {
          id: `MemberBands:member:${seeded.caseyAlphaMember.meta.guid}|band:${seeded.alphaBand.meta.guid}`,
          readModel: "MemberBands",
          values: { MemberRole: "BandAdmin", BandName: "The Alphas" },
          sources: {
            member: { objectName: "BandMember", recordId: seeded.caseyAlphaMember.meta.guid },
            band: { objectName: "Band", recordId: seeded.alphaBand.meta.guid },
          },
        },
        {
          id: `MemberBands:member:${seeded.robinAlphaMember.meta.guid}|band:${seeded.alphaBand.meta.guid}`,
          readModel: "MemberBands",
          values: { MemberRole: "BandMember", BandName: "The Alphas" },
          sources: {
            member: { objectName: "BandMember", recordId: seeded.robinAlphaMember.meta.guid },
            band: { objectName: "Band", recordId: seeded.alphaBand.meta.guid },
          },
        },
        {
          id: `MemberBands:member:${seeded.samAlphaMember.meta.guid}|band:${seeded.alphaBand.meta.guid}`,
          readModel: "MemberBands",
          values: { MemberRole: "BandMember", BandName: "The Alphas" },
          sources: {
            member: { objectName: "BandMember", recordId: seeded.samAlphaMember.meta.guid },
            band: { objectName: "Band", recordId: seeded.alphaBand.meta.guid },
          },
        },
      ]),
    );
  });
});

function sortRowsById<T extends { id: string }>(rows: T[]): T[] {
  return [...rows].sort((left, right) => left.id.localeCompare(right.id));
}

interface SeededJoinRuntime {
  runtime: ApplicationRuntime;
  caseyBase: RuntimeContext;
  alphaContext: RuntimeContext;
  betaContext: RuntimeContext;
  alphaBand: StoredObjectRecord;
  betaBand: StoredObjectRecord;
  casey: StoredObjectRecord;
  robin: StoredObjectRecord;
  caseyAlphaMember: StoredObjectRecord;
  robinAlphaMember: StoredObjectRecord;
  samAlphaMember: StoredObjectRecord;
  caseyFirst: StoredObjectRecord;
  caseySecond: StoredObjectRecord;
  caseyPrivate: StoredObjectRecord;
  robinFirst: StoredObjectRecord;
}

async function createSeededJoinRuntime(
  partialModel: PartialApplicationModel = createJoinPartialModel(),
): Promise<SeededJoinRuntime> {
  const runtime = new ApplicationRuntime(resolveApplicationModel(partialModel));
  const systemContext: RuntimeContext = {
    userId: "system-admin",
    roles: ["SystemAdmin"],
    channel: "api",
    now: fixedNow,
  };

  const casey = await runtime.create(
    "User",
    { Name: "Casey Morgan", Email: "casey@example.com" },
    systemContext,
  );
  const robin = await runtime.create(
    "User",
    { Name: "Robin Fox", Email: "robin@example.com" },
    systemContext,
  );
  const sam = await runtime.create(
    "User",
    { Name: "Sam Blake", Email: "sam@example.com" },
    systemContext,
  );
  const taylor = await runtime.create(
    "User",
    { Name: "Taylor Reed", Email: "taylor@example.com" },
    systemContext,
  );

  // A profile shares its user's record id, so the only way to join it is on the
  // record id of both sides.
  await runtime.create("UserProfile", { Nickname: "Case" }, systemContext, {
    recordId: casey.meta.guid,
  });
  await runtime.create("UserProfile", { Nickname: "Rob" }, systemContext, {
    recordId: robin.meta.guid,
  });

  const alphaBand = await runtime.create("Band", { Name: "The Alphas" }, systemContext);
  const betaBand = await runtime.create("Band", { Name: "The Betas" }, systemContext);

  const caseyAlphaMember = await runtime.create(
    "BandMember",
    { User: casey.meta.guid, Band: alphaBand.meta.guid, Role: "BandAdmin" },
    contextForBand(systemContext, alphaBand.meta.guid),
  );
  const robinAlphaMember = await runtime.create(
    "BandMember",
    { User: robin.meta.guid, Band: alphaBand.meta.guid, Role: "BandMember" },
    contextForBand(systemContext, alphaBand.meta.guid),
  );
  const samAlphaMember = await runtime.create(
    "BandMember",
    { User: sam.meta.guid, Band: alphaBand.meta.guid, Role: "BandMember" },
    contextForBand(systemContext, alphaBand.meta.guid),
  );
  await runtime.create(
    "BandMember",
    { User: casey.meta.guid, Band: betaBand.meta.guid, Role: "BandMember" },
    contextForBand(systemContext, betaBand.meta.guid),
  );
  await runtime.create(
    "BandMember",
    { User: taylor.meta.guid, Band: betaBand.meta.guid, Role: "BandMember" },
    contextForBand(systemContext, betaBand.meta.guid),
  );

  const caseyFirst = await runtime.create(
    "Availability",
    { User: casey.meta.guid, Date: "2026-08-01", Status: "Public" },
    systemContext,
  );
  const caseySecond = await runtime.create(
    "Availability",
    { User: casey.meta.guid, Date: "2026-08-02", Status: "Public" },
    systemContext,
  );
  const caseyPrivate = await runtime.create(
    "Availability",
    { User: casey.meta.guid, Date: "2026-08-03", Status: "Private" },
    systemContext,
  );
  const robinFirst = await runtime.create(
    "Availability",
    { User: robin.meta.guid, Date: "2026-08-01", Status: "Public" },
    systemContext,
  );
  await runtime.create(
    "Availability",
    { User: taylor.meta.guid, Date: "2026-08-05", Status: "Public" },
    systemContext,
  );

  const caseyBase: RuntimeContext = {
    userId: casey.meta.guid,
    roles: [],
    channel: "api",
    now: fixedNow,
  };

  return {
    runtime,
    caseyBase,
    alphaContext: await runtime.withSelectedContext("Band", alphaBand.meta.guid, caseyBase),
    betaContext: await runtime.withSelectedContext("Band", betaBand.meta.guid, caseyBase),
    alphaBand,
    betaBand,
    casey,
    robin,
    caseyAlphaMember,
    robinAlphaMember,
    samAlphaMember,
    caseyFirst,
    caseySecond,
    caseyPrivate,
    robinFirst,
  };
}

function contextForBand(context: RuntimeContext, bandId: string): RuntimeContext {
  return {
    ...context,
    selectedContexts: {
      ...(context.selectedContexts ?? {}),
      Band: bandId,
    },
  };
}

function createJoinPartialModel(): PartialApplicationModel {
  return {
    app: { name: "ReadModelJoins" },
    roles: [
      { name: "SystemAdmin" },
      { name: "BandMember" },
      { name: "BandAdmin", inherits: ["BandMember"] },
    ],
    contexts: [
      { name: "User", object: "User", selection: { mode: "required" } },
      {
        name: "Band",
        selection: { mode: "optional" },
        membership: {
          object: "BandMember",
          userField: "User",
          contextField: "Band",
          roleField: "Role",
          roles: ["BandAdmin", "BandMember"],
        },
      },
    ],
    objects: [
      {
        name: "User",
        businessKey: "Email",
        displayField: "Name",
        fields: [
          { name: "Name", type: "text", required: true },
          { name: "Email", type: "text", required: true, validators: [{ kind: "email" }] },
        ],
      },
      {
        name: "UserProfile",
        displayField: "Nickname",
        fields: [{ name: "Nickname", type: "text", required: true }],
      },
      {
        name: "Band",
        displayField: "Name",
        fields: [{ name: "Name", type: "text", required: true }],
      },
      {
        name: "BandMember",
        scope: { context: "Band", field: "Band" },
        fields: [
          {
            name: "User",
            type: "text",
            required: true,
            lookup: { targetObject: "User", displayField: "Name" },
          },
          {
            name: "Band",
            type: "text",
            required: true,
            lookup: { targetObject: "Band", displayField: "Name" },
          },
          { name: "Role", type: "text", required: true },
        ],
      },
      {
        name: "Availability",
        displayField: "Date",
        fields: [
          {
            name: "User",
            type: "text",
            required: true,
            lookup: { targetObject: "User", displayField: "Name" },
          },
          { name: "Date", type: "date", required: true },
          { name: "Status", type: "text", required: true },
        ],
      },
    ],
    readModels: [
      {
        // The real case: the selected band's membership is the junction that
        // reaches availability, which references only the shared User.
        name: "BandMemberAvailability",
        context: { mode: "required", context: "Band" },
        sources: [
          { name: "member", object: "BandMember", scope: "currentContext" },
          {
            name: "user",
            object: "User",
            scope: "all",
            join: {
              source: "member",
              localField: "id",
              sourceField: "User",
              cardinality: "one",
            },
          },
          {
            name: "availability",
            object: "Availability",
            scope: "all",
            join: {
              source: "member",
              localField: "User",
              sourceField: "User",
              cardinality: "many",
            },
          },
        ],
        fields: [
          { name: "MemberName", source: "user", field: "Name" },
          { name: "Date", source: "availability", field: "Date" },
          { name: "Status", source: "availability", field: "Status" },
        ],
        sort: [
          { field: "MemberName", direction: "asc" },
          { field: "Date", direction: "asc" },
        ],
      },
      {
        name: "UserProfileDirectory",
        sources: [
          { name: "user", object: "User", scope: "all" },
          {
            name: "profile",
            object: "UserProfile",
            scope: "all",
            join: {
              source: "user",
              localField: "id",
              sourceField: "id",
              cardinality: "one",
            },
          },
        ],
        fields: [
          { name: "Name", source: "user", field: "Name" },
          { name: "Nickname", source: "profile", field: "Nickname" },
        ],
        sort: [{ field: "Name", direction: "asc" }],
      },
      {
        // No join declared: the implicit lookup-field behaviour must be
        // untouched.
        name: "MemberBands",
        context: { mode: "required", context: "Band" },
        sources: [
          { name: "member", object: "BandMember", scope: "currentContext" },
          { name: "band", object: "Band", scope: "all" },
        ],
        fields: [
          { name: "MemberRole", source: "member", field: "Role" },
          { name: "BandName", source: "band", field: "Name" },
        ],
        sort: [{ field: "MemberRole", direction: "asc" }],
      },
    ],
    policies: [
      createSystemAdminAndReaderPolicy("User"),
      createSystemAdminAndReaderPolicy("UserProfile"),
      createSystemAdminAndReaderPolicy("Band"),
      createSystemAdminAndReaderPolicy("BandMember"),
      {
        name: "AvailabilityPolicy",
        object: "Availability",
        rules: [
          {
            name: "allowSystemAdminAllAvailabilityOps",
            effect: "allow",
            principal: { match: "specific", roles: ["SystemAdmin"] },
            action: "*",
          },
          {
            name: "allowSearchAvailability",
            effect: "allow",
            principal: { match: "authenticated" },
            action: "search",
          },
          {
            name: "allowReadPublicAvailability",
            effect: "allow",
            principal: { match: "authenticated" },
            action: "read",
            condition: {
              kind: "equals",
              left: { kind: "field", field: "Status" },
              right: { kind: "literal", value: "Public" },
            },
          },
        ],
      },
    ],
  };
}

function createSystemAdminAndReaderPolicy(objectName: string): PartialPolicyModel {
  return {
    name: `${objectName}Policy`,
    object: objectName,
    rules: [
      {
        name: `allowSystemAdminAll${objectName}Ops`,
        effect: "allow",
        principal: { match: "specific", roles: ["SystemAdmin"] },
        action: "*",
      },
      {
        name: `allowSearch${objectName}`,
        effect: "allow",
        principal: { match: "authenticated" },
        action: "search",
      },
      {
        name: `allowRead${objectName}`,
        effect: "allow",
        principal: { match: "authenticated" },
        action: "read",
      },
    ],
  };
}

/** Identical to the base model except that private availability is readable. */
function createPermissiveAvailabilityPartialModel(): PartialApplicationModel {
  const partial = createJoinPartialModel();

  return {
    ...partial,
    policies: (partial.policies ?? []).map((policy) =>
      policy.object === "Availability"
        ? {
            ...policy,
            rules: (policy.rules ?? []).map((rule) =>
              rule.name === "allowReadPublicAvailability"
                ? {
                    name: rule.name,
                    effect: rule.effect,
                    ...(rule.principal === undefined ? {} : { principal: rule.principal }),
                    action: rule.action,
                  }
                : rule,
            ),
          }
        : policy,
    ),
  };
}

/** Identical to the base model except that nobody may search availability. */
function createUnsearchableAvailabilityPartialModel(): PartialApplicationModel {
  const partial = createJoinPartialModel();

  return {
    ...partial,
    policies: (partial.policies ?? []).map((policy) =>
      policy.object === "Availability"
        ? {
            ...policy,
            rules: (policy.rules ?? []).filter((rule) => rule.name !== "allowSearchAvailability"),
          }
        : policy,
    ),
  };
}
