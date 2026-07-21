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
  AuthorityBootstrapRequest,
  AuthorityBootstrapResponse,
} from "./authority-types.js";

export class InMemoryAuthorityOutcomeStore implements AuthorityOutcomeStore {
  private readonly outcomes = new Map<string, AuthorityOutcome>();
  async get(operationId: string, actorId: string): Promise<AuthorityOutcome | null> {
    return structuredClone(this.outcomes.get(outcomeKey(operationId, actorId)) ?? null);
  }
  async put(outcome: AuthorityOutcome, actorId: string): Promise<void> {
    this.outcomes.set(outcomeKey(outcome.operationId, actorId), structuredClone(outcome));
  }
}

function outcomeKey(operationId: string, actorId: string): string {
  return `${actorId}\u0000${operationId}`;
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
    this.storage = storage;
  }
  private readonly storage: ObjectStorageBackend;

  /**
   * Authenticated accepted-state pull. Raw rows are never returned: each row is
   * passed through the runtime's context scope and read policy before emission.
   */
  async bootstrap(
    sessionToken: string | undefined,
    request: AuthorityBootstrapRequest = {},
  ): Promise<AuthorityBootstrapResponse> {
    const session = await this.sessions.verify(sessionToken);
    if (session === null) return { records: [] };
    try {
      const context = await this.resolveContext(session.userId, request.selectedContexts);
      const after = decodeCursor(request.cursor);
      const limit = Math.min(Math.max(request.limit ?? 100, 1), 250);
      const candidates = (await this.storage.listRecords())
        .filter(
          ({ objectName, record }) =>
            this.runtime.index.getObject(objectName).sync.mode !== "localPrivate",
        )
        .filter(({ record }) => record.meta.deletedAt === undefined)
        .sort((left, right) =>
          `${left.objectName}\u0000${left.record.meta.guid}`.localeCompare(
            `${right.objectName}\u0000${right.record.meta.guid}`,
          ),
        );
      const visible: AuthorityBootstrapResponse["records"] = [];
      for (const candidate of candidates) {
        const key = `${candidate.objectName}\u0000${candidate.record.meta.guid}`;
        if (after !== undefined && key <= after) continue;
        try {
          const shaped = await this.runtime.read(
            candidate.objectName,
            candidate.record.meta.guid,
            context,
          );
          if (shaped !== null) visible.push({ objectName: candidate.objectName, record: shaped });
        } catch {
          // A denied row is indistinguishable from an absent row to the caller.
        }
      }
      const records = visible.slice(0, limit);
      const last = records.at(-1);
      const hasMore = visible.length > records.length;
      return {
        records,
        ...(hasMore && last !== undefined
          ? { nextCursor: encodeCursor(`${last.objectName}\u0000${last.record.meta.guid}`) }
          : {}),
      };
    } catch {
      // Context/auth failures must not become an enumeration oracle.
      return { records: [] };
    }
  }

  async replay(
    sessionToken: string | undefined,
    intent: AuthorityOperationIntent,
  ): Promise<AuthorityOutcome> {
    const session = await this.sessions.verify(sessionToken);
    if (session === null)
      return {
        status: "rejected",
        operationId: intent.operationId,
        code: "ADL_AUTH_UNAUTHENTICATED",
        message: "A valid server session is required.",
      };
    const existing = await this.outcomes.get(intent.operationId, session.userId);
    if (existing !== null) return existing;
    try {
      const context = await this.resolveContext(session.userId, intent.selectedContexts);
      const records = await this.shapeAcceptedRecords(await this.apply(intent, context), context);
      return this.persist(
        { status: "accepted", operationId: intent.operationId, records },
        session.userId,
      );
    } catch (error) {
      if (error instanceof RevisionConflictError) {
        return error.manual
          ? this.persist(
              {
                status: "manualResolution",
                operationId: intent.operationId,
                code: "ADL_SYNC_MANUAL_RESOLUTION",
                message: error.message,
                recovery: "manual",
              },
              session.userId,
            )
          : this.persist(
              {
                status: "conflict",
                operationId: intent.operationId,
                code: "ADL_SYNC_CONFLICT",
                message: error.message,
                recovery: this.conflictRecovery(error.objectName),
              },
              session.userId,
            );
      }
      const code = error instanceof RuntimeError ? error.code : "ADL_AUTHORITY_REJECTED";
      const message = error instanceof Error ? error.message : "The operation was rejected.";
      return this.persist(
        { status: "rejected", operationId: intent.operationId, code, message },
        session.userId,
      );
    }
  }

  /** Used by the HTTP edge to exempt an authenticated idempotent retry from rate cost. */
  async replayOutcome(
    sessionToken: string | undefined,
    operationId: string,
  ): Promise<AuthorityOutcome | null> {
    const session = await this.sessions.verify(sessionToken);
    return session === null ? null : this.outcomes.get(operationId, session.userId);
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
    if (record === null)
      throw new RevisionConflictError("The record no longer exists.", intent.objectName, false);
    if (record.meta.revision !== intent.baseRevision)
      throw new RevisionConflictError(
        "The record changed on the authority server.",
        intent.objectName,
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

  private async resolveContext(
    userId: string,
    selectedContexts: Record<string, string> | undefined,
  ): Promise<RuntimeContext> {
    let context: RuntimeContext = { userId, roles: [], channel: "sync", online: true };
    for (const [contextName, contextId] of Object.entries(selectedContexts ?? {})) {
      context = await this.runtime.withSelectedContext(contextName, contextId, context);
    }
    return context;
  }

  private async shapeAcceptedRecords(
    records: StoredObjectRecord[],
    context: RuntimeContext,
  ): Promise<StoredObjectRecord[]> {
    const shaped: StoredObjectRecord[] = [];
    for (const record of records) {
      if (record.meta.deletedAt !== undefined) {
        shaped.push({ ...record, values: {} });
        continue;
      }
      const visible = await this.runtime.read(record.meta.object, record.meta.guid, context);
      if (visible !== null) shaped.push(visible);
    }
    return shaped;
  }

  private manualConflict(objectName: string): boolean {
    return this.runtime.index.getObject(objectName).sync.conflict === "manual";
  }
  private conflictRecovery(
    objectName: string,
  ): "serverWins" | "clientWins" | "stateTransitionWins" {
    const policy = this.runtime.index.getObject(objectName).sync.conflict;
    return policy === "manual" ? "serverWins" : policy;
  }
  private async persist(outcome: AuthorityOutcome, actorId: string): Promise<AuthorityOutcome> {
    await this.outcomes.put(outcome, actorId);
    return outcome;
  }
}

class RevisionConflictError extends Error {
  constructor(
    message: string,
    readonly objectName: string,
    readonly manual: boolean,
  ) {
    super(message);
  }
}

function encodeCursor(value: string): string {
  return btoa(value);
}
function decodeCursor(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    return atob(value);
  } catch {
    return undefined;
  }
}
