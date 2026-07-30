import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Pool } from "pg";
import {
  AuthorityAccessLifecycleService,
  AuthorityProjectionIntegrity,
  AuthorityService,
  PostgresAuthorityAccessStore,
  PostgresAuthorityUnitOfWork,
  PostgresObjectStorageBackend,
  InMemoryObjectStorageBackend,
  StaticSessionAdapter,
  resolveApplicationModel,
} from "../../src/index.js";
import type { StoredObjectRecord } from "../../src/index.js";
import { authorityPool, faultyPool, resetProjections, seedApplication } from "./pg-harness.js";

const noteApp = "note-app";
const bandApp = "band-app";
const memberToken = "m".repeat(48);
const adminToken = "a".repeat(48);
const claimantToken = "c".repeat(48);

const noteModel = resolveApplicationModel({
  app: { name: "Integration notes", startView: "NoteList" },
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
        { name: "c", effect: "allow", principal: { match: "authenticated" }, action: "create" },
        { name: "r", effect: "allow", principal: { match: "authenticated" }, action: "read" },
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

const bandModel = resolveApplicationModel({
  app: { name: "Integration bands", startView: "BandList" },
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
          name: "read",
          effect: "allow",
          principal: { match: "specific", roles: ["BandAdmin", "BandMember"] },
          action: "read",
        },
        {
          name: "manage",
          effect: "allow",
          principal: { match: "specific", roles: ["BandAdmin"] },
          action: "update",
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

async function seedRecord(app: string, object: string, row: StoredObjectRecord): Promise<void> {
  await pool.query(
    "insert into adl_authority_records (application_id, object_name, record_id, revision, deleted_at, record) values ($1, $2, $3, $4, null, $5::jsonb)",
    [app, object, row.meta.guid, row.meta.revision, JSON.stringify(row)],
  );
}

describe("authority replay against real PostgreSQL", () => {
  beforeEach(() => seedApplication(pool, noteApp, noteModel.modelVersion));

  function service(unitPool = authorityPool(pool)): AuthorityService {
    return new AuthorityService(noteModel, new InMemoryObjectStorageBackend(), sessions(), {
      unitOfWork: new PostgresAuthorityUnitOfWork(unitPool, noteApp, noteModel),
    });
  }
  function sessions(): StaticSessionAdapter {
    return new StaticSessionAdapter(new Map([[memberToken, { userId: "member-1" }]]));
  }

  it("commits record, runtime audit, and outcome in one real transaction", async () => {
    const outcome = await service().replay(memberToken, {
      operationId: "op-1",
      kind: "create",
      objectName: "Note",
      recordId: "note-real-note",
      values: { Title: "Real note" },
    });
    expect(outcome.status).toBe("accepted");
    expect(
      await count("select count(*)::int n from adl_authority_records where application_id=$1", [
        noteApp,
      ]),
    ).toBe(1);
    expect(
      await count(
        "select count(*)::int n from adl_authority_audit_events where application_id=$1",
        [noteApp],
      ),
    ).toBeGreaterThan(0);
    expect(await count("select count(*)::int n from adl_authority_operation_outcomes")).toBe(1);
  });

  it("is idempotent on retry", async () => {
    const authority = service();
    const intent = {
      operationId: "op-dup",
      kind: "create" as const,
      objectName: "Note",
      recordId: "note-once",
      values: { Title: "Once" },
    };
    const first = await authority.replay(memberToken, intent);
    const retry = await authority.replay(memberToken, intent);
    expect(retry).toEqual(first);
    expect(
      await count("select count(*)::int n from adl_authority_records where application_id=$1", [
        noteApp,
      ]),
    ).toBe(1);
    expect(
      await count(
        "select count(*)::int n from adl_authority_audit_events where application_id=$1",
        [noteApp],
      ),
    ).toBe(1);
  });

  /**
   * Phase 48. The client names the record, so the accepted record comes back
   * under the id the browser already holds. Idempotency stays keyed on the
   * operation id: a *different* operation reusing an accepted record's id is a
   * new operation and must be refused, not served the earlier outcome and not
   * allowed to overwrite, merge with, or silently adopt the existing record.
   */
  it("accepts a create under the client's own id and refuses a second create under it", async () => {
    const authority = service();
    const accepted = await authority.replay(memberToken, {
      operationId: "op-named",
      kind: "create",
      objectName: "Note",
      recordId: "note-client-named",
      values: { Title: "Named by the client" },
    });
    expect(accepted).toMatchObject({ status: "accepted" });
    expect(
      accepted.status === "accepted" ? accepted.records.map((row) => row.meta.guid) : [],
    ).toEqual(["note-client-named"]);
    // The row PostgreSQL holds is keyed by the client's id, so a follow-up
    // update against that id needs no translation step.
    expect(
      await count(
        "select count(*)::int n from adl_authority_records where application_id=$1 and record_id=$2",
        [noteApp, "note-client-named"],
      ),
    ).toBe(1);

    const collided = await authority.replay(memberToken, {
      operationId: "op-collides",
      kind: "create",
      objectName: "Note",
      recordId: "note-client-named",
      values: { Title: "Impostor" },
    });

    expect(collided).toMatchObject({
      status: "rejected",
      operationId: "op-collides",
      code: "ADL_RUNTIME_RECORD_ID_TAKEN",
    });
    // Still one row, still the original values, and the refusal is a durable
    // outcome of its own rather than the accepted one replayed back.
    expect(
      await count("select count(*)::int n from adl_authority_records where application_id=$1", [
        noteApp,
      ]),
    ).toBe(1);
    const rows = await pool.query<{ record: StoredObjectRecord }>(
      "select record from adl_authority_records where application_id=$1 and record_id=$2",
      [noteApp, "note-client-named"],
    );
    expect(rows.rows[0]?.record.values).toEqual({ Title: "Named by the client" });
    expect(await count("select count(*)::int n from adl_authority_operation_outcomes")).toBe(2);
    // The refusal is idempotent in its own right.
    expect(
      await authority.replay(memberToken, {
        operationId: "op-collides",
        kind: "create",
        objectName: "Note",
        recordId: "note-client-named",
        values: { Title: "Impostor" },
      }),
    ).toEqual(collided);
  });

  /**
   * A malformed id is refused by the runtime before storage sees it. Without this
   * the insert would raise a real PostgreSQL error, which is not a `RuntimeError`
   * and so would surface as a retryable infrastructure failure the client would
   * replay forever.
   */
  it("refuses a control-character record id before it reaches PostgreSQL", async () => {
    const outcome = await service().replay(memberToken, {
      operationId: "op-bad-id",
      kind: "create",
      objectName: "Note",
      recordId: `note-${String.fromCodePoint(0)}1`,
      values: { Title: "Never stored" },
    });

    expect(outcome).toMatchObject({
      status: "rejected",
      code: "ADL_RUNTIME_RECORD_ID_INVALID",
    });
    expect(
      await count("select count(*)::int n from adl_authority_records where application_id=$1", [
        noteApp,
      ]),
    ).toBe(0);
  });

  it("commits a multi-record command atomically", async () => {
    const outcome = await service().replay(memberToken, {
      operationId: "op-cmd",
      kind: "command",
      commandName: "CreateTwoNotes",
      input: { First: "one", Second: "two" },
    });
    expect(outcome.status).toBe("accepted");
    expect(
      await count("select count(*)::int n from adl_authority_records where application_id=$1", [
        noteApp,
      ]),
    ).toBe(2);
  });

  it("rolls back the whole transaction in real PostgreSQL when audit write fails", async () => {
    const faulty = faultyPool(pool, (sql) =>
      sql.startsWith("insert into adl_authority_audit_events"),
    );
    await expect(
      service(faulty).replay(memberToken, {
        operationId: "op-fault",
        kind: "create",
        objectName: "Note",
        recordId: "note-should-roll-back",
        values: { Title: "Should roll back" },
      }),
    ).rejects.toThrow("injected infrastructure failure");
    expect(
      await count("select count(*)::int n from adl_authority_records where application_id=$1", [
        noteApp,
      ]),
    ).toBe(0);
    expect(await count("select count(*)::int n from adl_authority_operation_outcomes")).toBe(0);
  });

  it("gates a genuinely concurrent duplicate submission to exactly one record", async () => {
    const authority = service();
    const intent = {
      operationId: "op-race",
      kind: "create" as const,
      objectName: "Note",
      recordId: "note-concurrent",
      values: { Title: "Concurrent" },
    };
    const [a, b] = await Promise.all([
      authority.replay(memberToken, intent),
      authority.replay(memberToken, intent),
    ]);
    expect(a.status).toBe("accepted");
    expect(b).toEqual(a);
    // Real row-level locking on the outcome primary key rolls the loser back.
    expect(
      await count("select count(*)::int n from adl_authority_records where application_id=$1", [
        noteApp,
      ]),
    ).toBe(1);
    expect(await count("select count(*)::int n from adl_authority_operation_outcomes")).toBe(1);
  });

  it("runs the real integrity SQL and detects an inconsistent restore set", async () => {
    await service().replay(memberToken, {
      operationId: "op-int",
      kind: "create",
      objectName: "Note",
      recordId: "note-kept",
      values: { Title: "Kept" },
    });
    const integrity = new AuthorityProjectionIntegrity(authorityPool(pool), noteApp);
    const healthy = await integrity.verify();
    expect(healthy.consistent).toBe(true);
    expect(healthy.counts.records).toBe(1);
    expect(healthy.acceptedOutcomeRecordsMissing).toBe(0);

    await pool.query("delete from adl_authority_records where application_id=$1", [noteApp]);
    const broken = await integrity.verify();
    expect(broken.consistent).toBe(false);
    expect(broken.acceptedOutcomeRecordsMissing).toBeGreaterThan(0);
    expect(await integrity.recoveryStatus()).toMatchObject({
      ready: false,
      recoveryRequired: true,
    });
  });

  it("persists a deterministic rejection durably and stays idempotent, without a record", async () => {
    const authority = service();
    // Missing required Title is a deterministic runtime validation rejection.
    const intent = {
      operationId: "op-reject",
      kind: "create" as const,
      objectName: "Note",
      recordId: "note-missing-title",
      values: {},
    };
    const first = await authority.replay(memberToken, intent);
    expect(first.status).toBe("rejected");
    expect(
      await count("select count(*)::int n from adl_authority_records where application_id=$1", [
        noteApp,
      ]),
    ).toBe(0);
    expect(await count("select count(*)::int n from adl_authority_operation_outcomes")).toBe(1);
    const retry = await authority.replay(memberToken, intent);
    expect(retry).toEqual(first);
  });

  it("rejects and rolls back on a persisted model-version mismatch", async () => {
    await pool.query(
      "update adl_authority_models set model_version='does-not-match' where application_id=$1",
      [noteApp],
    );
    const outcome = await service().replay(memberToken, {
      operationId: "op-version",
      kind: "create",
      objectName: "Note",
      recordId: "note-blocked",
      values: { Title: "blocked" },
    });
    expect(outcome.status).toBe("rejected");
    expect(
      await count("select count(*)::int n from adl_authority_records where application_id=$1", [
        noteApp,
      ]),
    ).toBe(0);
  });
});

describe("access lifecycle against real PostgreSQL", () => {
  beforeEach(async () => {
    await seedApplication(pool, bandApp, bandModel.modelVersion);
    await seedRecord(bandApp, "Band", record("Band", "band-1", { Name: "Giggle" }));
    await seedRecord(
      bandApp,
      "BandMember",
      record("BandMember", "membership-admin", {
        User: "admin-1",
        Band: "band-1",
        Role: "BandAdmin",
      }),
    );
    await seedRecord(
      bandApp,
      "BandMember",
      record("BandMember", "membership-target", {
        User: "target-1",
        Band: "band-1",
        Role: "BandMember",
      }),
    );
  });

  // A shared monotonic id generator: several services in one test write to the
  // same real tables, so their generated ids must never collide.
  let idCounter = 0;
  function accessService(unitPool = authorityPool(pool)): AuthorityAccessLifecycleService {
    return new AuthorityAccessLifecycleService(
      bandModel,
      new PostgresObjectStorageBackend(unitPool, bandApp, bandModel),
      new StaticSessionAdapter(
        new Map([
          [adminToken, { userId: "admin-1" }],
          [claimantToken, { userId: "claimant-1" }],
        ]),
      ),
      new PostgresAuthorityAccessStore(unitPool, bandApp),
      {
        now: () => new Date("2026-07-21T00:00:00.000Z"),
        newId: () => `id${(idCounter += 1)}`,
        newToken: () => `tok${(idCounter += 1)}`.padEnd(40, "t"),
      },
    );
  }

  it("creates an invite and its access audit atomically", async () => {
    const created = await accessService().createInvite(adminToken, {
      contextName: "Band",
      contextId: "band-1",
      role: "BandMember",
      expiresAt: new Date("2026-08-01T00:00:00.000Z"),
    });
    expect(created.inviteId).toMatch(/^invite-/u);
    expect(
      await count("select count(*)::int n from adl_authority_invites where application_id=$1", [
        bandApp,
      ]),
    ).toBe(1);
    expect(
      await count(
        "select count(*)::int n from adl_authority_access_audit_events where application_id=$1",
        [bandApp],
      ),
    ).toBe(1);
  });

  it("claims an invite with a real row lock, inserting membership and audit atomically", async () => {
    const created = await accessService().createInvite(adminToken, {
      contextName: "Band",
      contextId: "band-1",
      role: "BandMember",
      expiresAt: new Date("2026-08-01T00:00:00.000Z"),
    });
    const claim = await accessService().claimInvite(claimantToken, created.inviteToken);
    expect(claim.status).toBe("accepted");
    const memberships = await count(
      "select count(*)::int n from adl_authority_records where application_id=$1 and object_name='BandMember' and record->'values'->>'User'=$2",
      [bandApp, "claimant-1"],
    );
    expect(memberships).toBe(1);
    // inviteCreated + inviteClaimed
    expect(
      await count(
        "select count(*)::int n from adl_authority_access_audit_events where application_id=$1",
        [bandApp],
      ),
    ).toBe(2);
  });

  it("tombstones a membership and its audit atomically, and rolls back on audit failure", async () => {
    const revoked = await accessService().revokeMembership(adminToken, {
      contextName: "Band",
      contextId: "band-1",
      userId: "target-1",
      role: "BandMember",
    });
    expect(revoked).toBe(true);
    expect(
      await count(
        "select count(*)::int n from adl_authority_records where application_id=$1 and record_id='membership-target' and deleted_at is not null",
        [bandApp],
      ),
    ).toBe(1);
    expect(
      await count(
        "select count(*)::int n from adl_authority_access_audit_events where application_id=$1",
        [bandApp],
      ),
    ).toBe(1);

    // Re-seed a fresh target and prove the audit-failure path rolls the tombstone back.
    await pool.query(
      "delete from adl_authority_records where application_id=$1 and record_id='membership-target'",
      [bandApp],
    );
    await seedRecord(
      bandApp,
      "BandMember",
      record("BandMember", "membership-target", {
        User: "target-1",
        Band: "band-1",
        Role: "BandMember",
      }),
    );
    const faulty = faultyPool(pool, (sql) =>
      sql.startsWith("insert into adl_authority_access_audit_events"),
    );
    await expect(
      accessService(faulty).revokeMembership(adminToken, {
        contextName: "Band",
        contextId: "band-1",
        userId: "target-1",
        role: "BandMember",
      }),
    ).rejects.toThrow("injected infrastructure failure");
    expect(
      await count(
        "select count(*)::int n from adl_authority_records where application_id=$1 and record_id='membership-target' and deleted_at is not null",
        [bandApp],
      ),
    ).toBe(0);
  });
});
