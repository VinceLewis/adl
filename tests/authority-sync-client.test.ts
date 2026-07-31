import { describe, expect, it } from "vitest";
import {
  ApplicationRuntime,
  AuthorityService,
  AuthoritySyncClient,
  AuthorityTransportError,
  InMemoryObjectStorageBackend,
  InMemorySyncStateStorage,
  StaticSessionAdapter,
  resolveApplicationModel,
  validateApplicationModel,
} from "../src/index.js";
import type {
  AuthorityBootstrapRequest,
  AuthorityBootstrapResponse,
  AuthorityOperationIntent,
  AuthorityOutcome,
  AuthorityTransport,
  LocalOperation,
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
    {
      name: "Invitation",
      businessKey: "Email",
      displayField: "Email",
      fields: [{ name: "Email", type: "text", required: true }],
      sync: { mode: "onlineRequired", conflict: "manual" },
    },
    // The two objects `PlanTour` writes. A command needs a plain step and an
    // iterating one to be worth replaying at all: the plain step proves per-step
    // identity, the iterating one proves per-item identity, and only the two
    // together show that a manifest position is not simply a step position.
    {
      name: "Tour",
      businessKey: "Name",
      displayField: "Name",
      fields: [{ name: "Name", type: "text", required: true }],
      sync: { mode: "localFirst", conflict: "manual" },
    },
    {
      name: "TourStop",
      businessKey: "City",
      displayField: "City",
      fields: [
        { name: "Tour", type: "text", required: true },
        { name: "City", type: "text", required: true },
      ],
      sync: { mode: "localFirst", conflict: "manual" },
    },
  ],
  commands: [
    {
      name: "PlanTour",
      label: "Plan tour",
      inputs: [
        { name: "Name", type: "text", required: true },
        {
          name: "Cities",
          required: true,
          repeated: true,
          itemFields: [{ name: "City", type: "text", required: true }],
        },
      ],
      steps: [
        {
          name: "createTour",
          action: "create",
          object: "Tour",
          values: { Name: { kind: "input", name: "Name" } },
        },
        {
          name: "createStops",
          action: "create",
          object: "TourStop",
          forEach: "Cities",
          values: {
            Tour: { kind: "stepMeta", step: "createTour", property: "guid" },
            City: { kind: "item", field: "City" },
          },
        },
      ],
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
      name: "InvitationPolicy",
      object: "Invitation",
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
    // Deliberately not role-gated. The authority resolves a replay context with
    // no roles at all — roles come from accepted membership records, and this
    // fixture declares no business contexts — so an `Admin`-only rule would make
    // the real `AuthorityService` refuse every replayed command for a reason
    // that has nothing to do with what these cases are about. `authenticated` is
    // still a real policy check the server-side re-execution has to pass.
    ...["Tour", "TourStop"].map((objectName) => ({
      name: `${objectName}Policy`,
      object: objectName,
      rules: [
        {
          name: "signedInAll",
          effect: "allow" as const,
          principal: { match: "authenticated" as const },
          action: "*" as const,
        },
      ],
    })),
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

  /**
   * Regression (fixed in Phase 48): a create intent carried no record id, so the
   * authority minted its own. The accepted record then reconciled in as a SECOND
   * local row while the original kept its local guid and `syncStatus: "local"`
   * forever — its queue entry already discarded as accepted, so nothing would
   * ever resend or reconcile it. The hermetic fake masked this for two phases by
   * echoing the client's guid back; the id is now part of the contract, so a
   * transport that answers under the supplied id is honest rather than lucky.
   */
  it("replays a create under the local record id, so the accepted record converges onto one row", async () => {
    const runtime = newRuntime();
    const created = await runtime.create("Gig", { Title: "Friday rehearsal" }, adminContext);
    const localId = created.meta.guid;
    const transport = new FakeAuthorityTransport([], (intent) => ({
      status: "accepted",
      operationId: intent.operationId,
      records: [
        remoteGig(intent.kind === "create" ? intent.recordId : "not-a-create", "Friday rehearsal"),
      ],
    }));

    const outcomes = await new AuthoritySyncClient(runtime, transport).reconcile(
      "session-token",
      adminContext,
    );

    expect(transport.replayCalls[0]).toMatchObject({ kind: "create", recordId: localId });
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["accepted"]);
    // One row, under the id the browser already held, now marked synced. Two rows
    // here is the defect this test exists for.
    const rows = await runtime.objectStore.search("Gig", {}, adminContext);
    expect(rows.map((row) => row.meta.guid)).toEqual([localId]);
    await expect(runtime.objectStore.getRecordForRuntime("Gig", localId)).resolves.toMatchObject({
      meta: { guid: localId, syncStatus: "synced" },
    });
    expect(runtime.syncQueue.getEntries()).toEqual([]);
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
    // `recordId` names the record the client already holds. It is not an identity,
    // role, actor or timestamp assertion, and the authority still derives all of
    // those itself. `selectedContexts` is the same kind of thing: it reports the
    // context selection the operation was made under, and an empty object says
    // "none was" rather than claiming membership of anything.
    expect(Object.keys(createIntent ?? {}).sort()).toEqual([
      "kind",
      "objectName",
      "operationId",
      "recordId",
      "selectedContexts",
      "values",
    ]);
    expect(Object.keys(updateIntent ?? {}).sort()).toEqual([
      "baseRevision",
      "kind",
      "objectName",
      "operationId",
      "patch",
      "recordId",
      "selectedContexts",
    ]);
    expect(createIntent?.selectedContexts).toEqual({});
    expect(updateIntent?.selectedContexts).toEqual({});
    expect(JSON.stringify(transport.replayCalls)).not.toContain(adminContext.userId);
    expect(JSON.stringify(transport.replayCalls)).not.toContain("Admin");
  });
});

