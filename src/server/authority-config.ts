import { DEFAULT_OFFLINE_GRACE_DAYS } from "../model/defaults.js";
import type { ResolvedApplicationModel } from "../model/resolved-model.js";
import { OpaqueSessionAdapter } from "./opaque-session-adapter.js";
import { StaticSessionAdapter } from "./session-adapter.js";

export type AuthorityEnvironment = "development" | "test" | "production";

/**
 * How the authority establishes that a caller is who they say they are.
 *
 * - `passkey` verifies a WebAuthn assertion the authority itself challenged.
 *   There is no shared secret and no upstream provider to trust.
 * - `upstream` requires a real bearer-proof verifier (for example an OIDC
 *   `id_token`); without one, every proof is unverifiable and no session is
 *   issued. It never falls back to the bypass.
 * - `bypass` accepts the supplied account proof as the identity subject without
 *   contacting anything. It is a development-only state, is refused outright in
 *   production, and is never silent: the active mode is written to the startup
 *   security log and reported by `/readyz`.
 */
export type AuthorityIdentityVerificationMode = "bypass" | "upstream" | "passkey";

export interface AuthorityIdentityVerificationConfiguration {
  mode: AuthorityIdentityVerificationMode;
}

/**
 * WebAuthn relying-party binding. It is deliberately explicit rather than
 * inferred from the request: a credential registered against one relying party
 * id will not work against another, so a development registration and a
 * production registration are separate by design.
 */
export interface AuthorityWebAuthnConfiguration {
  relyingPartyId: string;
  relyingPartyName: string;
  /** Every origin an assertion may legitimately come from. */
  origins: readonly string[];
  challengeTtlSeconds: number;
}

export type AuthoritySelfServiceRegistrationCeiling = "model" | "off";

export interface AuthorityRateLimits {
  accountProof: number;
  /** Registration and authentication ceremonies, most of which are pre-session. */
  webauthn: number;
  /**
   * Anonymous account creation only — a `register/begin` carrying neither a
   * session cookie nor an invite token. Charged *in addition to*
   * {@link webauthn}, so the ordinary ceremony allowance shared with sign-in
   * stays untouched while the one endpoint where a stranger creates durable
   * state is capped independently. Either bucket can refuse, and a caller
   * cannot tell which did.
   */
  selfRegistration: number;
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
  /**
   * The effective session lifetime. It is the model's declared offline grace,
   * because a device must be able to sync anywhere inside that grace without a
   * fresh logon, shortened by {@link sessionTtlMinutesCap} when an operator has
   * set one. `loadAuthorityConfiguration` cannot know the model, so it seeds
   * this with the language's default grace and
   * {@link resolveSessionLifetime} replaces it once the model is loaded.
   */
  sessionTtlMinutes: number;
  /**
   * `ADL_SESSION_TTL_MINUTES`, when set. It may only shorten the declared
   * grace, never lengthen it: the model is the source of truth for how long a
   * device may stay away, and an environment variable must not quietly grant
   * more than the application declared.
   */
  sessionTtlMinutesCap?: number;
  maxRequestBytes: number;
  upstreamIdentity: { issuer: string; audience: string };
  identityVerification: AuthorityIdentityVerificationConfiguration;
  /** Present only in `passkey` mode, where it is required. */
  webauthn?: AuthorityWebAuthnConfiguration;
  /**
   * `ADL_SELF_SERVICE_REGISTRATION`. It may only ever *restrict* what the model
   * declared: the accepted values are `model` (defer to the declaration) and
   * `off`. There is deliberately no `on`, because enabling self-service for a
   * model that declares `INVITE_ONLY` would hand out a capability the
   * application never declared, and would do so where nothing in the model
   * records it.
   *
   * Optional, unlike every key of {@link AuthorityRateLimits}, and the
   * asymmetry is deliberate: this is read by name and never indexed, and its
   * absent value (`"model"`) is the permissive-but-model-bounded default an
   * operator who set nothing means. A rate limit is indexed dynamically, so an
   * optional key there would type a missing limit as `number | undefined` at
   * the one place a missing limit means "no limit".
   */
  selfServiceRegistration?: AuthoritySelfServiceRegistrationCeiling;
  /**
   * The reconciled answer, written by {@link resolveSelfServiceRegistration}
   * once the model is loaded. Absent means false — a missing flag must never
   * be read as permission.
   */
  selfServiceRegistrationEnabled?: boolean;
  rateLimits: AuthorityRateLimits;
}

