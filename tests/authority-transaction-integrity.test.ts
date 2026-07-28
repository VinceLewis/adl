import { beforeEach, describe, expect, it } from "vitest";
import {
  AuthorityAccessLifecycleService,
  AuthorityProjectionIntegrity,
  AuthorityService,
  InMemoryObjectStorageBackend,
  PostgresAuthorityAccessStore,
  PostgresAuthorityUnitOfWork,
  PostgresObjectStorageBackend,
  StaticSessionAdapter,
  resolveApplicationModel,
  validateApplicationModel,
} from "../src/index.js";
import type { PostgresPool, PostgresPoolClient, StoredObjectRecord } from "../src/index.js";

/**
 * An in-memory stand-in for a pinned `pg` client and pool. It executes exactly
 * the statements the authority projection writers issue, models
 * begin/commit/rollback so a failure rolls back every staged write, and can
 * inject a failure at any statement so we can prove all-or-nothing behaviour.
 */
interface RecordRow {
  applicationId: string;
  objectName: string;
  recordId: string;
  revision: string;
  deletedAt: string | null;
  record: StoredObjectRecord;
}
interface InviteRow {
  inviteId: string;
  applicationId: string;
  tokenHash: string;
  contextName: string;
  contextId: string;
  role: string;
  recipientUserId: string | null;
  createdBy: string;
  createdAt: unknown;
  expiresAt: unknown;
  claimedBy: string | null;
  claimedAt: unknown;
  membershipRecordId: string | null;
  revokedAt: unknown;
}
interface Tables {
  models: Map<string, { modelVersion: string }>;
  records: Map<string, RecordRow>;
  audit: Map<string, { applicationId: string; event: unknown; occurredAt: unknown }>;
  outcomes: Map<string, { operationId: string; actorId: string; outcome: unknown }>;
  accessAudit: Map<string, { applicationId: string; event: unknown; occurredAt: unknown }>;
  adminAudit: Map<string, { applicationId: string; event: unknown; occurredAt: unknown }>;
  invites: Map<string, InviteRow>;
}

function emptyTables(): Tables {
  return {
    models: new Map(),
    records: new Map(),
    audit: new Map(),
    outcomes: new Map(),
    accessAudit: new Map(),
    adminAudit: new Map(),
    invites: new Map(),
  };
}

class FakePostgres implements PostgresPool {
  readonly tables = emptyTables();
  /** Return an Error to inject a failure for a matching normalised statement. */
  failWhen: ((sql: string, values: unknown[]) => Error | null) | null = null;
  connections = 0;
  private released = 0;
  // A single persistent client so direct-statement stores (object storage,
  // access store) share one transaction snapshot when they run sequentially.
  private readonly defaultClient = new FakeClient(this, () => {});

  get openConnections(): number {
    return this.connections - this.released;
  }

  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ): Promise<{ rows: T[] }> {
    return this.defaultClient.query<T>(sql, values);
  }

  async connect(): Promise<PostgresPoolClient> {
    this.connections += 1;
    return new FakeClient(this, () => {
      this.released += 1;
    });
  }

  snapshot(): Tables {
    return structuredClone(this.tables);
  }
  restore(snap: Tables): void {
    for (const key of Object.keys(this.tables) as Array<keyof Tables>) {
      const live = this.tables[key] as Map<string, unknown>;
      const saved = snap[key] as Map<string, unknown>;
      live.clear();
      for (const [k, v] of saved) live.set(k, v);
    }
  }
}

class FakeClient implements PostgresPoolClient {
  private snapshot: Tables | null = null;
  constructor(
    private readonly pool: FakePostgres,
    private readonly onRelease: () => void,
  ) {}

