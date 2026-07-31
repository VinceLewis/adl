import type {
  JsonValue,
  ResolvedApplicationModel,
  ResolvedContextMembership,
  StoredObjectRecord,
} from "../model/resolved-model.js";
import { ApplicationRuntime } from "../runtime/application-runtime.js";
import type { ContextMembershipIndex } from "../runtime/context-membership-index.js";
import type { ObjectStorageBackend } from "../runtime/object-storage-backend.js";
import type { RuntimeContext, RuntimeReadModelRow } from "../runtime/runtime-types.js";
import type {
  AuthorityAccessLifecycleService,
  AuthorityAccessAuditEvent,
} from "./access-lifecycle.js";
import type { AuthoritySessionAdapter } from "./authority-types.js";
import type { PostgresQueryable } from "./postgres-authority-store.js";

const maximumReportRows = 500;
const maximumExportRows = 100;
const maximumPageSize = 100;

export interface AuthorityAdministrationAuditEvent {
  eventId: string;
  kind:
    | "reportViewed"
    | "reportExported"
    | "accessAuditReviewed"
    | "runtimeAuditReviewed"
    | "membershipStatusReviewed"
    | "inviteStatusReviewed"
    | "recoveryStatusReviewed"
    | "retentionStatusReviewed";
  actorId: string;
  contextName?: string;
  contextId?: string;
  reportName?: string;
  occurredAt: Date;
}

/** This is an audit sink, not a general event or payload database API. */
export interface AuthorityAdministrationAuditStore {
  record(event: AuthorityAdministrationAuditEvent): Promise<void>;
}

export interface AuthorityReportRequest {
  readModelName: string;
  selectedContexts?: Record<string, string>;
  cursor?: string;
  limit?: number;
}

export interface AuthorityReportResponse {
  readModelName: string;
  fields: string[];
  rows: Array<Record<string, JsonValue>>;
  nextCursor?: string;
  truncated: boolean;
}

export interface AuthorityReportExport {
  readModelName: string;
  contentType: "text/csv; charset=utf-8";
  filename: string;
  body: string;
  truncated: boolean;
}

interface StoredReportCursor {
  actorId: string;
  readModelName: string;
  fields: string[];
  rows: Array<Record<string, JsonValue>>;
  offset: number;
  expiresAt: number;
  truncated: boolean;
}

export interface AuthorityReportingOptions {
  now?: () => Date;
  newCursor?: () => string;
  newAuditId?: () => string;
}

/**
 * Executes only named resolved read models. The runtime shapes each source row
 * before it reaches this service, so reporting cannot become a second policy
 * engine or a raw PostgreSQL projection endpoint.
 */
export class AuthorityReportingService {
  private readonly runtime: ApplicationRuntime;
  private readonly cursors = new Map<string, StoredReportCursor>();
  private readonly now: () => Date;
  private readonly newCursor: () => string;
  private readonly newAuditId: () => string;

  constructor(
    model: ResolvedApplicationModel,
    private readonly storage: ObjectStorageBackend,
    private readonly sessions: AuthoritySessionAdapter,
    private readonly audit: AuthorityAdministrationAuditStore,
    options: AuthorityReportingOptions = {},
  ) {
    this.runtime = new ApplicationRuntime(model, { storage });
    this.now = options.now ?? (() => new Date());
    this.newCursor = options.newCursor ?? secureId;
    this.newAuditId = options.newAuditId ?? secureId;
  }

  async execute(
    sessionToken: string | undefined,
    request: AuthorityReportRequest,
  ): Promise<AuthorityReportResponse> {
    const session = await this.requireSession(sessionToken);
    const limit = boundedLimit(request.limit);
    this.clearExpiredCursors();
    const existing = request.cursor === undefined ? undefined : this.cursors.get(request.cursor);
    if (existing !== undefined) {
      if (existing.actorId !== session.userId || existing.readModelName !== request.readModelName)
        return emptyReport(request.readModelName);
      return this.page(existing, request.cursor as string, limit);
    }
    if (request.cursor !== undefined) return emptyReport(request.readModelName);

    let context: RuntimeContext;
    let result;
    try {
      context = await this.resolveContext(session.userId, request.selectedContexts);
      result = await this.runtime.executeReadModel(request.readModelName, context, {
        limit: maximumReportRows + 1,
      });
    } catch {
      // Context and policy failures are intentionally indistinguishable from an
      // empty report to prevent cross-context/report-name enumeration.
      return emptyReport(request.readModelName);
    }
    const fields = result.readModel.fields.map((field) => field.name);
    const truncated = result.rows.length > maximumReportRows;
    const rows = result.rows.slice(0, maximumReportRows).map(shapeReportRow);
    const cursor = `report-${this.newCursor()}`;
    const stored: StoredReportCursor = {
      actorId: session.userId,
      readModelName: request.readModelName,
      fields,
      rows,
      offset: 0,
      expiresAt: this.now().getTime() + 5 * 60_000,
      truncated,
    };
    this.cursors.set(cursor, stored);
    await this.record(
      "reportViewed",
      session.userId,
      request.readModelName,
      request.selectedContexts,
    );
    return this.page(stored, cursor, limit);
  }

