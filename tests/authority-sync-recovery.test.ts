import { describe, expect, it } from "vitest";
import {
  ApplicationRuntime,
  AuthoritySyncClient,
  InMemoryObjectStorageBackend,
  InMemorySyncStateStorage,
  resolveApplicationModel,
  validateApplicationModel,
} from "../src/index.js";
import type {
  AuthorityBootstrapRequest,
  AuthorityBootstrapResponse,
  AuthorityOperationIntent,
  AuthorityOutcome,
  AuthorityTransport,
  ObjectStorageBackend,
  PartialApplicationModel,
  RuntimeContext,
  StoredObjectRecord,
  SyncStateStorage,
} from "../src/index.js";

/**
 * Phase 47 recovery semantics. Before this phase every non-accepted outcome
 * discarded the queue entry, so a conflicted or rejected edit vanished without
 * anyone seeing it. The rules proven here are:
 *
 * - a verdict keeps the entry, it does not discard it;
 * - the model's declared conflict policy — not a client heuristic — picks the
 *   deterministic strategy;
 * - `manual` waits for a person, and survives a reload while it waits;
 * - a rejection is terminal and can only be acknowledged, never resubmitted;
 * - a transport failure is not a verdict and leaves the entry replayable.
 */

const partialModel: PartialApplicationModel = {
  app: { name: "SyncRecoveryFixture" },
  roles: [{ name: "Admin" }],
  objects: [
    conflictObject("ServerGig", "serverWins"),
    conflictObject("ClientGig", "clientWins"),
    conflictObject("ManualGig", "manual"),
    {
      ...conflictObject("TransitionGig", "stateTransitionWins"),
      fields: [
        { name: "Title", type: "text", required: true },
        { name: "Status", type: "text", required: false },
      ],
      lifecycle: {
        name: "TransitionGigLifecycle",
        stateField: "Status",
        initialState: "Draft",
        states: [{ name: "Draft" }, { name: "Booked" }],
        actions: [
          { name: "book", from: "Draft", to: "Booked", policyRefs: ["TransitionGigPolicy"] },
        ],
      },
    },
    // What `PlanTour` writes. A command needs a plain step and an iterating one
    // for "one rejected change" to mean anything: three records land, and the
    // question is whether the user is shown one refusal or three.
    {
      name: "TourPlan",
      businessKey: "Name",
      displayField: "Name",
      fields: [{ name: "Name", type: "text" as const, required: true }],
      sync: { mode: "localFirst" as const, conflict: "manual" as const },
    },
    {
      name: "TourPlanStop",
      businessKey: "City",
      displayField: "City",
      fields: [
        { name: "Plan", type: "text" as const, required: true },
        { name: "City", type: "text" as const, required: true },
      ],
      sync: { mode: "localFirst" as const, conflict: "manual" as const },
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
          name: "createPlan",
          action: "create",
          object: "TourPlan",
          values: { Name: { kind: "input", name: "Name" } },
        },
        {
          name: "createStops",
          action: "create",
          object: "TourPlanStop",
          forEach: "Cities",
          values: {
            Plan: { kind: "stepMeta", step: "createPlan", property: "guid" },
            City: { kind: "item", field: "City" },
          },
        },
      ],
    },
  ],
  policies: [
    "ServerGig",
    "ClientGig",
    "ManualGig",
    "TransitionGig",
    "TourPlan",
    "TourPlanStop",
  ].map((objectName) => ({
    name: `${objectName}Policy`,
    object: objectName,
    rules: [
      {
        name: "adminAll",
        effect: "allow" as const,
        principal: { match: "specific" as const, roles: ["Admin"] },
        action: "*",
      },
    ],
  })),
};

function conflictObject(
  name: string,
  conflict: "serverWins" | "clientWins" | "stateTransitionWins" | "manual",
) {
  return {
    name,
    businessKey: "Title",
    displayField: "Title",
    fields: [{ name: "Title", type: "text" as const, required: true }],
    sync: { mode: "localFirst" as const, conflict },
  };
}

const model = resolveApplicationModel(partialModel);

const adminContext: RuntimeContext = { userId: "user-42", roles: ["Admin"], channel: "ui" };

