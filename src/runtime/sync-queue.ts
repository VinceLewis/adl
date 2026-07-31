import type {
  LocalOperation,
  ResolvedApplicationModel,
  ResolvedObject,
} from "../model/resolved-model.js";
import { RuntimeModelIndex } from "./model-helpers.js";
import { isQueueableSyncMode, requiresImmediateDelivery } from "./sync-policy-service.js";
import { cloneJson, noopRuntimeLogger } from "./runtime-types.js";
import type { RuntimeLogger } from "./runtime-types.js";

/** The model-declared conflict policy the authority reported for this entry. */
export type SyncRecoveryStrategy = "serverWins" | "clientWins" | "stateTransitionWins" | "manual";

/** A real server verdict. A transport failure is never one of these. */
export type SyncRecoveryStatus = "rejected" | "conflict" | "manualResolution";

/**
 * The authority's verdict on a queued operation, held on the entry until the
 * strategy or the user resolves it. Carrying it here rather than discarding the
 * entry is what keeps a rejected or conflicted edit visible and recoverable,
 * and — because the queue is persisted — recoverable across a reload.
 */
export interface SyncQueueEntryRecovery {
  status: SyncRecoveryStatus;
  code: string;
  message: string;
  /** Absent for a rejection: a rejection has no winner to choose. */
  strategy?: SyncRecoveryStrategy;
  recordedAt: string;
}

/**
 * A delivery attempt that failed for transport reasons, held on the entry so a
 * write the runtime accepted and could not send is visible rather than lost.
 *
 * It is emphatically not a verdict: the entry keeps no `recovery`, stays
 * replayable, and is sent again by the next reconcile. Recorded only for a mode
 * whose accepted writes may not wait for a later connection, because a
 * `localFirst` entry waiting offline is that mode working, not failing.
 */
export interface SyncQueueEntryDelivery {
  status: "undelivered";
  message: string;
  attemptedAt: string;
}

export interface SyncQueueEntry {
  queueId: string;
  operation: LocalOperation;
  objectSync: ResolvedObject["sync"];
  /** Present once the authority has answered; absent while the entry is replayable. */
  recovery?: SyncQueueEntryRecovery;
  /** Present after a failed delivery attempt; cleared once the entry is sent or answered. */
  delivery?: SyncQueueEntryDelivery;
  /** Resubmission count, so each retry carries an operation id the authority has not settled. */
  attempts?: number;
}

/** A record one queued operation wrote, and whether that operation created it. */
export interface CoveredQueueRecord {
  objectName: string;
  recordId: string;
  /**
   * True when this operation is what brought the record into existence. Only
   * such a record may later be discarded locally, because only for such a record
   * is a refusal proof that the authority holds no copy of it.
   */
  created: boolean;
}

/**
 * Every record a queued operation's verdict is about.
 *
 * For an ordinary operation that is the one record it names. For a command it is
 * every record all of its steps wrote — the list Phase 57 put on the entry for
 * exactly this purpose — because the authority answered the command as one
 * transaction and its answer is equally true of every row it produced. The
 * created subset is the manifest, which names creates and only creates.
 */
export function coveredQueueRecords(operation: LocalOperation): CoveredQueueRecord[] {
  const command = operation.command;
  if (operation.operation !== "command" || command === undefined) {
    return [
      {
        objectName: operation.object,
        recordId: operation.recordId,
        created: operation.operation === "create",
      },
    ];
  }

  const created = new Set(
    command.recordIds.map((supplied) => `${supplied.objectName}\0${supplied.recordId}`),
  );
  return command.records.map((record) => ({
    objectName: record.objectName,
    recordId: record.recordId,
    created: created.has(`${record.objectName}\0${record.recordId}`),
  }));
}

export class SyncQueue {
  private readonly entries: SyncQueueEntry[] = [];

  constructor(
    private readonly model: ResolvedApplicationModel,
    private readonly index = new RuntimeModelIndex(model),
    private readonly logger: RuntimeLogger = noopRuntimeLogger,
  ) {}

