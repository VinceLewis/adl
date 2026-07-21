import type { ResolvedApplicationModel, StoredObjectRecord } from "../model/resolved-model.js";
import { ApplicationRuntime } from "../runtime/application-runtime.js";
import type { ObjectStorageBackend } from "../runtime/object-storage-backend.js";
import { RuntimeError } from "../runtime/runtime-types.js";
import type { RuntimeContext } from "../runtime/runtime-types.js";
import type {
  AuthorityOperationIntent,
  AuthorityOutcome,
  AuthorityOutcomeStore,
  AuthoritySessionAdapter,
} from "./authority-types.js";

export class InMemoryAuthorityOutcomeStore implements AuthorityOutcomeStore {
  private readonly outcomes = new Map<string, AuthorityOutcome>();
  async get(operationId: string): Promise<AuthorityOutcome | null> {
    return this.outcomes.get(operationId) ?? null;
  }
  async put(outcome: AuthorityOutcome): Promise<void> {
    this.outcomes.set(outcome.operationId, structuredClone(outcome));
  }
}

export class AuthorityService {
  private readonly runtime: ApplicationRuntime;

  constructor(
    model: ResolvedApplicationModel,
    storage: ObjectStorageBackend,
    private readonly sessions: AuthoritySessionAdapter,
    private readonly outcomes: AuthorityOutcomeStore = new InMemoryAuthorityOutcomeStore(),
  ) {
    this.runtime = new ApplicationRuntime(model, { storage });
  }

  async replay(
    sessionToken: string | undefined,
    intent: AuthorityOperationIntent,
  ): Promise<AuthorityOutcome> {
    const existing = await this.outcomes.get(intent.operationId);
    if (existing !== null) return existing;
    const session = await this.sessions.verify(sessionToken);
    if (session === null)
      return this.persist({
        status: "rejected",
        operationId: intent.operationId,
        code: "ADL_AUTH_UNAUTHENTICATED",
        message: "A valid server session is required.",
      });
    try {
      let context: RuntimeContext = {
        userId: session.userId,
        roles: [],
        channel: "sync",
        online: true,
      };
      for (const [contextName, contextId] of Object.entries(intent.selectedContexts ?? {})) {
        context = await this.runtime.withSelectedContext(contextName, contextId, context);
      }
      const records = await this.apply(intent, context);
      return this.persist({ status: "accepted", operationId: intent.operationId, records });
    } catch (error) {
      if (error instanceof RevisionConflictError) {
        return error.manual
          ? this.persist({
              status: "manualResolution",
              operationId: intent.operationId,
              code: "ADL_SYNC_MANUAL_RESOLUTION",
              message: error.message,
            })
          : this.persist({
              status: "conflict",
              operationId: intent.operationId,
              code: "ADL_SYNC_CONFLICT",
              message: error.message,
            });
      }
      const code = error instanceof RuntimeError ? error.code : "ADL_AUTHORITY_REJECTED";
      const message = error instanceof Error ? error.message : "The operation was rejected.";
      return this.persist({ status: "rejected", operationId: intent.operationId, code, message });
    }
  }

  private async apply(
    intent: AuthorityOperationIntent,
    context: RuntimeContext,
  ): Promise<StoredObjectRecord[]> {
    if (intent.kind === "create")
      return [await this.runtime.create(intent.objectName, intent.values, context)];
    if (intent.kind === "command")
      return (
        await this.runtime.executeCommand(intent.commandName, intent.input, context)
      ).steps.map((step) => step.record);
    const record = await this.runtime.objectStore.getRecordForRuntime(
      intent.objectName,
      intent.recordId,
    );
    if (record === null) throw new RevisionConflictError("The record no longer exists.", false);
    if (record.meta.revision !== intent.baseRevision)
      throw new RevisionConflictError(
        "The record changed on the authority server.",
        this.manualConflict(intent.objectName),
      );
    if (intent.kind === "update")
      return [await this.runtime.update(intent.objectName, intent.recordId, intent.patch, context)];
    if (intent.kind === "delete")
      return [await this.runtime.delete(intent.objectName, intent.recordId, context)];
    return [
      await this.runtime.transition(intent.objectName, intent.recordId, intent.actionName, context),
    ];
  }

  private manualConflict(objectName: string): boolean {
    return this.runtime.index.getObject(objectName).sync.conflict === "manual";
  }
  private async persist(outcome: AuthorityOutcome): Promise<AuthorityOutcome> {
    await this.outcomes.put(outcome);
    return outcome;
  }
}

class RevisionConflictError extends Error {
  constructor(
    message: string,
    readonly manual: boolean,
  ) {
    super(message);
  }
}
