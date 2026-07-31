import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve as resolvePath } from "node:path";
import { Pool } from "pg";
import { compileAdlProject, parseAdlProjectManifest } from "../compiler/compile-adl-project.js";
import { resolveApplicationModel } from "../compiler/resolve-model.js";
import type { ResolvedApplicationModel } from "../model/resolved-model.js";
import { RuntimeStartupError, noopRuntimeLogger } from "../runtime/runtime-types.js";
import { runRuntimeStartupCompatibilityChecks } from "../runtime/startup-compatibility.js";
import {
  AuthorityAccessLifecycleService,
  PostgresAuthorityAccessStore,
} from "./access-lifecycle.js";
import {
  AuthorityAdministrationService,
  AuthorityReportingService,
  PostgresAuthorityAdministrationStore,
  type AuthorityRetentionRunSummary,
} from "./authoritative-reporting.js";
import {
  AuthorityConfigurationError,
  loadAuthorityConfiguration,
  resolveSessionLifetime,
  type AuthorityConfiguration,
} from "./authority-config.js";
import {
  ContextMembershipDescriptors,
  ContextMembershipProjectionWriter,
  PostgresContextMembershipIndex,
} from "./authority-membership-projection.js";
import { createAuthorityNodeServer } from "./authority-node.js";
import {
  AuthorityRetentionRunner,
  AuthorityRetentionScheduler,
  PostgresAuthorityRetentionRunStore,
  loadAuthorityRetentionConfiguration,
  retentionPolicy,
} from "./authority-retention-runner.js";
import { AuthorityProjectionIntegrity } from "./authority-projection-integrity.js";
import { AuthorityService } from "./authority-service.js";
import { PostgresAuthorityUnitOfWork, type PostgresPool } from "./authority-unit-of-work.js";
import {
  describeIdentityVerification,
  selectUpstreamIdentityVerifier,
  type AuthorityIdentityVerificationStatus,
  type UpstreamIdentityVerifier,
} from "./identity-verification.js";
import {
  OpaqueSessionAdapter,
  PostgresAuthorityIdentitySessionStore,
} from "./opaque-session-adapter.js";
import type { PostgresQueryable } from "./postgres-authority-store.js";
import { PostgresObjectStorageBackend } from "./postgres-object-storage.js";
import { AuthorityMetrics, StructuredSecurityLogger } from "./security-operations.js";
import { SimpleWebAuthnLibrary } from "./simplewebauthn-adapter.js";
import { PasskeyIdentityService, PostgresWebAuthnCredentialStore } from "./webauthn-identity.js";

/** Process placement, not deployment policy: `AuthorityConfiguration` still owns the latter. */
export interface AuthorityProcessConfiguration {
  host: string;
  port: number;
  applicationId: string;
  modelPath: string;
}

export interface AuthorityProcessOptions {
  environment?: Record<string, string | undefined>;
  /** Real provider verifier, used only when `ADL_IDENTITY_VERIFICATION=upstream`. */
  upstreamIdentityVerifier?: UpstreamIdentityVerifier;
}

export interface AuthorityProcess {
  server: Server;
  configuration: AuthorityConfiguration;
  process: AuthorityProcessConfiguration;
  identityVerification: AuthorityIdentityVerificationStatus;
  model: ResolvedApplicationModel;
  listen(): Promise<{ host: string; port: number }>;
  close(): Promise<void>;
}

const READINESS_TIMEOUT_MS = 2_000;

export function loadAuthorityProcessConfiguration(
  environment: Record<string, string | undefined>,
): AuthorityProcessConfiguration {
  const applicationId = environment.ADL_APPLICATION_ID?.trim();
  if (applicationId === undefined || applicationId.length === 0)
    throw new AuthorityConfigurationError("ADL_APPLICATION_ID is required.");
  // Real PostgreSQL rejects NUL in a text key, and this id is the foreign key
  // every projection row hangs off; reject control characters before startup.
  if (applicationId.length > 200 || /[\u0000-\u001f\u007f]/u.test(applicationId))
    throw new AuthorityConfigurationError("ADL_APPLICATION_ID is invalid.");
  return {
    host: nonEmpty(environment.ADL_HOST) ?? "127.0.0.1",
    port: port(environment.ADL_PORT),
    applicationId,
    modelPath: nonEmpty(environment.ADL_MODEL_PATH) ?? "src/reference/giggle-band",
  };
}

