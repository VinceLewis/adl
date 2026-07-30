import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve as resolvePath } from "node:path";
import { Pool } from "pg";
import { compileAdlProject, parseAdlProjectManifest } from "../compiler/compile-adl-project.js";
import { resolveApplicationModel } from "../compiler/resolve-model.js";
import type { ResolvedApplicationModel } from "../model/resolved-model.js";
import {
  AuthorityAccessLifecycleService,
  PostgresAuthorityAccessStore,
} from "./access-lifecycle.js";
import {
  AuthorityAdministrationService,
  AuthorityReportingService,
  PostgresAuthorityAdministrationStore,
} from "./authoritative-reporting.js";
import {
  AuthorityConfigurationError,
  loadAuthorityConfiguration,
  resolveSessionLifetime,
  type AuthorityConfiguration,
} from "./authority-config.js";
import { createAuthorityNodeServer } from "./authority-node.js";
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
import { StructuredSecurityLogger } from "./security-operations.js";
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
 * ones are test wiring and must never serve a process. Migrations are applied
 * out of band with the migration role, so this function only upserts the
 * application metadata row that accepted records reference by foreign key.
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
  const authority = new AuthorityService(model, storage, sessions, {
    unitOfWork: new PostgresAuthorityUnitOfWork(database, applicationId, model),
  });
  const accessLifecycle = new AuthorityAccessLifecycleService(
    model,
    storage,
    sessions,
    new PostgresAuthorityAccessStore(database, applicationId),
  );
  const administrationStore = new PostgresAuthorityAdministrationStore(database, applicationId);
  const reporting = new AuthorityReportingService(model, storage, sessions, administrationStore);
  const integrity = new AuthorityProjectionIntegrity(database, applicationId);
  const administration = new AuthorityAdministrationService(
    model,
    storage,
    accessLifecycle,
    administrationStore,
    administrationStore,
    // Without this the recovery view would answer from a stub rather than the
    // real restore-verification counts.
    () => integrity.recoveryStatus(),
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
    await storage.writeApplicationMetadata({ modelVersion: model.modelVersion });
  } catch (error) {
    await pool.end().catch(() => undefined);
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
      await new Promise<void>((settle) => server.close(() => settle()));
      await pool.end();
    },
  };
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