/**
 * An `onlineRequired` write used to be validated, policy-checked, persisted,
 * written to the operation log — and then never sent, because the queue admitted
 * `localFirst` alone. These cases pin the delivery path that closes that gap,
 * and the visible state a failed delivery leaves behind.
 */
describe("AuthoritySyncClient online-required delivery", () => {
  async function onlineRequiredRuntime(): Promise<ApplicationRuntime> {
    const runtime = newRuntime();
    await runtime.create("Invitation", { Email: "player@example.test" }, adminContext);
    return runtime;
  }

  it("queues an accepted online-required write and delivers it", async () => {
    const runtime = await onlineRequiredRuntime();
    expect(runtime.syncQueue.getEntries().map((entry) => entry.operation.object)).toEqual([
      "Invitation",
    ]);

    const transport = new FakeAuthorityTransport();
    const outcomes = await new AuthoritySyncClient(runtime, transport).deliverPending(
      undefined,
      adminContext,
    );

    expect(outcomes.map((outcome) => outcome.status)).toEqual(["accepted"]);
    expect(transport.replayCalls.map(intentObjectName)).toEqual(["Invitation"]);
    // Delivered work leaves the queue and is recorded as accepted, not pending.
    expect(runtime.syncQueue.getEntries()).toEqual([]);
    expect(runtime.operationLog.getOperations().map((operation) => operation.status)).toEqual([
      "accepted",
    ]);
  });

  it("reconcile delivers a queued online-required entry alongside local-first work", async () => {
    const runtime = await onlineRequiredRuntime();
    await runtime.create("Gig", { Title: "Summer show" }, adminContext);
    const transport = new FakeAuthorityTransport();

    await new AuthoritySyncClient(runtime, transport).reconcile(undefined, adminContext);

    expect(transport.replayCalls.map(intentObjectName).sort()).toEqual(["Gig", "Invitation"]);
    expect(runtime.syncQueue.getEntries()).toEqual([]);
  });

  it("marks a failed delivery undelivered, and leaves the entry replayable", async () => {
    const runtime = await onlineRequiredRuntime();
    const transport = new FailingTransport();

    const outcomes = await new AuthoritySyncClient(runtime, transport).deliverPending(
      undefined,
      adminContext,
    );

    // A transport failure is not thrown at the writer: the local write stands.
    expect(outcomes).toEqual([]);
    const [entry] = runtime.syncQueue.getEntries();
    expect(entry?.delivery?.status).toBe("undelivered");
    expect(entry?.delivery?.message).toContain("The authority is unreachable.");
    // Not a verdict: no recovery, and the next reconcile still sends it.
    expect(entry?.recovery).toBeUndefined();
    expect(runtime.syncQueue.getReplayable()).toHaveLength(1);
    expect(runtime.syncQueue.getAwaitingRecovery()).toEqual([]);
  });

  it("lists an undelivered write as queue metadata a person can be shown", async () => {
    const runtime = await onlineRequiredRuntime();
    const client = new AuthoritySyncClient(runtime, new FailingTransport());
    await client.deliverPending(undefined, adminContext);

    const [item] = client.listUndelivered();
    expect(item).toMatchObject({ objectName: "Invitation", operation: "create" });
    // Queue metadata only: an undelivered item discloses no record values.
    expect(JSON.stringify(client.listUndelivered())).not.toContain("player@example.test");
    // It is not a settled operation, so it never appears as one.
    expect(client.listRecovery()).toEqual([]);
  });

  it("retries an undelivered write under its original operation id", async () => {
    const runtime = await onlineRequiredRuntime();
    const failing = new FailingTransport();
    const client = new AuthoritySyncClient(runtime, failing);
    await client.deliverPending(undefined, adminContext);
    const [undelivered] = client.listUndelivered();

    // A transport failure settles nothing, so the retry must reuse the id: if
    // the first request did reach the authority, the stored outcome answers it
    // instead of the operation being applied twice.
    const accepting = new FakeAuthorityTransport();
    const outcome = await new AuthoritySyncClient(runtime, accepting).retryDelivery(
      undefined,
      adminContext,
      undelivered?.queueId ?? "",
    );

    expect(outcome?.status).toBe("accepted");
    expect(accepting.replayCalls[0]?.operationId).toBe(failing.replayCalls[0]?.operationId);
    expect(runtime.syncQueue.getEntries()).toEqual([]);
  });

  it("does not mark a local-first entry undelivered: queueing offline is that mode working", async () => {
    const runtime = newRuntime();
    await runtime.create("Gig", { Title: "Queued offline" }, { ...adminContext, online: false });
    const client = new AuthoritySyncClient(runtime, new FailingTransport());

    // Nothing here requires immediate delivery, so nothing is attempted at all.
    await expect(client.deliverPending(undefined, adminContext)).resolves.toEqual([]);
    await expect(client.reconcile(undefined, adminContext)).rejects.toThrow(
      "The authority is unreachable.",
    );
    expect(runtime.syncQueue.getEntries()[0]?.delivery).toBeUndefined();
    expect(client.listUndelivered()).toEqual([]);
  });

  it("clears the undelivered state once the authority answers", async () => {
    const runtime = await onlineRequiredRuntime();
    const client = new AuthoritySyncClient(runtime, new FailingTransport());
    await client.deliverPending(undefined, adminContext);
    expect(client.listUndelivered()).toHaveLength(1);

    const rejecting = new FakeAuthorityTransport([], (intent) => ({
      status: "rejected",
      operationId: intent.operationId,
      code: "ADL_POLICY_DENIED",
      message: "Not permitted.",
    }));
    await new AuthoritySyncClient(runtime, rejecting).reconcile(undefined, adminContext);

    // A verdict outranks the transport failure that preceded it: the entry is
    // settled, so it is shown as refused rather than as still on its way.
    expect(client.listUndelivered()).toEqual([]);
    expect(client.listRecovery().map((item) => item.status)).toEqual(["rejected"]);
  });

  it("never queues a local-private write, so none can be marked undelivered", async () => {
    const runtime = newRuntime();
    await runtime.create("PrivateNote", { Body: "secret-private-body" }, adminContext);
    const client = new AuthoritySyncClient(runtime, new FailingTransport());

    await client.deliverPending(undefined, adminContext);

    expect(runtime.syncQueue.getEntries()).toEqual([]);
    expect(client.listUndelivered()).toEqual([]);
  });
});

