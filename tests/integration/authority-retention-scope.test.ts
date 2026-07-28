import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Pool } from "pg";
import {
  AuthorityAccessLifecycleService,
  AuthorityAdministrationService,
  AuthorityProjectionIntegrity,
  AuthorityRetentionService,
  AuthorityService,
  InMemoryObjectStorageBackend,
  PostgresAuthorityAccessStore,
  PostgresAuthorityAdministrationStore,
  PostgresObjectStorageBackend,
  PostgresAuthorityUnitOfWork,
  StaticSessionAdapter,
  resolveApplicationModel,
} from "../../src/index.js";
import type { StoredObjectRecord } from "../../src/index.js";
import { authorityPool, resetProjections, seedApplication } from "./pg-harness.js";

const app = "scope-app";
const adminToken = "a".repeat(48);

const scopeModel = resolveApplicationModel({
  app: { name: "Scoped tasks", startView: "TaskList" },
  roles: [{ name: "ProjectAdmin" }, { name: "ProjectMember" }],
  contexts: [
    {
      name: "Project",
      object: "Project",
      selection: { mode: "optional" },
      membership: {
        object: "ProjectMember",
        userField: "User",
        contextField: "Project",
        roleField: "Role",
        roles: ["ProjectAdmin", "ProjectMember"],
      },
    },
  ],
  objects: [
    {
      name: "Project",
      fields: [{ name: "Name", type: "text", required: true }],
      views: [{ name: "ProjectList", kind: "list", fields: ["Name"], actions: ["read"] }],
    },
    {
      name: "ProjectMember",
      scope: { context: "Project", field: "Project" },
      fields: [
        { name: "User", type: "text", required: true },
        {
          name: "Project",
          type: "text",
          required: true,
          lookup: { targetObject: "Project", displayField: "Name" },
        },
        { name: "Role", type: "text", required: true },
      ],
    },
    {
      name: "Task",
      scope: { context: "Project", field: "Project" },
      fields: [
        { name: "Title", type: "text", required: true },
        {
          name: "Project",
          type: "text",
          required: true,
          lookup: { targetObject: "Project", displayField: "Name" },
        },
      ],
      views: [{ name: "TaskList", kind: "list", fields: ["Title"], actions: ["read"] }],
    },
  ],
  policies: [
    {
      name: "ProjectMemberPolicy",
      object: "ProjectMember",
      rules: [
        {
          name: "read",
          effect: "allow",
          principal: { match: "specific", roles: ["ProjectAdmin", "ProjectMember"] },
          action: "read",
        },
        {
          name: "manage",
          effect: "allow",
          principal: { match: "specific", roles: ["ProjectAdmin"] },
          action: "update",
        },
      ],
    },
    {
      name: "TaskPolicy",
      object: "Task",
      rules: [
        {
          name: "create",
          effect: "allow",
          principal: { match: "specific", roles: ["ProjectAdmin", "ProjectMember"] },
          action: "create",
        },
        {
          name: "read",
          effect: "allow",
          principal: { match: "specific", roles: ["ProjectAdmin", "ProjectMember"] },
          action: "read",
        },
      ],
    },
  ],
});

let pool: Pool;

beforeAll(() => {
  pool = new Pool({ connectionString: inject("pgUrl"), max: 8 });
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await resetProjections(pool);
  await seedApplication(pool, app, scopeModel.modelVersion);
});

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const result = await pool.query<{ n: number }>(sql, params);
  return Number(result.rows[0]?.n ?? 0);
}

function record(object: string, id: string, values: Record<string, string>): StoredObjectRecord {
  return {
    meta: {
      guid: id,
      object,
      schemaVersion: 1,
      revision: `rev-${id}`,
      createdAt: "2026-07-21T00:00:00.000Z",
      createdBy: "seed",
      updatedAt: "2026-07-21T00:00:00.000Z",
      updatedBy: "seed",
      syncStatus: "synced",
    },
    values,
  };
}

async function seedRecord(object: string, row: StoredObjectRecord): Promise<void> {
  await pool.query(
    "insert into adl_authority_records (application_id, object_name, record_id, revision, deleted_at, record) values ($1, $2, $3, $4, null, $5::jsonb)",
    [app, object, row.meta.guid, row.meta.revision, JSON.stringify(row)],
  );
}

function sessions(): StaticSessionAdapter {
  return new StaticSessionAdapter(new Map([[adminToken, { userId: "admin-1" }]]));
}

function authority(): AuthorityService {
  return new AuthorityService(scopeModel, new InMemoryObjectStorageBackend(), sessions(), {
    unitOfWork: new PostgresAuthorityUnitOfWork(authorityPool(pool), app, scopeModel),
  });
}

