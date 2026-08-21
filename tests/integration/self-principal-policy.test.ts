import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Pool } from "pg";
import {
  ApplicationRuntime,
  PolicyDeniedError,
  PostgresObjectStorageBackend,
  resolveApplicationModel,
  validateApplicationModel,
} from "../../src/index.js";
import type {
  PartialApplicationModel,
  ResolvedApplicationModel,
  RuntimeContext,
} from "../../src/index.js";
import { authorityPool, resetProjections, seedApplication } from "./pg-harness.js";

/**
 * Phase 103, against real PostgreSQL because policy enforcement is an
 * authority-side claim and `AGENTS.md` will not accept a fake for one. The
 * precedent is `tests/integration/user-directory-policy.test.ts`, which pins
 * Phase 101's field-scoped `UserPolicy` the same way.
 *
 * The claim under test is the *combination*: adding a row-level `SELF` grant
 * to a `User` object that already carries Phase 101's field-scoped rule gives
 * the caller their own record in full and leaves every refusal Phase 101
 * established exactly where it was — the other person's record, the other
 * person's email, and the directory.
 *
 * The model is built here rather than taken from a reference app on purpose:
 * this phase ships the capability and changes no shipped application's content,
 * so no reference app declares a `SELF` rule to borrow.
 */

const applicationId = "phase-103-self";

let pool: Pool;
let model: ResolvedApplicationModel;

/** Phase 101's `UserPolicy` shape, verbatim in intent, plus the new row grant. */
const selfPolicyPartialModel = {
  app: { name: "SelfPrincipalDirectory", startView: "PersonList" },
  roles: [{ name: "SystemAdmin" }],
  contexts: [{ name: "User", object: "User", selection: { mode: "required" } }],
  objects: [
    {
      name: "User",
      businessKey: "Email",
      displayField: "Name",
      fields: [
        { name: "Name", type: "text", required: true },
        { name: "Email", type: "text", required: true },
      ],
      views: [{ name: "PersonList", kind: "list", fields: ["Name"] }],
    },
  ],
  policies: [
    {
      name: "UserSystemAdminPolicy",
      object: "User",
      rules: [
        {
          name: "allowSystemAdminAllUserOps",
          effect: "allow",
          principal: { match: "specific", roles: ["SystemAdmin"] },
          action: "*",
        },
      ],
    },
    {
      name: "UserPolicy",
      object: "User",
      rules: [
        {
          name: "allowAuthenticatedReadUserName",
          effect: "allow",
          principal: { match: "authenticated" },
          action: "read",
          fields: ["Name"],
        },
        {
          name: "allowUserReadSelf",
          effect: "allow",
          principal: { match: "self" },
          action: "read",
        },
        {
          name: "allowUserUpdateSelf",
          effect: "allow",
          principal: { match: "self" },
          action: "update",
        },
      ],
    },
  ],
} satisfies PartialApplicationModel;

const now = new Date("2026-08-20T09:00:00.000Z");
const adminContext: RuntimeContext = {
  userId: "system-admin",
  roles: ["SystemAdmin"],
  channel: "api",
  now,
};

function callerContext(userId: string): RuntimeContext {
  return { userId, roles: [], channel: "api", now };
}

beforeAll(async () => {
  pool = new Pool({ connectionString: inject("pgUrl"), max: 8 });
  model = resolveApplicationModel(selfPolicyPartialModel);
  expect(validateApplicationModel(model)).toEqual([]);
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await resetProjections(pool);
  await seedApplication(pool, applicationId, model.modelVersion);
});

async function seed(): Promise<{
  runtime: ApplicationRuntime;
  aliceId: string;
  bobId: string;
}> {
  const runtime = new ApplicationRuntime(model, {
    storage: new PostgresObjectStorageBackend(authorityPool(pool), applicationId, model),
  });
  await runtime.whenReady();

  const alice = await runtime.create(
    "User",
    { Name: "Alice Adams", Email: "alice@example.com" },
    adminContext,
  );
  const bob = await runtime.create(
    "User",
    { Name: "Bob Brand", Email: "bob@example.com" },
    adminContext,
  );

  return { runtime, aliceId: alice.meta.guid, bobId: bob.meta.guid };
}

