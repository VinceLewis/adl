import { describe, expect, it } from "vitest";
import {
  ApplicationRuntime,
  AuthorityService,
  AuthoritySyncClient,
  InMemoryObjectStorageBackend,
  RecordNotDiscardableError,
  StaticSessionAdapter,
  resolveApplicationModel,
  validateApplicationModel,
} from "../src/index.js";
import { createGiggleBandExampleModel } from "../src/reference/band-app.js";
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
 * The record sync state the platform declares and, before this phase, never
 * produced.
 *
 * `SyncStatus` has five values and only two writers existed: `"local"` when a
 * record was built and `"synced"` when a remote record was reconciled. A record
 * queued and waiting, a record the authority refused, a record in conflict and a
 * record that was never going anywhere were all `"local"` and all looked
 * identical. Every case below pins one of the produced states, and each says
 * what regresses if it stops being produced.
 */

const partialModel: PartialApplicationModel = {
  app: { name: "RecordSyncStateFixture" },
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
      // The control for "queued and waiting": a `localPrivate` record has no
      // delivery path by design, so it is not late, not refused and not pending.
      name: "PrivateNote",
      businessKey: "Body",
      displayField: "Body",
      fields: [{ name: "Body", type: "text", required: true }],
      sync: { mode: "localPrivate" },
    },
  ],
  policies: ["Gig", "PrivateNote"].map((objectName) => ({
    name: `${objectName}Policy`,
    object: objectName,
    rules: [
      {
        name: "adminAll",
        effect: "allow" as const,
        principal: { match: "specific" as const, roles: ["Admin"] },
        action: "*" as const,
      },
    ],
  })),
};

const model = resolveApplicationModel(partialModel);
const gigSchemaVersion = model.objects.find((object) => object.name === "Gig")?.schemaVersion ?? 1;

const adminContext: RuntimeContext = { userId: "user-42", roles: ["Admin"], channel: "ui" };

function newRuntime(storage = new InMemoryObjectStorageBackend()): ApplicationRuntime {
  return new ApplicationRuntime(model, { storage });
}

/**
 * A record as the authority would return it. Its `syncStatus` is deliberately
 * settable: the whole question in the reconcile direction is whether the device
 * adopts what a server asserts about a *device-local* field.
 */
function serverGig(
  id: string,
  title: string,
  meta: Partial<StoredObjectRecord["meta"]> = {},
): StoredObjectRecord {
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
      ...meta,
    },
    values: { Title: title },
  };
}

/** Scripted authority. Each replay call consults the caller-supplied verdict function. */
class ScriptedTransport implements AuthorityTransport {
  readonly replayCalls: AuthorityOperationIntent[] = [];
  bootstrapRecords: AuthorityBootstrapResponse["records"] = [];

  constructor(
    private readonly outcomeFor: (
      intent: AuthorityOperationIntent,
      attempt: number,
    ) => AuthorityOutcome,
  ) {}

  async bootstrap(
    _sessionToken: string | undefined,
    _request?: AuthorityBootstrapRequest,
  ): Promise<AuthorityBootstrapResponse> {
    return { records: this.bootstrapRecords };
  }

  async replay(
    _sessionToken: string | undefined,
    intent: AuthorityOperationIntent,
  ): Promise<AuthorityOutcome> {
    // Snapshotted, so a wire assertion describes what was sent rather than
    // whatever the runtime happens to hold by the time the test looks.
    this.replayCalls.push(structuredClone(intent));
    return this.outcomeFor(intent, this.replayCalls.length);
  }
}

function refusing(code = "ADL_POLICY_DENIED"): ScriptedTransport {
  return new ScriptedTransport((intent) => ({
    status: "rejected",
    operationId: intent.operationId,
    code,
    message: "The authority refused this write.",
  }));
}

async function syncStatusOf(
  runtime: ApplicationRuntime,
  objectName: string,
  recordId: string,
): Promise<string | undefined> {
  const record = await runtime.objectStore.getRecordForSync(objectName, recordId);
  return record?.meta.syncStatus;
}

