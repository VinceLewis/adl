import { describe, expect, it } from "vitest";
import {
  ApplicationRuntime,
  AuthoritySyncClient,
  InMemoryObjectStorageBackend,
  resolveApplicationModel,
  validateApplicationModel,
} from "../src/index.js";
import type {
  AuthorityBootstrapRequest,
  AuthorityBootstrapResponse,
  AuthorityOperationIntent,
  AuthorityOutcome,
  AuthorityTransport,
  PartialApplicationModel,
  RuntimeContext,
  StoredObjectRecord,
} from "../src/index.js";

/**
 * `AuthoritySyncClient` is the browser side of the loop. It must apply every
 * bootstrap page the authority discloses (a cursor that stops at page one
 * silently drops permitted records), send each queued local-first entry exactly
 * once, and never let a local-private operation reach the wire.
 */

const partialModel: PartialApplicationModel = {
  app: { name: "SyncClientFixture" },
  roles: [{ name: "Admin" }],
  objects: [
    {
      name: "Gig",
      businessKey: "Title",
      displayField: "Title",
      fields: [{ name: "Title", type: "text", required: true }],
      sync: { mode: "localFirst", conflict: "manual" },
    },
    {
      name: "PrivateNote",
      businessKey: "Body",
      displayField: "Body",
      fields: [{ name: "Body", type: "text", required: true }],
      sync: { mode: "localPrivate" },
    },
  ],
  policies: [
    {
      name: "GigPolicy",
      object: "Gig",
      rules: [
        {
          name: "adminAll",
          effect: "allow",
          principal: { match: "specific", roles: ["Admin"] },
          action: "*",
        },
      ],
    },
    {
      name: "PrivateNotePolicy",
      object: "PrivateNote",
      rules: [
        {
          name: "adminAll",
          effect: "allow",
          principal: { match: "specific", roles: ["Admin"] },
          action: "*",
        },
      ],
    },
  ],
};

const model = resolveApplicationModel(partialModel);
const gigSchemaVersion = model.objects.find((object) => object.name === "Gig")?.schemaVersion ?? 1;

const adminContext: RuntimeContext = {
  userId: "user-42",
  roles: ["Admin"],
  channel: "ui",
};

function remoteGig(id: string, title: string): StoredObjectRecord {
  return {
    meta: {
      guid: id,
      object: "Gig",
      schemaVersion: gigSchemaVersion,
      revision: `server-rev-${id}`,
      createdAt: "2026-07-30T00:00:00.000Z",
      createdBy: "authority",
      updatedAt: "2026-07-30T00:00:00.000Z",
      updatedBy: "authority",
      syncStatus: "synced",
    },
    values: { Title: title },
  };
}

/** In-memory authority. Every call is recorded so the wire payload can be asserted. */
class FakeAuthorityTransport implements AuthorityTransport {
  readonly bootstrapCalls: (AuthorityBootstrapRequest | undefined)[] = [];
  readonly replayCalls: AuthorityOperationIntent[] = [];

  constructor(
    private readonly pages: readonly AuthorityBootstrapResponse[] = [],
    private readonly outcomeFor: (intent: AuthorityOperationIntent) => AuthorityOutcome = (
      intent,
    ) => ({ status: "accepted", operationId: intent.operationId, records: [] }),
  ) {}

  async bootstrap(
    _sessionToken: string | undefined,
    request?: AuthorityBootstrapRequest,
  ): Promise<AuthorityBootstrapResponse> {
    this.bootstrapCalls.push(request);
    const page = this.pages[this.bootstrapCalls.length - 1];
    if (page === undefined)
      throw new Error(
        `The client requested bootstrap page ${this.bootstrapCalls.length}, beyond the fixture.`,
      );
    return page;
  }

  async replay(
    _sessionToken: string | undefined,
    intent: AuthorityOperationIntent,
  ): Promise<AuthorityOutcome> {
    this.replayCalls.push(intent);
    return this.outcomeFor(intent);
  }
}

function newRuntime(): ApplicationRuntime {
  return new ApplicationRuntime(model, { storage: new InMemoryObjectStorageBackend() });
}