  async exportCsv(
    sessionToken: string | undefined,
    request: Omit<AuthorityReportRequest, "cursor" | "limit">,
  ): Promise<AuthorityReportExport> {
    const session = await this.requireSession(sessionToken);
    const context = await this.resolveContext(session.userId, request.selectedContexts);
    const result = await this.runtime.executeReadModel(request.readModelName, context, {
      limit: maximumExportRows + 1,
    });
    await this.requireExportAllowed(result.readModel.sources, result.rows, context);
    const fields = result.readModel.fields.map((field) => field.name);
    const rows = result.rows.slice(0, maximumExportRows).map(shapeReportRow);
    await this.record(
      "reportExported",
      session.userId,
      request.readModelName,
      request.selectedContexts,
    );
    return {
      readModelName: request.readModelName,
      contentType: "text/csv; charset=utf-8",
      filename: `${safeFilename(request.readModelName)}.csv`,
      body: [fields, ...rows.map((row) => fields.map((field) => csvCell(row[field])))]
        .map((row) => row.join(","))
        .join("\r\n"),
      truncated: result.rows.length > maximumExportRows,
    };
  }

  private page(
    cursor: StoredReportCursor,
    cursorId: string,
    limit: number,
  ): AuthorityReportResponse {
    const rows = cursor.rows.slice(cursor.offset, cursor.offset + limit);
    cursor.offset += rows.length;
    const hasMore = cursor.offset < cursor.rows.length;
    if (!hasMore) this.cursors.delete(cursorId);
    return {
      readModelName: cursor.readModelName,
      fields: [...cursor.fields],
      rows,
      ...(hasMore ? { nextCursor: cursorId } : {}),
      truncated: cursor.truncated,
    };
  }

  private async requireSession(token: string | undefined): Promise<{ userId: string }> {
    const session = await this.sessions.verify(token);
    if (session === null) throw new ReportingAccessError("ADL_AUTH_UNAUTHENTICATED");
    return session;
  }
  private async resolveContext(
    userId: string,
    selectedContexts: Record<string, string> | undefined,
  ): Promise<RuntimeContext> {
    let context: RuntimeContext = { userId, roles: [], channel: "api", online: true };
    for (const [contextName, contextId] of Object.entries(selectedContexts ?? {}))
      context = await this.runtime.withSelectedContext(contextName, contextId, context);
    return context;
  }
  private async record(
    kind: AuthorityAdministrationAuditEvent["kind"],
    actorId: string,
    reportName?: string,
    selectedContexts?: Record<string, string>,
  ): Promise<void> {
    const context = Object.entries(selectedContexts ?? {}).at(0);
    await this.audit.record({
      eventId: `admin-audit-${this.newAuditId()}`,
      kind,
      actorId,
      ...(context === undefined ? {} : { contextName: context[0], contextId: context[1] }),
      ...(reportName === undefined ? {} : { reportName }),
      occurredAt: this.now(),
    });
  }
  private clearExpiredCursors(): void {
    const now = this.now().getTime();
    for (const [id, cursor] of this.cursors) if (cursor.expiresAt <= now) this.cursors.delete(id);
  }
  /**
   * The per-record export re-check goes to `policyEngine` directly rather than
   * through a runtime entry point, so anything a policy decision needs on the
   * context has to be resolved here. A `contextMember` principal would otherwise
   * find no roster and deny — the safe direction, but still a false denial that
   * would only appear in a deployment.
   */
  private async requireExportAllowed(
    sources: Array<{ name: string; object: string }>,
    rows: RuntimeReadModelRow[],
    callerContext: RuntimeContext,
  ): Promise<void> {
    const context = await this.runtime.withContextMembers(callerContext);
    for (const row of rows) {
      for (const source of sources) {
        const reference = row.sources[source.name];
        if (reference === undefined) continue;
        const record = await this.storage.read(source.object, reference.recordId);
        if (record === null) throw new ReportingAccessError("ADL_POLICY_DENIED");
        this.runtime.policyEngine.requireAllowed(
          { objectName: source.object, action: "export", record, channel: "api" },
          context,
        );
      }
    }
  }
}