  enqueue(operation: LocalOperation | undefined): SyncQueueEntry | undefined {
    if (operation === undefined) {
      return undefined;
    }

    const object = this.index.getObject(operation.object);
    // Every mode whose accepted writes belong to the authority is queued here,
    // not `localFirst` alone. An `onlineRequired` write that skipped the queue
    // was validated, persisted, logged and then never sent to anyone.
    if (!isQueueableSyncMode(object.sync.mode)) {
      this.logger.debug("SyncQueue.enqueue skipped", {
        objectName: operation.object,
        mode: object.sync.mode,
        opId: operation.opId,
      });
      return undefined;
    }

    const entry: SyncQueueEntry = {
      queueId: `sync-${operation.opId}`,
      operation: cloneJson(operation),
      objectSync: cloneJson(object.sync),
    };
    this.entries.push(entry);
    this.logger.debug("SyncQueue.enqueue recorded", {
      objectName: operation.object,
      opId: operation.opId,
      queueId: entry.queueId,
    });
    return cloneJson(entry);
  }

  getEntries(): SyncQueueEntry[] {
    return cloneJson(this.entries);
  }

  /** Entries the authority has not answered yet, and only those, are replayable. */
  getReplayable(): SyncQueueEntry[] {
    return cloneJson(this.entries.filter((entry) => entry.recovery === undefined));
  }

  /** Entries holding a server verdict that no strategy or user has resolved yet. */
  getAwaitingRecovery(): SyncQueueEntry[] {
    return cloneJson(this.entries.filter((entry) => entry.recovery !== undefined));
  }

  /**
   * The verdict still outstanding against one record, if any.
   *
   * Asked by reconciliation, so that reading the authority's copy of a record
   * does not quietly settle a question the user has not answered. A record with
   * an unresolved conflict against it is not `synced` merely because a bootstrap
   * has run: the queue still holds an operation the user may yet resubmit.
   */
  getUnresolvedVerdict(objectName: string, recordId: string): SyncRecoveryStatus | undefined {
    for (const entry of this.entries) {
      const recovery = entry.recovery;
      if (recovery === undefined) continue;
      const covers = coveredQueueRecords(entry.operation).some(
        (record) => record.objectName === objectName && record.recordId === recordId,
      );
      if (covers) return recovery.status;
    }
    return undefined;
  }

  /**
   * Entries that were expected to reach the authority now and did not. They are
   * still replayable — a transport failure settles nothing — so they appear here
   * *and* in `getReplayable()`.
   */
  getUndelivered(): SyncQueueEntry[] {
    return cloneJson(this.entries.filter((entry) => entry.delivery !== undefined));
  }

  setRecovery(queueId: string, recovery: SyncQueueEntryRecovery): void {
    const entry = this.entries.find((candidate) => candidate.queueId === queueId);
    if (entry !== undefined) {
      entry.recovery = cloneJson(recovery);
      // The authority answered, so the delivery question is closed however it
      // answered. Leaving the marker would report the entry as both undelivered
      // and settled.
      delete entry.delivery;
    }
  }

  /**
   * Records a failed delivery attempt. Ignored for a mode that is allowed to
   * wait for the next connection, so normal offline queueing is never reported
   * as a failure, and ignored once the authority has answered, because a verdict
   * outranks a transport failure that preceded it.
   */
  setDeliveryFailure(queueId: string, delivery: SyncQueueEntryDelivery): void {
    const entry = this.entries.find((candidate) => candidate.queueId === queueId);
    if (
      entry === undefined ||
      entry.recovery !== undefined ||
      !requiresImmediateDelivery(entry.objectSync.mode)
    ) {
      return;
    }

    entry.delivery = cloneJson(delivery);
    this.logger.debug("SyncQueue.setDeliveryFailure recorded", {
      objectName: entry.operation.object,
      queueId,
      mode: entry.objectSync.mode,
    });
  }

  clearDeliveryFailure(queueId: string): void {
    const entry = this.entries.find((candidate) => candidate.queueId === queueId);
    if (entry !== undefined) {
      delete entry.delivery;
    }
  }

  /**
   * Clears the verdict and counts a retry, so a resubmission carries an
   * operation id the authority has not already settled. Returns the entry to
   * resend, or undefined when it is gone.
   */
  beginRetry(queueId: string): SyncQueueEntry | undefined {
    const entry = this.entries.find((candidate) => candidate.queueId === queueId);
    if (entry === undefined) {
      return undefined;
    }

    delete entry.recovery;
    delete entry.delivery;
    entry.attempts = (entry.attempts ?? 0) + 1;
    return cloneJson(entry);
  }

  remove(queueId: string): void {
    const index = this.entries.findIndex((entry) => entry.queueId === queueId);
    if (index >= 0) {
      this.entries.splice(index, 1);
    }
  }

  clear(): void {
    this.entries.length = 0;
  }

  restore(entries: SyncQueueEntry[]): void {
    this.entries.splice(0, this.entries.length, ...cloneJson(entries));
  }
}
