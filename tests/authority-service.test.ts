import { describe, expect, it } from "vitest";
import {
  AuthorityService,
  InMemoryObjectStorageBackend,
  StaticSessionAdapter,
  validateApplicationModel,
  resolveApplicationModel,
} from "../src/index.js";
import type { StoredObjectRecord } from "../src/index.js";

const tokenAdmin = "a".repeat(48);
const tokenMember = "b".repeat(48);
const model = resolveApplicationModel({
  app: { name: "Authority fixture", startView: "GigList" },
  roles: [{ name: "BandAdmin" }, { name: "BandMember" }],
  contexts: [
    {
      name: "Band",
      object: "Band",
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
    { name: "Band", fields: [{ name: "Name", type: "text", required: true }] },
    {
      name: "BandMember",
      scope: { context: "Band", field: "Band" },
      fields: [
        { name: "User", type: "text", required: true },
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
      name: "Gig",
      scope: { context: "Band", field: "Band" },
      fields: [
        {
          name: "Band",
          type: "text",
          required: true,
          lookup: { targetObject: "Band", displayField: "Name" },
        },
        { name: "Title", type: "text", required: true },
      ],
      views: [
        {
          name: "GigList",
          kind: "list",
          context: { mode: "required", context: "Band" },
          fields: ["Title"],
          actions: ["create", "read", "update"],
        },
      ],
      sync: { mode: "localFirst", conflict: "manual" },
    },
  ],
  policies: [
    {
      name: "BandPolicy",
      object: "Band",
      rules: [
        {
          name: "membersRead",
          effect: "allow",
          principal: { match: "specific", roles: ["BandAdmin", "BandMember"] },
          action: "read",
        },
      ],
    },
    {
      name: "BandMemberPolicy",
      object: "BandMember",
      rules: [
        {
          name: "membersRead",
          effect: "allow",
          principal: { match: "specific", roles: ["BandAdmin", "BandMember"] },
          action: "read",
        },
      ],
    },
    {
      name: "GigPolicy",
      object: "Gig",
      rules: [
        {
          name: "membersRead",
          effect: "allow",
          principal: { match: "specific", roles: ["BandAdmin", "BandMember"] },
          action: "read",
        },
        {
          name: "adminsCreate",
          effect: "allow",
          principal: { match: "specific", roles: ["BandAdmin"] },
          action: "create",
        },
        {
          name: "adminsUpdate",
          effect: "allow",
          principal: { match: "specific", roles: ["BandAdmin"] },
          action: "update",
        },
      ],
    },
  ],
});

function record(object: string, id: string, values: Record<string, string>): StoredObjectRecord {
  return {
    meta: {
      guid: id,
      object,
      schemaVersion: 1,
      revision: `rev-${id}`,
      createdAt: "2026-07-21T00:00:00.000Z",
      createdBy: "seed",
      updatedAt: "2026-07-21T00:00:00.000Z",
      updatedBy: "seed",
      syncStatus: "synced",
    },
    values,
  };
}

async function fixture() {
  const storage = new InMemoryObjectStorageBackend();
  await storage.create("Band", record("Band", "band-1", { Name: "Giggle" }));
  await storage.create(
    "BandMember",
    record("BandMember", "membership-admin", {
      User: "admin-1",
      Band: "band-1",
      Role: "BandAdmin",
    }),
  );
  await storage.create(
    "BandMember",
    record("BandMember", "membership-member", {
      User: "member-1",
      Band: "band-1",
      Role: "BandMember",
    }),
  );
  return new AuthorityService(
    model,
    storage,
    new StaticSessionAdapter(
      new Map([
        [tokenAdmin, { userId: "admin-1" }],
        [tokenMember, { userId: "member-1" }],
      ]),
    ),
  );
}

describe("AuthorityService", () => {
  it("fixture model is valid", () => expect(validateApplicationModel(model)).toEqual([]));
  it("derives band roles from accepted memberships, rejects spoofed access, and deduplicates", async () => {
    const authority = await fixture();
    const adminIntent = {
      operationId: "op-create-1",
      kind: "create" as const,
      objectName: "Gig",
      values: { Band: "band-1", Title: "Friday rehearsal" },
      selectedContexts: { Band: "band-1" },
    };
    const accepted = await authority.replay(tokenAdmin, adminIntent);
    expect(accepted.status).toBe("accepted");
    const repeated = await authority.replay(tokenAdmin, adminIntent);
    expect(repeated).toEqual(accepted);
    const spoofed = await authority.replay(tokenMember, {
      operationId: "op-member-create",
      kind: "create",
      objectName: "Gig",
      values: { Band: "band-1", Title: "crafted write" },
      selectedContexts: { Band: "band-1" },
    });
    expect(spoofed).toMatchObject({ status: "rejected", code: "ADL_POLICY_DENIED" });
    const noSession = await authority.replay(undefined, {
      ...adminIntent,
      operationId: "op-no-session",
    });
    expect(noSession).toMatchObject({ status: "rejected", code: "ADL_AUTH_UNAUTHENTICATED" });
  });

  it("does not let a caller select a context they do not belong to", async () => {
    const authority = await fixture();
    const result = await authority.replay(tokenMember, {
      operationId: "op-outside-context",
      kind: "create",
      objectName: "Gig",
      values: { Band: "other-band", Title: "crafted write" },
      selectedContexts: { Band: "other-band" },
    });
    expect(result).toMatchObject({ status: "rejected", code: "ADL_RUNTIME_CONTEXT_ERROR" });
  });

  it("bootstraps only policy-shaped records in the authenticated selected context", async () => {
    const authority = await fixture();
    await authority.replay(tokenAdmin, {
      operationId: "op-bootstrap-create",
      kind: "create",
      objectName: "Gig",
      values: { Band: "band-1", Title: "Visible rehearsal" },
      selectedContexts: { Band: "band-1" },
    });
    const memberPull = await authority.bootstrap(tokenMember, {
      selectedContexts: { Band: "band-1" },
      limit: 1,
    });
    expect(memberPull.records).toHaveLength(1);
    expect(memberPull.records[0]).toMatchObject({
      objectName: "Band",
      record: { values: { Name: "Giggle" } },
    });
    const forbiddenPull = await authority.bootstrap(tokenMember, {
      selectedContexts: { Band: "outside-band" },
    });
    expect(forbiddenPull.records).toEqual([]);
  });
});
