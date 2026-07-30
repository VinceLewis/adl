import type {
  LocalOperation,
  ResolvedApplicationModel,
  ResolvedObject,
} from "../model/resolved-model.js";
import { RuntimeModelIndex } from "./model-helpers.js";
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

export interface SyncQueueEntry {
  queueId: string;
  operation: LocalOperation;
  objectSync: ResolvedObject["sync"];
  /** Present once the authority has answered; absent while the entry is replayable. */
  recovery?: SyncQueueEntryRecovery;
  /** Resubmission count, so each retry carries an operation id the authority has not settled. */
  attempts?: number;
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
    if (object.sync.mode !== "localFirst") {
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

  setRecovery(queueId: string, recovery: SyncQueueEntryRecovery): void {
    const entry = this.entries.find((candidate) => candidate.queueId === queueId);
    if (entry !== undefined) {
      entry.recovery = cloneJson(recovery);
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