/**
 * The name matters, not only the message. A retention run reduces a fault to its
 * error name before recording it — the driver's own message can carry hosts,
 * roles and statement text — so without this every configuration refusal would
 * land in the run log as the bare string `Error`, indistinguishable from an
 * infrastructure fault an operator would go and investigate quite differently.
 */
export class AuthorityConfigurationError extends Error {
  override readonly name = "AuthorityConfigurationError";
}

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
    sessionTtlMinutes: minutesForDays(DEFAULT_OFFLINE_GRACE_DAYS),
    ...(environment.ADL_SESSION_TTL_MINUTES === undefined
      ? {}
      : { sessionTtlMinutesCap: positiveInteger(environment.ADL_SESSION_TTL_MINUTES, 0) }),
    maxRequestBytes: positiveInteger(environment.ADL_MAX_REQUEST_BYTES, 65_536),
    upstreamIdentity: {
      issuer: required(environment, "ADL_UPSTREAM_IDENTITY_ISSUER"),
      audience: required(environment, "ADL_UPSTREAM_IDENTITY_AUDIENCE"),
    },
    identityVerification: { mode: identityVerificationMode(environment.ADL_IDENTITY_VERIFICATION) },
    selfServiceRegistration: selfServiceRegistrationCeiling(
      environment.ADL_SELF_SERVICE_REGISTRATION,
    ),
    rateLimits: {
      accountProof: positiveInteger(environment.ADL_RATE_ACCOUNT_PROOF, 10),
      webauthn: positiveInteger(environment.ADL_RATE_WEBAUTHN, 20),
      selfRegistration: positiveInteger(environment.ADL_RATE_SELF_REGISTRATION, 5),
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
  // A real verifier now exists, so the bypass is no longer reachable in
  // production at all. There is deliberately no acknowledgement flag: an
  // operator cannot opt a production deployment back into accepting an
  // unverified identity.
  if (config.environment === "production" && config.identityVerification.mode === "bypass")
    throw new AuthorityConfigurationError(
      "Production requires ADL_IDENTITY_VERIFICATION=passkey or upstream; the identity bypass is unavailable in production.",
    );
  if (config.identityVerification.mode === "passkey")
    return { ...config, webauthn: webauthnConfiguration(environment, config.allowedOrigins) };
  return config;
}

/**
 * Reconciles the deployment configuration with the model the authority serves.
 *
 * The declared offline grace is how long a device may keep syncing since its
 * last successful authentication, so the session it authenticates into must be
 * able to span it — an 8-hour session would expire a device that the model says
 * has 30 days. An operator may shorten that with `ADL_SESSION_TTL_MINUTES`, and
 * only shorten it: lengthening past the declared grace would hand out a
 * capability the application never declared. The grace stays a *maximum* either
 * way, because revocation takes effect on the next contact regardless of how
 * much of it is left.
 */
export function resolveSessionLifetime(
  configuration: AuthorityConfiguration,
  model: ResolvedApplicationModel,
): AuthorityConfiguration {
  const graceMinutes = minutesForDays(model.app.offlineGraceDays);
  const cap = configuration.sessionTtlMinutesCap;
  return {
    ...configuration,
    sessionTtlMinutes: cap === undefined ? graceMinutes : Math.min(graceMinutes, cap),
  };
}