  release(): void {
    this.onRelease();
  }

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ): Promise<{ rows: T[] }> {
    const q = sql.replace(/\s+/gu, " ").trim().toLowerCase();
    const failure = this.pool.failWhen?.(q, values) ?? null;
    if (failure !== null) throw failure;

    if (q === "begin") {
      this.snapshot = this.pool.snapshot();
      return { rows: [] };
    }
    if (q === "commit") {
      this.snapshot = null;
      return { rows: [] };
    }
    if (q === "rollback") {
      if (this.snapshot !== null) this.pool.restore(this.snapshot);
      this.snapshot = null;
      return { rows: [] };
    }
    return { rows: this.run(q, values) as T[] };
  }

  private run(q: string, values: unknown[]): Array<Record<string, unknown>> {
    const t = this.pool.tables;

    if (q.startsWith("select model_version from adl_authority_models"))
      return mapRow(t.models.get(String(values[0])), (row) => ({
        model_version: row.modelVersion,
      }));
    if (q.startsWith("insert into adl_authority_models")) {
      t.models.set(String(values[0]), { modelVersion: String(values[1]) });
      return [];
    }

    if (q.startsWith("select record from adl_authority_records") && q.includes("record_id = $3"))
      return mapRow(t.records.get(recordKey(values[0], values[1], values[2])), (row) => ({
        record: row.record,
      }));
    if (q.startsWith("select record from adl_authority_records"))
      return [...t.records.values()]
        .filter((row) => row.applicationId === values[0] && row.objectName === values[1])
        .map((row) => ({ record: row.record }));
    if (q.startsWith("select object_name, record from adl_authority_records"))
      return [...t.records.values()]
        .filter((row) => row.applicationId === values[0])
        .map((row) => ({ object_name: row.objectName, record: row.record }));
    if (q.startsWith("insert into adl_authority_records")) {
      const key = recordKey(values[0], values[1], values[2]);
      if (t.records.has(key)) throw new Error(`duplicate record ${key}`);
      t.records.set(key, {
        applicationId: String(values[0]),
        objectName: String(values[1]),
        recordId: String(values[2]),
        revision: String(values[3]),
        deletedAt: values[4] === null ? null : String(values[4]),
        record: JSON.parse(String(values[5])) as StoredObjectRecord,
      });
      return [];
    }
    if (q.startsWith("update adl_authority_records")) {
      const key = recordKey(values[0], values[1], values[2]);
      const existing = t.records.get(key);
      if (existing === undefined) return [];
      existing.revision = String(values[3]);
      existing.deletedAt = values[4] === null ? null : String(values[4]);
      existing.record = JSON.parse(String(values[5])) as StoredObjectRecord;
      return [{ record_id: existing.recordId }];
    }

    if (q.startsWith("insert into adl_authority_operation_outcomes")) {
      const key = outcomeKey(values[0], values[1]);
      const inserted = !t.outcomes.has(key);
      if (inserted)
        t.outcomes.set(key, {
          operationId: String(values[0]),
          actorId: String(values[1]),
          outcome: JSON.parse(String(values[2])) as unknown,
        });
      return q.includes("returning operation_id") && inserted ? [{ operation_id: values[0] }] : [];
    }
    if (q.startsWith("select outcome from adl_authority_operation_outcomes"))
      return mapRow(t.outcomes.get(outcomeKey(values[0], values[1])), (row) => ({
        outcome: row.outcome,
      }));

    if (q.startsWith("insert into adl_authority_audit_events")) {
      const id = String(values[0]);
      if (!t.audit.has(id))
        t.audit.set(id, {
          applicationId: String(values[1]),
          event: JSON.parse(String(values[2])) as unknown,
          occurredAt: values[3],
        });
      return [];
    }

    if (q.startsWith("insert into adl_authority_access_audit_events")) {
      t.accessAudit.set(String(values[0]), {
        applicationId: String(values[1]),
        event: JSON.parse(String(values[2])) as unknown,
        occurredAt: values[3],
      });
      return [];
    }
    if (q.startsWith("insert into adl_authority_administration_audit_events")) {
      t.adminAudit.set(String(values[0]), {
        applicationId: String(values[1]),
        event: JSON.parse(String(values[2])) as unknown,
        occurredAt: values[3],
      });
      return [];
    }

    if (q.startsWith("insert into adl_authority_invites")) {
      t.invites.set(String(values[0]), {
        inviteId: String(values[0]),
        applicationId: String(values[1]),
        tokenHash: String(values[2]),
        contextName: String(values[3]),
        contextId: String(values[4]),
        role: String(values[5]),
        recipientUserId: values[6] === null ? null : String(values[6]),
        createdBy: String(values[7]),
        createdAt: values[8],
        expiresAt: values[9],
        claimedBy: null,
        claimedAt: null,
        membershipRecordId: null,
        revokedAt: null,
      });
      return [];
    }
    if (q.startsWith("update adl_authority_invites set revoked_at")) {
      const invite = t.invites.get(String(values[1]));
      if (
        invite === undefined ||
        invite.applicationId !== values[0] ||
        invite.contextName !== values[2] ||
        invite.contextId !== values[3] ||
        invite.claimedBy !== null ||
        invite.revokedAt != null
      )
        return [];
      invite.revokedAt = values[4];
      return [{ invite_id: invite.inviteId }];
    }
    if (q.startsWith("update adl_authority_invites set claimed_by")) {
      const invite = t.invites.get(String(values[0]));
      if (invite === undefined) return [];
      invite.claimedBy = String(values[2]);
      invite.claimedAt = values[3];
      invite.membershipRecordId = String(values[4]);
      return [];
    }
    if (q.startsWith("select invite_id, context_name")) {
      const invite = [...t.invites.values()].find(
        (row) => row.applicationId === values[0] && row.tokenHash === values[1],
      );
      return invite === undefined
        ? []
        : [
            {
              invite_id: invite.inviteId,
              context_name: invite.contextName,
              context_id: invite.contextId,
              role: invite.role,
              recipient_user_id: invite.recipientUserId,
              expires_at: invite.expiresAt,
              claimed_by: invite.claimedBy,
              membership_record_id: invite.membershipRecordId,
              revoked_at: invite.revokedAt,
            },
          ];
    }

    // Projection integrity aggregates.
    if (q.includes("jsonb_array_elements")) {
      let missing = 0;
      for (const outcome of t.outcomes.values()) {
        const body = outcome.outcome as { status?: string; records?: StoredObjectRecord[] };
        if (body.status !== "accepted") continue;
        for (const reference of body.records ?? []) {
          const key = recordKey(values[0], reference.meta.object, reference.meta.guid);
          if (!t.records.has(key)) missing += 1;
        }
      }
      return [{ total: missing }];
    }
    if (q.includes("m.application_id is null")) {
      const orphans = [...t.records.values()].filter(
        (row) => row.applicationId === values[0] && !t.models.has(row.applicationId),
      ).length;
      return [{ total: orphans }];
    }
    if (q.includes("count(*)::int as total from adl_authority_operation_outcomes"))
      return [{ total: t.outcomes.size }];
    if (q.includes("count(*)::int as total")) return [{ total: this.scopedCount(q, values) }];

    throw new Error(`Unhandled statement: ${q}`);
  }

  private scopedCount(q: string, values: unknown[]): number {
    const app = String(values[0]);
    const t = this.pool.tables;
    if (q.includes("adl_authority_models")) return t.models.has(app) ? 1 : 0;
    if (q.includes("adl_authority_audit_events"))
      return [...t.audit.values()].filter((r) => r.applicationId === app).length;
    if (q.includes("adl_authority_access_audit_events"))
      return [...t.accessAudit.values()].filter((r) => r.applicationId === app).length;
    if (q.includes("adl_authority_administration_audit_events"))
      return [...t.adminAudit.values()].filter((r) => r.applicationId === app).length;
    if (q.includes("adl_authority_records"))
      return [...t.records.values()].filter((r) => r.applicationId === app).length;
    return 0;
  }
}