export interface AuthorityAccessAuditSummary {
  accessAuditId: string;
  kind: AuthorityAccessAuditEvent["kind"];
  contextName: string;
  contextId: string;
  role?: string;
  membershipRecordId?: string;
  occurredAt: string;
}
export interface AuthorityRuntimeAuditSummary {
  auditId: string;
  object: string;
  recordId: string;
  operation: string;
  occurredAt: string;
}
export interface AuthorityInviteStatus {
  inviteId: string;
  contextName: string;
  contextId: string;
  role: string;
  recipientUserId?: string;
  expiresAt: string;
  status: "active" | "claimed" | "revoked" | "expired";
}
export interface AuthorityAdministrationDataStore {
  listAccessAudit(
    contextName: string,
    contextId: string,
    limit: number,
  ): Promise<AuthorityAccessAuditSummary[]>;
  listRuntimeAudit(
    contextName: string,
    contextId: string,
    limit: number,
  ): Promise<AuthorityRuntimeAuditSummary[]>;
  listInvites(
    contextName: string,
    contextId: string,
    now: Date,
    limit: number,
  ): Promise<AuthorityInviteStatus[]>;
}
export interface AuthorityRecoveryStatus {
  ready: boolean;
  recoveryRequired: boolean;
  lastRestoreAt?: string;
}

/**
 * What an operator is told about retention, and the whole of it.
 *
 * Retention is not triggerable from here. It is application-wide and every
 * administration authorisation in this repository is scoped to one business
 * context, so exposing a trigger would hand a context manager a destructive
 * application-wide action they do not otherwise have. An operator runs retention
 * from the scheduled process entry; this surface exists so they can see that it
 * is configured, that it ran, and what it did.
 *
 * Everything here is metadata: windows, a schedule, an outcome and counts. No
 * accepted record, audit payload, token, verifier or outcome body can reach it,
 * because the run log it reads has no column that could hold one.
 */
export interface AuthorityRetentionRunSummary {
  runId: string;
  startedAt: string;
  finishedAt: string;
  outcome: "completed" | "dryRun" | "held" | "failed";
  dryRun: boolean;
  held: boolean;
  effectiveCutoff: string | null;
  prunedRuntimeAudit: number;
  prunedOutcomes: number;
  prunedSessions: number;
  prunedChallenges: number;
  prunedTotal: number;
  /** A reduced fault name such as `Error 42P01`, never a driver message. */
  failureCode?: string;
}

export interface AuthorityRetentionStatusView {
  /** True when this authority process runs retention on its own interval. */
  scheduled: boolean;
  intervalMinutes?: number;
  legalHold: boolean;
  minimumRetentionDays: number;
  sessionRetentionDays: number;
  challengeRetentionDays: number;
  /** Absent when retention has never run against this application. */
  lastRun?: AuthorityRetentionRunSummary;
}
export interface AuthorityAdministrationListRequest {
  limit?: number;
  cursor?: string;
}
interface StoredAdministrationCursor {
  actorId: string;
  kind: string;
  contextName: string;
  contextId: string;
  entries: unknown[];
  offset: number;
  expiresAt: number;
}