describe("AuthoritySyncClient bootstrap paging", () => {
  it("fixture model is valid", () => expect(validateApplicationModel(model)).toEqual([]));

  it("follows nextCursor across every page and applies each page's records", async () => {
    const runtime = newRuntime();
    const transport = new FakeAuthorityTransport([
      {
        records: [{ objectName: "Gig", record: remoteGig("gig-1", "Page one") }],
        nextCursor: "c1",
      },
      {
        records: [{ objectName: "Gig", record: remoteGig("gig-2", "Page two") }],
        nextCursor: "c2",
      },
      { records: [{ objectName: "Gig", record: remoteGig("gig-3", "Page three") }] },
    ]);
    const client = new AuthoritySyncClient(runtime, transport);

    const result = await client.bootstrap("session-token", {
      ...adminContext,
      selectedContexts: { Band: "band-1" },
    });

    expect(transport.bootstrapCalls).toEqual([
      { selectedContexts: { Band: "band-1" } },
      { selectedContexts: { Band: "band-1" }, cursor: "c1" },
      { selectedContexts: { Band: "band-1" }, cursor: "c2" },
    ]);
    expect(result.records.map((entry) => entry.record.meta.guid)).toEqual([
      "gig-1",
      "gig-2",
      "gig-3",
    ]);
    // A complete dataset carries no cursor for the caller to resume from.
    expect(result.nextCursor).toBeUndefined();
    // Records disclosed only on later pages are reconciled, not dropped.
    for (const [id, title] of [
      ["gig-1", "Page one"],
      ["gig-2", "Page two"],
      ["gig-3", "Page three"],
    ] as const) {
      await expect(runtime.objectStore.getRecordForRuntime("Gig", id)).resolves.toMatchObject({
        meta: { guid: id, syncStatus: "synced" },
        values: { Title: title },
      });
    }
  });

  it("stops on a repeated cursor instead of walking the same page forever", async () => {
    const runtime = newRuntime();
    const repeated: AuthorityBootstrapResponse[] = Array.from({ length: 6 }, (_unused, index) => ({
      records: [{ objectName: "Gig", record: remoteGig(`gig-${index + 1}`, `Page ${index + 1}`) }],
      nextCursor: "stuck-cursor",
    }));
    const transport = new FakeAuthorityTransport(repeated);

    const result = await new AuthoritySyncClient(runtime, transport).bootstrap(
      "session-token",
      adminContext,
    );

    expect(transport.bootstrapCalls).toEqual([{}, { cursor: "stuck-cursor" }]);
    expect(result.records).toHaveLength(2);
    await expect(runtime.objectStore.getRecordForRuntime("Gig", "gig-3")).resolves.toBeNull();
  });

  it("stops on an empty page even when the server offers another cursor", async () => {
    const runtime = newRuntime();
    const transport = new FakeAuthorityTransport([
      { records: [], nextCursor: "c1" },
      { records: [{ objectName: "Gig", record: remoteGig("gig-unreachable", "Never fetched") }] },
    ]);

    const result = await new AuthoritySyncClient(runtime, transport).bootstrap(
      undefined,
      adminContext,
    );

    expect(transport.bootstrapCalls).toEqual([{}]);
    expect(result).toEqual({ records: [] });
    await expect(
      runtime.objectStore.getRecordForRuntime("Gig", "gig-unreachable"),
    ).resolves.toBeNull();
  });
});

