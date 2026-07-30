import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Client, Pool } from "pg";
import type { PostgresPool, PostgresPoolClient, PostgresQueryable } from "../../src/index.js";

/** Applied in order. `roles.sql` is deployment-only and intentionally skipped. */
export const MIGRATION_FILES = [
  "0001_authority_projection.sql",
  "0002_security_operations.sql",
  "0003_reporting_administration.sql",
  "0004_authority_transaction_integrity.sql",
  "0005_authority_audit_scope_and_retention.sql",
  "0006_passkey_identity.sql",
];

/** Every projection table the integration tests read, write, or reset. */
export const AUTHORITY_TABLES = [
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

/** Apply the real migrations once. Idempotent: skips if already migrated. */
export async function applyMigrations(client: Client): Promise<void> {
  const already = await client.query(
    "select 1 from pg_indexes where indexname = 'adl_authority_identity_links_user_idx'",
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