async function seedProjectAdmin(projectId: string): Promise<void> {
  await seedRecord("Project", record("Project", projectId, { Name: projectId }));
  await seedRecord(
    "ProjectMember",
    record("ProjectMember", `member-${projectId}`, {
      User: "admin-1",
      Project: projectId,
      Role: "ProjectAdmin",
    }),
  );
}

describe("context-scoped runtime audit against real PostgreSQL", () => {
  it("stamps each audit row with the record's declared context scope", async () => {
    await seedProjectAdmin("project-a");
    await seedProjectAdmin("project-b");
    await authority().replay(adminToken, {
      operationId: "op-a",
      kind: "create",
      objectName: "Task",
      values: { Title: "A task", Project: "project-a" },
      selectedContexts: { Project: "project-a" },
    });
    await authority().replay(adminToken, {
      operationId: "op-b",
      kind: "create",
      objectName: "Task",
      values: { Title: "B task", Project: "project-b" },
      selectedContexts: { Project: "project-b" },
    });

    expect(
      await count(
        "select count(*)::int n from adl_authority_audit_events where application_id=$1 and context_name='Project' and context_id='project-a'",
        [app],
      ),
    ).toBe(1);
    expect(
      await count(
        "select count(*)::int n from adl_authority_audit_events where application_id=$1 and context_name='Project' and context_id='project-b'",
        [app],
      ),
    ).toBe(1);
    // No audit row is left half-scoped.
    expect(
      await count(
        "select count(*)::int n from adl_authority_audit_events where application_id=$1 and (context_name is null) <> (context_id is null)",
        [app],
      ),
    ).toBe(0);
  });

  it("scopes an administrator's review to their context in SQL, with the per-row runtime read still enforced", async () => {
    await seedProjectAdmin("project-a");
    await seedProjectAdmin("project-b");
    await authority().replay(adminToken, {
      operationId: "op-a",
      kind: "create",
      objectName: "Task",
      values: { Title: "A task", Project: "project-a" },
      selectedContexts: { Project: "project-a" },
    });
    await authority().replay(adminToken, {
      operationId: "op-b",
      kind: "create",
      objectName: "Task",
      values: { Title: "B task", Project: "project-b" },
      selectedContexts: { Project: "project-b" },
    });

    const storage = new PostgresObjectStorageBackend(authorityPool(pool), app, scopeModel);
    const store = new PostgresAuthorityAdministrationStore(authorityPool(pool), app);
    const administration = new AuthorityAdministrationService(
      scopeModel,
      storage,
      new AuthorityAccessLifecycleService(
        scopeModel,
        storage,
        sessions(),
        new PostgresAuthorityAccessStore(authorityPool(pool), app),
      ),
      store,
      store,
    );

    const reviewA = await administration.runtimeAudit(adminToken, "Project", "project-a");
    expect(reviewA.entries).toHaveLength(1);
    expect(reviewA.entries[0]?.object).toBe("Task");

    const reviewB = await administration.runtimeAudit(adminToken, "Project", "project-b");
    expect(reviewB.entries).toHaveLength(1);
    // The two contexts' reviews are disjoint: project-a's page never leaks project-b's audit.
    expect(reviewA.entries[0]?.recordId).not.toBe(reviewB.entries[0]?.recordId);
  });

  it("verifies scope consistency and flags a half-populated audit scope", async () => {
    await seedProjectAdmin("project-a");
    await authority().replay(adminToken, {
      operationId: "op-a",
      kind: "create",
      objectName: "Task",
      values: { Title: "A task", Project: "project-a" },
      selectedContexts: { Project: "project-a" },
    });
    const integrity = new AuthorityProjectionIntegrity(authorityPool(pool), app);
    const healthy = await integrity.verify();
    expect(healthy.consistent).toBe(true);
    expect(healthy.auditScopeInconsistent).toBe(0);
    expect(healthy.counts.outcomes).toBe(1);

    // Corrupt one row into a half-populated scope, as a bad migration/restore might.
    await pool.query(
      "update adl_authority_audit_events set context_id=null where application_id=$1",
      [app],
    );
    const broken = await integrity.verify();
    expect(broken.auditScopeInconsistent).toBeGreaterThan(0);
    expect(broken.consistent).toBe(false);
  });
});

