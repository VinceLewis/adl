import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { Client, Pool } from "pg";
import {
  AuthorityService,
  InMemoryObjectStorageBackend,
  PostgresAuthorityUnitOfWork,
  StaticSessionAdapter,
  resolveApplicationModel,
} from "../../src/index.js";
import { AUTHORITY_TABLES, MIGRATION_FILES, authorityPool } from "./pg-harness.js";

/**
 * The two-role split, exercised for real.
 *
 * Every other integration test runs as the provisioned superuser, which owns
 * every table — so none of them can see whether `adl_authority` actually holds
 * the DML a deployment gives it. This test provisions the real split described
 * by `docs/operations/authority-production-runbook.md`: `roles.sql` as the
 * database owner, `grants.sql` and the ordered migrations as `adl_migrator`,
 * traffic as `adl_authority`.
 *
 * It needs its own throwaway databases. The shared harness database is owned by
 * the superuser and truncated between tests, and the migrations' `if not
 * exists` guards would leave that ownership unchanged and prove nothing.
 */

const MIGRATIONS_DIR = "src/server/migrations";
const MIGRATOR_PASSWORD = "adl_role_grants_migrator";
const AUTHORITY_PASSWORD = "adl_role_grants_authority";

/** Databases created by this file, dropped in `afterAll`. */
const createdDatabases: string[] = [];

let adminUrl: string;
let admin: Client;

/**
 * Read a deployment SQL file the way `psql` would run it.
 *
 * `roles.sql` and `grants.sql` are psql scripts: they carry `\set` meta-commands
 * and `roles.sql` interpolates a `:"authority_db"` variable. The `pg` driver
 * speaks SQL only, so the meta-command lines are dropped and the variable is
 * substituted with a quoted identifier — exactly what psql does with them. Every
 * SQL statement in the file reaches real PostgreSQL unmodified. `ON_ERROR_STOP`
 * is not needed: a multi-statement simple query aborts at the first error.
 */
function deploymentSql(file: string, variables: Record<string, string> = {}): string {
  const raw = readFileSync(resolve(process.cwd(), MIGRATIONS_DIR, file), "utf8");
  const withoutMetaCommands = raw
    .split("\n")
    .filter((line) => !line.startsWith("\\"))
    .join("\n");
  return Object.entries(variables).reduce(
    (sql, [name, value]) => sql.split(`:"${name}"`).join(quoteIdentifier(value)),
    withoutMetaCommands,
  );
}

function quoteIdentifier(value: string): string {
  return `"${value.split('"').join('""')}"`;
}

function migrationSql(file: string): string {
  return readFileSync(resolve(process.cwd(), MIGRATIONS_DIR, file), "utf8");
}

/** Rewrite the provisioned URL to connect as a different role, to a different database. */
function urlFor(role: string, password: string, database: string): string {
  const url = new URL(adminUrl);
  url.username = role;
  url.password = password;
  url.pathname = `/${database}`;
  return url.toString();
}

