import { beforeEach, describe, expect, it } from "vitest";
import { ApplicationRuntime, PolicyDeniedError, resolveApplicationModel } from "../src/index.js";
import type {
  PartialApplicationModel,
  PartialPolicyModel,
  RuntimeContext,
  StoredObjectRecord,
} from "../src/index.js";
import { bandContextPartialModel } from "./fixtures/band-context-model.js";

const fixedNow = new Date("2026-08-20T09:00:00.000Z");

const systemContext: RuntimeContext = {
  userId: "system-admin",
  roles: ["SystemAdmin"],
  channel: "api",
  now: fixedNow,
};

function callerContext(userId: string): RuntimeContext {
  return { userId, roles: [], channel: "api", now: fixedNow };
}

function adminOnlyPolicies(objects: string[]): PartialPolicyModel[] {
  return objects.map((object) => ({
    name: `${object}AdminPolicy`,
    object,
    rules: [
      {
        name: `allowSystemAdminAll${object}Ops`,
        effect: "allow" as const,
        principal: { match: "specific" as const, roles: ["SystemAdmin"] },
        action: "*" as const,
      },
    ],
  }));
}

/**
 * Phase 101's shape, verbatim in intent: any signed-in caller may learn a
 * person's display name and may not pull the record, the email, or the
 * directory.
 */
const phase101FieldScopedUserRule = {
  name: "allowAuthenticatedReadUserName",
  effect: "allow" as const,
  principal: { match: "authenticated" as const },
  action: "read" as const,
  fields: ["Name"],
};

/**
 * The language as it stood before this phase: `OWNER` is the closest principal
 * to "this record is me", and a `User` record carries none of the four things
 * `isOwner` looks at about the person it describes.
 */
function createPreSelfPartialModel(): PartialApplicationModel {
  return {
    ...bandContextPartialModel,
    roles: [{ name: "SystemAdmin" }, { name: "BandAdmin" }, { name: "BandMember" }],
    policies: [
      ...adminOnlyPolicies(["Band", "BandMember", "Gig"]),
      {
        name: "UserPolicy",
        object: "User",
        rules: [
          phase101FieldScopedUserRule,
          {
            name: "allowUserOwnerReadUser",
            effect: "allow",
            principal: { match: "owner" },
            action: "read",
          },
        ],
      },
      ...adminOnlyPolicies(["User"]),
    ],
  } satisfies PartialApplicationModel;
}

/** The same model with a row-level `SELF` grant added and nothing else changed. */
function createSelfPartialModel(
  extraUserRules: PartialPolicyModel["rules"] = [],
): PartialApplicationModel {
  const partial = createPreSelfPartialModel();

  return {
    ...partial,
    policies: (partial.policies ?? []).map((policy) =>
      policy.name === "UserPolicy"
        ? {
            ...policy,
            rules: [
              ...(policy.rules ?? []),
              {
                name: "allowUserReadSelf",
                effect: "allow" as const,
                principal: { match: "self" as const },
                action: "read" as const,
              },
              {
                name: "allowUserUpdateSelf",
                effect: "allow" as const,
                principal: { match: "self" as const },
                action: "update" as const,
              },
              ...(extraUserRules ?? []),
            ],
          }
        : policy,
    ),
  } satisfies PartialApplicationModel;
}

interface SeededUsers {
  runtime: ApplicationRuntime;
  alice: StoredObjectRecord;
  bob: StoredObjectRecord;
  aliceContext: RuntimeContext;
  bobContext: RuntimeContext;
}

async function seedUsers(partialModel: PartialApplicationModel): Promise<SeededUsers> {
  const runtime = new ApplicationRuntime(resolveApplicationModel(partialModel));
  await runtime.whenReady();

  const alice = await runtime.create(
    "User",
    { Name: "Alice Adams", Email: "alice@example.com" },
    systemContext,
  );
  const bob = await runtime.create(
    "User",
    { Name: "Bob Brand", Email: "bob@example.com" },
    systemContext,
  );

  return {
    runtime,
    alice,
    bob,
    aliceContext: callerContext(alice.meta.guid),
    bobContext: callerContext(bob.meta.guid),
  };
}

describe("the gap SELF closes: no pre-Phase-103 construct grants a self-read", () => {
  let seeded: SeededUsers;

  beforeEach(async () => {
    seeded = await seedUsers(createPreSelfPartialModel());
  });

  it("refuses a caller their own User record even with ALLOW READ OWNER declared", async () => {
    // `isOwner` looks at `meta.createdBy`, `values.CreatedBy`, `values.OwnerId`
    // and `values.ownerId`. A `User` record carries none of them about the
    // person it describes, and the seed's `createdBy` is the administrator.
    expect(seeded.alice.meta.createdBy).toBe("system-admin");

    await expect(
      seeded.runtime.read("User", seeded.alice.meta.guid, seeded.aliceContext),
    ).rejects.toBeInstanceOf(PolicyDeniedError);
  });

  it("gives that same caller only the field Phase 101's rule names", async () => {
    const label = await seeded.runtime.readFieldsForDisplay(
      "User",
      seeded.alice.meta.guid,
      ["Name", "Email"],
      seeded.aliceContext,
    );

    expect(label?.values).toEqual({ Name: "Alice Adams" });
  });
});

