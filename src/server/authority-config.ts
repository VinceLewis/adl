import { OpaqueSessionAdapter } from "./opaque-session-adapter.js";
import { StaticSessionAdapter } from "./session-adapter.js";

export type AuthorityEnvironment = "development" | "test" | "production";

export interface AuthorityRateLimits {
  accountProof: number;
  session: number;
  invite: number;
  bootstrap: number;
  replay: number;
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
    rateLimits: {
      accountProof: positiveInteger(environment.ADL_RATE_ACCOUNT_PROOF, 10),
      session: positiveInteger(environment.ADL_RATE_SESSION, 30),
      invite: positiveInteger(environment.ADL_RATE_INVITE, 20),
      bootstrap: positiveInteger(environment.ADL_RATE_BOOTSTRAP, 120),
      replay: positiveInteger(environment.ADL_RATE_REPLAY, 240),
    },
  };
  if (config.environment === "production" && environment.ADL_COOKIE_SECURE !== "true")
    throw new AuthorityConfigurationError("Production requires ADL_COOKIE_SECURE=true.");
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
