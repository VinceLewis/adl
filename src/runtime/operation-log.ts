import type {
  JsonValue,
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

  setStatus(opId: string, status: LocalOperation["status"]): void {
    const operation = this.operations.find((entry) => entry.opId === opId);
    if (operation !== undefined) {
      operation.status = status;
    }
  }

  clear(): void {
    this.operations.length = 0;
  }
}
