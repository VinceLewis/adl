import type { RuntimeContext } from "../runtime/runtime-types.js";
import type { ApplicationRuntime } from "../runtime/application-runtime.js";
import type {
  SyncQueueEntry,
  SyncRecoveryStatus,
  SyncRecoveryStrategy,
} from "../runtime/sync-queue.js";
import type { LocalOperationKind } from "../model/resolved-model.js";
import type {
  AuthorityBootstrapRecord,
  AuthorityBootstrapRequest,
  AuthorityBootstrapResponse,
  AuthorityOperationIntent,
  AuthorityOutcome,
} from "./authority-types.js";

export interface AuthorityTransport {
  replay(
    sessionToken: string | undefined,
    intent: AuthorityOperationIntent,
  ): Promise<AuthorityOutcome>;
  bootstrap(
    sessionToken: string | undefined,
    request?: AuthorityBootstrapRequest,
  ): Promise<AuthorityBootstrapResponse>;
}

/**
 * The two things a client may do with a settled operation. Neither invents a
 * winner: `keepServer` abandons the local operation so the authority's state
 * stands, and `resubmitMine` sends the same operation again, rebased on the
 * authority's current revision, for the authority to judge afresh.
 */
export type SyncRecoveryChoice = "keepServer" | "resubmitMine";

/**
 * What the user may be shown about a settled operation. It deliberately carries
 * no record values: a conflict must never disclose a server record the caller
 * could not read through a normal runtime read.
 */
export interface SyncRecoveryItem {
  queueId: string;
  opId: string;
  objectName: string;
  recordId: string;
  operation: LocalOperationKind;
  status: SyncRecoveryStatus;
  code: string;
  message: string;
  strategy?: SyncRecoveryStrategy;
  recordedAt: string;
  /** True only for `manual`: every other verdict is resolved by the model or is terminal. */
  requiresUserChoice: boolean;
  /** The choices this verdict permits. A rejection permits `keepServer` alone. */
  choices: SyncRecoveryChoice[];
}

/** Sends only local-first queue entries; local-private records never enter that queue. */
export class AuthoritySyncClient {
  constructor(
    private readonly runtime: ApplicationRuntime,
    private readonly transport: AuthorityTransport,
  ) {}

  /**
   * Replays every queue entry the authority has not yet answered. An accepted
   * entry leaves the queue; a rejection or conflict stays on it carrying the
   * verdict, so the work is recoverable rather than silently discarded. A
   * transport failure propagates untouched: it is not a verdict, and the entry
   * must stay replayable.
   */
  async reconcile(
    sessionToken: string | undefined,
    context: RuntimeContext,
  ): Promise<AuthorityOutcome[]> {
    const outcomes: AuthorityOutcome[] = [];
    for (const entry of this.runtime.syncQueue.getReplayable()) {
      const outcome = await this.send(sessionToken, entry, context, entry.operation.baseRevision);
      if (outcome !== null) {
        outcomes.push(outcome);
      }
    }
    return outcomes;
  }

  /** Every settled operation the user or the model still has to resolve. */
  listRecovery(): SyncRecoveryItem[] {
    return this.runtime.syncQueue.getAwaitingRecovery().map((entry) => toRecoveryItem(entry));
  }

  /**
   * Applies the model-declared strategy for every entry that does not need a
   * person. Run it after a bootstrap: `keepServer` relies on the authority's
   * state having already replaced the local record, and `resubmitMine` rebases
   * on the revision that bootstrap wrote.
   */
  async applyAutomaticRecovery(
    sessionToken: string | undefined,
    context: RuntimeContext,
  ): Promise<AuthorityOutcome[]> {
    const outcomes: AuthorityOutcome[] = [];
    for (const entry of this.runtime.syncQueue.getAwaitingRecovery()) {
      const item = toRecoveryItem(entry);
      // Only a declared conflict strategy resolves itself. A rejection has no
      // strategy and must never be auto-discarded: the whole point of this
      // phase is that a refused write stays visible until a person sees it.
      if (item.strategy === undefined || item.requiresUserChoice) {
        continue;
      }

      const outcome = await this.resolveRecovery(
        sessionToken,
        context,
        entry.queueId,
        automaticChoice(entry),
      );
      if (outcome !== null) {
        outcomes.push(outcome);
      }
    }
    return outcomes;
  }

