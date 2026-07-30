import type { RuntimeContext } from "../runtime/runtime-types.js";
import type { ApplicationRuntime } from "../runtime/application-runtime.js";
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
      // Tombstones included: a queued delete has no active record, and skipping
      // it would strand the entry in the queue and never tell the authority.
      const record = await this.runtime.objectStore.getRecordForSync(
        operation.object,
        operation.recordId,
      );
      // Only a create needs values that exist nowhere else; the other kinds are
      // reconstructible from the queued operation alone.
      if (record === null && operation.operation === "create") continue;
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
}

function toIntent(
  operation: import("../model/resolved-model.js").LocalOperation,
  record: import("../model/resolved-model.js").StoredObjectRecord | null,
  context: RuntimeContext,
): AuthorityOperationIntent {
  const selected =
    context.selectedContexts === undefined ? {} : { selectedContexts: context.selectedContexts };
  // An absent base revision cannot be invented: the authority answers with a
  // conflict, which is visible, rather than the entry vanishing silently.
  const baseRevision = operation.baseRevision ?? record?.meta.revision ?? "";
  if (operation.operation === "create")
    return {
      operationId: operation.opId,
      kind: "create",
      objectName: operation.object,
      values: record?.values ?? {},
      ...selected,
    };
  if (operation.operation === "transition")
    return {
      operationId: operation.opId,
      kind: "transition",
      objectName: operation.object,
      recordId: operation.recordId,
      actionName: operation.lifecycleAction ?? "",
      baseRevision,
      ...selected,
    };
  if (operation.operation === "delete")
    return {
      operationId: operation.opId,
      kind: "delete",
      objectName: operation.object,
      recordId: operation.recordId,
      baseRevision,
      ...selected,
    };
  return {
    operationId: operation.opId,
    kind: "update",
    objectName: operation.object,
    recordId: operation.recordId,
    patch: operation.patch ?? {},
    baseRevision,
    ...selected,
  };
}