/** Server-only operational views, deliberately constrained to one authorised context. */
export class AuthorityAdministrationService {
  private readonly runtime: ApplicationRuntime;
  private nextAuditId = 1;
  private readonly cursors = new Map<string, StoredAdministrationCursor>();
  constructor(
    model: ResolvedApplicationModel,
    private readonly storage: ObjectStorageBackend,
    private readonly access: AuthorityAccessLifecycleService,
    private readonly data: AuthorityAdministrationDataStore,
    private readonly audit: AuthorityAdministrationAuditStore,
    private readonly recoveryStatus: () => Promise<AuthorityRecoveryStatus> = async () => ({
      ready: true,
      recoveryRequired: false,
    }),
    private readonly now: () => Date = () => new Date(),
    /**
     * Scope-indexed read model over membership records. With one, membership
     * review reads a bounded page for exactly this context instead of scanning
     * every accepted record and filtering in memory; without one it keeps the
     * scan, which is the in-memory test wiring. Either way each candidate record
     * is read and passed through the runtime's read policy below, which stays
     * the disclosure boundary.
     */
    private readonly membershipIndex: ContextMembershipIndex | undefined = undefined,
    /**
     * Metadata-only retention status. Absent when the deployment has composed no
     * retention path at all, in which case the surface reports that rather than
     * inventing a schedule. It is a read: nothing here can start a run.
     */
    private readonly retentionStatus:
      | (() => Promise<AuthorityRetentionStatusView | null>)
      | undefined = undefined,
  ) {
    this.runtime = new ApplicationRuntime(model, {
      storage,
      ...(membershipIndex === undefined ? {} : { membershipIndex }),
    });
  }

  async accessAudit(
    token: string | undefined,
    contextName: string,
    contextId: string,
    request?: number | AuthorityAdministrationListRequest,
  ) {
    const actor = await this.access.requireAdministration(token, contextName, contextId);
    const entries = await this.data.listAccessAudit(contextName, contextId, queryLimit(request));
    await this.record("accessAuditReviewed", actor.userId, contextName, contextId);
    return this.page(actor.userId, "accessAudit", contextName, contextId, entries, request);
  }
  async runtimeAudit(
    token: string | undefined,
    contextName: string,
    contextId: string,
    request?: number | AuthorityAdministrationListRequest,
  ) {
    const actor = await this.access.requireAdministration(token, contextName, contextId);
    let context: RuntimeContext = { userId: actor.userId, roles: [], channel: "api", online: true };
    context = await this.runtime.withSelectedContext(contextName, contextId, context);
    const candidates = await this.data.listRuntimeAudit(
      contextName,
      contextId,
      queryLimit(request),
    );
    const entries: AuthorityRuntimeAuditSummary[] = [];
    for (const candidate of candidates) {
      try {
        if ((await this.runtime.read(candidate.object, candidate.recordId, context)) !== null)
          entries.push(candidate);
      } catch {
        // Audit review must not turn an inaccessible row into an existence oracle.
      }
    }
    await this.record("runtimeAuditReviewed", actor.userId, contextName, contextId);
    return this.page(actor.userId, "runtimeAudit", contextName, contextId, entries, request);
  }
  async memberships(
    token: string | undefined,
    contextName: string,
    contextId: string,
    request?: number | AuthorityAdministrationListRequest,
  ) {
    const actor = await this.access.requireAdministration(token, contextName, contextId);
    const membership = this.runtime.model.contexts?.find(
      (item) => item.name === contextName,
    )?.membership;
    if (membership === undefined) throw new ReportingAccessError("ADL_RUNTIME_CONTEXT_ERROR");
    let context: RuntimeContext = { userId: actor.userId, roles: [], channel: "api", online: true };
    context = await this.runtime.withSelectedContext(contextName, contextId, context);
    // The read/mask checks below call `policyEngine` directly, so the roster a
    // `contextMember` principal needs never arrives on its own.
    context = await this.runtime.withContextMembers(context);
    const candidates = await this.membershipCandidates(
      membership,
      contextName,
      contextId,
      queryLimit(request),
    );
    const entries: Array<{
      membershipRecordId: string;
      userId?: string;
      role?: string;
      status: "active" | "revoked";
    }> = [];
    for (const candidate of candidates) {
      try {
        const decision = this.runtime.policyEngine.evaluate(
          { objectName: membership.object, action: "read", record: candidate },
          context,
        );
        if (decision.effect === "deny" || decision.effect === "hidden") continue;
        const visible = this.runtime.policyEngine.applyReadPolicy(
          membership.object,
          candidate,
          context,
        );
        const userId = stringValue(visible.values[membership.userField]);
        const role = stringValue(visible.values[membership.roleField]);
        entries.push({
          membershipRecordId: candidate.meta.guid,
          ...(userId === undefined ? {} : { userId }),
          ...(role === undefined ? {} : { role }),
          status: candidate.meta.deletedAt === undefined ? "active" : "revoked",
        });
      } catch {
        // Normal row/field read policy remains the disclosure boundary.
      }
    }
    await this.record("membershipStatusReviewed", actor.userId, contextName, contextId);
    return this.page(actor.userId, "memberships", contextName, contextId, entries, request);
  }
  /**
   * Membership records to consider for one context's review page, revoked ones
   * included so a revoked membership is reported rather than silently omitted.
   * The projection bounds the page in SQL; the record is then read back so the
   * values reviewed are the record's own.
   */
  private async membershipCandidates(
    membership: ResolvedContextMembership,
    contextName: string,
    contextId: string,
    limit: number,
  ): Promise<StoredObjectRecord[]> {
    if (this.membershipIndex === undefined) {
      return (await this.storage.listRecords())
        .filter((entry) => entry.objectName === membership.object)
        .map((entry) => entry.record)
        .filter((record) => record.values[membership.contextField] === contextId)
        .slice(0, limit);
    }
    const rows = await this.membershipIndex.listForContext({ contextName, contextId, limit });
    const records: StoredObjectRecord[] = [];
    for (const row of rows) {
      const record = await this.storage.read(membership.object, row.membershipRecordId);
      if (record !== null && record.values[membership.contextField] === contextId)
        records.push(record);
    }
    return records;
  }