function adminUrlFor(database: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

async function runAs(connectionString: string, sql: string): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

/**
 * Fail loudly, naming the missing capability, rather than skipping.
 *
 * A silent skip is how this gap survived nine migrations. If an external
 * `ADL_TEST_DATABASE_URL` names a role that cannot create databases or roles,
 * the answer is to grant the capability, not to soften the test.
 */
async function requireProvisioningCapability(): Promise<void> {
  const { rows } = await admin.query<{
    rolsuper: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
  }>("select rolsuper, rolcreatedb, rolcreaterole from pg_roles where rolname = current_user");
  const role = rows[0];
  if (role === undefined) throw new Error("Could not read the current role from pg_roles.");
  const missing: string[] = [];
  if (!role.rolsuper && !role.rolcreatedb) missing.push("CREATE DATABASE (rolcreatedb)");
  if (!role.rolsuper && !role.rolcreaterole) missing.push("CREATE ROLE (rolcreaterole)");
  if (missing.length > 0) {
    throw new Error(
      `tests/integration/authority-role-grants.test.ts provisions the real two-role split and needs ${missing.join(" and ")}. ` +
        "The Docker-provisioned database has both. If ADL_TEST_DATABASE_URL points at a database whose role does not, " +
        "grant the capability — this test must not be skipped, because the gap it covers is invisible to every other test.",
    );
  }
}

/**
 * Provision one throwaway database following the runbook, with `grants.sql`
 * applied either before or after the ordered migrations. Both orders are
 * supported deliberately: an operator who runs it the other way round must not
 * be silently broken.
 */
async function provision(label: string, grantsOrder: "before" | "after"): Promise<string> {
  const database = `adl_role_grants_${label}_${process.pid}_${Date.now().toString(36)}`;
  await admin.query(`create database ${quoteIdentifier(database)}`);
  createdDatabases.push(database);

  // roles.sql, as the database owner. Roles are cluster-global, so a role left
  // over by an earlier run takes its `duplicate_object` branch and keeps
  // whatever password it had; set both passwords explicitly afterwards, exactly
  // as scripts/dev/postgres.sh does.
  await runAs(adminUrlFor(database), deploymentSql("roles.sql", { authority_db: database }));
  await admin.query(`alter role adl_migrator password '${MIGRATOR_PASSWORD}'`);
  await admin.query(`alter role adl_authority password '${AUTHORITY_PASSWORD}'`);

  const migrator = urlFor("adl_migrator", MIGRATOR_PASSWORD, database);
  const grants = deploymentSql("grants.sql");
  if (grantsOrder === "before") await runAs(migrator, grants);
  for (const file of MIGRATION_FILES) await runAs(migrator, migrationSql(file));
  if (grantsOrder === "after") await runAs(migrator, grants);
  return database;
}

/** The first column of each public table, read over the admin connection. */
async function firstColumnPerTable(database: string): Promise<Map<string, string>> {
  const client = new Client({ connectionString: adminUrlFor(database) });
  await client.connect();
  try {
    const { rows } = await client.query<{ table_name: string; column_name: string }>(
      "select distinct on (table_name) table_name, column_name from information_schema.columns where table_schema = 'public' order by table_name, ordinal_position",
    );
    return new Map(rows.map((row) => [row.table_name, row.column_name]));
  } finally {
    await client.end();
  }
}

/**
 * Every projection table is owned by `adl_migrator`, not by the connecting role.
 * If this ever stops holding, the DML assertions below prove nothing, because a
 * table owner always holds DML over its own table.
 */
async function expectMigratorOwnsEveryTable(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ tablename: string; tableowner: string }>(
    "select tablename, tableowner from pg_tables where schemaname = 'public' order by tablename",
  );
  const owners = new Map(rows.map((row) => [row.tablename, row.tableowner]));
  for (const table of AUTHORITY_TABLES) expect(owners.get(table)).toBe("adl_migrator");
}

/**
 * Real `select`/`insert`/`update`/`delete` statements against every projection
 * table, as `adl_authority`.
 *
 * PostgreSQL checks table privileges at executor start, before any row is
 * touched, so a zero-row form of each statement is a complete privilege proof
 * without needing a legal fixture row for all fourteen tables. Two tables get a
 * real round trip with real values below as well.
 */
async function expectFullDmlOnEveryProjectionTable(pool: Pool, database: string): Promise<void> {
  // Read the column names over the admin connection, not the traffic one:
  // `information_schema.columns` hides columns the querying role holds no
  // privilege on, so asking as `adl_authority` turns a missing grant into an
  // empty catalogue rather than into the `permission denied for table ...` the
  // failure should actually report.
  const columns = await firstColumnPerTable(database);
  for (const table of AUTHORITY_TABLES) {
    const column = columns.get(table);
    expect(column, `${table} should exist with at least one column`).toBeTypeOf("string");
    const quoted = quoteIdentifier(table);
    const quotedColumn = quoteIdentifier(column as string);
    await expect(pool.query(`select * from ${quoted} where false`)).resolves.toBeDefined();
    await expect(
      pool.query(`insert into ${quoted} select * from ${quoted} where false`),
    ).resolves.toBeDefined();
    await expect(
      pool.query(`update ${quoted} set ${quotedColumn} = ${quotedColumn} where false`),
    ).resolves.toBeDefined();
    await expect(pool.query(`delete from ${quoted} where false`)).resolves.toBeDefined();
  }
}