describe("the sync state a local write leaves on the record", () => {
  it("fixture model is valid", () => expect(validateApplicationModel(model)).toEqual([]));

  /**
   * Case 1. Regression guard: if `writtenSyncStatus` stops producing `pending`,
   * a write that is queued and unanswered becomes indistinguishable from one
   * that was never going anywhere, and the device reports work it is still
   * holding as settled.
   */
  it("reports a queued local write as pending, and synced once the authority accepts it", async () => {
    const runtime = newRuntime();
    const created = await runtime.create("Gig", { Title: "Friday rehearsal" }, adminContext);
    const gigId = created.meta.guid;

    // Queued and unanswered. True whether or not an authority is reachable, or
    // configured at all: the write is waiting either way.
    expect(created.meta.syncStatus).toBe("pending");
    expect(await syncStatusOf(runtime, "Gig", gigId)).toBe("pending");
    expect(await runtime.summariseRecordSyncState()).toMatchObject({ pending: 1, synced: 0 });
    expect(runtime.syncQueue.getEntries()).toHaveLength(1);

    const transport = new ScriptedTransport((intent) => ({
      status: "accepted",
      operationId: intent.operationId,
      records: [serverGig(gigId, "Friday rehearsal")],
    }));
    await new AuthoritySyncClient(runtime, transport).reconcile("session-token", adminContext);

    expect(await syncStatusOf(runtime, "Gig", gigId)).toBe("synced");
    expect(await runtime.summariseRecordSyncState()).toMatchObject({ pending: 0, synced: 1 });
    expect(await runtime.listRefusedRecords()).toEqual([]);
  });

  /**
   * Case 2. Regression guard: reporting a `localPrivate` record as `pending`
   * would show every private row as permanently unsent work, and a surface
   * counting outstanding writes would never reach zero.
   */
  it("reports a write on a non-queueable object as local, because nothing is waiting on it", async () => {
    const runtime = newRuntime();
    const note = await runtime.create("PrivateNote", { Body: "secret-private-body" }, adminContext);

    expect(note.meta.syncStatus).toBe("local");
    expect(await syncStatusOf(runtime, "PrivateNote", note.meta.guid)).toBe("local");
    // Nothing was queued, so there is nothing an authority could ever answer.
    expect(runtime.syncQueue.getEntries()).toEqual([]);
    expect(await runtime.summariseRecordSyncState()).toMatchObject({ local: 1, pending: 0 });

    // An update leaves it local too: the mode decides, not the operation kind.
    await runtime.update("PrivateNote", note.meta.guid, { Body: "still private" }, adminContext);
    expect(await syncStatusOf(runtime, "PrivateNote", note.meta.guid)).toBe("local");
  });
});