  async invites(
    token: string | undefined,
    contextName: string,
    contextId: string,
    request?: number | AuthorityAdministrationListRequest,
  ) {
    const actor = await this.access.requireAdministration(token, contextName, contextId);
    const entries = await this.data.listInvites(
      contextName,
      contextId,
      this.now(),
      queryLimit(request),
    );
    await this.record("inviteStatusReviewed", actor.userId, contextName, contextId);
    return this.page(actor.userId, "invites", contextName, contextId, entries, request);
  }
  async recovery(token: string | undefined, contextName: string, contextId: string) {
    const actor = await this.access.requireAdministration(token, contextName, contextId);
    const status = await this.recoveryStatus();
    await this.record("recoveryStatusReviewed", actor.userId, contextName, contextId);
    return status;
  }
  /**
   * Retention status for an operator who is already authorised to administer
   * this context. It is gated exactly as every other administration read is, and
   * it adds no capability: there is no run, no dry run and no cutoff argument
   * here, only what a run already did.
   */
  async retention(
    token: string | undefined,
    contextName: string,
    contextId: string,
  ): Promise<AuthorityRetentionStatusView | null> {
    const actor = await this.access.requireAdministration(token, contextName, contextId);
    const status = (await this.retentionStatus?.()) ?? null;
    await this.record("retentionStatusReviewed", actor.userId, contextName, contextId);
    return status;
  }
  async revokeSessions(
    token: string | undefined,
    contextName: string,
    contextId: string,
    userId: string,
  ) {
    return {
      revoked: await this.access.revokeUserSessions(token, { contextName, contextId, userId }),
    };
  }
  private async record(
    kind: AuthorityAdministrationAuditEvent["kind"],
    actorId: string,
    contextName: string,
    contextId: string,
  ): Promise<void> {
    await this.audit.record({
      eventId: `admin-audit-${this.nextAuditId++}`,
      kind,
      actorId,
      contextName,
      contextId,
      occurredAt: this.now(),
    });
  }
  private page<T>(
    actorId: string,
    kind: string,
    contextName: string,
    contextId: string,
    fetched: T[],
    request: number | AuthorityAdministrationListRequest | undefined,
  ): { entries: T[]; nextCursor?: string } {
    const input = listRequest(request);
    this.clearExpiredCursors();
    const existing = input.cursor === undefined ? undefined : this.cursors.get(input.cursor);
    if (existing !== undefined) {
      if (
        existing.actorId !== actorId ||
        existing.kind !== kind ||
        existing.contextName !== contextName ||
        existing.contextId !== contextId
      )
        return { entries: [] };
      return this.nextPage<T>(existing, input.cursor as string, input.limit);
    }
    if (input.cursor !== undefined) return { entries: [] };
    const id = `admin-${secureId()}`;
    const cursor: StoredAdministrationCursor = {
      actorId,
      kind,
      contextName,
      contextId,
      entries: fetched,
      offset: 0,
      expiresAt: this.now().getTime() + 5 * 60_000,
    };
    this.cursors.set(id, cursor);
    return this.nextPage<T>(cursor, id, input.limit);
  }
  private nextPage<T>(
    cursor: StoredAdministrationCursor,
    id: string,
    limit: number,
  ): { entries: T[]; nextCursor?: string } {
    const entries = cursor.entries.slice(cursor.offset, cursor.offset + limit) as T[];
    cursor.offset += entries.length;
    const hasMore = cursor.offset < cursor.entries.length;
    if (!hasMore) this.cursors.delete(id);
    return { entries, ...(hasMore ? { nextCursor: id } : {}) };
  }
  private clearExpiredCursors(): void {
    const now = this.now().getTime();
    for (const [id, cursor] of this.cursors) if (cursor.expiresAt <= now) this.cursors.delete(id);
  }
}