describe("SELF policy principal", () => {
  let seeded: SeededUsers;

  beforeEach(async () => {
    seeded = await seedUsers(createSelfPartialModel());
  });

  it("lets a caller read their own record in full, including ungranted fields", async () => {
    const record = await seeded.runtime.read("User", seeded.alice.meta.guid, seeded.aliceContext);

    expect(record?.values.Name).toBe("Alice Adams");
    // `Email` is granted by no field-scoped rule; the row grant is what carries it.
    expect(record?.values.Email).toBe("alice@example.com");
  });

  it("refuses another user's record", async () => {
    await expect(
      seeded.runtime.read("User", seeded.bob.meta.guid, seeded.aliceContext),
    ).rejects.toBeInstanceOf(PolicyDeniedError);
  });

  it("grants no search, so the directory Phase 101 closed stays closed", async () => {
    await expect(
      seeded.runtime.search("User", undefined, seeded.aliceContext),
    ).rejects.toBeInstanceOf(PolicyDeniedError);
  });

  it("cannot widen search even when the SELF rule names every action", async () => {
    // The rule the search test above cannot state on its own: with `ALLOW READ
    // SELF` there is simply no search rule, so its refusal would hold for any
    // principal. `ALLOW * SELF` *does* name search, and it is still refused,
    // because the object-level gate is evaluated with no record for `isSelf` to
    // compare the caller against. That is what makes "a SELF grant can never
    // reopen a user directory" a property of the request shape rather than of
    // careful policy authoring.
    const wildcard = await seedUsers(
      createSelfPartialModel([
        {
          name: "allowUserAllOpsSelf",
          effect: "allow",
          principal: { match: "self" },
          action: "*",
        },
      ]),
    );

    await expect(
      wildcard.runtime.search("User", undefined, wildcard.aliceContext),
    ).rejects.toBeInstanceOf(PolicyDeniedError);

    // The positive control for the same model: the wildcard rule is live, so
    // the refusal above is about the request shape and not about a dead rule.
    const own = await wildcard.runtime.read(
      "User",
      wildcard.alice.meta.guid,
      wildcard.aliceContext,
    );
    expect(own?.values.Email).toBe("alice@example.com");
  });

  it("still lets a caller resolve another user's display name through the field-scoped rule", async () => {
    const label = await seeded.runtime.readFieldsForDisplay(
      "User",
      seeded.bob.meta.guid,
      ["Name", "Email"],
      seeded.aliceContext,
    );

    expect(label?.values).toEqual({ Name: "Bob Brand" });
  });

  it("matches on the record's own guid, not on who created it", () => {
    const decision = seeded.runtime.policyEngine.evaluate(
      { objectName: "User", action: "read", record: seeded.alice },
      // The administrator created every seeded record, so a `SELF` rule keyed on
      // `meta.createdBy` would allow this and one keyed on `meta.guid` must not.
      callerContext("system-admin-not-a-record-id"),
    );

    expect(decision.effect).toBe("deny");
  });

  it("fails closed with no record on the request", () => {
    const decision = seeded.runtime.policyEngine.evaluate(
      { objectName: "User", action: "read" },
      seeded.aliceContext,
    );

    expect(decision.effect).toBe("deny");
  });

  it("fails closed for an unauthenticated caller", () => {
    const decision = seeded.runtime.policyEngine.evaluate(
      { objectName: "User", action: "read", record: seeded.alice },
      { userId: "", roles: [], channel: "api", now: fixedNow },
    );

    expect(decision.effect).toBe("deny");
  });

  it("lets an explicit DENY beat the SELF allow", async () => {
    const withDeny = await seedUsers(
      createSelfPartialModel([
        {
          name: "denyAuthenticatedReadUser",
          effect: "deny",
          principal: { match: "authenticated" },
          action: "read",
        },
      ]),
    );

    await expect(
      withDeny.runtime.read("User", withDeny.alice.meta.guid, withDeny.aliceContext),
    ).rejects.toBeInstanceOf(PolicyDeniedError);
  });

  it("lets a field-scoped HIDDEN beat the SELF allow for that field only", async () => {
    const withHidden = await seedUsers(
      createSelfPartialModel([
        {
          name: "hideEmailFromEveryone",
          effect: "hidden",
          principal: { match: "authenticated" },
          action: "read",
          fields: ["Email"],
        },
      ]),
    );

    const record = await withHidden.runtime.read(
      "User",
      withHidden.alice.meta.guid,
      withHidden.aliceContext,
    );

    expect(record?.values.Name).toBe("Alice Adams");
    expect(record?.values.Email).toBeUndefined();
  });

  it("grants the update it names and nothing it does not", async () => {
    const updated = await seeded.runtime.update(
      "User",
      seeded.alice.meta.guid,
      { Name: "Alice Anderson" },
      seeded.aliceContext,
    );
    expect(updated.values.Name).toBe("Alice Anderson");

    await expect(
      seeded.runtime.delete("User", seeded.alice.meta.guid, seeded.aliceContext),
    ).rejects.toBeInstanceOf(PolicyDeniedError);
  });
});