describe("a refused write stays refused", () => {
  /**
   * Case 3. Regression guard: the verdict used to live only on the queue entry,
   * which is discarded the moment the user dismisses it. If the state stops
   * living on the record, a dismissed refusal leaves rows that are for ever
   * indistinguishable from work nobody has sent yet — and if it stops being
   * persisted, the next page load says the same thing.
   */
  it("keeps a refused create marked rejected after the verdict is dismissed and after a reload", async () => {
    const storage = new InMemoryObjectStorageBackend();
    const runtime = newRuntime(storage);
    await runtime.whenReady();
    const created = await runtime.create("Gig", { Title: "Refused" }, adminContext);
    const gigId = created.meta.guid;
    const client = new AuthoritySyncClient(runtime, refusing());

    await client.reconcile("session-token", adminContext);
    expect(await syncStatusOf(runtime, "Gig", gigId)).toBe("rejected");
    expect(await runtime.listRefusedRecords()).toEqual([
      { objectName: "Gig", recordId: gigId, discardable: true },
    ]);

    // Dismissing settles the operation, not the record.
    await client.resolveRecovery(
      "session-token",
      adminContext,
      client.listRecovery()[0]?.queueId ?? "",
      "keepServer",
    );
    expect(client.listRecovery()).toEqual([]);
    expect(runtime.syncQueue.getEntries()).toEqual([]);
    expect(await syncStatusOf(runtime, "Gig", gigId)).toBe("rejected");

    // Reload for real: a second runtime over the same persisted backend. An
    // assertion against the first runtime's in-memory object would prove nothing
    // about survival, which is exactly why the state belongs on the record.
    const reloaded = newRuntime(storage);
    await reloaded.whenReady();
    const readBack = await reloaded.read("Gig", gigId, adminContext);
    expect(readBack?.meta.syncStatus).toBe("rejected");
    expect(readBack?.values.Title).toBe("Refused");
    expect(await reloaded.listRefusedRecords()).toEqual([
      { objectName: "Gig", recordId: gigId, discardable: true },
    ]);
    expect(await reloaded.summariseRecordSyncState()).toMatchObject({ rejected: 1 });
  });

  /**
   * Case 4. Regression guard: a command's queue entry names one *representative*
   * record, so applying the verdict to that record alone would leave every other
   * row the transaction wrote looking like ordinary unsent work. `CreateBand`
   * writes a `Band` and its founder `BandMember` in one transaction; a refusal
   * is equally true of both.
   *
   * The refusal is produced rather than scripted: the device's own manifest is
   * replayed to the real authority first under a different operation id, so the
   * ids the device holds are taken by the time it reconciles and the authority
   * refuses it with `ADL_RUNTIME_RECORD_ID_TAKEN`.
   */
  it("marks every record a refused command wrote, not only the one its queue entry is filed under", async () => {
    const giggleModel = await createGiggleBandExampleModel();
    const sessionToken = "record-sync-state-session-record-sync-state";
    const authority = new AuthorityService(
      giggleModel,
      new InMemoryObjectStorageBackend(),
      new StaticSessionAdapter(new Map([[sessionToken, { userId: "user-founder" }]])),
    );
    const device = new ApplicationRuntime(giggleModel, {
      storage: new InMemoryObjectStorageBackend(),
    });
    const founder: RuntimeContext = { userId: "user-founder", roles: [], channel: "ui" };

    await device.executeCommand("CreateBand", { Name: "The Alphas" }, founder);
    const entry = device.syncQueue.getEntries()[0];
    const command = entry?.operation.command;
    if (command === undefined) throw new Error("Expected one queued command entry.");
    expect(command.records).toHaveLength(2);
    // Both rows are waiting on the same single verdict.
    for (const record of command.records) {
      expect(await syncStatusOf(device, record.objectName, record.recordId)).toBe("pending");
    }

    // Another device gets there first with the same ids, under its own operation
    // id, so this device's replay is refused for a reason the authority really
    // produced rather than one a fake was told to return.
    const first = await authority.replay(sessionToken, {
      operationId: "op-another-device",
      kind: "command",
      commandName: command.name,
      input: command.input,
      recordIds: command.recordIds,
    });
    expect(first.status).toBe("accepted");

    const transport: AuthorityTransport = {
      bootstrap: (token, request) => authority.bootstrap(token, request),
      replay: (token, intent) => authority.replay(token, intent),
    };
    const outcomes = await new AuthoritySyncClient(device, transport).reconcile(
      sessionToken,
      founder,
    );

    expect(outcomes.map((outcome) => outcome.status)).toEqual(["rejected"]);
    expect(outcomes[0]?.status === "rejected" ? outcomes[0].code : "").toBe(
      "ADL_RUNTIME_RECORD_ID_TAKEN",
    );

    // Both records, not just the one the entry happens to be filed under — and
    // both discardable, because the refusal proves the authority holds no copy
    // of either under this device's authorship.
    const refused = await device.listRefusedRecords();
    expect(refused).toHaveLength(2);
    // The record the queue entry does *not* name is the one this case exists
    // for: it is what a verdict applied to the entry's own record alone would
    // leave looking like ordinary unsent work.
    const unnamed = refused.filter((item) => item.recordId !== entry?.operation.recordId);
    expect(unnamed).toHaveLength(1);
    expect(unnamed[0]?.discardable).toBe(true);
    expect(refused.map((item) => item.objectName).sort()).toEqual(["Band", "BandMember"]);
    expect(refused.every((item) => item.discardable)).toBe(true);
    for (const record of command.records) {
      expect(await syncStatusOf(device, record.objectName, record.recordId)).toBe("rejected");
    }
    expect(await device.summariseRecordSyncState()).toMatchObject({ rejected: 2, pending: 0 });
  });
});