function recordKey(app: unknown, object: unknown, id: unknown): string {
  return `${String(app)} ${String(object)} ${String(id)}`;
}
function outcomeKey(operationId: unknown, actorId: unknown): string {
  return `${String(operationId)} ${String(actorId)}`;
}
function mapRow<Row, Out extends Record<string, unknown>>(
  row: Row | undefined,
  project: (row: Row) => Out,
): Out[] {
  return row === undefined ? [] : [project(row)];
}

const applicationId = "phase44";
const tokenMember = "m".repeat(48);

const model = resolveApplicationModel({
  app: { name: "Phase 44 fixture", startView: "NoteList" },
  roles: [{ name: "Member" }],
  objects: [
    {
      name: "Note",
      fields: [{ name: "Title", type: "text", required: true }],
      views: [{ name: "NoteList", kind: "list", fields: ["Title"], actions: ["read"] }],
      sync: { mode: "localFirst", conflict: "serverWins" },
    },
  ],
  policies: [
    {
      name: "NotePolicy",
      object: "Note",
      rules: [
        {
          name: "authenticatedAll",
          effect: "allow",
          principal: { match: "authenticated" },
          action: "create",
        },
        {
          name: "authenticatedRead",
          effect: "allow",
          principal: { match: "authenticated" },
          action: "read",
        },
        {
          name: "authenticatedUpdate",
          effect: "allow",
          principal: { match: "authenticated" },
          action: "update",
        },
      ],
    },
  ],
  commands: [
    {
      name: "CreateTwoNotes",
      inputs: [
        { name: "First", type: "text", required: true },
        { name: "Second", type: "text", required: true },
      ],
      steps: [
        {
          name: "first",
          action: "create",
          object: "Note",
          authority: "command",
          values: { Title: { kind: "input", name: "First" } },
        },
        {
          name: "second",
          action: "create",
          object: "Note",
          authority: "command",
          values: { Title: { kind: "input", name: "Second" } },
        },
      ],
    },
  ],
});