function newRuntime(options?: {
  storage?: ObjectStorageBackend;
  syncStateStorage?: SyncStateStorage;
}): ApplicationRuntime {
  return new ApplicationRuntime(model, {
    storage: options?.storage ?? new InMemoryObjectStorageBackend(),
    ...(options?.syncStateStorage === undefined
      ? {}
      : { syncStateStorage: options.syncStateStorage }),
  });
}

function conflictOutcome(
  intent: AuthorityOperationIntent,
  recovery: "serverWins" | "clientWins" | "stateTransitionWins",
): AuthorityOutcome {
  return {
    status: "conflict",
    operationId: intent.operationId,
    code: "ADL_SYNC_CONFLICT",
    message: "The record changed on the authority since this operation was queued.",
    recovery,
  };
}

function manualOutcome(intent: AuthorityOperationIntent): AuthorityOutcome {
  return {
    status: "manualResolution",
    operationId: intent.operationId,
    code: "ADL_SYNC_MANUAL_RESOLUTION",
    message: "This record must be resolved by a person.",
    recovery: "manual",
  };
}

function serverRecord(objectName: string, id: string, title: string): StoredObjectRecord {
  const schemaVersion = model.objects.find((object) => object.name === objectName)?.schemaVersion;
  return {
    meta: {
      guid: id,
      object: objectName,
      schemaVersion: schemaVersion ?? 1,
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

/** Scripted authority. Each replay call consults the caller-supplied verdict function. */
class ScriptedTransport implements AuthorityTransport {
  readonly replayCalls: AuthorityOperationIntent[] = [];
  bootstrapCalls = 0;
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
    this.bootstrapCalls += 1;
    return { records: this.bootstrapRecords };
  }

  async replay(
    _sessionToken: string | undefined,
    intent: AuthorityOperationIntent,
  ): Promise<AuthorityOutcome> {
    this.replayCalls.push(intent);
    return this.outcomeFor(intent, this.replayCalls.length);
  }
}

async function queueUpdate(
  runtime: ApplicationRuntime,
  objectName: string,
): Promise<StoredObjectRecord> {
  const created = await runtime.create(objectName, { Title: "Local title" }, adminContext);
  await runtime.update(objectName, created.meta.guid, { Title: "Local edit" }, adminContext);
  return created;
}

describe("client conflict and rejection recovery", () => {
  it("fixture model is valid", () => expect(validateApplicationModel(model)).toEqual([]));

  it("keeps a rejected entry on the queue with its reason instead of discarding it", async () => {
    const runtime = newRuntime();
    await runtime.create("ServerGig", { Title: "Refused" }, adminContext);
    const transport = new ScriptedTransport((intent) => ({
      status: "rejected",
      operationId: intent.operationId,
      code: "ADL_POLICY_DENIED",
      message: "The authority refused this write.",
    }));
    const client = new AuthoritySyncClient(runtime, transport);

    await client.reconcile(undefined, adminContext);

    const recovery = client.listRecovery();
    expect(recovery).toHaveLength(1);
    expect(recovery[0]).toMatchObject({
      status: "rejected",
      code: "ADL_POLICY_DENIED",
      message: "The authority refused this write.",
      requiresUserChoice: false,
      // Terminal: a refused write is acknowledged, never resurrected as accepted.
      choices: ["keepServer"],
    });
    expect(runtime.syncQueue.getReplayable()).toEqual([]);

    // A second reconcile does not resend an operation the authority already settled.
    await client.reconcile(undefined, adminContext);
    expect(transport.replayCalls).toHaveLength(1);
  });

  /**
   * Regression. Automatic recovery originally skipped only `requiresUserChoice`
   * entries, so a rejection — which needs no choice — was silently discarded by
   * the very pass that was supposed to leave it visible. Real PostgreSQL found
   * it: the refused write vanished before anyone could see the reason.
   */
  it("does not let automatic recovery discard a rejection", async () => {
    const runtime = newRuntime();
    await runtime.create("ServerGig", { Title: "Refused" }, adminContext);
    const transport = new ScriptedTransport((intent) => ({
      status: "rejected",
      operationId: intent.operationId,
      code: "ADL_POLICY_DENIED",
      message: "The authority refused this write.",
    }));
    const client = new AuthoritySyncClient(runtime, transport);

    await client.reconcile(undefined, adminContext);
    await client.applyAutomaticRecovery(undefined, adminContext);

    expect(client.listRecovery().map((item) => item.status)).toEqual(["rejected"]);
    expect(runtime.syncQueue.getAwaitingRecovery()).toHaveLength(1);
  });

  it("never resubmits a rejection, even when asked to", async () => {
    const runtime = newRuntime();
    await runtime.create("ClientGig", { Title: "Refused" }, adminContext);
    const transport = new ScriptedTransport((intent) => ({
      status: "rejected",
      operationId: intent.operationId,
      code: "ADL_VALIDATION_FAILED",
      message: "The authority refused this write.",
    }));
    const client = new AuthoritySyncClient(runtime, transport);
    await client.reconcile(undefined, adminContext);

    const queueId = client.listRecovery()[0]?.queueId ?? "";
    await client.resolveRecovery(undefined, adminContext, queueId, "resubmitMine");

    expect(transport.replayCalls).toHaveLength(1);
    expect(client.listRecovery()).toEqual([]);
    expect(runtime.syncQueue.getEntries()).toEqual([]);
  });

  it("resolves a serverWins conflict by abandoning the local operation, with no user input", async () => {
    const runtime = newRuntime();
    const created = await queueUpdate(runtime, "ServerGig");
    const transport = new ScriptedTransport((intent) => conflictOutcome(intent, "serverWins"));
    transport.bootstrapRecords = [
      { objectName: "ServerGig", record: serverRecord("ServerGig", created.meta.guid, "Server") },
    ];
    const client = new AuthoritySyncClient(runtime, transport);

    await client.reconcile(undefined, adminContext);
    await client.bootstrap(undefined, adminContext);
    await client.applyAutomaticRecovery(undefined, adminContext);

    // Nothing was resubmitted and nothing awaits a person.
    expect(transport.replayCalls.map((intent) => intent.kind)).toEqual(["create", "update"]);
    expect(client.listRecovery()).toEqual([]);
    expect(runtime.syncQueue.getEntries()).toEqual([]);
    await expect(
      runtime.objectStore.getRecordForRuntime("ServerGig", created.meta.guid),
    ).resolves.toMatchObject({ values: { Title: "Server" } });
  });

  it("resolves a clientWins conflict by resubmitting rebased on the authority's revision", async () => {
    const runtime = newRuntime();
    const created = await queueUpdate(runtime, "ClientGig");
    const transport = new ScriptedTransport((intent, attempt) =>
      attempt <= 2
        ? conflictOutcome(intent, "clientWins")
        : {
            status: "accepted",
            operationId: intent.operationId,
            records: [serverRecord("ClientGig", created.meta.guid, "Local edit")],
          },
    );
    transport.bootstrapRecords = [
      { objectName: "ClientGig", record: serverRecord("ClientGig", created.meta.guid, "Server") },
    ];
    const client = new AuthoritySyncClient(runtime, transport);

    await client.reconcile(undefined, adminContext);
    await client.bootstrap(undefined, adminContext);
    await client.applyAutomaticRecovery(undefined, adminContext);

    const resubmissions = transport.replayCalls.slice(2);
    expect(resubmissions).toHaveLength(2);
    for (const intent of resubmissions) {
      // A retry carries an operation id the authority has not settled, and the
      // base revision the bootstrap wrote — not the stale queued one.
      expect(intent.operationId).toMatch(/-r1$/u);
      if (intent.kind === "update") {
        expect(intent.baseRevision).toBe(`server-rev-${created.meta.guid}`);
      }
    }
    expect(client.listRecovery()).toEqual([]);
    expect(runtime.syncQueue.getEntries()).toEqual([]);
  });

  it("resolves stateTransitionWins by resubmitting a transition and abandoning a plain update", async () => {
    const runtime = newRuntime();
    const created = await runtime.create("TransitionGig", { Title: "Gig" }, adminContext);
    await runtime.update("TransitionGig", created.meta.guid, { Title: "Edit" }, adminContext);
    await runtime.transition("TransitionGig", created.meta.guid, "book", adminContext);

    const transport = new ScriptedTransport((intent, attempt) =>
      attempt <= 3
        ? conflictOutcome(intent, "stateTransitionWins")
        : { status: "accepted", operationId: intent.operationId, records: [] },
    );
    const client = new AuthoritySyncClient(runtime, transport);

    await client.reconcile(undefined, adminContext);
    await client.applyAutomaticRecovery(undefined, adminContext);

    // Only the transition is resubmitted; the create and the update stand down.
    expect(transport.replayCalls.slice(3).map((intent) => intent.kind)).toEqual(["transition"]);
    expect(client.listRecovery()).toEqual([]);
  });

  it("holds a manual conflict for a person and offers exactly two bounded choices", async () => {
    const runtime = newRuntime();
    const created = await queueUpdate(runtime, "ManualGig");
    const transport = new ScriptedTransport((intent) => manualOutcome(intent));
    const client = new AuthoritySyncClient(runtime, transport);

    await client.reconcile(undefined, adminContext);
    await client.applyAutomaticRecovery(undefined, adminContext);

    const recovery = client.listRecovery();
    expect(recovery).toHaveLength(2);
    for (const item of recovery) {
      expect(item.requiresUserChoice).toBe(true);
      expect(item.strategy).toBe("manual");
      expect(item.choices).toEqual(["keepServer", "resubmitMine"]);
      // The surface carries no record values: a conflict must never disclose a
      // record the caller could not read through a normal runtime read.
      expect(Object.keys(item)).not.toContain("values");
      expect(Object.keys(item)).not.toContain("record");
    }
    // Automatic recovery left them alone; nothing was discarded without a person.
    expect(runtime.syncQueue.getAwaitingRecovery()).toHaveLength(2);
    expect(created.meta.guid).toBeTruthy();
  });

  it("discards a manual entry only once the user resolves it, and survives a reload first", async () => {
    const storage = new InMemoryObjectStorageBackend();
    const syncStateStorage = new InMemorySyncStateStorage();
    const first = newRuntime({ storage, syncStateStorage });
    await first.whenReady();
    const created = await queueUpdate(first, "ManualGig");
    const transport = new ScriptedTransport((intent) => manualOutcome(intent));
    await new AuthoritySyncClient(first, transport).reconcile(undefined, adminContext);

    // Reload: a new runtime over the same persisted object and sync state.
    const second = newRuntime({ storage, syncStateStorage });
    await second.whenReady();
    const reloaded = new AuthoritySyncClient(second, transport);

    const recovery = reloaded.listRecovery();
    expect(recovery.map((item) => item.status)).toEqual(["manualResolution", "manualResolution"]);

    const updateItem = recovery.find((item) => item.operation === "update");
    await reloaded.resolveRecovery(
      undefined,
      adminContext,
      updateItem?.queueId ?? "",
      "keepServer",
    );
    expect(reloaded.listRecovery().map((item) => item.operation)).toEqual(["create"]);

    const createItem = reloaded.listRecovery()[0];
    await reloaded.resolveRecovery(
      undefined,
      adminContext,
      createItem?.queueId ?? "",
      "resubmitMine",
    );
    // The resubmission went to the authority under a fresh operation id.
    expect(transport.replayCalls.at(-1)?.operationId).toMatch(/-r1$/u);
    expect(created.meta.guid).toBeTruthy();
  });

  it("treats a transport failure as retryable, not as a verdict", async () => {
    const runtime = newRuntime();
    await runtime.create("ServerGig", { Title: "Queued offline" }, adminContext);
    const transport = new ScriptedTransport(() => {
      throw new Error("network down");
    });
    const client = new AuthoritySyncClient(runtime, transport);

    await expect(client.reconcile(undefined, adminContext)).rejects.toThrow("network down");

    expect(client.listRecovery()).toEqual([]);
    expect(runtime.syncQueue.getReplayable()).toHaveLength(1);
  });
});

/**
 * A command succeeds or fails as one transaction, so it has to be recovered as
 * one change.
 *
 * Presenting its steps separately would ask a person to resolve three unrelated
 * failures against whichever object happened to be filed first — and would let
 * them dismiss one and resubmit another, which for a transaction is not a
 * resolution at all. There is one queue entry, so there is one verdict, one
 * recovery item and one resolution.
 */
describe("recovery for a command", () => {
  const tourInput = { Name: "Spring tour", Cities: [{ City: "Leeds" }, { City: "York" }] };

  async function plannedTour(runtime: ApplicationRuntime): Promise<void> {
    await runtime.executeCommand("PlanTour", tourInput, adminContext);
  }

  function refusingTransport(): ScriptedTransport {
    return new ScriptedTransport((intent) => ({
      status: "rejected",
      operationId: intent.operationId,
      code: "ADL_POLICY_DENIED",
      message: "The authority refused this command.",
    }));
  }

  it("presents a refused command as one change, named, with dismissal as the only choice", async () => {
    const runtime = newRuntime();
    await plannedTour(runtime);
    expect(runtime.syncQueue.getEntries()).toHaveLength(1);
    const client = new AuthoritySyncClient(runtime, refusingTransport());

    await client.reconcile(undefined, adminContext);

    const recovery = client.listRecovery();
    // One item for three records. Three items would be three refusals to read,
    // three things to dismiss, and no way to tell they were ever one change.
    expect(recovery).toHaveLength(1);
    expect(recovery[0]).toMatchObject({
      operation: "command",
      commandName: "PlanTour",
      commandLabel: "Plan tour",
      recordCount: 3,
      status: "rejected",
      code: "ADL_POLICY_DENIED",
      requiresUserChoice: false,
      // Terminal, exactly as for a refused single write: a command the authority
      // refused is acknowledged, never resurrected as accepted.
      choices: ["keepServer"],
    });
    // Still metadata only. A command's input carries record values, and the
    // recovery surface has no read policy behind it to disclose them.
    expect(JSON.stringify(recovery)).not.toContain("Leeds");
    // Every step moves off `pending` with the command: the verdict covers them
    // all, and leaving them pending would show settled work as unsent.
    expect(runtime.operationLog.getOperations().map((operation) => operation.status)).toEqual([
      "rejected",
      "rejected",
      "rejected",
      "rejected",
    ]);
  });

  /**
   * The decision, recorded rather than discovered later: a rejected command
   * leaves its local records exactly where a rejected create leaves its local
   * row. Nothing deletes them, and a later bootstrap cannot remove records the
   * authority never had. The user's work stays on the device, unsent, with the
   * reason visible in the recovery panel.
   */
  it("leaves every local record the command wrote in place after a refusal", async () => {
    const runtime = newRuntime();
    await plannedTour(runtime);
    const client = new AuthoritySyncClient(runtime, refusingTransport());
    await client.reconcile(undefined, adminContext);

    const localRows = async () => ({
      plans: (await runtime.objectStore.search("TourPlan", {}, adminContext)).length,
      stops: (await runtime.objectStore.search("TourPlanStop", {}, adminContext)).length,
    });
    expect(await localRows()).toEqual({ plans: 1, stops: 2 });

    await client.resolveRecovery(
      undefined,
      adminContext,
      client.listRecovery()[0]?.queueId ?? "",
      "keepServer",
    );

    // Dismissing settles the operation, not the records.
    expect(client.listRecovery()).toEqual([]);
    expect(runtime.syncQueue.getEntries()).toEqual([]);
    expect(await localRows()).toEqual({ plans: 1, stops: 2 });
  });

  it("resubmits a conflicted command whole, under a fresh operation id", async () => {
    const runtime = newRuntime();
    await plannedTour(runtime);
    const transport = new ScriptedTransport((intent, attempt) =>
      attempt === 1
        ? manualOutcome(intent)
        : { status: "accepted", operationId: intent.operationId, records: [] },
    );
    const client = new AuthoritySyncClient(runtime, transport);
    await client.reconcile(undefined, adminContext);

    const item = client.listRecovery()[0];
    expect(item).toMatchObject({ operation: "command", requiresUserChoice: true });
    expect(item?.choices).toEqual(["keepServer", "resubmitMine"]);

    await client.resolveRecovery(undefined, adminContext, item?.queueId ?? "", "resubmitMine");

    // Exactly one resubmission, not one per record: the transaction is what is
    // being offered to the authority again.
    expect(transport.replayCalls).toHaveLength(2);
    const [first, second] = transport.replayCalls;
    if (first?.kind !== "command" || second?.kind !== "command") {
      throw new Error("Expected both attempts to be command intents.");
    }
    // A fresh operation id, because the authority has already settled the first
    // one and would otherwise replay the stored conflict back verbatim.
    expect(second.operationId).toBe(`${first.operationId}-r1`);
    // The same work, and the same record ids: the device still holds those rows,
    // so re-minting them here would strand the ones it is showing.
    expect(second.commandName).toBe("PlanTour");
    expect(second.input).toEqual(first.input);
    expect(second.recordIds).toEqual(first.recordIds);
    expect(second.recordIds).toHaveLength(3);

    expect(client.listRecovery()).toEqual([]);
    expect(runtime.syncQueue.getEntries()).toEqual([]);
  });
});
