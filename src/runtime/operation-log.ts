import type {
  JsonValue,
  LocalBatchOperation,
  LocalCommandOperation,
  LocalOperation,
  LocalOperationKind,
  ResolvedApplicationModel,
  StoredObjectRecord,
} from "../model/resolved-model.js";
import {
  cloneJson,
  getContextNowIso,
  noopRuntimeLogger,
  toOperationLogChannel,
} from "./runtime-types.js";
import type { RuntimeContext, RuntimeLogger } from "./runtime-types.js";

export interface OperationLogDetails {
  baseRevision?: string;
  patch?: Record<string, JsonValue>;
  commandName?: string;
  commandLabel?: string;
  commandStep?: string;
  commandTransactionId?: string;
  /** The whole command, for the single entry that stands for the transaction. */
  command?: LocalCommandOperation;
  /** The whole batch, for the single entry that stands for an ad-hoc transaction. */
  batch?: LocalBatchOperation;
  lifecycleAction?: string;
  fromState?: string;
  toState?: string;
}

export class OperationLog {
  private readonly operations: LocalOperation[] = [];
  private nextOperationId = 1;

  constructor(
    private readonly model: ResolvedApplicationModel,
    private readonly logger: RuntimeLogger = noopRuntimeLogger,
  ) {}

  record(
    operation: LocalOperationKind,
    objectName: string,
    record: StoredObjectRecord,
    context: RuntimeContext,
    details: OperationLogDetails = {},
  ): LocalOperation | undefined {
    this.logger.debug("ENTER OperationLog.record", {
      objectName,
      recordId: record.meta.guid,
      operation,
    });

    if (
      !this.model.operationLog.enabled ||
      !this.model.operationLog.operations.includes(operation)
    ) {
      this.logger.debug("EXIT OperationLog.record", { recorded: false });
      return undefined;
    }

    const localOperation: LocalOperation = {
      opId: `op-${this.nextOperationId++}`,
      object: objectName,
      recordId: record.meta.guid,
      ...(details.baseRevision === undefined ? {} : { baseRevision: details.baseRevision }),
      operation,
      ...(details.patch === undefined ? {} : { patch: cloneJson(details.patch) }),
      ...(details.commandName === undefined ? {} : { commandName: details.commandName }),
      ...(details.commandLabel === undefined ? {} : { commandLabel: details.commandLabel }),
      ...(details.commandStep === undefined ? {} : { commandStep: details.commandStep }),
      ...(details.commandTransactionId === undefined
        ? {}
        : { commandTransactionId: details.commandTransactionId }),
      ...(details.command === undefined ? {} : { command: cloneJson(details.command) }),
      ...(details.batch === undefined ? {} : { batch: cloneJson(details.batch) }),
      // Captured here rather than read at drain time, so a queue drained after
      // the user switched contexts — or after a reload — replays every operation
      // against the selection that was in force when it was made.
      //
      // Recorded even when nothing was selected, and that is the point: an
      // empty selection is a selection. Omitting it would make "nothing was in
      // force" indistinguishable from "this entry predates the capture", and the
      // second reading falls back to the drain-time selection — which is exactly
      // the defect, reappearing for every operation made outside a context.
      selectedContexts: { ...(context.selectedContexts ?? {}) },
      ...(details.lifecycleAction === undefined
        ? {}
        : { lifecycleAction: details.lifecycleAction }),
      ...(details.fromState === undefined ? {} : { fromState: details.fromState }),
      ...(details.toState === undefined ? {} : { toState: details.toState }),
      createdAt: getContextNowIso(context),
      createdBy: context.userId,
      contextSnapshot: {
        roles: [...context.roles],
        channel: toOperationLogChannel(context.channel),
      },
      status: "pending",
    };

    this.operations.push(localOperation);
    this.logger.debug("EXIT OperationLog.record", {
      recorded: true,
      opId: localOperation.opId,
    });
    return cloneJson(localOperation);
  }

  getOperations(): LocalOperation[] {
    return cloneJson(this.operations);
  }

  restore(operations: LocalOperation[]): void {
    this.operations.splice(0, this.operations.length, ...cloneJson(operations));
    this.nextOperationId = Math.max(
      1,
      ...operations
        .map((operation) => Number(operation.opId.replace(/^op-/, "")) + 1)
        .filter(Number.isFinite),
    );
  }

  setStatus(opId: string, status: LocalOperation["status"]): void {
    const operation = this.operations.find((entry) => entry.opId === opId);
    if (operation !== undefined) {
      operation.status = status;
    }
  }

  /**
   * Carries a command's verdict to the per-step entries it stands for.
   *
   * Only the command entry is queued, so only it is answered by the authority.
   * Without this the steps a command wrote would sit at `pending` in the local
   * history for ever, reading as unsent work while the command that produced
   * them had been accepted.
   */
  setStatusForCommandTransaction(
    commandTransactionId: string,
    status: LocalOperation["status"],
  ): void {
    for (const operation of this.operations) {
      if (operation.commandTransactionId === commandTransactionId) {
        operation.status = status;
      }
    }
  }

  clear(): void {
    this.operations.length = 0;
  }
}
