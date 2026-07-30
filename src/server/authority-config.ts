import { OpaqueSessionAdapter } from "./opaque-session-adapter.js";
import { StaticSessionAdapter } from "./session-adapter.js";

export type AuthorityEnvironment = "development" | "test" | "production";

/**
 * `bypass` accepts the supplied account proof as the identity subject without
 * contacting any provider. It is a documented, temporary development state
 * pending a real provider decision, and it is never silent: the active mode is
 * written to the startup security log and reported by `/readyz`. `upstream`
 * requires a real verifier; without one, every proof is unverifiable and no
 * session is issued.
 */
export type AuthorityIdentityVerificationMode = "bypass" | "upstream";

export interface AuthorityIdentityVerificationConfiguration {
  mode: AuthorityIdentityVerificationMode;
}

export interface AuthorityRateLimits {
  accountProof: number;
  session: number;
  invite: number;
  bootstrap: number;
  replay: number;
  report: number;
  administration: number;
}

export interface AuthorityConfiguration {
  environment: AuthorityEnvironment;
  databaseUrl: string;
  allowedOrigins: readonly string[];
  cookieName: "__Host-adl_session";
  csrfCookieName: "__Host-adl_csrf";
  sessionTtlMinutes: number;
  maxRequestBytes: number;
  upstreamIdentity: { issuer: string; audience: string };
  identityVerification: AuthorityIdentityVerificationConfiguration;
  rateLimits: AuthorityRateLimits;
}

export class AuthorityConfigurationError extends Error {}

/**
 * Reads only deployment configuration. It intentionally does not model any of
 * these values in ADL source or the resolved application model.
 */
export function loadAuthorityConfiguration(
  environment: Record<string, string | undefined>,
): AuthorityConfiguration {
  const environmentName = environment.ADL_ENV ?? environment.NODE_ENV ?? "development";
  if (!isEnvironment(environmentName)) throw new AuthorityConfigurationError("ADL_ENV is invalid.");
  const databaseUrl = required(environment, "ADL_DATABASE_URL");
  if (!databaseUrl.startsWith("postgresql://") && !databaseUrl.startsWith("postgres://"))
    throw new AuthorityConfigurationError("ADL_DATABASE_URL must be a PostgreSQL URL.");
  const allowedOrigins = required(environment, "ADL_ALLOWED_ORIGINS")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (allowedOrigins.length === 0 || allowedOrigins.some((origin) => !isHttpsOrigin(origin)))
    throw new AuthorityConfigurationError("ADL_ALLOWED_ORIGINS must contain only HTTPS origins.");
  if (new Set(allowedOrigins).size !== allowedOrigins.length)
    throw new AuthorityConfigurationError("ADL_ALLOWED_ORIGINS must not contain duplicates.");
  const config: AuthorityConfiguration = {
    environment: environmentName,
    databaseUrl,
    allowedOrigins,
    cookieName: "__Host-adl_session",
    csrfCookieName: "__Host-adl_csrf",
    sessionTtlMinutes: positiveInteger(environment.ADL_SESSION_TTL_MINUTES, 480),
    maxRequestBytes: positiveInteger(environment.ADL_MAX_REQUEST_BYTES, 65_536),
    upstreamIdentity: {
      issuer: required(environment, "ADL_UPSTREAM_IDENTITY_ISSUER"),
      audience: required(environment, "ADL_UPSTREAM_IDENTITY_AUDIENCE"),
    },
    identityVerification: { mode: identityVerificationMode(environment.ADL_IDENTITY_VERIFICATION) },
    rateLimits: {
      accountProof: positiveInteger(environment.ADL_RATE_ACCOUNT_PROOF, 10),
      session: positiveInteger(environment.ADL_RATE_SESSION, 30),
      invite: positiveInteger(environment.ADL_RATE_INVITE, 20),
      bootstrap: positiveInteger(environment.ADL_RATE_BOOTSTRAP, 120),
      replay: positiveInteger(environment.ADL_RATE_REPLAY, 240),
      report: positiveInteger(environment.ADL_RATE_REPORT, 30),
      administration: positiveInteger(environment.ADL_RATE_ADMINISTRATION, 30),
    },
  };
  if (config.environment === "production" && environment.ADL_COOKIE_SECURE !== "true")
    throw new AuthorityConfigurationError("Production requires ADL_COOKIE_SECURE=true.");
  // The bypass may not be reached in production by omission. An operator has to
  // state it deliberately, and it is still disclosed at startup and on /readyz.
  if (
    config.environment === "production" &&
    config.identityVerification.mode === "bypass" &&
    environment.ADL_IDENTITY_BYPASS_ACKNOWLEDGED !== "true"
  )
    throw new AuthorityConfigurationError(
      "Production identity bypass requires ADL_IDENTITY_BYPASS_ACKNOWLEDGED=true.",
    );
  return config;
}

/** Reject test wiring before a production HTTP process can serve traffic. */
export function assertProductionSessionAdapter(
  configuration: AuthorityConfiguration,
  adapter: unknown,
): void {
  if (configuration.environment !== "production") return;
  if (adapter instanceof StaticSessionAdapter)
    throw new AuthorityConfigurationError("StaticSessionAdapter is unavailable in production.");
  if (!(adapter instanceof OpaqueSessionAdapter))
    throw new AuthorityConfigurationError("Production requires OpaqueSessionAdapter.");
}

function required(environment: Record<string, string | undefined>, name: string): string {
  const value = environment[name]?.trim();
  if (value === undefined || value.length === 0)
    throw new AuthorityConfigurationError(`${name} is required.`);
  return value;
}
function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new AuthorityConfigurationError(
      "Authority numeric configuration must be a positive integer.",
    );
  return parsed;
}
function identityVerificationMode(value: string | undefined): AuthorityIdentityVerificationMode {
  const declared = value?.trim();
  const mode = declared === undefined || declared.length === 0 ? "bypass" : declared;
  if (mode === "bypass" || mode === "upstream") return mode;
  throw new AuthorityConfigurationError(
    "ADL_IDENTITY_VERIFICATION must be 'bypass' or 'upstream'.",
  );
}
function isEnvironment(value: string): value is AuthorityEnvironment {
  return value === "development" || value === "test" || value === "production";
}
function isHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.origin === value &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}