/**
 * Reads an ADL project from disk. The browser build imports the same sources
 * through Vite `?raw` assets; the server process must not, so it reads them
 * with `node:fs` and keeps the browser-only module out of its dependency graph.
 */
export function loadAuthorityModel(modelPath: string): ResolvedApplicationModel {
  const directory = resolvePath(modelPath);
  const manifestSource = read(join(directory, "app.yaml"), modelPath);
  const manifest = parseAdlProjectManifest(manifestSource);
  const sources = Object.fromEntries(
    manifest.sources.map((source) => [source, read(join(directory, source), modelPath)]),
  );
  const compiled = compileAdlProject({ manifestSource, sources });
  const errors = compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length > 0)
    throw new AuthorityConfigurationError(
      `The ADL model at '${modelPath}' has ${errors.length} error diagnostic(s): ${errors
        .map((diagnostic) => `${diagnostic.code} ${diagnostic.message}`)
        .join("; ")}`,
    );
  return resolveApplicationModel(compiled.partialModel);
}

/**
 * Composition root. Every store is the PostgreSQL implementation: the in-memory
 * ones are test wiring and must never serve a process. Projection *schema*
 * migrations are applied out of band with the migration role; what this function
 * does is bring the accepted *records* to the model it is about to serve, and
 * refuse to start if it cannot.
 */