const SERVER_SESSION_TOKEN = "sync-client-session-sync-client-session";

/**
 * The real `AuthorityService`, in process, over its own accepted-state storage.
 *
 * A scripted fake would be the wrong instrument for a command. The whole
 * question is whether the authority's *re-execution* adopts the ids the device
 * minted, and a fake that answers with the ids it was handed cannot tell the
 * difference between adoption and an echo — which is precisely how the Phase 48
 * duplication defect survived two phases in this very file. Here the ids in the
 * response are the ids the server-side execution actually wrote, and
 * `serverStorage` can be inspected to confirm it.
 */
class AuthorityBackedTransport implements AuthorityTransport {
  readonly replayCalls: AuthorityOperationIntent[] = [];
  readonly serverStorage = new InMemoryObjectStorageBackend();
  private readonly authority: AuthorityService;

  constructor() {
    this.authority = new AuthorityService(
      model,
      this.serverStorage,
      new StaticSessionAdapter(new Map([[SERVER_SESSION_TOKEN, { userId: "server-user" }]])),
    );
  }

  async bootstrap(
    sessionToken: string | undefined,
    request?: AuthorityBootstrapRequest,
  ): Promise<AuthorityBootstrapResponse> {
    return this.authority.bootstrap(sessionToken, request);
  }