const sessions = new StaticSessionAdapter(new Map([[tokenMember, { userId: "member-1" }]]));

function seededPool(modelVersion = model.modelVersion): FakePostgres {
  const pool = new FakePostgres();
  pool.tables.models.set(applicationId, { modelVersion });
  return pool;
}
function service(pool: FakePostgres): AuthorityService {
  return new AuthorityService(model, new InMemoryObjectStorageBackend(), sessions, {
    unitOfWork: new PostgresAuthorityUnitOfWork(pool, applicationId, model),
  });
}

describe("Phase 44 authority projection transactional integrity", () => {
  let pool: FakePostgres;
  beforeEach(() => {
    pool = seededPool();
  });

  it("fixture model is valid", () => expect(validateApplicationModel(model)).toEqual([]));

  it("commits accepted record, runtime audit, and outcome together", async () => {
    const authority = service(pool);
    const outcome = await authority.replay(tokenMember, {
      operationId: "op-1",
      kind: "create",
      objectName: "Note",
      values: { Title: "First note" },
    });
    expect(outcome.status).toBe("accepted");
    expect(pool.tables.records.size).toBe(1);
    expect(pool.tables.outcomes.size).toBe(1);
    // Runtime audit is now durably projected in the same transaction.
    expect(pool.tables.audit.size).toBeGreaterThan(0);
    expect(pool.openConnections).toBe(0);
  });

  it("returns the stored outcome on idempotent retry without re-applying", async () => {
    const authority = service(pool);
    const intent = {
      operationId: "op-dup",
      kind: "create" as const,
      objectName: "Note",
      values: { Title: "Once only" },
    };
    const first = await authority.replay(tokenMember, intent);
    const retry = await authority.replay(tokenMember, intent);
    expect(retry).toEqual(first);
    expect(pool.tables.records.size).toBe(1);
    expect(pool.tables.audit.size).toBe(1);
  });

  it("rolls back every projection and stays retryable when the outcome write fails", async () => {
    const authority = service(pool);
    pool.failWhen = (q) =>
      q.startsWith("insert into adl_authority_operation_outcomes")
        ? new Error("outcome write failed")
        : null;
    // An infrastructure failure surfaces (retryable) rather than being cached as
    // a false rejection, and leaves no partial projection behind.
    await expect(
      authority.replay(tokenMember, {
        operationId: "op-fail-outcome",
        kind: "create",
        objectName: "Note",
        values: { Title: "Should not persist" },
      }),
    ).rejects.toThrow("outcome write failed");
    expect(pool.tables.records.size).toBe(0);
    expect(pool.tables.audit.size).toBe(0);
    expect(pool.tables.outcomes.size).toBe(0);
    expect(pool.openConnections).toBe(0);
  });

  it("rolls back the record and outcome when the audit write fails", async () => {
    const authority = service(pool);
    pool.failWhen = (q) =>
      q.startsWith("insert into adl_authority_audit_events")
        ? new Error("audit write failed")
        : null;
    await expect(
      authority.replay(tokenMember, {
        operationId: "op-fail-audit",
        kind: "create",
        objectName: "Note",
        values: { Title: "Should not persist" },
      }),
    ).rejects.toThrow("audit write failed");
    expect(pool.tables.records.size).toBe(0);
    expect(pool.tables.outcomes.size).toBe(0);
    expect(pool.openConnections).toBe(0);
  });

  it("keeps a multi-record command all-or-nothing on failure", async () => {
    const authority = service(pool);
    // Fail the second record insert so the first must roll back too.
    let inserts = 0;
    pool.failWhen = (q) => {
      if (!q.startsWith("insert into adl_authority_records")) return null;
      inserts += 1;
      return inserts === 2 ? new Error("second step failed") : null;
    };
    await expect(
      authority.replay(tokenMember, {
        operationId: "op-command-fail",
        kind: "command",
        commandName: "CreateTwoNotes",
        input: { First: "one", Second: "two" },
      }),
    ).rejects.toThrow("second step failed");
    // The first step's record must not survive the failed command.
    expect(pool.tables.records.size).toBe(0);

    pool.failWhen = null;
    const ok = await authority.replay(tokenMember, {
      operationId: "op-command-ok",
      kind: "command",
      commandName: "CreateTwoNotes",
      input: { First: "one", Second: "two" },
    });
    expect(ok.status).toBe("accepted");
    expect(pool.tables.records.size).toBe(2);
  });

  it("persists a durable rejection so a retry stays idempotent without a record", async () => {
    const authority = service(pool);
    // Missing required Title fails runtime validation.
    const intent = {
      operationId: "op-reject",
      kind: "create" as const,
      objectName: "Note",
      values: {},
    };
    const first = await authority.replay(tokenMember, intent);
    expect(first.status).toBe("rejected");
    expect(pool.tables.records.size).toBe(0);
    expect(pool.tables.outcomes.size).toBe(1);
    const retry = await authority.replay(tokenMember, intent);
    expect(retry).toEqual(first);
  });

  it("gates a concurrent duplicate outcome so the raced record rolls back", async () => {
    const unitOfWork = new PostgresAuthorityUnitOfWork(pool, applicationId, model);
    const accepted = await unitOfWork.run(async (transaction) => {
      await transaction.runtime.create(
        "Note",
        { Title: "winner" },
        { userId: "member-1", roles: [], channel: "sync", online: true },
      );
      const outcome = {
        status: "accepted" as const,
        operationId: "op-race",
        records: [] as StoredObjectRecord[],
      };
      expect(await transaction.putOutcome(outcome, "member-1")).toBe(true);
      return outcome;
    });
    expect(accepted.status).toBe("accepted");
    expect(pool.tables.records.size).toBe(1);

    // A second transaction that races past the pre-check hits the outcome gate.
    await expect(
      unitOfWork.run(async (transaction) => {
        await transaction.runtime.create(
          "Note",
          { Title: "loser" },
          { userId: "member-1", roles: [], channel: "sync", online: true },
        );
        if (!(await transaction.putOutcome({ ...accepted }, "member-1")))
          throw new Error("gate rejected duplicate");
        return accepted;
      }),
    ).rejects.toThrow("gate rejected duplicate");
    // The loser's record write was rolled back.
    expect(pool.tables.records.size).toBe(1);
  });

  it("rejects and rolls back on a persisted model-version mismatch", async () => {
    const mismatched = seededPool("does-not-match");
    const authority = service(mismatched);
    const outcome = await authority.replay(tokenMember, {
      operationId: "op-version",
      kind: "create",
      objectName: "Note",
      values: { Title: "blocked" },
    });
    expect(outcome.status).toBe("rejected");
    expect(mismatched.tables.records.size).toBe(0);
  });

  it("verifies projection integrity and detects an inconsistent restore set", async () => {
    const authority = service(pool);
    await authority.replay(tokenMember, {
      operationId: "op-integrity",
      kind: "create",
      objectName: "Note",
      values: { Title: "kept" },
    });
    const integrity = new AuthorityProjectionIntegrity(await pool.connect(), applicationId);
    const healthy = await integrity.verify();
    expect(healthy.consistent).toBe(true);
    expect(healthy.counts.records).toBe(1);
    expect(healthy.acceptedOutcomeRecordsMissing).toBe(0);

    // Simulate a partial restore: the accepted record projection is lost but the
    // outcome that references it survives.
    pool.tables.records.clear();
    const broken = await integrity.verify();
    expect(broken.consistent).toBe(false);
    expect(broken.acceptedOutcomeRecordsMissing).toBeGreaterThan(0);
    expect(await integrity.recoveryStatus()).toMatchObject({
      ready: false,
      recoveryRequired: true,
    });
  });
});

