import { Pool } from "pg";
import { AuthorityConfigurationError } from "./authority-config.js";
import {
  AuthorityRetentionRunner,
  PostgresAuthorityRetentionRunStore,
  loadAuthorityRetentionConfiguration,
  retentionPolicy,
  type AuthorityRetentionProcessConfiguration,
  type AuthorityRetentionRunRecord,
} from "./authority-retention-runner.js";
import type { PostgresPool } from "./authority-unit-of-work.js";
import type { PostgresQueryable } from "./postgres-authority-store.js";
import { AuthorityMetrics, StructuredSecurityLogger } from "./security-operations.js";

/**
 * The one-shot retention entry point: the schedulable process this phase gives
 * an operator, for `cron`, a Kubernetes `CronJob`, a systemd timer, or a hand
 * run during an incident.
 *
 * It deliberately reads a *small* environment — a database URL, an application
 * id, and the retention windows — rather than the whole authority configuration.
 * A retention job needs no allowed origins, no identity verifier, no relying
 * party and no cookie policy, and requiring them would make the safest way to
 * run retention the most awkward one to configure.
 *
 * It is safe to run while the authority is serving traffic, and safe to run
 * concurrently with an in-process schedule: both take the same per-application
 * advisory lock, so the second waits rather than double-deleting.
 */
export interface AuthorityRetentionProcessOptions {
  environment?: Record<string, string | undefined>;
  /** Report what would be pruned and delete nothing. */
  dryRun?: boolean;
  /** Injected for tests; production opens a pool from `ADL_DATABASE_URL`. */
  pool?: PostgresPool & PostgresQueryable;
}

export interface AuthorityRetentionTargetConfiguration {
  applicationId: string;
  databaseUrl: string;
  retention: AuthorityRetentionProcessConfiguration;
}

export function loadRetentionProcessConfiguration(
  environment: Record<string, string | undefined>,
): AuthorityRetentionTargetConfiguration {
  const applicationId = environment.ADL_APPLICATION_ID?.trim();
  if (applicationId === undefined || applicationId.length === 0)
    throw new AuthorityConfigurationError("ADL_APPLICATION_ID is required.");
  // The same shape check the authority process applies: this id is the key every
  // projection row hangs off, and real PostgreSQL rejects control characters in it.
  if (applicationId.length > 200 || /[\u0000-\u001f\u007f]/u.test(applicationId))
    throw new AuthorityConfigurationError("ADL_APPLICATION_ID is invalid.");
  const databaseUrl = environment.ADL_DATABASE_URL?.trim();
  if (databaseUrl === undefined || databaseUrl.length === 0)
    throw new AuthorityConfigurationError("ADL_DATABASE_URL is required.");
  if (!databaseUrl.startsWith("postgresql://") && !databaseUrl.startsWith("postgres://"))
    throw new AuthorityConfigurationError("ADL_DATABASE_URL must be a PostgreSQL URL.");
  return {
    applicationId,
    databaseUrl,
    retention: loadAuthorityRetentionConfiguration(environment),
  };
}

/**
 * Composes and runs retention exactly once, returning the metadata-only record
 * of what happened. The record is also written to the run log and to the
 * structured security log by the runner itself, so a scheduled invocation leaves
 * evidence whether or not anything reads the return value.
 */
export async function runAuthorityRetentionOnce(
  options: AuthorityRetentionProcessOptions = {},
): Promise<AuthorityRetentionRunRecord> {
  const environment = options.environment ?? process.env;
  const configuration = loadRetentionProcessConfiguration(environment);
  const owned = options.pool === undefined;
  const pool = options.pool ?? poolFor(configuration.databaseUrl);
  try {
    const runner = new AuthorityRetentionRunner(pool, configuration.applicationId, {
      policy: retentionPolicy(configuration.retention),
      runs: new PostgresAuthorityRetentionRunStore(pool, configuration.applicationId),
      logger: new StructuredSecurityLogger(),
      metrics: new AuthorityMetrics(),
    });
    return await runner.run({ ...(options.dryRun === true ? { dryRun: true } : {}) });
  } finally {
    if (owned) await (pool as unknown as Pool).end().catch(() => undefined);
  }
}

function poolFor(connectionString: string): PostgresPool & PostgresQueryable {
  // A real `pg.Pool` structurally satisfies the ADL pool/queryable contracts;
  // this cast documents that without coupling ADL's types to the pg package.
  return new Pool({ connectionString }) as unknown as PostgresPool & PostgresQueryable;
}