  async replay(
    sessionToken: string | undefined,
    intent: AuthorityOperationIntent,
  ): Promise<AuthorityOutcome> {
    // Snapshotted, so an assertion describes what crossed the wire rather than
    // whatever the runtime happens to hold by the time the test looks.
    this.replayCalls.push(structuredClone(intent));
    return this.authority.replay(sessionToken, intent);
  }

  async serverIds(objectName: string): Promise<string[]> {
    return (await this.serverStorage.listRecords())
      .filter((entry) => entry.objectName === objectName)
      .map((entry) => entry.record.meta.guid)
      .sort();
  }
}

/**
 * A locally executed command is one unit of work for the authority.
 *
 * Replaying its steps separately is what destroys the transaction: a step
 * writing into a context an earlier step established is refused outright, and a
 * batch lands partially. These cases pin the client half — one entry, one
 * intent, one verdict — and prove the accepted records land on the rows the
 * device already has rather than beside them.
 */
describe("AuthoritySyncClient command replay", () => {
  const tourInput = {
    Name: "Spring tour",
    Cities: [{ City: "Leeds" }, { City: "York" }, { City: "Hull" }],
  };

  async function plannedTour(runtime: ApplicationRuntime): Promise<string[]> {
    const result = await runtime.executeCommand("PlanTour", tourInput, adminContext);
    return result.steps.map((step) => step.recordId);
  }

  it("queues a locally executed command as one entry, not one per write", async () => {
    const runtime = newRuntime();
    await plannedTour(runtime);

    const entries = runtime.syncQueue.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.operation.operation).toBe("command");
    expect(entries[0]?.operation.command?.name).toBe("PlanTour");
    expect(entries[0]?.operation.command?.records).toHaveLength(4);
    // The four writes are still in the device's own history. They are simply not
    // queued: the authority has to be told about the transaction, and one entry
    // per step is exactly the shape that loses it.
    expect(runtime.operationLog.getOperations().map((operation) => operation.operation)).toEqual([
      "create",
      "create",
      "create",
      "create",
      "command",
    ]);
    // Nothing the command wrote is separately replayable, so nothing can be sent
    // twice or land alone.
    expect(runtime.syncQueue.getReplayable().map((entry) => entry.operation.object)).toEqual([
      "Tour",
    ]);
  });

  it("sends one command intent carrying the name, input and full record-id manifest", async () => {
    const runtime = newRuntime();
    const [tourId, ...stopIds] = await plannedTour(runtime);
    const transport = new AuthorityBackedTransport();

    await new AuthoritySyncClient(runtime, transport).reconcile(SERVER_SESSION_TOKEN, adminContext);

    expect(transport.replayCalls).toHaveLength(1);
    const intent = transport.replayCalls[0];
    if (intent?.kind !== "command")
      throw new Error(`Expected a command intent, got ${intent?.kind}.`);
    expect(intent.commandName).toBe("PlanTour");
    // The input crosses the wire, not the resulting writes: the authority
    // re-executes so that policy, validation, scope and preconditions all run
    // there exactly as they ran here.
    expect(intent.input).toEqual(tourInput);
    // One manifest entry per create, in planned order, with the iterating step's
    // items named individually. "The id for step N" is really "the id for item M
    // of step N", and an entry that could not say which item would be useless.
    expect(intent.recordIds).toEqual([
      { step: "createTour", objectName: "Tour", recordId: tourId },
      { step: "createStops", itemIndex: 0, objectName: "TourStop", recordId: stopIds[0] },
      { step: "createStops", itemIndex: 1, objectName: "TourStop", recordId: stopIds[1] },
      { step: "createStops", itemIndex: 2, objectName: "TourStop", recordId: stopIds[2] },
    ]);
  });

  it("reconciles every accepted record onto the local rows and settles the whole command", async () => {
    const runtime = newRuntime();
    const [tourId, ...stopIds] = await plannedTour(runtime);
    const transport = new AuthorityBackedTransport();

    const outcomes = await new AuthoritySyncClient(runtime, transport).reconcile(
      SERVER_SESSION_TOKEN,
      adminContext,
    );

    expect(outcomes.map((outcome) => outcome.status)).toEqual(["accepted"]);
    // The authority wrote these ids itself, having adopted the manifest. Had it
    // minted its own, these would be four ids nobody local has ever seen.
    expect(await transport.serverIds("Tour")).toEqual([tourId]);
    expect(await transport.serverIds("TourStop")).toEqual([...stopIds].sort());

    // Four local rows, the same four ids, now marked synced. Eight rows here —
    // the local four plus the authority's four — is the defect this case exists
    // for, and it is invisible in the outcome status alone.
    const tours = await runtime.objectStore.search("Tour", {}, adminContext);
    const stops = await runtime.objectStore.search("TourStop", {}, adminContext);
    expect(tours.map((row) => row.meta.guid)).toEqual([tourId]);
    expect(stops.map((row) => row.meta.guid).sort()).toEqual([...stopIds].sort());
    for (const row of [...tours, ...stops]) {
      expect(row.meta.syncStatus).toBe("synced");
    }
    // The stop still points at the tour under the id the device holds, so the
    // relationship survives the round trip rather than naming a server-side row.
    expect(stops.every((row) => row.values.Tour === tourId)).toBe(true);

    expect(runtime.syncQueue.getEntries()).toEqual([]);
    // Only the command entry was queued, so only it is answered — and leaving
    // its steps at `pending` would show accepted work as unsent for ever.
    expect(runtime.operationLog.getOperations().map((operation) => operation.status)).toEqual([
      "accepted",
      "accepted",
      "accepted",
      "accepted",
      "accepted",
    ]);
  });

  it("leaves an ordinary write replaying as its own per-record intent", async () => {
    const runtime = newRuntime();
    await runtime.create("Gig", { Title: "Not part of a command" }, adminContext);
    await plannedTour(runtime);
    const transport = new FakeAuthorityTransport();

    await new AuthoritySyncClient(runtime, transport).reconcile("session-token", adminContext);

    // A command changes nothing for work that did not originate in one: the Gig
    // is still its own create intent, sent under its own operation id.
    expect(transport.replayCalls.map((intent) => intent.kind)).toEqual(["create", "command"]);
    expect(transport.replayCalls.map(intentObjectName)).toEqual(["Gig", "PlanTour"]);
  });
});