describe("Phase 44 access lifecycle atomic audit", () => {
  const contextModel = resolveApplicationModel({
    app: { name: "Phase 44 access fixture", startView: "BandList" },
    roles: [{ name: "BandAdmin" }, { name: "BandMember" }],
    contexts: [
      {
        name: "Band",
        object: "Band",
        selection: { mode: "optional" },
        membership: {
          object: "BandMember",
          userField: "User",
          contextField: "Band",
          roleField: "Role",
          roles: ["BandAdmin", "BandMember"],
        },
      },
    ],
    objects: [
      {
        name: "Band",
        fields: [{ name: "Name", type: "text", required: true }],
        views: [{ name: "BandList", kind: "list", fields: ["Name"], actions: ["read"] }],
      },
      {
        name: "BandMember",
        scope: { context: "Band", field: "Band" },
        fields: [
          { name: "User", type: "text", required: true },
          {
            name: "Band",
            type: "text",
            required: true,
            lookup: { targetObject: "Band", displayField: "Name" },
          },
          { name: "Role", type: "text", required: true },
        ],
      },
    ],
    policies: [
      {
        name: "BandMemberPolicy",
        object: "BandMember",
        rules: [
          {
            name: "membersRead",
            effect: "allow",
            principal: { match: "specific", roles: ["BandAdmin", "BandMember"] },
            action: "read",
          },
          {
            name: "adminsManage",
            effect: "allow",
            principal: { match: "specific", roles: ["BandAdmin"] },
            action: "update",
          },
        ],
      },
    ],
  });

  const adminToken = "a".repeat(48);
  const accessSessions = new StaticSessionAdapter(new Map([[adminToken, { userId: "admin-1" }]]));

  function memberRecord(id: string, user: string, role: string): StoredObjectRecord {
    return {
      meta: {
        guid: id,
        object: "BandMember",
        schemaVersion: 1,
        revision: `rev-${id}`,
        createdAt: "2026-07-21T00:00:00.000Z",
        createdBy: "seed",
        updatedAt: "2026-07-21T00:00:00.000Z",
        updatedBy: "seed",
        syncStatus: "synced",
      },
      values: { User: user, Band: "band-1", Role: role },
    };
  }

  function seedRecord(pool: FakePostgres, objectName: string, row: StoredObjectRecord): void {
    pool.tables.records.set(recordKey(applicationId, objectName, row.meta.guid), {
      applicationId,
      objectName,
      recordId: row.meta.guid,
      revision: row.meta.revision,
      deletedAt: null,
      record: row,
    });
  }

  function bandRecord(): StoredObjectRecord {
    return {
      meta: {
        guid: "band-1",
        object: "Band",
        schemaVersion: 1,
        revision: "rev-band-1",
        createdAt: "2026-07-21T00:00:00.000Z",
        createdBy: "seed",
        updatedAt: "2026-07-21T00:00:00.000Z",
        updatedBy: "seed",
        syncStatus: "synced",
      },
      values: { Name: "Giggle" },
    };
  }

  function seedAccessPool(): FakePostgres {
    const pool = new FakePostgres();
    pool.tables.models.set(applicationId, { modelVersion: contextModel.modelVersion });
    seedRecord(pool, "Band", bandRecord());
    seedRecord(pool, "BandMember", memberRecord("membership-admin", "admin-1", "BandAdmin"));
    seedRecord(pool, "BandMember", memberRecord("membership-target", "target-1", "BandMember"));
    return pool;
  }

  function accessService(pool: FakePostgres): AuthorityAccessLifecycleService {
    // The runtime reads business records and the access store writes projections
    // through the same PostgreSQL, exactly as production wiring does.
    const storage = new PostgresObjectStorageBackend(pool, applicationId, contextModel);
    return new AuthorityAccessLifecycleService(
      contextModel,
      storage,
      accessSessions,
      new PostgresAuthorityAccessStore(pool, applicationId),
      {
        now: () => new Date("2026-07-21T00:00:00.000Z"),
        newId: idFactory(),
        newToken: () => "t".repeat(40),
      },
    );
  }

  it("writes an invite and its audit atomically, rolling back both on audit failure", async () => {
    const pool = seedAccessPool();
    const service = accessService(pool);
    pool.failWhen = (q) =>
      q.startsWith("insert into adl_authority_access_audit_events")
        ? new Error("audit failed")
        : null;
    await expect(
      service.createInvite(adminToken, {
        contextName: "Band",
        contextId: "band-1",
        role: "BandMember",
        expiresAt: new Date("2026-08-01T00:00:00.000Z"),
      }),
    ).rejects.toThrow("audit failed");
    expect(pool.tables.invites.size).toBe(0);
    expect(pool.tables.accessAudit.size).toBe(0);

    pool.failWhen = null;
    const created = await service.createInvite(adminToken, {
      contextName: "Band",
      contextId: "band-1",
      role: "BandMember",
      expiresAt: new Date("2026-08-01T00:00:00.000Z"),
    });
    expect(pool.tables.invites.size).toBe(1);
    expect(pool.tables.accessAudit.size).toBe(1);
    expect(created.inviteId).toMatch(/^invite-/u);
  });

  it("tombstones a membership and its revocation audit atomically", async () => {
    const pool = seedAccessPool();
    const service = accessService(pool);
    const revoked = await service.revokeMembership(adminToken, {
      contextName: "Band",
      contextId: "band-1",
      userId: "target-1",
      role: "BandMember",
    });
    expect(revoked).toBe(true);
    const tombstone = pool.tables.records.get(
      recordKey(applicationId, "BandMember", "membership-target"),
    );
    expect(tombstone?.deletedAt).not.toBeNull();
    expect(pool.tables.accessAudit.size).toBe(1);
  });

  it("rolls back the membership tombstone when its audit write fails", async () => {
    const pool = seedAccessPool();
    const service = accessService(pool);
    pool.failWhen = (q) =>
      q.startsWith("insert into adl_authority_access_audit_events")
        ? new Error("audit failed")
        : null;
    await expect(
      service.revokeMembership(adminToken, {
        contextName: "Band",
        contextId: "band-1",
        userId: "target-1",
        role: "BandMember",
      }),
    ).rejects.toThrow("audit failed");
    const record = pool.tables.records.get(
      recordKey(applicationId, "BandMember", "membership-target"),
    );
    expect(record?.deletedAt).toBeNull();
    expect(pool.tables.accessAudit.size).toBe(0);
  });
});

function idFactory(): () => string {
  let n = 0;
  return () => `id${(n += 1)}`;
}