/**
 * Discarding is a local action the user asks for, and deliberately not a third
 * recovery primitive: it settles nothing with the authority and sends nothing to
 * it. It is permitted only where a refusal proves the authority has no copy to
 * contradict the removal — which is a refused *create*, and nothing else.
 */
describe("discarding a refused record", () => {
  async function refusedCreate(): Promise<{
    runtime: ApplicationRuntime;
    client: AuthoritySyncClient;
    gigId: string;
  }> {
    const runtime = newRuntime();
    const created = await runtime.create("Gig", { Title: "Refused create" }, adminContext);
    const client = new AuthoritySyncClient(runtime, refusing("ADL_RUNTIME_RECORD_ID_TAKEN"));
    await client.reconcile("session-token", adminContext);
    return { runtime, client, gigId: created.meta.guid };
  }

  /**
   * Case 6a. Regression guard: if the discard's tombstone were queued, the
   * device would ask the authority to delete a record it never accepted — a
   * request about a row that does not exist there — and a refused create would
   * become a second refusal.
   */
  it("discards a refused create, leaving an unqueued tombstone rather than a live row", async () => {
    const { runtime, gigId } = await refusedCreate();
    const queuedBefore = runtime.syncQueue.getEntries().length;
    const loggedBefore = runtime.operationLog.getOperations().length;

    await runtime.discardRefusedRecord("Gig", gigId, adminContext);

    // Gone from every read: not merely unmarked.
    await expect(runtime.read("Gig", gigId, adminContext)).resolves.toBeNull();
    await expect(runtime.objectStore.getRecordForRuntime("Gig", gigId)).resolves.toBeNull();
    expect(await runtime.objectStore.search("Gig", {}, adminContext)).toEqual([]);
    expect(await runtime.listRefusedRecords()).toEqual([]);
    // A tombstone, so a later create cannot silently resurrect the id.
    const tombstone = await runtime.objectStore.getRecordForSync("Gig", gigId);
    expect(tombstone?.meta.deletedAt).toBeDefined();
    expect(tombstone?.meta.syncStatus).toBe("local");
    expect(tombstone?.meta.syncRejectedCreate).toBeUndefined();
    // Nothing was sent, and nothing was queued to be sent.
    expect(runtime.syncQueue.getEntries()).toHaveLength(queuedBefore);
    expect(runtime.operationLog.getOperations()).toHaveLength(loggedBefore);
  });

  /**
   * Case 6b. Regression guard: permitting this would delete a row the next
   * bootstrap restores — a silent no-op dressed up as a repair — and would lose
   * the local values the user still has for a record the authority holds.
   */
  it("refuses to discard a refused update on a record the authority still holds", async () => {
    const runtime = newRuntime();
    const created = await runtime.create("Gig", { Title: "Accepted" }, adminContext);
    const gigId = created.meta.guid;
    const accepting = new ScriptedTransport((intent) => ({
      status: "accepted",
      operationId: intent.operationId,
      records: [serverGig(gigId, "Accepted")],
    }));
    await new AuthoritySyncClient(runtime, accepting).reconcile("session-token", adminContext);
    expect(await syncStatusOf(runtime, "Gig", gigId)).toBe("synced");

    await runtime.update("Gig", gigId, { Title: "Local edit" }, adminContext);
    await new AuthoritySyncClient(runtime, refusing()).reconcile("session-token", adminContext);

    // Refused, and visibly so — but the authority still holds this record, so
    // the refusal licences no local removal.
    expect(await syncStatusOf(runtime, "Gig", gigId)).toBe("rejected");
    expect(await runtime.listRefusedRecords()).toEqual([
      { objectName: "Gig", recordId: gigId, discardable: false },
    ]);

    const error = await runtime
      .discardRefusedRecord("Gig", gigId, adminContext)
      .then(() => undefined)
      .catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(RecordNotDiscardableError);
    expect((error as RecordNotDiscardableError).code).toBe("ADL_RUNTIME_RECORD_NOT_DISCARDABLE");
    // The row survives the refusal to discard it.
    await expect(runtime.read("Gig", gigId, adminContext)).resolves.toMatchObject({
      values: { Title: "Local edit" },
    });
  });

  /**
   * A refused *delete* is the third shape a refusal takes, and the one with
   * nothing for the user to do. Regression guard: listing the tombstone as a
   * refused record would offer a discard for a row that is already gone from
   * every read, and counting it would report refused work the user cannot see.
   */
  it("marks a refused delete's tombstone without offering it as something to discard", async () => {
    const runtime = newRuntime();
    const created = await runtime.create("Gig", { Title: "Accepted" }, adminContext);
    const gigId = created.meta.guid;
    await new AuthoritySyncClient(
      runtime,
      new ScriptedTransport((intent) => ({
        status: "accepted",
        operationId: intent.operationId,
        records: [serverGig(gigId, "Accepted")],
      })),
    ).reconcile("session-token", adminContext);
    await runtime.delete("Gig", gigId, adminContext);
    expect(await syncStatusOf(runtime, "Gig", gigId)).toBe("pending");

    await new AuthoritySyncClient(runtime, refusing()).reconcile("session-token", adminContext);

    // The verdict reaches the tombstone: `setRecordSyncState` reads and writes
    // through deleted rows deliberately, because a refused delete's tombstone is
    // exactly the record the verdict is about.
    const tombstone = await runtime.objectStore.getRecordForSync("Gig", gigId);
    expect(tombstone?.meta.deletedAt).toBeDefined();
    expect(tombstone?.meta.syncStatus).toBe("rejected");
    // The authority still holds this record, so the refusal carries no discard
    // licence, and neither user-facing surface reports a row that is not there.
    expect(tombstone?.meta.syncRejectedCreate).toBeUndefined();
    expect(await runtime.listRefusedRecords()).toEqual([]);
    expect(await runtime.summariseRecordSyncState()).toMatchObject({ rejected: 0 });
    // Asking to discard it changes nothing rather than erasing the tombstone a
    // later create must not be able to write through.
    await runtime.discardRefusedRecord("Gig", gigId, adminContext);
    expect((await runtime.objectStore.getRecordForSync("Gig", gigId))?.meta.deletedAt).toBe(
      tombstone?.meta.deletedAt,
    );
  });

  /**
   * The licence a refusal leaves is spent by the next write, deliberately: it
   * says "the authority refused *this* record's create", and a record written
   * again is queued and unanswered rather than refused. Regression guard: if the
   * licence outlived the verdict, a row whose later write the authority accepted
   * would still offer the user a discard that destroys accepted work.
   */
  /**
   * Regression guard for a defect found while this suite was being written: an
   * edit used to spend the discard licence.
   *
   * The licence means "the authority holds no copy of this record", and editing
   * the row here does not change that. When it was cleared on every write, a
   * refused create was stranded one edit later: the edit queued as an *update*,
   * the authority refused it — as it must, having no such record — and the row
   * ended `rejected` with nothing left saying it could be thrown away. Only the
   * authority producing a copy spends the licence.
   */
  it("keeps the discard licence when the refused record is written again", async () => {
    const { runtime, gigId } = await refusedCreate();
    expect(await runtime.listRefusedRecords()).toEqual([
      { objectName: "Gig", recordId: gigId, discardable: true },
    ]);

    await runtime.update("Gig", gigId, { Title: "Edited after refusal" }, adminContext);

    // Queued and unanswered again, so there is nothing settled to discard yet.
    expect(await syncStatusOf(runtime, "Gig", gigId)).toBe("pending");
    expect(await runtime.listRefusedRecords()).toEqual([]);
    await expect(runtime.discardRefusedRecord("Gig", gigId, adminContext)).rejects.toThrow(
      RecordNotDiscardableError,
    );

    // The edit is refused in its turn, because the authority has no such record
    // to update. The row must still be something the user can throw away.
    await new AuthoritySyncClient(runtime, refusing("ADL_RUNTIME_RECORD_NOT_FOUND")).reconcile(
      "session-token",
      adminContext,
    );
    expect(await syncStatusOf(runtime, "Gig", gigId)).toBe("rejected");
    expect(await runtime.listRefusedRecords()).toEqual([
      { objectName: "Gig", recordId: gigId, discardable: true },
    ]);
    await runtime.discardRefusedRecord("Gig", gigId, adminContext);
    await expect(runtime.read("Gig", gigId, adminContext)).resolves.toBeNull();
  });

  /**
   * The other half of the same rule. A collision is refused *because* the id
   * already names a record the authority holds, so the bootstrap that follows
   * hands the device that record — and discarding the row would then delete the
   * authority's record rather than the user's refused work.
   */
  it("spends the discard licence when the authority produces a record under that id", async () => {
    const { runtime, gigId } = await refusedCreate();
    expect(await runtime.listRefusedRecords()).toEqual([
      { objectName: "Gig", recordId: gigId, discardable: true },
    ]);

    await runtime.reconcileRemoteRecord("Gig", serverGig(gigId, "Somebody else's record"));

    // Still listed as refused, because the verdict is still unresolved and the
    // user has not been told about it yet — but no longer discardable.
    expect(await runtime.listRefusedRecords()).toEqual([
      { objectName: "Gig", recordId: gigId, discardable: false },
    ]);
    await expect(runtime.discardRefusedRecord("Gig", gigId, adminContext)).rejects.toThrow(
      RecordNotDiscardableError,
    );
  });

  /**
   * Case 6c. Regression guard: Phase 47's rule is that there are exactly two
   * recovery primitives and neither invents a winner. A discard that happened as
   * a side effect of resolving a verdict would be a third, applied without the
   * user asking for it.
   */
  it("is not reachable through either recovery primitive", async () => {
    const { runtime, client, gigId } = await refusedCreate();
    const item = client.listRecovery()[0];
    // A rejection permits dismissal alone; there is no discard choice to make.
    expect(item?.choices).toEqual(["keepServer"]);

    // Even asked for the choice a rejection does not permit, the fallback
    // abandons the operation and leaves every row exactly where it was.
    await client.resolveRecovery(
      "session-token",
      adminContext,
      item?.queueId ?? "",
      "resubmitMine",
    );
    expect(runtime.syncQueue.getEntries()).toEqual([]);
    await expect(runtime.read("Gig", gigId, adminContext)).resolves.toMatchObject({
      values: { Title: "Refused create" },
    });
    expect(await runtime.listRefusedRecords()).toEqual([
      { objectName: "Gig", recordId: gigId, discardable: true },
    ]);
  });
});