  /**
   * Applies one resolution. `keepServer` discards the local operation, which is
   * the only permitted resolution for a rejection: a refused write must never be
   * resurrected as accepted. `resubmitMine` sends the operation again under a
   * fresh operation id, rebased on the local record's current revision, and the
   * authority judges it exactly as it judges any other replay.
   */
  async resolveRecovery(
    sessionToken: string | undefined,
    context: RuntimeContext,
    queueId: string,
    choice: SyncRecoveryChoice,
  ): Promise<AuthorityOutcome | null> {
    const entry = this.runtime.syncQueue
      .getAwaitingRecovery()
      .find((candidate) => candidate.queueId === queueId);
    if (entry === undefined) {
      return null;
    }

    // A choice the verdict does not permit falls back to abandoning the local
    // operation. A rejection can only ever be acknowledged.
    const permitted = toRecoveryItem(entry).choices;
    if (choice === "keepServer" || !permitted.includes(choice)) {
      this.runtime.syncQueue.remove(entry.queueId);
      return null;
    }

    const retry = this.runtime.syncQueue.beginRetry(entry.queueId);
    if (retry === undefined) {
      return null;
    }

    this.runtime.operationLog.setStatus(retry.operation.opId, "sent");
    // Rebase: the base revision comes from the record as it now stands locally,
    // which a bootstrap has already reconciled to the authority's version.
    return this.send(sessionToken, retry, context, undefined);
  }

  /**
   * Applies every page the authority is willing to disclose. A bootstrap that
   * stopped at page one would silently drop permitted records, so the cursor is
   * followed to exhaustion. The returned response carries no `nextCursor`
   * because the dataset is complete.
   */
  async bootstrap(
    sessionToken: string | undefined,
    context: RuntimeContext,
  ): Promise<AuthorityBootstrapResponse> {
    const selected =
      context.selectedContexts === undefined ? {} : { selectedContexts: context.selectedContexts };
    const records: AuthorityBootstrapRecord[] = [];
    const usedCursors = new Set<string>();
    let cursor: string | undefined;
    for (;;) {
      const page = await this.transport.bootstrap(sessionToken, {
        ...selected,
        ...(cursor === undefined ? {} : { cursor }),
      });
      for (const entry of page.records) {
        await this.runtime.reconcileRemoteRecord(entry.objectName, entry.record);
        records.push(entry);
      }
      const next = page.nextCursor;
      // An empty page or a repeated cursor cannot make further progress; stop
      // rather than trusting the server to terminate the walk.
      if (next === undefined || page.records.length === 0 || usedCursors.has(next)) break;
      usedCursors.add(next);
      cursor = next;
    }
    return { records };
  }

  /** Sends one entry and records the authority's verdict against it. */
  private async send(
    sessionToken: string | undefined,
    entry: SyncQueueEntry,
    context: RuntimeContext,
    baseRevision: string | undefined,
  ): Promise<AuthorityOutcome | null> {
    const operation = entry.operation;
    // Tombstones included: a queued delete has no active record, and skipping
    // it would strand the entry in the queue and never tell the authority.
    const record = await this.runtime.objectStore.getRecordForSync(
      operation.object,
      operation.recordId,
    );
    // Only a create needs values that exist nowhere else; the other kinds are
    // reconstructible from the queued operation alone.
    if (record === null && operation.operation === "create") return null;
    const intent = toIntent(operationIdFor(entry), operation, record, context, baseRevision);
    const outcome = await this.transport.replay(sessionToken, intent);
    if (outcome.status === "accepted") {
      for (const accepted of outcome.records) {
        await this.runtime.reconcileRemoteRecord(accepted.meta.object, accepted);
      }
      this.runtime.operationLog.setStatus(operation.opId, "accepted");
      this.runtime.syncQueue.remove(entry.queueId);
      return outcome;
    }

    this.runtime.operationLog.setStatus(
      operation.opId,
      outcome.status === "rejected" ? "rejected" : "conflict",
    );
    // The entry survives its verdict. It is discarded only once the declared
    // strategy or the user has resolved it.
    this.runtime.syncQueue.setRecovery(entry.queueId, {
      status: outcome.status,
      code: outcome.code,
      message: outcome.message,
      ...(outcome.status === "rejected" ? {} : { strategy: outcome.recovery }),
      recordedAt: new Date().toISOString(),
    });
    return outcome;
  }
}

