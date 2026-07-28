import type { AuditEvent, JsonValue, ResolvedApplicationModel } from "../model/resolved-model.js";
import { ApplicationRuntime } from "../runtime/application-runtime.js";
import type { AuthorityOutcome } from "./authority-types.js";
import type { PostgresQueryable } from "./postgres-authority-store.js";
import { PostgresObjectStorageBackend } from "./postgres-object-storage.js";

/** The business context a scoped record belongs to, derived from its declared scope. */
interface AuditContextScope {
  contextName: string;
  contextId: string;
}

/** A pinned client that must be released back to the pool after the transaction. */
export interface PostgresPoolClient extends PostgresQueryable {
  release(): void;
}

/** Structural `pg.Pool` contract; ADL never depends on the `pg` package directly. */
export interface PostgresPool {
  connect(): Promise<PostgresPoolClient>;
}

/**
 * The set of authority projections a single accepted replay commits together.
 * Reporting and administration observe only these committed projections.
 */
export interface AuthorityTransactionAuditContext {
  operationId: string;
  actorId: string;
}

/**
 * One authority commit boundary. Every write issued through it — accepted
 * records (via the runtime), runtime audit projection, and the actor-bound
 * outcome — lands in the same PostgreSQL transaction, so a failure at any stage
 * rolls back all of them together.
 */
export class AuthorityTransaction {
  /** A transaction-scoped runtime whose record writes join this transaction. */
  readonly runtime: ApplicationRuntime;
  private readonly storageBackend: PostgresObjectStorageBackend;
  /** Object name -> its declared scope (context name + the field holding the context id). */
  private readonly objectScopes: Map<string, { contextName: string; field: string }>;

  constructor(
    private readonly client: PostgresPoolClient,
    private readonly applicationId: string,
    model: ResolvedApplicationModel,
  ) {
    this.storageBackend = new PostgresObjectStorageBackend(client, applicationId, model, {
      ambientTransaction: true,
    });
    this.runtime = new ApplicationRuntime(model, { storage: this.storageBackend });
    this.objectScopes = new Map(
      model.objects
        .filter((object) => object.scope !== undefined)
        .map((object) => [
          object.name,
          { contextName: object.scope!.context, field: object.scope!.field },
        ]),
    );
  }

  /**
   * Insert the actor-bound outcome. Returns false when an outcome for this
   * (operationId, actorId) already exists — the idempotency gate that makes a
   * concurrent duplicate submission roll back instead of committing a second
   * accepted record.
   */
  async putOutcome(outcome: AuthorityOutcome, actorId: string): Promise<boolean> {
    const result = await this.client.query<{ operation_id: string }>(
      "insert into adl_authority_operation_outcomes (operation_id, actor_id, application_id, outcome) values ($1, $2, $3, $4::jsonb) on conflict (operation_id, actor_id) do nothing returning operation_id",
      [outcome.operationId, actorId, this.applicationId, JSON.stringify(outcome)],
    );
    return result.rows.length > 0;
  }

  /** Persist this operation's runtime audit events into the same transaction. */
  async writeRuntimeAudit(
    events: AuditEvent[],
    context: AuthorityTransactionAuditContext,
  ): Promise<void> {
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      if (event === undefined) continue;
      // The runtime numbers audit ids per instance, so make the durable id
      // globally unique per (actor, operation, event) to avoid cross-operation
      // primary-key collisions and duplicate-on-retry writes.
      const auditId = `${context.actorId}:${context.operationId}:${index}`;
      const scope = this.contextScopeFor(event);
      await this.client.query(
        "insert into adl_authority_audit_events (audit_id, application_id, context_name, context_id, event, occurred_at) values ($1, $2, $3, $4, $5::jsonb, $6) on conflict (audit_id) do nothing",
        [
          auditId,
          this.applicationId,
          scope?.contextName ?? null,
          scope?.contextId ?? null,
          JSON.stringify(event),
          event.occurredAt,
        ],
      );
    }
  }

  /**
   * The business context an audit event belongs to. Scoping is a persistence
   * concern derived from the model's declared object scope, not a reimplemented
   * policy: the context id is the record's scope-field value. Unscoped objects,
   * and scoped rows whose scope value is not a plain string, yield no scope so
   * both columns stay null rather than half-populated.
   */
  private contextScopeFor(event: AuditEvent): AuditContextScope | undefined {
    const scope = this.objectScopes.get(event.object);
    if (scope === undefined) return undefined;
    const value =
      readScopeValue(event.after, scope.field) ?? readScopeValue(event.before, scope.field);
    if (value === undefined) return undefined;
    return { contextName: scope.contextName, contextId: value };
  }
}

function readScopeValue(
  values: Record<string, JsonValue> | undefined,
  field: string,
): string | undefined {
  const value = values?.[field];
  return typeof value === "string" ? value : undefined;
}

/**
 * Thrown inside a unit-of-work when the actor-bound outcome already exists, so
 * the transaction rolls back rather than committing a duplicate projection.
 */
export class OutcomeConflictError extends Error {
  constructor() {
    super("An outcome for this operation and actor already exists.");
  }
}

/**
 * PostgreSQL authority unit-of-work. It owns a single pinned client and the
 * begin/commit/rollback boundary for accepted replay, and exposes short
 * outcome-only transactions for durable rejection idempotency.
 */
export class PostgresAuthorityUnitOfWork {
  constructor(
    private readonly pool: PostgresPool,
    private readonly applicationId: string,
    private readonly model: ResolvedApplicationModel,
  ) {}

  /** Run `work` inside one transaction. Commits on success, rolls back on any throw. */
  async run<T>(work: (transaction: AuthorityTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      let result: T;
      try {
        result = await work(new AuthorityTransaction(client, this.applicationId, this.model));
      } catch (error) {
        await safeRollback(client);
        throw error;
      }
      await client.query("commit");
      return result;
    } finally {
      client.release();
    }
  }

  /** Durably persist a non-accepted (rejected/conflict) outcome for idempotency. */
  async putOutcomeOnly(outcome: AuthorityOutcome, actorId: string): Promise<AuthorityOutcome> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      try {
        await client.query(
          "insert into adl_authority_operation_outcomes (operation_id, actor_id, application_id, outcome) values ($1, $2, $3, $4::jsonb) on conflict (operation_id, actor_id) do nothing",
          [outcome.operationId, actorId, this.applicationId, JSON.stringify(outcome)],
        );
      } catch (error) {
        await safeRollback(client);
        throw error;
      }
      await client.query("commit");
    } finally {
      client.release();
    }
    return (await this.getOutcome(outcome.operationId, actorId)) ?? outcome;
  }

  /** Read a committed outcome bound to the authenticated actor. */
  async getOutcome(operationId: string, actorId: string): Promise<AuthorityOutcome | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query<{ outcome: AuthorityOutcome }>(
        "select outcome from adl_authority_operation_outcomes where operation_id = $1 and actor_id = $2",
        [operationId, actorId],
      );
      return result.rows[0]?.outcome ?? null;
    } finally {
      client.release();
    }
  }
}

async function safeRollback(client: PostgresPoolClient): Promise<void> {
  try {
    await client.query("rollback");
  } catch {
    // A rollback failure must not mask the original error; the pool discards the
    // client on release. Never surface protected query state here.
  }
}