/** A real round trip with real values, on the model row and on the 0008 table. */
async function expectRealRoundTrip(pool: Pool, applicationId: string): Promise<void> {
  await pool.query(
    "insert into adl_authority_models (application_id, model_version, resolved_model) values ($1, '1.0.0', '{}'::jsonb)",
    [applicationId],
  );
  await pool.query(
    "insert into adl_authority_context_memberships (application_id, membership_record_id, object_name, context_name, context_id, user_id, role) values ($1, 'membership-1', 'BandMember', 'Band', 'band-1', 'user-1', 'BandMember')",
    [applicationId],
  );
  const read = await pool.query<{ role: string }>(
    "select role from adl_authority_context_memberships where application_id = $1",
    [applicationId],
  );
  expect(read.rows[0]?.role).toBe("BandMember");
  await pool.query(
    "update adl_authority_context_memberships set role = 'BandAdmin' where application_id = $1",
    [applicationId],
  );
  const updated = await pool.query<{ role: string }>(
    "select role from adl_authority_context_memberships where application_id = $1",
    [applicationId],
  );
  expect(updated.rows[0]?.role).toBe("BandAdmin");
  await pool.query("delete from adl_authority_context_memberships where application_id = $1", [
    applicationId,
  ]);
  await pool.query("delete from adl_authority_models where application_id = $1", [applicationId]);
}

/**
 * `adl_authority` holds DML and nothing else. These refusals are acceptance
 * criteria, not extras: a future "fix" that widens the traffic role fails here.
 */
async function expectDdlAndTruncateRefused(pool: Pool): Promise<void> {
  await expect(pool.query("create table adl_role_grants_forbidden (id text)")).rejects.toThrow(
    /permission denied for schema public/u,
  );
  await expect(pool.query("truncate table adl_authority_records")).rejects.toThrow(
    /permission denied for table adl_authority_records/u,
  );
  await expect(
    pool.query("alter table adl_authority_records add column adl_role_grants_forbidden text"),
  ).rejects.toThrow(/must be owner of table adl_authority_records/u);
}

const noteApp = "role-grants-note-app";
const memberToken = "m".repeat(48);
const noteModel = resolveApplicationModel({
  app: { name: "Role grant notes", startView: "NoteList" },
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
});

beforeAll(async () => {
  adminUrl = inject("pgUrl");
  admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await requireProvisioningCapability();
}, 120_000);

afterAll(async () => {
  for (const database of createdDatabases) {
    await admin.query(`drop database if exists ${quoteIdentifier(database)} with (force)`);
  }
  await admin.end();
});