/**
 * Which context a queued operation replays under.
 *
 * `toIntent` used to read the selection in force when the queue *drained*, so a
 * queue sent after the user switched contexts — or after a reload, when the
 * selection is whatever the shell restored — replayed writes against a selection
 * that was never in force when they were made. The selection belongs to the
 * operation, not to the moment it is sent.
 *
 * The three readings below are deliberately distinct, and the middle one is the
 * one that bit: recording the selection only when there was one made "nothing
 * was selected" indistinguishable from "this entry predates the capture", and
 * the second reading falls back to the drain-time selection. An offline command
 * executed outside any context then replayed against whichever context the
 * device happened to be showing on reconnect.
 */
describe("AuthoritySyncClient context capture", () => {
  const executedIn: RuntimeContext = { ...adminContext, selectedContexts: { Band: "band-a" } };
  const drainedIn: RuntimeContext = { ...adminContext, selectedContexts: { Band: "band-b" } };
  const tourInput = { Name: "Autumn tour", Cities: [{ City: "Derby" }] };

  async function sentIntent(
    runtime: ApplicationRuntime,
    drainContext: RuntimeContext,
  ): Promise<AuthorityOperationIntent> {
    const transport = new FakeAuthorityTransport();
    await new AuthoritySyncClient(runtime, transport).reconcile("session-token", drainContext);
    const intent = transport.replayCalls[0];
    if (intent === undefined) throw new Error("Expected the entry to be replayed.");
    return intent;
  }

  it("replays a create with the selection it was made under, not the one in force now", async () => {
    const runtime = newRuntime();
    await runtime.create("Gig", { Title: "Made in band-a" }, executedIn);

    const intent = await sentIntent(runtime, drainedIn);

    expect(intent.selectedContexts).toEqual({ Band: "band-a" });
  });

  it("replays a command with the selection it was executed under", async () => {
    const runtime = newRuntime();
    await runtime.executeCommand("PlanTour", tourInput, executedIn);

    const intent = await sentIntent(runtime, drainedIn);

    expect(intent.kind).toBe("command");
    expect(intent.selectedContexts).toEqual({ Band: "band-a" });
  });

  it("replays a create made outside any context with no selection at all", async () => {
    const runtime = newRuntime();
    await runtime.create("Gig", { Title: "Made in no context" }, adminContext);

    const intent = await sentIntent(runtime, drainedIn);

    // An empty selection is a selection. Reading it as "unknown" and falling
    // back to `band-b` is what made an offline write land in a context its
    // author never chose.
    expect(intent.selectedContexts).toEqual({});
  });

  it("replays a command executed outside any context with no selection at all", async () => {
    const runtime = newRuntime();
    await runtime.executeCommand("PlanTour", tourInput, adminContext);

    const intent = await sentIntent(runtime, drainedIn);

    expect(intent.kind).toBe("command");
    // The case that was caught end to end: an offline context-establishing
    // command replayed under the drain-time selection is refused as
    // `ADL_RUNTIME_CONTEXT_ERROR`, naming a context the caller never mentioned.
    expect(intent.selectedContexts).toEqual({});
  });

  it("falls back to the drain-time selection only for an entry queued before capture existed", async () => {
    const { runtime, opCount } = await legacyQueue(async (target) => {
      await target.create("Gig", { Title: "Queued by an older build" }, executedIn);
    });
    expect(opCount).toBe(1);

    const intent = await sentIntent(runtime, drainedIn);

    // No captured selection at all — not an empty one — is the only reading that
    // may fall back, because it is the only one that means "this entry predates
    // the capture". That is the old behaviour, for exactly the entries written
    // under it.
    expect(intent.selectedContexts).toEqual({ Band: "band-b" });
  });

  it("falls back for a legacy command entry on the same terms", async () => {
    const { runtime } = await legacyQueue(async (target) => {
      await target.executeCommand("PlanTour", tourInput, executedIn);
    });

    const intent = await sentIntent(runtime, drainedIn);

    expect(intent.kind).toBe("command");
    expect(intent.selectedContexts).toEqual({ Band: "band-b" });
  });

  /**
   * A queue as an older build left it: persisted, then reloaded by a runtime
   * that captures selections. Stripping the key from the persisted snapshot is
   * what that upgrade actually looks like, rather than reaching into the live
   * queue's private state to fake it.
   */
  async function legacyQueue(
    write: (runtime: ApplicationRuntime) => Promise<void>,
  ): Promise<{ runtime: ApplicationRuntime; opCount: number }> {
    const storage = new InMemoryObjectStorageBackend();
    const syncStateStorage = new InMemorySyncStateStorage();
    const first = new ApplicationRuntime(model, { storage, syncStateStorage });
    await first.whenReady();
    await write(first);

    const persisted = await syncStateStorage.read();
    if (persisted === null) throw new Error("Expected the sync state to have been persisted.");
    await syncStateStorage.write({
      ...persisted,
      operations: persisted.operations.map(withoutSelectedContexts),
      queue: persisted.queue.map((entry) => ({
        ...entry,
        operation: withoutSelectedContexts(entry.operation),
      })),
    });

    const reloaded = new ApplicationRuntime(model, { storage, syncStateStorage });
    await reloaded.whenReady();
    return { runtime: reloaded, opCount: persisted.queue.length };
  }
});

function withoutSelectedContexts(operation: LocalOperation): LocalOperation {
  const copy: LocalOperation = { ...operation };
  delete copy.selectedContexts;
  return copy;
}

/** A command intent names no single object; every intent this suite sends does. */
function intentObjectName(intent: AuthorityOperationIntent): string {
  return intent.kind === "command" ? intent.commandName : intent.objectName;
}

/** Fails every replay the way an unreachable authority does: no verdict at all. */
class FailingTransport implements AuthorityTransport {
  readonly replayCalls: AuthorityOperationIntent[] = [];

  async bootstrap(): Promise<AuthorityBootstrapResponse> {
    throw new AuthorityTransportError("The authority is unreachable.", 503);
  }

  async replay(
    _sessionToken: string | undefined,
    intent: AuthorityOperationIntent,
  ): Promise<AuthorityOutcome> {
    this.replayCalls.push(intent);
    throw new AuthorityTransportError("The authority is unreachable.", 503);
  }
}