/** Test/development store; production wiring uses the PostgreSQL implementation below. */
export class InMemoryAuthorityAdministrationStore
  implements AuthorityAdministrationAuditStore, AuthorityAdministrationDataStore
{
  readonly events: AuthorityAdministrationAuditEvent[] = [];
  readonly accessEvents: AuthorityAccessAuditSummary[] = [];
  /** Runtime-audit events carry the context they were stamped with, mirroring the SQL scope columns. */
  readonly runtimeEvents: Array<
    AuthorityRuntimeAuditSummary & { contextName?: string; contextId?: string }
  > = [];
  readonly invites: AuthorityInviteStatus[] = [];
  async record(event: AuthorityAdministrationAuditEvent): Promise<void> {
    this.events.push({ ...event, occurredAt: new Date(event.occurredAt) });
  }
  async listAccessAudit(contextName: string, contextId: string, limit: number) {
    return this.accessEvents
      .filter((event) => event.contextName === contextName && event.contextId === contextId)
      .slice(0, limit)
      .map((event) => ({ ...event }));
  }
  async listRuntimeAudit(contextName: string, contextId: string, limit: number) {
    // Scope to one context like the SQL reader; unscoped rows (no stamped
    // context) never appear in a per-context review.
    return this.runtimeEvents
      .filter((event) => event.contextName === contextName && event.contextId === contextId)
      .slice(0, limit)
      .map(({ contextName: _n, contextId: _i, ...summary }) => ({ ...summary }));
  }
  async listInvites(
    contextName: string,
    contextId: string,
    now: Date,
    limit: number,
  ): Promise<AuthorityInviteStatus[]> {
    return this.invites
      .filter((invite) => invite.contextName === contextName && invite.contextId === contextId)
      .map((invite) => ({
        ...invite,
        status:
          invite.status === "active" && new Date(invite.expiresAt) <= now
            ? "expired"
            : invite.status,
      }))
      .slice(0, limit);
  }
}

/** PostgreSQL projection reader/writer. It selects only review-safe columns. */
export class PostgresAuthorityAdministrationStore
  implements AuthorityAdministrationAuditStore, AuthorityAdministrationDataStore
{
  constructor(
    private readonly database: PostgresQueryable,
    private readonly applicationId: string,
  ) {}
  async record(event: AuthorityAdministrationAuditEvent): Promise<void> {
    await this.database.query(
      "insert into adl_authority_administration_audit_events (event_id, application_id, event, occurred_at) values ($1, $2, $3::jsonb, $4)",
      [event.eventId, this.applicationId, JSON.stringify(event), event.occurredAt],
    );
  }
  async listAccessAudit(contextName: string, contextId: string, limit: number) {
    const result = await this.database.query<{
      access_audit_id: string;
      event: Record<string, unknown>;
      occurred_at: Date | string;
    }>(
      "select access_audit_id, event, occurred_at from adl_authority_access_audit_events where application_id = $1 and event->>'contextName' = $2 and event->>'contextId' = $3 order by occurred_at desc limit $4",
      [this.applicationId, contextName, contextId, limit],
    );
    return result.rows.flatMap((row) =>
      accessSummary(row.access_audit_id, row.event, row.occurred_at),
    );
  }
  async listRuntimeAudit(contextName: string, contextId: string, limit: number) {
    // Scope in SQL to one authorised business context using the (context_name,
    // context_id) the unit-of-work stamped from the record's declared scope, so
    // a bounded page is not dominated (or emptied) by other contexts' events.
    // The caller still applies the per-row runtime read as the disclosure boundary.
    const result = await this.database.query<{
      audit_id: string;
      event: Record<string, unknown>;
      occurred_at: Date | string;
    }>(
      "select audit_id, event, occurred_at from adl_authority_audit_events where application_id = $1 and context_name = $2 and context_id = $3 order by occurred_at desc limit $4",
      [this.applicationId, contextName, contextId, limit],
    );
    return result.rows.flatMap((row) => runtimeSummary(row.audit_id, row.event, row.occurred_at));
  }
  async listInvites(contextName: string, contextId: string, now: Date, limit: number) {
    const result = await this.database.query<{
      invite_id: string;
      context_name: string;
      context_id: string;
      role: string;
      recipient_user_id: string | null;
      expires_at: Date | string;
      claimed_at: Date | string | null;
      revoked_at: Date | string | null;
    }>(
      "select invite_id, context_name, context_id, role, recipient_user_id, expires_at, claimed_at, revoked_at from adl_authority_invites where application_id = $1 and context_name = $2 and context_id = $3 order by created_at desc limit $4",
      [this.applicationId, contextName, contextId, limit],
    );
    return result.rows.map(
      (row): AuthorityInviteStatus => ({
        inviteId: row.invite_id,
        contextName: row.context_name,
        contextId: row.context_id,
        role: row.role,
        ...(row.recipient_user_id === null ? {} : { recipientUserId: row.recipient_user_id }),
        expiresAt: new Date(row.expires_at).toISOString(),
        status:
          row.revoked_at !== null
            ? "revoked"
            : row.claimed_at !== null
              ? "claimed"
              : new Date(row.expires_at) <= now
                ? "expired"
                : "active",
      }),
    );
  }
}

