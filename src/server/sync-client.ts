import type { RuntimeContext } from "../runtime/runtime-types.js";
import type { ApplicationRuntime } from "../runtime/application-runtime.js";
import type {
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

/** Sends only local-first queue entries; local-private records never enter that queue. */
export class AuthoritySyncClient {
  constructor(
    private readonly runtime: ApplicationRuntime,
    private readonly transport: AuthorityTransport,
  ) {}
  async reconcile(
    sessionToken: string | undefined,
    context: RuntimeContext,
  ): Promise<AuthorityOutcome[]> {
    const outcomes: AuthorityOutcome[] = [];
    for (const entry of this.runtime.syncQueue.getEntries()) {
      const operation = entry.operation;
      const record = await this.runtime.objectStore.getRecordForRuntime(
        operation.object,
        operation.recordId,
      );
      if (record === null) continue;
      const intent = toIntent(operation, record, context);
      const outcome = await this.transport.replay(sessionToken, intent);
      outcomes.push(outcome);
      if (outcome.status === "accepted") {
        for (const accepted of outcome.records) {
          await this.runtime.reconcileRemoteRecord(accepted.meta.object, accepted);
        }
      }
      this.runtime.operationLog.setStatus(
        operation.opId,
        outcome.status === "accepted"
          ? "accepted"
          : outcome.status === "rejected"
            ? "rejected"
            : "conflict",
      );
      this.runtime.syncQueue.remove(entry.queueId);
    }
    return outcomes;
  }

  async bootstrap(
    sessionToken: string | undefined,
    context: RuntimeContext,
  ): Promise<AuthorityBootstrapResponse> {
    const response = await this.transport.bootstrap(
      sessionToken,
      context.selectedContexts === undefined ? {} : { selectedContexts: context.selectedContexts },
    );
    for (const entry of response.records) {
      await this.runtime.reconcileRemoteRecord(entry.objectName, entry.record);
    }
    return response;
  }
}

function toIntent(
  operation: import("../model/resolved-model.js").LocalOperation,
  record: import("../model/resolved-model.js").StoredObjectRecord,
  context: RuntimeContext,
): AuthorityOperationIntent {
  const selected =
    context.selectedContexts === undefined ? {} : { selectedContexts: context.selectedContexts };
  if (operation.operation === "create")
    return {
      operationId: operation.opId,
      kind: "create",
      objectName: operation.object,
      values: record.values,
      ...selected,
    };
  if (operation.operation === "transition")
    return {
      operationId: operation.opId,
      kind: "transition",
      objectName: operation.object,
      recordId: operation.recordId,
      actionName: operation.lifecycleAction ?? "",
      baseRevision: operation.baseRevision ?? record.meta.revision,
      ...selected,
    };
  if (operation.operation === "delete")
    return {
      operationId: operation.opId,
      kind: "delete",
      objectName: operation.object,
      recordId: operation.recordId,
      baseRevision: operation.baseRevision ?? record.meta.revision,
      ...selected,
    };
  return {
    operationId: operation.opId,
    kind: "update",
    objectName: operation.object,
    recordId: operation.recordId,
    patch: operation.patch ?? {},
    baseRevision: operation.baseRevision ?? record.meta.revision,
    ...selected,
  };
}
