import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Client, Pool } from "pg";
import type { PostgresPool, PostgresPoolClient, PostgresQueryable } from "../../src/index.js";

/**
 * Applied in order.
 *
 * `roles.sql` and `grants.sql` are deployment-only and deliberately not in this
 * list: the shared harness database is owned by the provisioned superuser and
 * has no `adl_authority` role, so `grants.sql` would fail on it. The two-role
 * split those two files provision is exercised by
 * `tests/integration/authority-role-grants.test.ts`, which brings its own
 * throwaway database precisely so this shared one is untouched.
 */
export const MIGRATION_FILES = [
  "0001_authority_projection.sql",
  "0002_security_operations.sql",
  "0003_reporting_administration.sql",
  "0004_authority_transaction_integrity.sql",
  "0005_authority_audit_scope_and_retention.sql",
  "0006_passkey_identity.sql",
  "0007_model_fingerprint.sql",
  "0008_membership_projection.sql",
  "0009_retention_scheduling.sql",
];

/** Every projection table the integration tests read, write, or reset. */
export const AUTHORITY_TABLES = [
  "adl_authority_retention_runs",
  "adl_authority_administration_audit_events",
  "adl_authority_access_audit_events",
  "adl_authority_invites",
  "adl_authority_sessions",
  "adl_authority_webauthn_challenges",
  "adl_authority_webauthn_credentials",
  "adl_authority_identity_links",
  "adl_authority_identities",
  "adl_authority_audit_events",
  "adl_authority_operation_outcomes",
  "adl_authority_context_memberships",
  "adl_authority_records",
  "adl_authority_models",
];

/**
 * Apply the real migrations once. Idempotent: skips if already migrated.
 *
 * The skip test must key off the **newest** migration, not a convenient index
 * from some older one. Keying it on an artefact of `0006` meant that a reused
 * `ADL_TEST_DATABASE_URL` database already at `0006` skipped every file, so
 * `0007` could never be applied there — the list being correct would not have
 * saved it.
 */
export async function applyMigrations(client: Client): Promise<void> {
  const already = await client.query(
    "select 1 from information_schema.columns where table_name = 'adl_authority_retention_runs' and column_name = 'pruned_sessions'",
  );
  if ((already.rowCount ?? 0) > 0) return;
  for (const file of MIGRATION_FILES) {
    const sql = readFileSync(resolve(process.cwd(), "src/server/migrations", file), "utf8");
    await client.query(sql);
  }
}

/** Clear every projection between tests so each test starts from a clean slate. */
export async function resetProjections(pool: Pool): Promise<void> {
  await pool.query(`truncate table ${AUTHORITY_TABLES.join(", ")} restart identity cascade`);
}

/** Seed the required application metadata row (records reference it via FK). */
export async function seedApplication(
  pool: Pool,
  applicationId: string,
  modelVersion: string,
): Promise<void> {
  await pool.query(
    "insert into adl_authority_models (application_id, model_version, resolved_model) values ($1, $2, $3::jsonb) on conflict (application_id) do update set model_version = excluded.model_version",
    [applicationId, modelVersion, JSON.stringify({ modelVersion })],
  );
}

/**
 * A real `pg.Pool` structurally satisfies the ADL authority pool/queryable
 * contracts; this cast documents that at the call sites.
 */
export function authorityPool(pool: Pool): PostgresPool & PostgresQueryable {
  return pool as unknown as PostgresPool & PostgresQueryable;
}

/**
 * Wrap a pool so a chosen statement throws after the transaction is underway,
 * simulating an infrastructure fault so we can assert real PostgreSQL rollback.
 */
export function faultyPool(
  pool: Pool,
  shouldFail: (sql: string) => boolean,
): PostgresPool & PostgresQueryable {
  const real = authorityPool(pool);
  const guard = (sql: string): void => {
    if (shouldFail(normalise(sql))) throw new Error("injected infrastructure failure");
  };
  const wrapClient = (client: PostgresPoolClient): PostgresPoolClient =>
    ({
      query: (sql: string, values?: unknown[]) => {
        guard(sql);
        return client.query(sql, values);
      },
      release: () => client.release(),
    }) as PostgresPoolClient;
  return {
    // Direct-statement stores (object storage, access store) use `.query`; the
    // unit-of-work uses `connect()`. Inject on both so either path can fault.
    query: (sql: string, values?: unknown[]) => {
      guard(sql);
      return real.query(sql, values);
    },
    connect: async () => wrapClient(await real.connect()),
  } as PostgresPool & PostgresQueryable;
}

function normalise(sql: string): string {
  return sql.replace(/\s+/gu, " ").trim().toLowerCase();
}