describe("authority retention against real PostgreSQL", () => {
  const now = () => new Date("2026-07-28T12:00:00.000Z");

  async function insertAudit(id: string, contextId: string, occurredAt: string): Promise<void> {
    await pool.query(
      "insert into adl_authority_audit_events (audit_id, application_id, context_name, context_id, event, occurred_at) values ($1,$2,'Project',$3,$4::jsonb,$5)",
      [
        id,
        app,
        contextId,
        JSON.stringify({ object: "Task", recordId: id, operation: "create" }),
        occurredAt,
      ],
    );
  }
  async function insertOutcome(operationId: string, acceptedAt: string): Promise<void> {
    await pool.query(
      "insert into adl_authority_operation_outcomes (operation_id, actor_id, application_id, outcome, accepted_at) values ($1,'admin-1',$2,$3::jsonb,$4)",
      [
        operationId,
        app,
        JSON.stringify({ status: "accepted", operationId, records: [] }),
        acceptedAt,
      ],
    );
  }

  it("prunes only rows older than the minimum retention window", async () => {
    await insertAudit("audit-old", "project-a", "2026-01-01T00:00:00.000Z");
    await insertAudit("audit-recent", "project-a", "2026-07-28T06:00:00.000Z");
    await insertOutcome("op-old", "2026-01-01T00:00:00.000Z");
    await insertOutcome("op-recent", "2026-07-28T06:00:00.000Z");

    const retention = new AuthorityRetentionService(authorityPool(pool), app, now);
    // guard = now - 24h = 2026-07-27T12:00; both recent rows are inside the window.
    const status = await retention.prune(
      { minimumRetentionMs: 24 * 60 * 60 * 1000 },
      { before: now() },
    );

    expect(status.held).toBe(false);
    expect(status.effectiveCutoff).toBe("2026-07-27T12:00:00.000Z");
    expect(status.prunedRuntimeAudit).toBe(1);
    expect(status.prunedOutcomes).toBe(1);
    expect(
      await count(
        "select count(*)::int n from adl_authority_audit_events where audit_id='audit-recent'",
      ),
    ).toBe(1);
    expect(
      await count(
        "select count(*)::int n from adl_authority_audit_events where audit_id='audit-old'",
      ),
    ).toBe(0);
    expect(
      await count(
        "select count(*)::int n from adl_authority_operation_outcomes where operation_id='op-recent'",
      ),
    ).toBe(1);
    expect(
      await count(
        "select count(*)::int n from adl_authority_operation_outcomes where operation_id='op-old'",
      ),
    ).toBe(0);
  });

  it("never prunes inside the minimum window even when an earlier cutoff is requested", async () => {
    await insertAudit("audit-boundary", "project-a", "2026-07-28T06:00:00.000Z");
    const retention = new AuthorityRetentionService(authorityPool(pool), app, now);
    // Operator asks to delete everything up to now, but the 24h window protects the row.
    const status = await retention.prune(
      { minimumRetentionMs: 24 * 60 * 60 * 1000 },
      { before: new Date("2026-07-28T11:59:59.000Z") },
    );
    expect(status.prunedRuntimeAudit).toBe(0);
    expect(
      await count(
        "select count(*)::int n from adl_authority_audit_events where audit_id='audit-boundary'",
      ),
    ).toBe(1);
  });

  it("refuses to act under legal hold", async () => {
    await insertAudit("audit-held", "project-a", "2026-01-01T00:00:00.000Z");
    await insertOutcome("op-held", "2026-01-01T00:00:00.000Z");
    const retention = new AuthorityRetentionService(authorityPool(pool), app, now);
    const status = await retention.prune(
      { minimumRetentionMs: 60_000, legalHold: true },
      { before: now() },
    );
    expect(status).toEqual({
      held: true,
      effectiveCutoff: null,
      prunedRuntimeAudit: 0,
      prunedOutcomes: 0,
    });
    expect(await count("select count(*)::int n from adl_authority_audit_events")).toBe(1);
    expect(await count("select count(*)::int n from adl_authority_operation_outcomes")).toBe(1);
  });

  it("rejects a non-positive minimum retention window", async () => {
    const retention = new AuthorityRetentionService(authorityPool(pool), app, now);
    await expect(retention.prune({ minimumRetentionMs: 0 }, { before: now() })).rejects.toThrow(
      "positive minimum retention window",
    );
  });

  it("never deletes accepted records and leaves Phase 44 idempotency intact", async () => {
    await seedProjectAdmin("project-a");
    const intent = {
      operationId: "op-keep",
      kind: "create" as const,
      objectName: "Task",
      values: { Title: "Durable", Project: "project-a" },
      selectedContexts: { Project: "project-a" },
    };
    const first = await authority().replay(adminToken, intent);
    expect(first.status).toBe("accepted");

    // A retention run whose window covers the whole of last year: the just-written
    // rows are in-retention, and records are never a retention target regardless.
    const retention = new AuthorityRetentionService(authorityPool(pool), app, now);
    await retention.prune({ minimumRetentionMs: 365 * 24 * 60 * 60 * 1000 }, { before: now() });

    expect(
      await count(
        "select count(*)::int n from adl_authority_records where application_id=$1 and object_name='Task'",
        [app],
      ),
    ).toBe(1);
    // The retained outcome still makes the operation idempotent.
    const retry = await authority().replay(adminToken, intent);
    expect(retry).toEqual(first);
  });
});