/**
 * A retry may not reuse an operation id the authority has already settled: the
 * stored outcome for that id would be replayed back verbatim as the same
 * conflict. Each attempt therefore carries its own id.
 */
function operationIdFor(entry: SyncQueueEntry): string {
  const attempts = entry.attempts ?? 0;
  return attempts === 0 ? entry.operation.opId : `${entry.operation.opId}-r${attempts}`;
}

function toRecoveryItem(entry: SyncQueueEntry): SyncRecoveryItem {
  const recovery = entry.recovery;
  const strategy = recovery?.strategy;
  const requiresUserChoice = strategy === "manual";
  return {
    queueId: entry.queueId,
    opId: entry.operation.opId,
    objectName: entry.operation.object,
    recordId: entry.operation.recordId,
    operation: entry.operation.operation,
    status: recovery?.status ?? "conflict",
    code: recovery?.code ?? "",
    message: recovery?.message ?? "",
    ...(strategy === undefined ? {} : { strategy }),
    recordedAt: recovery?.recordedAt ?? "",
    requiresUserChoice,
    choices: permittedChoices(entry),
  };
}

/**
 * A rejection is terminal: the authority refused the write, so acknowledging it
 * is the only move. Every conflict may be resubmitted, because the authority
 * still decides the resubmission.
 */
function permittedChoices(entry: SyncQueueEntry): SyncRecoveryChoice[] {
  if (entry.recovery?.status === "rejected") return ["keepServer"];
  return ["keepServer", "resubmitMine"];
}

/**
 * The deterministic reading of each declared policy. `stateTransitionWins` means
 * a lifecycle transition outranks a concurrent field write, so only a queued
 * transition is resubmitted under it.
 */
function automaticChoice(entry: SyncQueueEntry): SyncRecoveryChoice {
  const strategy = entry.recovery?.strategy;
  if (strategy === "clientWins") return "resubmitMine";
  if (strategy === "stateTransitionWins")
    return entry.operation.operation === "transition" ? "resubmitMine" : "keepServer";
  return "keepServer";
}

function toIntent(
  operationId: string,
  operation: import("../model/resolved-model.js").LocalOperation,
  record: import("../model/resolved-model.js").StoredObjectRecord | null,
  context: RuntimeContext,
  queuedBaseRevision: string | undefined,
): AuthorityOperationIntent {
  const selected =
    context.selectedContexts === undefined ? {} : { selectedContexts: context.selectedContexts };
  // An absent base revision cannot be invented: the authority answers with a
  // conflict, which is visible, rather than the entry vanishing silently.
  const baseRevision = queuedBaseRevision ?? record?.meta.revision ?? "";
  if (operation.operation === "create")
    return {
      operationId,
      kind: "create",
      objectName: operation.object,
      values: record?.values ?? {},
      ...selected,
    };
  if (operation.operation === "transition")
    return {
      operationId,
      kind: "transition",
      objectName: operation.object,
      recordId: operation.recordId,
      actionName: operation.lifecycleAction ?? "",
      baseRevision,
      ...selected,
    };
  if (operation.operation === "delete")
    return {
      operationId,
      kind: "delete",
      objectName: operation.object,
      recordId: operation.recordId,
      baseRevision,
      ...selected,
    };
  return {
    operationId,
    kind: "update",
    objectName: operation.object,
    recordId: operation.recordId,
    patch: operation.patch ?? {},
    baseRevision,
    ...selected,
  };
}