export async function createAuthorityProcess(
  options: AuthorityProcessOptions = {},
): Promise<AuthorityProcess> {
  const environment = options.environment ?? process.env;
  const processConfiguration = loadAuthorityProcessConfiguration(environment);
  const { applicationId } = processConfiguration;
  const model = loadAuthorityModel(processConfiguration.modelPath);
  // The session must be able to span the grace the model declares, so the
  // deployment configuration is reconciled with the model before anything that
  // issues or reads a session is composed.
  const configuration = resolveSessionLifetime(loadAuthorityConfiguration(environment), model);

  const pool = new Pool({ connectionString: configuration.databaseUrl });
  // A real `pg.Pool` structurally satisfies the ADL pool/queryable contracts;
  // this cast documents that without coupling ADL's types to the pg package.
  const database = pool as unknown as PostgresPool & PostgresQueryable;

  const sessions = new OpaqueSessionAdapter(
    new PostgresAuthorityIdentitySessionStore(database, applicationId),
    { sessionTtlMs: configuration.sessionTtlMinutes * 60_000 },
  );
  // Non-ambient: these accepted-state reads run outside the unit-of-work, which
  // opens its own pinned client and owns the begin/commit boundary itself.
  const storage = new PostgresObjectStorageBackend(database, applicationId, model);
  // One scope-indexed read model over membership records, shared by everything
  // that resolves a context or reviews memberships. It narrows candidates; the
  // runtime read and policy remain the disclosure boundary at every call site.
  const membershipIndex = new PostgresContextMembershipIndex(database, applicationId);
  const authority = new AuthorityService(model, storage, sessions, {
    unitOfWork: new PostgresAuthorityUnitOfWork(database, applicationId, model),
    membershipIndex,
  });
  const accessLifecycle = new AuthorityAccessLifecycleService(
    model,
    storage,
    sessions,
    new PostgresAuthorityAccessStore(database, applicationId, model),
    { membershipIndex },
  );
  const administrationStore = new PostgresAuthorityAdministrationStore(database, applicationId);
  const reporting = new AuthorityReportingService(model, storage, sessions, administrationStore);
  const integrity = new AuthorityProjectionIntegrity(database, applicationId, model);
  /*
   * Retention is composed here but is never reachable from the HTTP edge. The
   * runner is what the in-process schedule and the one-shot entry both drive,
   * and the administration surface is given a *read* of its run log — so an
   * operator can see that retention is configured and what it last did, without
   * anyone gaining the ability to start a deployment-wide delete from a
   * context-scoped session.
   */
  const retentionConfiguration = loadAuthorityRetentionConfiguration(environment);
  const retentionRuns = new PostgresAuthorityRetentionRunStore(database, applicationId);
  /*
   * One metrics registry and one logger for the whole process, shared with the
   * HTTP edge below. Letting each half default to its own instance is why the
   * retention counters would never have been scraped: `/metrics` is served by
   * the edge, and a runner counting into a registry nobody serves is a counter
   * that does not exist. The one-shot entry point has no endpoint to serve at
   * all, which is what the run log and the structured events are for.
   */
  const metrics = new AuthorityMetrics();
  const logger = new StructuredSecurityLogger();
  const retention = new AuthorityRetentionRunner(database, applicationId, {
    policy: retentionPolicy(retentionConfiguration),
    runs: retentionRuns,
    metrics,
    logger,
  });
  const administration = new AuthorityAdministrationService(
    model,
    storage,
    accessLifecycle,
    administrationStore,
    administrationStore,
    // Without this the recovery view would answer from a stub rather than the
    // real restore-verification counts.
    () => integrity.recoveryStatus(),
    () => new Date(),
    membershipIndex,
    async () => ({
      scheduled: retentionConfiguration.intervalMinutes !== undefined,
      ...(retentionConfiguration.intervalMinutes === undefined
        ? {}
        : { intervalMinutes: retentionConfiguration.intervalMinutes }),
      legalHold: retentionConfiguration.legalHold,
      minimumRetentionDays: retentionConfiguration.minimumRetentionDays,
      sessionRetentionDays: retentionConfiguration.sessionRetentionDays,
      challengeRetentionDays: retentionConfiguration.challengeRetentionDays,
      ...(await retentionSummary(retention)),
    }),
  );
  const identityVerifier = selectUpstreamIdentityVerifier(
    configuration,
    options.upstreamIdentityVerifier === undefined
      ? {}
      : { upstream: options.upstreamIdentityVerifier },
  );
  const identityVerification = describeIdentityVerification(configuration, identityVerifier);
  // Composed only in `passkey` mode, and only here: this is the single place
  // that binds the WebAuthn implementation to the process, so nothing else in
  // the repository depends on `@simplewebauthn/server`.
  const passkeys =
    configuration.webauthn === undefined
      ? undefined
      : new PasskeyIdentityService(
          configuration.webauthn,
          sessions,
          new PostgresWebAuthnCredentialStore(database, applicationId),
          new SimpleWebAuthnLibrary(),
          { accessLifecycle },
        );

  try {
    await migrateAcceptedState(pool, applicationId, model);
  } catch (error) {
    await pool.end().catch(() => undefined);
    if (error instanceof AuthorityConfigurationError) throw error;
    // The driver's message can name infrastructure; keep only its error name so
    // no connection string, credential or protected value can escape here.
    throw new AuthorityConfigurationError(
      `Could not record the application model row in PostgreSQL (${faultCode(error)}). Apply the migrations out of band first.`,
    );
  }

  const server = createAuthorityNodeServer({
    configuration,
    authority,
    sessions,
    identityVerifier,
    ...(passkeys === undefined ? {} : { passkeys }),
    accessLifecycle,
    reporting,
    administration,
    metrics,
    logger,
    clientKey,
    readiness: async () => {
      try {
        await withTimeout(database.query("select 1"), READINESS_TIMEOUT_MS);
      } catch {
        return { ready: false, reason: "database_unavailable" };
      }
      try {
        const metadata = await withTimeout(storage.readApplicationMetadata(), READINESS_TIMEOUT_MS);
        if (metadata === null) return { ready: false, reason: "application_model_missing" };
      } catch {
        return { ready: false, reason: "application_model_unreadable" };
      }
      return { ready: true };
    },
  });

  /*
   * The in-process schedule is opt-in. With no `ADL_RETENTION_INTERVAL_MINUTES`
   * this process prunes nothing and the operator drives retention from the
   * one-shot entry point instead; with one, both remain safe together because
   * every run takes the same per-application advisory lock. The first tick is
   * one interval away rather than at startup, so a restart loop cannot turn into
   * a prune loop.
   */
  const scheduler =
    retentionConfiguration.intervalMinutes === undefined
      ? undefined
      : new AuthorityRetentionScheduler(retention, retentionConfiguration.intervalMinutes * 60_000);
  scheduler?.start();

  return {
    server,
    configuration,
    process: processConfiguration,
    identityVerification,
    model,
    listen: () =>
      new Promise((settle, fail) => {
        const onError = (error: Error): void => {
          server.off("listening", onListening);
          fail(error);
        };
        const onListening = (): void => {
          server.off("error", onError);
          const address = server.address() as AddressInfo | null;
          settle({
            host: address?.address ?? processConfiguration.host,
            port: address?.port ?? processConfiguration.port,
          });
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(processConfiguration.port, processConfiguration.host);
      }),
    close: async () => {
      scheduler?.stop();
      await new Promise<void>((settle) => server.close(() => settle()));
      await pool.end();
    },
  };
}

/**
 * The last recorded run, shaped for the status surface. A read failure is not
 * allowed to break the whole status view: an operator asking "is retention
 * configured?" must still get their answer when the run log cannot be read.
 */
async function retentionSummary(
  retention: AuthorityRetentionRunner,
): Promise<{ lastRun?: AuthorityRetentionRunSummary }> {
  let latest: Awaited<ReturnType<AuthorityRetentionRunner["latest"]>> = null;
  try {
    latest = await retention.latest();
  } catch {
    return {};
  }
  if (latest === null) return {};
  const { applicationId: _applicationId, ...summary } = latest;
  return { lastRun: summary };
}

/**
 * Starts the composed process and states the identity boundary exactly once, so
 * a bypassed deployment is visible in the log as well as on `/readyz`. No proof,
 * token, cookie or connection string is ever part of that line.
 */
export async function startAuthorityProcess(
  options: AuthorityProcessOptions = {},
): Promise<AuthorityProcess> {
  const authorityProcess = await createAuthorityProcess(options);
  const address = await authorityProcess.listen();
  new StructuredSecurityLogger().write({
    event: "authority_started",
    outcome: "allowed",
    host: address.host,
    port: address.port,
    applicationId: authorityProcess.process.applicationId,
    modelVersion: authorityProcess.model.modelVersion,
    identityMode: authorityProcess.identityVerification.mode,
    identityVerifier: authorityProcess.identityVerification.verifier,
    identityBypassed: authorityProcess.identityVerification.bypassed,
    occurredAt: new Date().toISOString(),
  });
  const shutdown = (): void => {
    void authorityProcess.close().catch(() => undefined);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return authorityProcess;
}

/**
 * Brings the accepted-record projection to the model this process is running,
 * before anything that could serve it is composed.
 *
 * The authority refuses to start rather than serving state it cannot read. That
 * is the whole point: a process that starts anyway would answer bootstraps from
 * records shaped for a different model, and every device that pulled them would
 * persist the damage locally. Nothing here deletes a record — an unappliable
 * migration leaves the projection exactly as it was, for an operator to fix by
 * deploying a model that declares the missing hop.
 *
 * The work runs on one pinned client, not the pool: `commitTransaction` issues
 * its own `begin`/`commit`, and on an unpinned pool those could land on
 * different connections and lose atomicity entirely.
 *
 * It also holds a session-level advisory lock for the whole of startup, so two
 * authority processes starting at once against one projection cannot both plan
 * and apply the same hop, and cannot rebuild the membership projection over each
 * other. Each individual commit was already atomic, so this closes a robustness
 * gap rather than a demonstrated corruption; the second process simply waits and
 * then finds the work already done.
 */
async function migrateAcceptedState(
  pool: Pool,
  applicationId: string,
  model: ResolvedApplicationModel,
): Promise<void> {
  const client = await pool.connect();
  let locked = false;
  try {
    // hashtext gives a stable per-application key, so unrelated applications
    // sharing one database never serialise against each other.
    await client.query("select pg_advisory_lock(hashtext($1))", [
      `adl_authority_startup:${applicationId}`,
    ]);
    locked = true;
    const queryable = client as unknown as PostgresQueryable;
    const storage = new PostgresObjectStorageBackend(queryable, applicationId, model);
    const diagnostics = await runRuntimeStartupCompatibilityChecks(
      model,
      storage,
      noopRuntimeLogger,
      { applyMigrations: true },
    );
    // Rebuild the derived membership projection from the accepted records this
    // process is about to serve. It brings up a projection written before it had
    // a writer, one left behind by an out-of-band restore, and one whose records
    // a migration hop just rewrote. It is idempotent and derives everything from
    // accepted records, so it can neither invent nor drop a membership.
    await rebuildMembershipProjection(queryable, applicationId, model);
    for (const diagnostic of diagnostics) {
      // Metadata only: a code, a message about versions, and counts. No
      // accepted record, audit payload, token or outcome body is ever in here.
      new StructuredSecurityLogger().write({
        event: "authority_model_migration",
        outcome: diagnostic.severity === "error" ? "denied" : "allowed",
        applicationId,
        modelVersion: model.modelVersion,
        diagnosticCode: diagnostic.code,
        diagnosticMessage: diagnostic.message,
        occurredAt: new Date().toISOString(),
      });
    }
  } catch (error) {
    if (error instanceof RuntimeStartupError) {
      throw new AuthorityConfigurationError(
        `The accepted-record projection is not compatible with this model and was left unchanged: ${error.diagnostics
          .filter((diagnostic) => diagnostic.severity === "error")
          .map((diagnostic) => `${diagnostic.code} ${diagnostic.message}`)
          .join("; ")}`,
      );
    }
    throw error;
  } finally {
    // Releasing an unlocked session-level lock logs a PostgreSQL warning, so
    // only unlock what was actually taken. A crashed process releases it when
    // its backend ends, so the lock can never be held by nobody.
    if (locked)
      await client
        .query("select pg_advisory_unlock(hashtext($1))", [
          `adl_authority_startup:${applicationId}`,
        ])
        .catch(() => undefined);
    client.release();
  }
}

/** Rebuild the membership projection for one application in a single transaction. */
async function rebuildMembershipProjection(
  database: PostgresQueryable,
  applicationId: string,
  model: ResolvedApplicationModel,
): Promise<void> {
  const descriptors = new ContextMembershipDescriptors(model);
  if (descriptors.empty) return;
  const writer = new ContextMembershipProjectionWriter(database, applicationId, descriptors);
  await database.query("begin");
  try {
    await writer.rebuild();
    await database.query("commit");
  } catch (error) {
    await database.query("rollback").catch(() => undefined);
    throw error;
  }
}

/**
 * Rate-limit bucket key. The Node adapter hands the handler a web `Request`, so
 * only the forwarded chain is visible; behind the trusted HTTPS proxy that
 * terminates TLS the first hop is the client. Without a proxy every caller
 * shares one bucket, which limits more strictly rather than less.
 */
function clientKey(request: Request): string {
  const firstHop = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return firstHop !== undefined && firstHop.length > 0 && firstHop.length <= 64
    ? firstHop
    : "unknown-client";
}

function read(file: string, modelPath: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    throw new AuthorityConfigurationError(
      `The ADL model at '${modelPath}' is missing a source file it declares.`,
    );
  }
}
function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}
function port(value: string | undefined): number {
  const declared = nonEmpty(value);
  if (declared === undefined) return 8787;
  const parsed = Number(declared);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535)
    throw new AuthorityConfigurationError("ADL_PORT must be a port number between 1 and 65535.");
  return parsed;
}
/**
 * A driver fault reduced to its name and, when the driver supplies one, its
 * short symbolic code (`ECONNREFUSED`, `42P01`, ...). The driver's own message
 * is deliberately dropped: it can name hosts, roles and statement text.
 */
function faultCode(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  const code: unknown = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Za-z0-9_]{1,32}$/u.test(code)
    ? `${error.name} ${code}`
    : error.name;
}
async function withTimeout<T>(work: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, fail) => {
        timer = setTimeout(() => fail(new Error("readiness probe timed out")), milliseconds);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
