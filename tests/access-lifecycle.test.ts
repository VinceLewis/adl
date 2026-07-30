import { describe, expect, it } from "vitest";
import {
  AuthorityAccessLifecycleService,
  AuthorityService,
  InMemoryAuthorityAccessStore,
  InMemoryAuthorityIdentitySessionStore,
  InMemoryObjectStorageBackend,
  OpaqueSessionAdapter,
  resolveApplicationModel,
  validateApplicationModel,
} from "../src/index.js";
import type { StoredObjectRecord } from "../src/index.js";

const model = resolveApplicationModel({
  app: { name: "Access lifecycle fixture", startView: "BandList" },
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
    {
      name: "Band",
      fields: [{ name: "Name", type: "text", required: true }],
      views: [{ name: "BandList", kind: "list", fields: ["Name"], actions: ["read"] }],
    },
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
        {
          name: "adminsManageMembership",
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
      revision: "rev-1",
      createdAt: "2026-07-21T00:00:00.000Z",
      createdBy: "seed",
      updatedAt: "2026-07-21T00:00:00.000Z",
      updatedBy: "seed",
      syncStatus: "synced",
    },
    values,
  };
}

describe("authority identity and access lifecycle", () => {
  it("uses opaque server sessions and makes rotation, expiry, and sign-out effective", async () => {
    let now = new Date("2026-07-21T12:00:00.000Z");
    const ids = ["alice", "session-1", "session-2"];
    const tokens = ["a".repeat(48), "b".repeat(48)];
    const sessions = new OpaqueSessionAdapter(new InMemoryAuthorityIdentitySessionStore(), {
      now: () => now,
      newId: () => ids.shift() ?? "overflow",
      newToken: () => tokens.shift() ?? "z".repeat(48),
      sessionTtlMs: 60_000,
    });
    const alice = await sessions.provisionIdentity("bypass", "alice@example.test");
    const issued = await sessions.issueSession(alice.userId);
    expect(await sessions.verify(issued.sessionToken)).toMatchObject({ userId: alice.userId });
    const rotated = await sessions.rotate(issued.sessionToken);
    expect(await sessions.verify(issued.sessionToken)).toBeNull();
    expect(await sessions.verify(rotated?.sessionToken)).toMatchObject({ userId: alice.userId });
    await sessions.signOut(rotated?.sessionToken);
    expect(await sessions.verify(rotated?.sessionToken)).toBeNull();
    const expiring = await sessions.issueSession(alice.userId, new Date(now.getTime() + 1));
    now = new Date(now.getTime() + 1);
    expect(await sessions.verify(expiring.sessionToken)).toBeNull();
  });

  it("claims an online invite exactly once, derives access from membership, and revokes it", async () => {
    expect(validateApplicationModel(model)).toEqual([]);
    const storage = new InMemoryObjectStorageBackend();
    let now = new Date("2026-07-21T12:00:00.000Z");
    const sessionIds = ["admin", "recipient", "outsider", "s1", "s2", "s3"];
    const sessionTokens = ["a".repeat(48), "b".repeat(48), "c".repeat(48)];
    const sessions = new OpaqueSessionAdapter(new InMemoryAuthorityIdentitySessionStore(), {
      now: () => now,
      newId: () => sessionIds.shift() ?? "overflow",
      newToken: () => sessionTokens.shift() ?? "z".repeat(48),
    });
    const admin = await sessions.provisionIdentity("bypass", "admin@example.test");
    const recipient = await sessions.provisionIdentity("bypass", "recipient@example.test");
    const outsider = await sessions.provisionIdentity("bypass", "outsider@example.test");
    const adminSession = await sessions.issueSession(admin.userId);
    const recipientSession = await sessions.issueSession(recipient.userId);
    const outsiderSession = await sessions.issueSession(outsider.userId);
    await storage.create("Band", record("Band", "band-1", { Name: "Giggle" }));
    await storage.create(
      "BandMember",
      record("BandMember", "membership-admin", {
        User: admin.userId,
        Band: "band-1",
        Role: "BandAdmin",
      }),
    );
    await storage.create(
      "BandMember",
      record("BandMember", "membership-outsider", {
        User: outsider.userId,
        Band: "band-1",
        Role: "BandMember",
      }),
    );
    const accessStore = new InMemoryAuthorityAccessStore(storage);
    const access = new AuthorityAccessLifecycleService(model, storage, sessions, accessStore, {
      now: () => now,
      newId: (() => {
        let value = 0;
        return () => `access-${++value}`;
      })(),
      newToken: (() => {
        let value = 0;
        return () => `invite-${++value}`.padEnd(48, "i");
      })(),
    });

    const invite = await access.createInvite(adminSession.sessionToken, {
      contextName: "Band",
      contextId: "band-1",
      role: "BandMember",
      recipientUserId: recipient.userId,
      expiresAt: new Date(now.getTime() + 60_000),
    });
    await expect(
      access.createInvite(outsiderSession.sessionToken, {
        contextName: "Band",
        contextId: "band-1",
        role: "BandMember",
        expiresAt: new Date(now.getTime() + 60_000),
      }),
    ).rejects.toMatchObject({ code: "ADL_POLICY_DENIED" });
    expect(await access.claimInvite(outsiderSession.sessionToken, invite.inviteToken)).toEqual({
      status: "rejected",
      code: "ADL_INVITE_INVALID",
    });
    const claimed = await access.claimInvite(recipientSession.sessionToken, invite.inviteToken);
    expect(claimed.status).toBe("accepted");
    expect(await access.claimInvite(recipientSession.sessionToken, invite.inviteToken)).toEqual(
      claimed,
    );
    expect(accessStore.getAuditEvents().map((event) => event.kind)).toEqual([
      "inviteCreated",
      "inviteClaimed",
    ]);
    expect(JSON.stringify(accessStore.getAuditEvents())).not.toContain(invite.inviteToken);

    const expiring = await access.createInvite(adminSession.sessionToken, {
      contextName: "Band",
      contextId: "band-1",
      role: "BandMember",
      expiresAt: new Date(now.getTime() + 1),
    });
    now = new Date(now.getTime() + 1);
    expect(await access.claimInvite(recipientSession.sessionToken, expiring.inviteToken)).toEqual({
      status: "rejected",
      code: "ADL_INVITE_INVALID",
    });
    const revoked = await access.createInvite(adminSession.sessionToken, {
      contextName: "Band",
      contextId: "band-1",
      role: "BandMember",
      expiresAt: new Date(now.getTime() + 60_000),
    });
    expect(
      await access.revokeInvite(adminSession.sessionToken, {
        inviteId: revoked.inviteId,
        contextName: "Band",
        contextId: "band-1",
      }),
    ).toBe(true);
    expect(await access.claimInvite(recipientSession.sessionToken, revoked.inviteToken)).toEqual({
      status: "rejected",
      code: "ADL_INVITE_INVALID",
    });

    const authority = new AuthorityService(model, storage, sessions);
    expect(
      (
        await authority.bootstrap(recipientSession.sessionToken, {
          selectedContexts: { Band: "band-1" },
        })
      ).records.map((entry) => entry.objectName),
    ).toContain("Band");
    expect(
      await access.revokeMembership(adminSession.sessionToken, {
        contextName: "Band",
        contextId: "band-1",
        userId: recipient.userId,
        role: "BandMember",
      }),
    ).toBe(true);
    expect(await sessions.verify(recipientSession.sessionToken)).toBeNull();
    expect(
      await authority.bootstrap(recipientSession.sessionToken, {
        selectedContexts: { Band: "band-1" },
      }),
    ).toEqual({ records: [] });
    expect(
      await authority.replay(recipientSession.sessionToken, {
        operationId: "revoked-session-replay",
        kind: "create",
        objectName: "Band",
        recordId: "band-crafted-after-revocation",
        values: { Name: "crafted after revocation" },
      }),
    ).toMatchObject({ status: "rejected", code: "ADL_AUTH_UNAUTHENTICATED" });
  });
});
