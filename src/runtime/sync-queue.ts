import type {
  LocalOperation,
  ResolvedApplicationModel,
  ResolvedObject,
} from "../model/resolved-model.js";
import { RuntimeModelIndex } from "./model-helpers.js";
import { cloneJson, noopRuntimeLogger } from "./runtime-types.js";
import type { RuntimeLogger } from "./runtime-types.js";

export interface SyncQueueEntry {
  queueId: string;
  operation: LocalOperation;
  objectSync: ResolvedObject["sync"];
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

  clear(): void {
    this.entries.length = 0;
  }
}