describe("the deployment's two-role split, provisioned for real", () => {
  describe("grants.sql applied before the ordered migrations", () => {
    let database: string;
    let authority: Pool;
    let migratorUrl: string;

    beforeAll(async () => {
      database = await provision("before", "before");
      migratorUrl = urlFor("adl_migrator", MIGRATOR_PASSWORD, database);
      authority = new Pool({
        connectionString: urlFor("adl_authority", AUTHORITY_PASSWORD, database),
        max: 4,
      });
    }, 120_000);

    afterAll(async () => {
      await authority.end();
    });

    it("leaves every projection table owned by adl_migrator, not the traffic role", async () => {
      await expectMigratorOwnsEveryTable(authority);
    });

    it("gives adl_authority select, insert, update and delete on every projection table", async () => {
      await expectFullDmlOnEveryProjectionTable(authority, database);
    });

    it("round-trips real rows, including the table 0008 drops and re-creates", async () => {
      await expectRealRoundTrip(authority, `${noteApp}-round-trip`);
    });

    it("covers a table adl_migrator creates after grants.sql ran", async () => {
      // The default-privileges half of grants.sql, and only that half, can
      // satisfy this: the catch-up grant ran before this table existed. It is
      // the same mechanism that carries a future migration's new table, and
      // that re-grants adl_authority_context_memberships when 0008 re-creates it.
      await runAs(migratorUrl, "create table adl_role_grants_later (id text primary key)");
      await authority.query("insert into adl_role_grants_later (id) values ('x')");
      const read = await authority.query<{ id: string }>("select id from adl_role_grants_later");
      expect(read.rows[0]?.id).toBe("x");
      await authority.query("update adl_role_grants_later set id = 'y'");
      await authority.query("delete from adl_role_grants_later");
    });

    it("refuses adl_authority create table, truncate and alter table", async () => {
      await expectDdlAndTruncateRefused(authority);
    });

    it("accepts a real AuthorityService write over the adl_authority connection", async () => {
      // Hand-written SQL proves the grant. Only the real server path proves the
      // grant is sufficient for what the server actually does — the unit of work
      // writes the record, the runtime audit and the outcome in one transaction.
      const pool = authorityPool(authority);
      await authority.query(
        "insert into adl_authority_models (application_id, model_version, resolved_model) values ($1, $2, '{}'::jsonb) on conflict (application_id) do nothing",
        [noteApp, noteModel.modelVersion],
      );
      const service = new AuthorityService(
        noteModel,
        new InMemoryObjectStorageBackend(),
        new StaticSessionAdapter(new Map([[memberToken, { userId: "member-1" }]])),
        { unitOfWork: new PostgresAuthorityUnitOfWork(pool, noteApp, noteModel) },
      );
      const outcome = await service.replay(memberToken, {
        operationId: "role-grants-op-1",
        kind: "create",
        objectName: "Note",
        recordId: "note-role-grants",
        values: { Title: "Written as adl_authority" },
      });
      expect(outcome.status).toBe("accepted");
      const records = await authority.query<{ n: string }>(
        "select count(*)::int n from adl_authority_records where application_id = $1",
        [noteApp],
      );
      expect(Number(records.rows[0]?.n)).toBe(1);
      const outcomes = await authority.query<{ n: string }>(
        "select count(*)::int n from adl_authority_operation_outcomes where application_id = $1",
        [noteApp],
      );
      expect(Number(outcomes.rows[0]?.n)).toBe(1);
    });
  });

  describe("grants.sql applied after the ordered migrations", () => {
    // The repair path for a deployment whose tables already exist. Here the
    // catch-up grant is the load-bearing half.
    let database: string;
    let authority: Pool;
    let migratorUrl: string;

    beforeAll(async () => {
      database = await provision("after", "after");
      migratorUrl = urlFor("adl_migrator", MIGRATOR_PASSWORD, database);
      authority = new Pool({
        connectionString: urlFor("adl_authority", AUTHORITY_PASSWORD, database),
        max: 4,
      });
    }, 120_000);

    afterAll(async () => {
      await authority.end();
    });

    it("leaves every projection table owned by adl_migrator, not the traffic role", async () => {
      await expectMigratorOwnsEveryTable(authority);
    });

    it("gives adl_authority select, insert, update and delete on every projection table", async () => {
      await expectFullDmlOnEveryProjectionTable(authority, database);
    });

    it("round-trips real rows, including the table 0008 drops and re-creates", async () => {
      await expectRealRoundTrip(authority, `${noteApp}-round-trip-after`);
    });

    it("still covers a table adl_migrator creates afterwards", async () => {
      await runAs(migratorUrl, "create table adl_role_grants_later_after (id text primary key)");
      await authority.query("insert into adl_role_grants_later_after (id) values ('x')");
      const read = await authority.query<{ id: string }>(
        "select id from adl_role_grants_later_after",
      );
      expect(read.rows[0]?.id).toBe("x");
      await authority.query("delete from adl_role_grants_later_after");
    });

    it("refuses adl_authority create table, truncate and alter table", async () => {
      await expectDdlAndTruncateRefused(authority);
    });
  });
});