/**
 * Reconciles the model's registration declaration with the deployment ceiling.
 *
 * The model is the ceiling and the deployment may only restrict: an
 * application that does not declare `REGISTRATION SELF_SERVICE` cannot be
 * self-registered into under any configuration, and there is no accepted value
 * of any environment variable that changes that. `resolveSessionLifetime`
 * argues the same asymmetry for the offline grace, and it applies with more
 * force here, because the capability is "strangers may create accounts".
 *
 * It is additionally false outside `passkey` mode: `bypass` and `upstream`
 * have no registration ceremony at all — an identity is minted from an account
 * proof through `/v1/session/issue` — so the flag would be both meaningless and
 * misleading there.
 */
export function resolveSelfServiceRegistration(
  configuration: AuthorityConfiguration,
  model: ResolvedApplicationModel,
): AuthorityConfiguration {
  const declared = model.app.registration === "selfService";
  const ceiling = configuration.selfServiceRegistration ?? "model";
  return {
    ...configuration,
    selfServiceRegistrationEnabled:
      declared && ceiling === "model" && configuration.identityVerification.mode === "passkey",
  };
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
function minutesForDays(days: number): number {
  return days * 24 * 60;
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
function selfServiceRegistrationCeiling(
  value: string | undefined,
): AuthoritySelfServiceRegistrationCeiling {
  const declared = value?.trim();
  const ceiling = declared === undefined || declared.length === 0 ? "model" : declared;
  if (ceiling === "model" || ceiling === "off") return ceiling;
  // Deliberately no `on`: see AuthorityConfiguration.selfServiceRegistration.
  throw new AuthorityConfigurationError(
    "ADL_SELF_SERVICE_REGISTRATION must be 'model' or 'off'; there is no value that enables self-service for a model that did not declare it.",
  );
}
function identityVerificationMode(value: string | undefined): AuthorityIdentityVerificationMode {
  const declared = value?.trim();
  const mode = declared === undefined || declared.length === 0 ? "bypass" : declared;
  if (mode === "bypass" || mode === "upstream" || mode === "passkey") return mode;
  throw new AuthorityConfigurationError(
    "ADL_IDENTITY_VERIFICATION must be 'bypass', 'upstream' or 'passkey'.",
  );
}

/**
 * Origin binding is explicit. `ADL_WEBAUTHN_ORIGINS` defaults to the already
 * validated allowed origins rather than to anything derived from a request, and
 * the relying party id must be a registrable domain that every one of those
 * origins is under — a mismatch is refused at startup rather than producing
 * credentials that silently fail to verify later.
 */
function webauthnConfiguration(
  environment: Record<string, string | undefined>,
  allowedOrigins: readonly string[],
): AuthorityWebAuthnConfiguration {
  const relyingPartyId = required(environment, "ADL_WEBAUTHN_RP_ID");
  if (!/^[a-z0-9.-]{1,253}$/iu.test(relyingPartyId))
    throw new AuthorityConfigurationError("ADL_WEBAUTHN_RP_ID must be a host name.");
  const declaredOrigins = environment.ADL_WEBAUTHN_ORIGINS?.trim();
  const origins =
    declaredOrigins === undefined || declaredOrigins.length === 0
      ? [...allowedOrigins]
      : declaredOrigins
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean);
  if (origins.length === 0)
    throw new AuthorityConfigurationError("ADL_WEBAUTHN_ORIGINS must contain at least one origin.");
  for (const origin of origins) {
    let host: string;
    try {
      host = new URL(origin).hostname;
    } catch {
      throw new AuthorityConfigurationError("ADL_WEBAUTHN_ORIGINS must contain only origins.");
    }
    if (host !== relyingPartyId && !host.endsWith(`.${relyingPartyId}`))
      throw new AuthorityConfigurationError(
        "Every ADL_WEBAUTHN_ORIGINS entry must be under ADL_WEBAUTHN_RP_ID.",
      );
  }
  return {
    relyingPartyId,
    relyingPartyName: environment.ADL_WEBAUTHN_RP_NAME?.trim() || relyingPartyId,
    origins,
    challengeTtlSeconds: positiveInteger(environment.ADL_WEBAUTHN_CHALLENGE_TTL_SECONDS, 300),
  };
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
