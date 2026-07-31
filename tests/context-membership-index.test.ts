import { describe, expect, it } from "vitest";
import {
  ApplicationRuntime,
  InMemoryObjectStorageBackend,
  readMembershipFields,
  resolveApplicationModel,
} from "../src/index.js";
import type {
  ContextMembershipCandidate,
  ContextMembershipIndex,
  ResolvedContextMembership,
  StoredObjectRecord,
} from "../src/index.js";

const model = resolveApplicationModel({
  app: { name: "Membership index fixture", startView: "BandList" },
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
});

const membership = model.contexts?.[0]?.membership as ResolvedContextMembership;

function record(
  object: string,
  id: string,
  values: Record<string, string>,
  deletedAt?: string,
): StoredObjectRecord {
  return {
    meta: {
      guid: id,
      object,
      schemaVersion: 1,
      revision: `rev-${id}`,
      createdAt: "2026-07-31T00:00:00.000Z",
      createdBy: "seed",
      updatedAt: "2026-07-31T00:00:00.000Z",
      updatedBy: "seed",
      syncStatus: "synced",
      ...(deletedAt === undefined ? {} : { deletedAt }),
    },
    values,
  };
}

/** A test index that records what it was asked, so narrowing is observable. */
class RecordingIndex implements ContextMembershipIndex {
  readonly userRequests: Array<{ contextName: string; userId: string }> = [];
  constructor(private readonly rows: ContextMembershipCandidate[]) {}
  async listForUser(request: { contextName: string; userId: string }) {
    this.userRequests.push(request);
    return this.rows.filter((row) => row.userId === request.userId && !row.revoked);
  }
  async listForContext(request: { contextName: string; contextId: string; limit?: number }) {
    return this.rows.filter((row) => row.contextId === request.contextId);
  }
}

function candidate(
  membershipRecordId: string,
  userId: string,
  contextId: string,
  role: string,
  revoked = false,
): ContextMembershipCandidate {
  return { membershipRecordId, userId, contextId, role, revoked };
}

async function seed(storage: InMemoryObjectStorageBackend): Promise<void> {
  await storage.create("Band", record("Band", "band-1", { Name: "First" }));
  await storage.create("Band", record("Band", "band-2", { Name: "Second" }));
  await storage.create(
    "BandMember",
    record("BandMember", "member-1", { User: "user-1", Band: "band-1", Role: "BandAdmin" }),
  );
  await storage.create(
    "BandMember",
    record("BandMember", "member-2", { User: "user-1", Band: "band-2", Role: "BandMember" }),
  );
  await storage.create(
    "BandMember",
    record("BandMember", "member-3", { User: "user-2", Band: "band-1", Role: "BandMember" }),
  );
}

describe("context membership index port", () => {
  it("resolves exactly the contexts the scan resolves, without scanning", async () => {
    const scanned = new InMemoryObjectStorageBackend();
    const indexed = new InMemoryObjectStorageBackend();
    await seed(scanned);
    await seed(indexed);
    const index = new RecordingIndex([
      candidate("member-1", "user-1", "band-1", "BandAdmin"),
      candidate("member-2", "user-1", "band-2", "BandMember"),
      candidate("member-3", "user-2", "band-1", "BandMember"),
    ]);

    const withScan = await new ApplicationRuntime(model, {
      storage: scanned,
    }).contextService.listAvailableContexts("Band", {
      userId: "user-1",
      roles: [],
      channel: "api",
      online: true,
    });
    const withIndex = await new ApplicationRuntime(model, {
      storage: indexed,
      membershipIndex: index,
    }).contextService.listAvailableContexts("Band", {
      userId: "user-1",
      roles: [],
      channel: "api",
      online: true,
    });

    expect(withIndex).toEqual(withScan);
    expect(withIndex.map((entry) => entry.id)).toEqual(["band-1", "band-2"]);
    // Narrowed to one user in one business context, not the whole record set.
    expect(index.userRequests).toEqual([{ contextName: "Band", userId: "user-1" }]);
  });

  it("keeps the record authoritative when the index names a stale candidate", async () => {
    const storage = new InMemoryObjectStorageBackend();
    await seed(storage);
    // A candidate for a record that no longer exists, and one whose record was
    // tombstoned. Neither may become an available context.
    await storage.delete(
      "BandMember",
      record(
        "BandMember",
        "member-2",
        { User: "user-1", Band: "band-2", Role: "BandMember" },
        "2026-07-31T01:00:00.000Z",
      ),
    );
    const runtime = new ApplicationRuntime(model, {
      storage,
      membershipIndex: new RecordingIndex([
        candidate("member-1", "user-1", "band-1", "BandAdmin"),
        candidate("member-2", "user-1", "band-2", "BandMember"),
        candidate("member-gone", "user-1", "band-2", "BandAdmin"),
      ]),
    });

    const available = await runtime.contextService.listAvailableContexts("Band", {
      userId: "user-1",
      roles: [],
      channel: "api",
      online: true,
    });

    expect(available.map((entry) => entry.id)).toEqual(["band-1"]);
    expect(available[0]?.roles).toEqual(["BandAdmin"]);
  });

  it("takes the role from the record, not from the index", async () => {
    const storage = new InMemoryObjectStorageBackend();
    await seed(storage);
    const runtime = new ApplicationRuntime(model, {
      storage,
      // The index claims an elevated role the record does not carry.
      membershipIndex: new RecordingIndex([candidate("member-3", "user-2", "band-1", "BandAdmin")]),
    });

    const available = await runtime.contextService.listAvailableContexts("Band", {
      userId: "user-2",
      roles: [],
      channel: "api",
      online: true,
    });

    expect(available.map((entry) => entry.roles)).toEqual([["BandMember"]]);
  });

  it("scans when no index is supplied, so a device is unaffected", async () => {
    const storage = new InMemoryObjectStorageBackend();
    await seed(storage);
    const available = await new ApplicationRuntime(model, {
      storage,
    }).contextService.listAvailableContexts("Band", {
      userId: "user-2",
      roles: [],
      channel: "api",
      online: true,
    });
    expect(available.map((entry) => entry.id)).toEqual(["band-1"]);
  });
});

describe("readMembershipFields", () => {
  it("reads the three declared fields", () => {
    expect(
      readMembershipFields(membership, { User: "user-1", Band: "band-1", Role: "BandAdmin" }),
    ).toEqual({ userId: "user-1", contextId: "band-1", role: "BandAdmin" });
  });

  it("refuses a record that cannot be fully indexed rather than half-indexing it", () => {
    expect(readMembershipFields(membership, { User: "user-1", Band: "band-1" })).toBeUndefined();
    expect(
      readMembershipFields(membership, { User: "user-1", Band: "", Role: "BandAdmin" }),
    ).toBeUndefined();
    expect(
      readMembershipFields(membership, { User: "user-1", Band: 7, Role: "BandAdmin" }),
    ).toBeUndefined();
  });
});