export class ReportingAccessError extends Error {
  constructor(readonly code: string) {
    super(
      code === "ADL_AUTH_UNAUTHENTICATED"
        ? "A valid server session is required."
        : "The request is unavailable.",
    );
  }
}

function shapeReportRow(row: RuntimeReadModelRow): Record<string, JsonValue> {
  return structuredClone(row.values);
}
function boundedLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? 50, 1), maximumPageSize);
}
function listRequest(
  request: number | AuthorityAdministrationListRequest | undefined,
): Required<Pick<AuthorityAdministrationListRequest, "limit">> &
  Pick<AuthorityAdministrationListRequest, "cursor"> {
  return typeof request === "number"
    ? { limit: boundedLimit(request) }
    : {
        limit: boundedLimit(request?.limit),
        ...(request?.cursor === undefined ? {} : { cursor: request.cursor }),
      };
}
function queryLimit(request: number | AuthorityAdministrationListRequest | undefined): number {
  return Math.min(listRequest(request).limit + 1, maximumPageSize + 1);
}
function emptyReport(readModelName: string): AuthorityReportResponse {
  return { readModelName, fields: [], rows: [], truncated: false };
}
function stringValue(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}
function csvCell(value: JsonValue | undefined): string {
  const text =
    value === undefined || value === null
      ? ""
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
  return `"${text.replaceAll('"', '""')}"`;
}
function safeFilename(value: string): string {
  return (
    value
      .replace(/[^a-z0-9_-]/giu, "-")
      .replace(/-+/gu, "-")
      .toLowerCase() || "report"
  );
}
function secureId(): string {
  const bytes = new Uint8Array(18);
  globalThis.crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
}
function accessSummary(
  accessAuditId: string,
  event: Record<string, unknown>,
  occurredAt: Date | string,
): AuthorityAccessAuditSummary[] {
  const kind = typeof event.kind === "string" ? event.kind : undefined;
  const contextName = typeof event.contextName === "string" ? event.contextName : undefined;
  const contextId = typeof event.contextId === "string" ? event.contextId : undefined;
  if (kind === undefined || contextName === undefined || contextId === undefined) return [];
  return [
    {
      accessAuditId,
      kind: kind as AuthorityAccessAuditEvent["kind"],
      contextName,
      contextId,
      ...(typeof event.role === "string" ? { role: event.role } : {}),
      ...(typeof event.membershipRecordId === "string"
        ? { membershipRecordId: event.membershipRecordId }
        : {}),
      occurredAt: new Date(occurredAt).toISOString(),
    },
  ];
}
function runtimeSummary(
  auditId: string,
  event: Record<string, unknown>,
  occurredAt: Date | string,
): AuthorityRuntimeAuditSummary[] {
  if (
    typeof event.object !== "string" ||
    typeof event.recordId !== "string" ||
    typeof event.operation !== "string"
  )
    return [];
  return [
    {
      auditId,
      object: event.object,
      recordId: event.recordId,
      operation: event.operation,
      occurredAt: new Date(occurredAt).toISOString(),
    },
  ];
}