describe("AuthoritySyncClient reconcile", () => {
  async function queuedRuntime(): Promise<{ runtime: ApplicationRuntime; gigId: string }> {
    const runtime = newRuntime();
    const gig = await runtime.create("Gig", { Title: "Friday rehearsal" }, adminContext);
    await runtime.update("Gig", gig.meta.guid, { Title: "Saturday rehearsal" }, adminContext);
    await runtime.create("PrivateNote", { Body: "secret-private-body" }, adminContext);
    return { runtime, gigId: gig.meta.guid };
  }

  /**
   * Regression (fixed in Phase 46): `reconcile` used to look the record up with
   * `getRecordForRuntime`, which hides tombstones, and `continue` when it was
   * null. Every queued delete was therefore skipped — never sent, never removed
   * from the queue, stuck `pending` forever — so the authority never learned
   * about the deletion. `getRecordForSync` includes tombstones.
   */
  it("replays a queued delete for a record the authority still holds", async () => {
    const runtime = newRuntime();
    await runtime.reconcileRemoteRecord("Gig", remoteGig("gig-remote", "From the authority"));
    await runtime.delete("Gig", "gig-remote", adminContext);
    expect(runtime.syncQueue.getEntries().map((entry) => entry.operation.operation)).toEqual([
      "delete",
    ]);

    const transport = new FakeAuthorityTransport();
    await new AuthoritySyncClient(runtime, transport).reconcile("session-token", adminContext);

    expect(transport.replayCalls.map((intent) => intent.kind)).toEqual(["delete"]);
    expect(runtime.syncQueue.getEntries()).toEqual([]);
    expect(runtime.operationLog.getOperations().map((operation) => operation.status)).toEqual([
      "accepted",
    ]);
  });

  it("sends each queued local-first entry exactly once and records the outcome status", async () => {
    const { runtime, gigId } = await queuedRuntime();
    expect(runtime.syncQueue.getEntries()).toHaveLength(2);
    expect(runtime.operationLog.getOperations()).toHaveLength(3);

    const transport = new FakeAuthorityTransport([], (intent) =>
      intent.kind === "create"
        ? {
            status: "accepted",
            operationId: intent.operationId,
            records: [remoteGig(gigId, "Server title")],
          }
        : {
            status: "rejected",
            operationId: intent.operationId,
            code: "ADL_POLICY_DENIED",
            message: "The authority refused the update.",
          },
    );
    const client = new AuthoritySyncClient(runtime, transport);

    const outcomes = await client.reconcile("session-token", adminContext);

    expect(outcomes.map((outcome) => outcome.status)).toEqual(["accepted", "rejected"]);
    expect(transport.replayCalls.map((intent) => intent.kind)).toEqual(["create", "update"]);
    // The accepted entry leaves the queue; the rejected one stays on it carrying
    // its verdict, so the refused edit is recoverable instead of vanishing.
    expect(runtime.syncQueue.getReplayable()).toEqual([]);
    expect(runtime.syncQueue.getAwaitingRecovery().map((entry) => entry.recovery?.status)).toEqual([
      "rejected",
    ]);
    const statuses = new Map(
      runtime.operationLog.getOperations().map((operation) => [operation.opId, operation.status]),
    );
    const [createIntent, updateIntent] = transport.replayCalls;
    expect(statuses.get(createIntent?.operationId ?? "")).toBe("accepted");
    expect(statuses.get(updateIntent?.operationId ?? "")).toBe("rejected");
    // An accepted outcome's records are reconciled into local storage.
    await expect(runtime.objectStore.getRecordForRuntime("Gig", gigId)).resolves.toMatchObject({
      meta: { revision: `server-rev-${gigId}`, syncStatus: "synced" },
      values: { Title: "Server title" },
    });

    // A second reconnect replays nothing: the queue is the exactly-once ledger.
    await client.reconcile("session-token", adminContext);
    expect(transport.replayCalls).toHaveLength(2);
  });

  it("never puts a local-private record or its operation on the wire", async () => {
    const { runtime } = await queuedRuntime();
    const transport = new FakeAuthorityTransport();
    await new AuthoritySyncClient(runtime, transport).reconcile("session-token", adminContext);

    expect(
      transport.replayCalls.map((intent) =>
        "objectName" in intent ? intent.objectName : intent.kind,
      ),
    ).toEqual(["Gig", "Gig"]);
    const wire = JSON.stringify(transport.replayCalls);
    expect(wire).not.toContain("PrivateNote");
    expect(wire).not.toContain("secret-private-body");
    // The private operation stays pending locally and is never resolved remotely.
    const privateOperation = runtime.operationLog
      .getOperations()
      .find((operation) => operation.object === "PrivateNote");
    expect(privateOperation?.status).toBe("pending");
  });

  it("sends no client-derived identity, role, actor or timestamp in an intent", async () => {
    const { runtime } = await queuedRuntime();
    const transport = new FakeAuthorityTransport();
    await new AuthoritySyncClient(runtime, transport).reconcile(undefined, adminContext);

    const [createIntent, updateIntent] = transport.replayCalls;
    expect(Object.keys(createIntent ?? {}).sort()).toEqual([
      "kind",
      "objectName",
      "operationId",
      "values",
    ]);
    expect(Object.keys(updateIntent ?? {}).sort()).toEqual([
      "baseRevision",
      "kind",
      "objectName",
      "operationId",
      "patch",
      "recordId",
    ]);
    expect(JSON.stringify(transport.replayCalls)).not.toContain(adminContext.userId);
    expect(JSON.stringify(transport.replayCalls)).not.toContain("Admin");
  });
});
