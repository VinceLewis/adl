import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Pool } from "pg";
import {
  AuthorityAccessLifecycleService,
  AuthorityAdministrationService,
  AuthorityProjectionIntegrity,
  AuthorityService,
  PostgresAuthorityAccessStore,
  PostgresAuthorityAdministrationStore,
  PostgresContextMembershipIndex,
  PostgresObjectStorageBackend,
  PostgresAuthorityUnitOfWork,
  StaticSessionAdapter,
  resolveApplicationModel,
} from "../../src/index.js";
import type { StoredObjectRecord } from "../../src/index.js";
import { createAuthorityProcess } from "../../src/server/authority-entrypoint.js";
import { authorityPool, faultyPool, resetProjections, seedApplication } from "./pg-harness.js";

const app = "membership-app";
const adminToken = "a".repeat(48);
const memberToken = "m".repeat(48);
const claimantToken = "c".repeat(48);

const bandModel = resolveApplicationModel({
  app: { name: "Membership projection fixture", startView: "BandList" },
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
    {
      name: "Gig",
      scope: { context: "Band", field: "Band" },
      fields: [
        { name: "Title", type: "text", required: true },
        {
          name: "Band",
          type: "text",
          required: true,
          lookup: { targetObject: "Band", displayField: "Name" },
        },
      ],
    },
  ],
  policies: [
    {
      name: "BandPolicy",
      object: "Band",
      rules: [
        {
          name: "read",
          effect: "allow",
          principal: { match: "specific", roles: ["BandAdmin", "BandMember"] },
          action: "read",
        },
      ],
    },
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
        {
          name: "create",
          effect: "allow",
          principal: { match: "specific", roles: ["BandAdmin"] },
          action: "create",
        },
        {
          name: "remove",
          effect: "allow",
          principal: { match: "specific", roles: ["BandAdmin"] },
          action: "delete",
        },
      ],
    },
    {
      name: "GigPolicy",
      object: "Gig",
      rules: [
        {
          name: "read",
          effect: "allow",
          principal: { match: "specific", roles: ["BandAdmin", "BandMember"] },
          action: "read",
        },
        {
          name: "create",
          effect: "allow",
          principal: { match: "specific", roles: ["BandAdmin", "BandMember"] },
          action: "create",
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
  await seedApplication(pool, app, bandModel.modelVersion);
});

function record(
  object: string,
  id: string,
  values: Record<string, string>,
  deletedAt?: string,
): StoredObjectRecord {
  return {
    meta: {
      guid: id,
      object,
      schemaVersion: 1,
      revision: `rev-${id}`,
      createdAt: "2026-07-31T00:00:00.000Z",
      createdBy: "seed",
      updatedAt: "2026-07-31T00:00:00.000Z",
      updatedBy: "seed",
      syncStatus: "synced",
      ...(deletedAt === undefined ? {} : { deletedAt }),
    },
    values,
  };
}

function storage(target = authorityPool(pool)): PostgresObjectStorageBackend {
  return new PostgresObjectStorageBackend(target, app, bandModel);
}

/** Seed through the real record path, so the derived projection is written too. */
async function seedRecord(object: string, row: StoredObjectRecord): Promise<void> {
  await storage().create(object, row);
}

/** Seed straight into the record table, deliberately leaving the projection behind. */
async function seedRecordWithoutProjection(
  object: string,
  row: StoredObjectRecord,
  application = app,
): Promise<void> {
  await pool.query(
    "insert into adl_authority_records (application_id, object_name, record_id, revision, deleted_at, record) values ($1, $2, $3, $4, null, $5::jsonb)",
    [application, object, row.meta.guid, row.meta.revision, JSON.stringify(row)],
  );
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const result = await pool.query<{ n: number }>(sql, params);
  return Number(result.rows[0]?.n ?? 0);
}

async function membershipRows(): Promise<
  Array<{
    membership_record_id: string;
    object_name: string;
    context_name: string;
    context_id: string;
    user_id: string;
    role: string;
    revoked_at: Date | null;
  }>
> {
  const result = await pool.query(
    "select membership_record_id, object_name, context_name, context_id, user_id, role, revoked_at from adl_authority_context_memberships where application_id=$1 order by membership_record_id",
    [app],
  );
  return result.rows as Awaited<ReturnType<typeof membershipRows>>;
}

function sessions(): StaticSessionAdapter {
  return new StaticSessionAdapter(
    new Map([
      [adminToken, { userId: "admin-1" }],
      [memberToken, { userId: "member-1" }],
      [claimantToken, { userId: "claimant-1" }],
    ]),
  );
}

function membershipIndex(target = authorityPool(pool)): PostgresContextMembershipIndex {
  return new PostgresContextMembershipIndex(target, app);
}

function authority(): AuthorityService {
  return new AuthorityService(bandModel, storage(), sessions(), {
    unitOfWork: new PostgresAuthorityUnitOfWork(authorityPool(pool), app, bandModel),
    membershipIndex: membershipIndex(),
  });
}

let idCounter = 0;
function accessService(target = authorityPool(pool)): AuthorityAccessLifecycleService {
  return new AuthorityAccessLifecycleService(
    bandModel,
    storage(target),
    sessions(),
    new PostgresAuthorityAccessStore(target, app, bandModel),
    {
      now: () => new Date("2026-07-31T00:00:00.000Z"),
      newId: () => `id${(idCounter += 1)}`,
      newToken: () => `tok${(idCounter += 1)}`.padEnd(40, "t"),
      membershipIndex: membershipIndex(target),
    },
  );
}

function administrationService(): AuthorityAdministrationService {
  const store = new PostgresAuthorityAdministrationStore(authorityPool(pool), app);
  return new AuthorityAdministrationService(
    bandModel,
    storage(),
    accessService(),
    store,
    store,
    async () => ({ ready: true, recoveryRequired: false }),
    () => new Date("2026-07-31T00:00:00.000Z"),
    membershipIndex(),
  );
}

async function seedBandWithAdmin(bandId: string): Promise<void> {
  await seedRecord("Band", record("Band", bandId, { Name: bandId }));
  await seedRecord(
    "BandMember",
    record("BandMember", `membership-admin-${bandId}`, {
      User: "admin-1",
      Band: bandId,
      Role: "BandAdmin",
    }),
  );
}

describe("membership projection writes against real PostgreSQL", () => {
  it("writes a projection row for every accepted membership record", async () => {
    await seedBandWithAdmin("band-1");
    expect(await membershipRows()).toEqual([
      {
        membership_record_id: "membership-admin-band-1",
        object_name: "BandMember",
        context_name: "Band",
        context_id: "band-1",
        user_id: "admin-1",
        role: "BandAdmin",
        revoked_at: null,
      },
    ]);
    // A non-membership record never produces a row.
    await seedRecord("Gig", record("Gig", "gig-1", { Title: "Show", Band: "band-1" }));
    expect(await membershipRows()).toHaveLength(1);
  });

  it("writes the projection row inside the invite claim transaction", async () => {
    await seedBandWithAdmin("band-1");
    const created = await accessService().createInvite(adminToken, {
      contextName: "Band",
      contextId: "band-1",
      role: "BandMember",
      expiresAt: new Date("2026-08-31T00:00:00.000Z"),
    });
    const claimed = await accessService().claimInvite(claimantToken, created.inviteToken);
    expect(claimed.status).toBe("accepted");

    const rows = await membershipRows();
    expect(rows.map((row) => row.user_id)).toEqual(["admin-1", "claimant-1"]);
    const granted = rows.find((row) => row.user_id === "claimant-1");
    expect(granted).toMatchObject({ context_id: "band-1", role: "BandMember", revoked_at: null });
    expect(granted?.membership_record_id).toMatch(/^membership-/u);
  });

  it("rolls the grant and its projection row back together when the projection write fails", async () => {
    await seedBandWithAdmin("band-1");
    const created = await accessService().createInvite(adminToken, {
      contextName: "Band",
      contextId: "band-1",
      role: "BandMember",
      expiresAt: new Date("2026-08-31T00:00:00.000Z"),
    });
    const faulty = faultyPool(pool, (sql) =>
      sql.startsWith("insert into adl_authority_context_memberships"),
    );

    await expect(
      accessService(faulty).claimInvite(claimantToken, created.inviteToken),
    ).rejects.toThrow("injected infrastructure failure");

    // No membership record, no projection row, and the invite is still claimable.
    expect(
      await count(
        "select count(*)::int n from adl_authority_records where application_id=$1 and object_name='BandMember'",
        [app],
      ),
    ).toBe(1);
    expect(await membershipRows()).toHaveLength(1);
    expect(
      await count(
        "select count(*)::int n from adl_authority_invites where application_id=$1 and claimed_by is null",
        [app],
      ),
    ).toBe(1);
    // The retry succeeds, so the failure left nothing half-applied.
    expect((await accessService().claimInvite(claimantToken, created.inviteToken)).status).toBe(
      "accepted",
    );
  });

  it("marks the projection row revoked with the membership tombstone", async () => {
    await seedBandWithAdmin("band-1");
    await seedRecord(
      "BandMember",
      record("BandMember", "membership-target", {
        User: "member-1",
        Band: "band-1",
        Role: "BandMember",
      }),
    );

    expect(
      await accessService().revokeMembership(adminToken, {
        contextName: "Band",
        contextId: "band-1",
        userId: "member-1",
        role: "BandMember",
      }),
    ).toBe(true);

    const revoked = (await membershipRows()).find(
      (row) => row.membership_record_id === "membership-target",
    );
    // The row is retained and marked, not deleted: membership review reports it.
    expect(revoked?.revoked_at).not.toBeNull();
  });

  it("keeps the projection in step with an ordinary replayed membership write", async () => {
    await seedBandWithAdmin("band-1");
    const created = await authority().replay(adminToken, {
      operationId: "op-create",
      kind: "create",
      objectName: "BandMember",
      recordId: "membership-replayed",
      values: { User: "member-1", Band: "band-1", Role: "BandMember" },
      selectedContexts: { Band: "band-1" },
    });
    expect(created.status).toBe("accepted");
    expect(
      (await membershipRows()).find((row) => row.membership_record_id === "membership-replayed"),
    ).toMatchObject({ user_id: "member-1", context_id: "band-1", role: "BandMember" });

    const revision = created.status === "accepted" ? created.records[0]?.meta.revision : undefined;
    const deleted = await authority().replay(adminToken, {
      operationId: "op-delete",
      kind: "delete",
      objectName: "BandMember",
      recordId: "membership-replayed",
      baseRevision: revision ?? "",
      selectedContexts: { Band: "band-1" },
    });
    expect(deleted.status).toBe("accepted");
    expect(
      (await membershipRows()).find((row) => row.membership_record_id === "membership-replayed")
        ?.revoked_at,
    ).not.toBeNull();
  });

  it("drops the row when a membership record stops being indexable", async () => {
    await seedBandWithAdmin("band-1");
    // A record whose declared role field is empty cannot be indexed, and is one
    // membership resolution already skips.
    await storage().update(
      "BandMember",
      record("BandMember", "membership-admin-band-1", {
        User: "admin-1",
        Band: "band-1",
        Role: "",
      }),
    );
    expect(await membershipRows()).toHaveLength(0);
  });
});

describe("scoped membership reads against real PostgreSQL", () => {
  it("resolves a caller's context from the projection rather than a full scan", async () => {
    await seedBandWithAdmin("band-1");
    await seedRecord("Band", record("Band", "band-2", { Name: "band-2" }));
    await seedRecord(
      "BandMember",
      record("BandMember", "membership-other", {
        User: "member-1",
        Band: "band-2",
        Role: "BandMember",
      }),
    );

    const accepted = await authority().replay(adminToken, {
      operationId: "op-gig",
      kind: "create",
      objectName: "Gig",
      recordId: "gig-1",
      values: { Title: "Show", Band: "band-1" },
      selectedContexts: { Band: "band-1" },
    });
    expect(accepted.status).toBe("accepted");

    // The admin holds no membership in band-2, so selecting it is refused.
    const refused = await authority().replay(adminToken, {
      operationId: "op-gig-other",
      kind: "create",
      objectName: "Gig",
      recordId: "gig-2",
      values: { Title: "Show", Band: "band-2" },
      selectedContexts: { Band: "band-2" },
    });
    expect(refused.status).toBe("rejected");
  });

  it("bounds a membership review to one context and reports revoked memberships", async () => {
    await seedBandWithAdmin("band-1");
    await seedRecord("Band", record("Band", "band-2", { Name: "band-2" }));
    await seedRecord(
      "BandMember",
      record("BandMember", "membership-elsewhere", {
        User: "member-1",
        Band: "band-2",
        Role: "BandMember",
      }),
    );
    await seedRecord(
      "BandMember",
      record("BandMember", "membership-target", {
        User: "member-1",
        Band: "band-1",
        Role: "BandMember",
      }),
    );
    await accessService().revokeMembership(adminToken, {
      contextName: "Band",
      contextId: "band-1",
      userId: "member-1",
      role: "BandMember",
    });

    const review = await administrationService().memberships(adminToken, "Band", "band-1");
    const seen = review.entries as Array<{ membershipRecordId: string; status: string }>;
    expect(seen.map((entry) => entry.membershipRecordId).sort()).toEqual([
      "membership-admin-band-1",
      "membership-target",
    ]);
    expect(seen.find((entry) => entry.membershipRecordId === "membership-target")?.status).toBe(
      "revoked",
    );
  });

  it("refuses a session revocation for a user with no live membership in the context", async () => {
    await seedBandWithAdmin("band-1");
    expect(
      await accessService().revokeUserSessions(adminToken, {
        contextName: "Band",
        contextId: "band-1",
        userId: "member-1",
      }),
    ).toBe(false);
  });
});

describe("membership projection integrity against real PostgreSQL", () => {
  function integrity(): AuthorityProjectionIntegrity {
    return new AuthorityProjectionIntegrity(authorityPool(pool), app, bandModel);
  }

  it("reports a consistent projection and discloses no accepted values", async () => {
    await seedBandWithAdmin("band-1");
    const report = await integrity().verify();
    expect(report.consistent).toBe(true);
    expect(report.counts.contextMemberships).toBe(1);
    expect(report.membershipProjectionMissing).toBe(0);
    expect(report.membershipProjectionOrphaned).toBe(0);
    expect(report.membershipProjectionStale).toBe(0);
    // Metadata only: no user id, context id, role or record id is in the report.
    expect(JSON.stringify(report)).not.toMatch(/admin-1|band-1|BandAdmin|membership-admin/u);
  });

  it("detects an accepted membership record with no projection row", async () => {
    await seedBandWithAdmin("band-1");
    await pool.query("delete from adl_authority_context_memberships where application_id=$1", [
      app,
    ]);
    const report = await integrity().verify();
    expect(report.membershipProjectionMissing).toBe(1);
    expect(report.consistent).toBe(false);
  });

  it("detects a projection row with no backing accepted record", async () => {
    await seedBandWithAdmin("band-1");
    await pool.query(
      "insert into adl_authority_context_memberships (application_id, membership_record_id, object_name, context_name, context_id, user_id, role) values ($1, 'ghost', 'BandMember', 'Band', 'band-1', 'ghost-1', 'BandMember')",
      [app],
    );
    const report = await integrity().verify();
    expect(report.membershipProjectionOrphaned).toBe(1);
    expect(report.consistent).toBe(false);
  });

  it("detects a projection row whose revoked state disagrees with its record", async () => {
    await seedBandWithAdmin("band-1");
    await pool.query(
      "update adl_authority_context_memberships set revoked_at = now() where application_id=$1",
      [app],
    );
    const report = await integrity().verify();
    expect(report.membershipProjectionStale).toBe(1);
    expect(report.consistent).toBe(false);
  });

  it("ignores an accepted membership record that cannot be indexed", async () => {
    await seedBandWithAdmin("band-1");
    await seedRecordWithoutProjection(
      "BandMember",
      record("BandMember", "membership-partial", { User: "member-1", Band: "band-1" }),
    );
    const report = await integrity().verify();
    expect(report.membershipProjectionMissing).toBe(0);
    expect(report.consistent).toBe(true);
  });
});

describe("membership projection startup rebuild against real PostgreSQL", () => {
  const entrypointApp = "membership-entrypoint-app";

  function environment(): Record<string, string> {
    return {
      ADL_ENV: "test",
      ADL_DATABASE_URL: inject("pgUrl"),
      ADL_ALLOWED_ORIGINS: "https://app.test",
      ADL_UPSTREAM_IDENTITY_ISSUER: "https://identity.test",
      ADL_UPSTREAM_IDENTITY_AUDIENCE: "adl-test",
      ADL_APPLICATION_ID: entrypointApp,
      ADL_MODEL_PATH: "src/reference/giggle-band",
      ADL_HOST: "127.0.0.1",
      // The process under test is never told to listen, so this is only a
      // configuration value the entrypoint insists on parsing.
      ADL_PORT: "8099",
    };
  }

  async function entrypointMembershipCount(): Promise<number> {
    return count(
      "select count(*)::int n from adl_authority_context_memberships where application_id=$1",
      [entrypointApp],
    );
  }

  it("backfills a projection that predates its writer, and two processes starting at once do not race", async () => {
    // Register the application row and a membership record with no projection
    // row: exactly the state Phase 47 observed in a real deployment.
    const first = await createAuthorityProcess({ environment: environment() });
    await first.close();
    await seedRecordWithoutProjection(
      "Band",
      record("Band", "band-legacy", { Name: "Legacy" }),
      entrypointApp,
    );
    await seedRecordWithoutProjection(
      "BandMember",
      record("BandMember", "membership-legacy", {
        User: "legacy-1",
        Band: "band-legacy",
        Role: "BandAdmin",
      }),
      entrypointApp,
    );
    expect(await entrypointMembershipCount()).toBe(0);

    // Two processes start simultaneously against the one projection. The
    // advisory lock serialises them, and the rebuild is idempotent, so exactly
    // one row exists afterwards rather than a duplicate or a lost row.
    const [second, third] = await Promise.all([
      createAuthorityProcess({ environment: environment() }),
      createAuthorityProcess({ environment: environment() }),
    ]);
    try {
      expect(await entrypointMembershipCount()).toBe(1);
      const row = await pool.query<{ user_id: string; context_id: string; role: string }>(
        "select user_id, context_id, role from adl_authority_context_memberships where application_id=$1",
        [entrypointApp],
      );
      expect(row.rows[0]).toEqual({
        user_id: "legacy-1",
        context_id: "band-legacy",
        role: "BandAdmin",
      });
    } finally {
      await second.close();
      await third.close();
    }
    // Startup released what it took: nothing is left holding the lock.
    expect(await advisoryLocksHeld()).toBe(0);
  });

  it("blocks a second startup while the startup lock is held elsewhere", async () => {
    const blocker = await pool.connect();
    const lockKey = `adl_authority_startup:${entrypointApp}`;
    let settled = false;
    try {
      await blocker.query("select pg_advisory_lock(hashtext($1))", [lockKey]);
      const pending = createAuthorityProcess({ environment: environment() });
      const observed = pending.then((started) => {
        settled = true;
        return started;
      });

      await new Promise((wait) => setTimeout(wait, 400));
      // Startup cannot get past its migration step while the lock is held.
      expect(settled).toBe(false);

      await blocker.query("select pg_advisory_unlock(hashtext($1))", [lockKey]);
      const started = await observed;
      expect(settled).toBe(true);
      await started.close();
    } finally {
      blocker.release();
    }
  });

  async function advisoryLocksHeld(): Promise<number> {
    return count("select count(*)::int n from pg_locks where locktype = 'advisory'");
  }
});