describe("a SELF row grant beside Phase 101's field-scoped rule, over real PostgreSQL", () => {
  it("gives a caller their own record in full", async () => {
    const { runtime, aliceId } = await seed();

    const own = await runtime.read("User", aliceId, callerContext(aliceId));

    expect(own?.values.Name).toBe("Alice Adams");
    // No field-scoped rule names `Email`; the row grant is what carries it.
    expect(own?.values.Email).toBe("alice@example.com");
  });

  it("still refuses another user's record, their email, and the directory", async () => {
    const { runtime, aliceId, bobId } = await seed();
    const alice = callerContext(aliceId);

    await expect(runtime.read("User", bobId, alice)).rejects.toBeInstanceOf(PolicyDeniedError);
    await expect(runtime.search("User", undefined, alice)).rejects.toBeInstanceOf(
      PolicyDeniedError,
    );

    // The label Phase 101 kept working still works, and still carries only the
    // one field. Asserted on the rendered values, not on the absence of a throw.
    const label = await runtime.readFieldsForDisplay("User", bobId, ["Name", "Email"], alice);
    expect(label?.values).toEqual({ Name: "Bob Brand" });
  });

  it("refuses a signed-in caller who is nobody in this directory", async () => {
    const { runtime, aliceId } = await seed();
    const stranger = callerContext("self-registered-stranger");

    await expect(runtime.read("User", aliceId, stranger)).rejects.toBeInstanceOf(PolicyDeniedError);
    await expect(runtime.search("User", undefined, stranger)).rejects.toBeInstanceOf(
      PolicyDeniedError,
    );
  });

  it("cannot widen search even when the SELF rule names every action", async () => {
    // The strongest form of the Phase 101 guarantee, and the only form of it
    // that says anything about `SELF` specifically: the model above declares no
    // `search` rule at all, so its refusal would hold for any principal.
    // `ALLOW * SELF` does name search, and is still refused, because the
    // object-level gate is evaluated before any record is fetched and `isSelf`
    // has nothing to compare the caller against.
    const wildcardId = `${applicationId}-wildcard`;
    const wildcardModel = resolveApplicationModel({
      ...selfPolicyPartialModel,
      policies: selfPolicyPartialModel.policies.map((policy) =>
        policy.name === "UserPolicy"
          ? {
              ...policy,
              rules: [
                ...policy.rules,
                {
                  name: "allowUserAllOpsSelf",
                  effect: "allow" as const,
                  principal: { match: "self" as const },
                  action: "*" as const,
                },
              ],
            }
          : policy,
      ),
    });
    expect(validateApplicationModel(wildcardModel)).toEqual([]);
    await seedApplication(pool, wildcardId, wildcardModel.modelVersion);

    const runtime = new ApplicationRuntime(wildcardModel, {
      storage: new PostgresObjectStorageBackend(authorityPool(pool), wildcardId, wildcardModel),
    });
    await runtime.whenReady();
    const alice = await runtime.create(
      "User",
      { Name: "Alice Adams", Email: "alice@example.com" },
      adminContext,
    );
    await runtime.create("User", { Name: "Bob Brand", Email: "bob@example.com" }, adminContext);

    await expect(
      runtime.search("User", undefined, callerContext(alice.meta.guid)),
    ).rejects.toBeInstanceOf(PolicyDeniedError);

    // The positive control: the wildcard rule is live on a record, so the
    // refusal above is about the request shape and not about a dead rule.
    const own = await runtime.read("User", alice.meta.guid, callerContext(alice.meta.guid));
    expect(own?.values.Email).toBe("alice@example.com");
  });

  it("lets the caller update their own record and refuses the update of another's", async () => {
    const { runtime, aliceId, bobId } = await seed();
    const alice = callerContext(aliceId);

    const updated = await runtime.update("User", aliceId, { Name: "Alice Anderson" }, alice);
    expect(updated.values.Name).toBe("Alice Anderson");

    await expect(
      runtime.update("User", bobId, { Name: "Bobby Brand" }, alice),
    ).rejects.toBeInstanceOf(PolicyDeniedError);

    // And the refused write left nothing behind in the projection.
    const bobAfter = await runtime.read("User", bobId, adminContext);
    expect(bobAfter?.values.Name).toBe("Bob Brand");
  });

  it("grants no delete, because the rules name read and update only", async () => {
    const { runtime, aliceId } = await seed();

    await expect(runtime.delete("User", aliceId, callerContext(aliceId))).rejects.toBeInstanceOf(
      PolicyDeniedError,
    );

    const stillThere = await runtime.read("User", aliceId, adminContext);
    expect(stillThere?.values.Name).toBe("Alice Adams");
  });
});