/**
 * A record's sync state is device-local. It is not part of the intent contract,
 * and it is not something an authority may assert about a device.
 */
describe("record sync state never crosses the wire", () => {
  /**
   * Case 7a. Regression guard: putting the state on an intent would let a client
   * assert its own view of settlement to the authority, and would make a
   * device-local field part of a contract the authority has to interpret.
   */
  it("emits no record sync state in any intent a reconcile sends", async () => {
    const runtime = newRuntime();
    const created = await runtime.create("Gig", { Title: "Refused" }, adminContext);
    const gigId = created.meta.guid;
    await runtime.create("PrivateNote", { Body: "secret-private-body" }, adminContext);

    const rejecting = refusing();
    await new AuthoritySyncClient(runtime, rejecting).reconcile("session-token", adminContext);
    expect(await syncStatusOf(runtime, "Gig", gigId)).toBe("rejected");

    // A record carrying a verdict is written again and replayed again: the
    // second intent is the one that would leak a state if any intent did.
    await runtime.update("Gig", gigId, { Title: "Edited after refusal" }, adminContext);
    expect(await syncStatusOf(runtime, "Gig", gigId)).toBe("pending");
    const accepting = new ScriptedTransport((intent) => ({
      status: "accepted",
      operationId: intent.operationId,
      records: [],
    }));
    await new AuthoritySyncClient(runtime, accepting).reconcile("session-token", adminContext);

    const wire = JSON.stringify([...rejecting.replayCalls, ...accepting.replayCalls]);
    expect(rejecting.replayCalls).toHaveLength(1);
    expect(accepting.replayCalls).toHaveLength(1);
    expect(wire).not.toContain("syncStatus");
    expect(wire).not.toContain("syncRejectedCreate");
    // Nor by the back door of a whole record meta block riding along on a create.
    const [createIntent] = rejecting.replayCalls;
    expect(Object.keys(createIntent ?? {}).sort()).toEqual([
      "kind",
      "objectName",
      "operationId",
      "recordId",
      "selectedContexts",
      "values",
    ]);
    expect(createIntent?.kind === "create" ? Object.keys(createIntent.values) : []).toEqual([
      "Title",
    ]);
  });

  /**
   * Case 7b. Regression guard: adopting the field from a server record would let
   * the authority's own bookkeeping — or a hostile response — mark a device's
   * rows refused, and would make a record that has just arrived from the
   * authority claim it was never sent.
   */
  it("stores the device's own answer for a reconciled record, never the sync state the server asserts", async () => {
    const runtime = newRuntime();
    const refused = await runtime.create("Gig", { Title: "Refused" }, adminContext);
    const gigId = refused.meta.guid;
    const client = new AuthoritySyncClient(runtime, refusing());
    await client.reconcile("session-token", adminContext);
    await client.resolveRecovery(
      "session-token",
      adminContext,
      client.listRecovery()[0]?.queueId ?? "",
      "keepServer",
    );
    // No question is outstanding about this record any more, so the only thing
    // that could make it `rejected` now is the server saying so.
    expect(await syncStatusOf(runtime, "Gig", gigId)).toBe("rejected");

    // The server asserts a device-local state about the records it returns: one
    // the device holds, and one it has never seen.
    await runtime.reconcileRemoteRecord(
      "Gig",
      serverGig(gigId, "Server title", { syncStatus: "rejected", syncRejectedCreate: true }),
    );
    await runtime.reconcileRemoteRecord(
      "Gig",
      serverGig("gig-fresh", "Fresh", { syncStatus: "conflict", syncRejectedCreate: true }),
    );

    // Neither claim is adopted. A record reconciled onto this device with no
    // verdict outstanding against it is synced *on this device*, and the discard
    // licence belongs to the local row rather than to the authority's copy.
    for (const id of [gigId, "gig-fresh"]) {
      const stored = await runtime.objectStore.getRecordForSync("Gig", id);
      expect(stored?.meta.syncStatus).toBe("synced");
      expect(stored?.meta.syncRejectedCreate).toBeUndefined();
    }
    expect(await runtime.listRefusedRecords()).toEqual([]);
    expect(await runtime.summariseRecordSyncState()).toMatchObject({ synced: 2, rejected: 0 });

    // And the converse, which is the same rule read the other way: a server
    // claiming `synced` cannot settle a conflict the user has not resolved. The
    // answer comes from the device's own queue in both directions, never from
    // the wire.
    await runtime.update("Gig", gigId, { Title: "Local edit" }, adminContext);
    const conflicting = new ScriptedTransport((intent) => ({
      status: "manualResolution",
      operationId: intent.operationId,
      code: "ADL_SYNC_MANUAL_RESOLUTION",
      message: "This record must be resolved by a person.",
      recovery: "manual",
    }));
    await new AuthoritySyncClient(runtime, conflicting).reconcile("session-token", adminContext);
    expect(await syncStatusOf(runtime, "Gig", gigId)).toBe("conflict");

    await runtime.reconcileRemoteRecord("Gig", serverGig(gigId, "Server title again"));
    expect(await syncStatusOf(runtime, "Gig", gigId)).toBe("conflict");
    expect(await runtime.summariseRecordSyncState()).toMatchObject({ conflict: 1, synced: 1 });
  });
});
