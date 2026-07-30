import type { JsonValue } from "../model/resolved-model.js";
import type { AuthorityAccessLifecycleService } from "./access-lifecycle.js";
import type {
  AuthorityAdministrationService,
  AuthorityReportingService,
} from "./authoritative-reporting.js";
import {
  assertProductionSessionAdapter,
  type AuthorityConfiguration,
  type AuthorityRateLimits,
} from "./authority-config.js";
import { AuthorityService } from "./authority-service.js";
import type { AuthorityBootstrapRequest, AuthorityOperationIntent } from "./authority-types.js";
import {
  describeIdentityVerification,
  type UpstreamIdentityVerifier,
} from "./identity-verification.js";
import { OpaqueSessionAdapter } from "./opaque-session-adapter.js";
import {
  AuthorityMetrics,
  FixedWindowRateLimiter,
  type AuthorityRateLimiter,
  type SecurityLogger,
  StructuredSecurityLogger,
} from "./security-operations.js";

export interface AuthorityHttpDependencies {
  configuration: AuthorityConfiguration;
  authority: AuthorityService;
  sessions: OpaqueSessionAdapter;
  identityVerifier: UpstreamIdentityVerifier;
  accessLifecycle?: AuthorityAccessLifecycleService;
  reporting?: AuthorityReportingService;
  administration?: AuthorityAdministrationService;
  logger?: SecurityLogger;
  metrics?: AuthorityMetrics;
  rateLimiter?: AuthorityRateLimiter;
  clientKey?: (request: Request) => string;
  newCsrfToken?: () => string;
  readiness?: () => Promise<{ ready: boolean; reason?: string }>;
}

/**
 * Framework-neutral authority HTTP edge. A Node/Fastify/worker adapter may
 * forward a Request to this handler; ADL policy remains in AuthorityService.
 */
export function createAuthorityHttpHandler(
  dependencies: AuthorityHttpDependencies,
): (request: Request) => Promise<Response> {
  const { configuration, authority, sessions, identityVerifier } = dependencies;
  assertProductionSessionAdapter(configuration, sessions);
  const logger = dependencies.logger ?? new StructuredSecurityLogger();
  const metrics = dependencies.metrics ?? new AuthorityMetrics();
  const rateLimiter = dependencies.rateLimiter ?? new FixedWindowRateLimiter();
  const clientKey = dependencies.clientKey ?? (() => "unknown-client");
  const newCsrfToken = dependencies.newCsrfToken ?? secureToken;
  const identityVerification = describeIdentityVerification(configuration, identityVerifier);
  // The identity boundary is never silent: the active mode is stated once at
  // startup and on every readiness probe. No proof value is ever included.
  logger.write({
    event: "identity_verification_configured",
    outcome: "allowed",
    mode: identityVerification.mode,
    verifier: identityVerification.verifier,
    bypassed: identityVerification.bypassed,
    occurredAt: new Date().toISOString(),
  });

  return async (request) => {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/healthz") return textResponse("ok\n");
    if (pathname === "/readyz") {
      const readiness = (await dependencies.readiness?.()) ?? { ready: true };
      return jsonResponse(
        {
          status: readiness.ready ? "ready" : "not ready",
          ...(readiness.reason === undefined ? {} : { reason: readiness.reason }),
          identityVerification,
        },
        readiness.ready ? 200 : 503,
      );
    }
    if (pathname === "/metrics")
      return textResponse(metrics.prometheus(), 200, "text/plain; version=0.0.4");
    if (request.method === "OPTIONS") return preflight(request, configuration);
    if (request.method !== "POST") return failure("not_found", 404);
    if (!isHttps(request)) return reject("https_required", 400, pathname);
    if (!hasAllowedOrigin(request, configuration)) return reject("origin_denied", 403, pathname);
    if (request.headers.get("content-type")?.toLowerCase().startsWith("application/json") !== true)
      return reject("content_type_required", 415, pathname);
    const rateBucket = bucketFor(pathname);
    if (rateBucket === undefined) return failure("not_found", 404);
    metrics.incrementRequest(pathname);
    let body: Record<string, JsonValue>;
    try {
      body = await readJsonObject(request, configuration.maxRequestBytes);
    } catch (error) {
      return reject(
        error instanceof RequestShapeError ? error.code : "malformed_request",
        400,
        pathname,
      );
    }
    try {
      if (pathname === "/v1/session/issue") {
        if (!enforceRate()) return rateLimited();
        const proof = request.headers.get("x-adl-account-proof");
        if (proof === null || proof.length < 16)
          return reject("authentication_failed", 401, pathname);
        const identityProof = await identityVerifier.verify(proof, configuration.upstreamIdentity);
        if (identityProof === null || identityProof.subject.trim().length === 0)
          return reject("authentication_failed", 401, pathname);
        const identity = await sessions.provisionIdentity(identityProof.subject);
        const issued = await sessions.issueSession(identity.userId);
        logger.write({
          event: "session_issued",
          outcome: "allowed",
          endpoint: pathname,
          status: 201,
          occurredAt: new Date().toISOString(),
        });
        return jsonResponse(
          { userId: identity.userId, expiresAt: issued.expiresAt.toISOString() },
          201,
          cookieHeaders(configuration, issued.sessionToken, newCsrfToken()),
        );
      }
      const cookie = readCookie(request.headers.get("cookie"), configuration.cookieName);
      const session = cookie === undefined ? null : await sessions.verify(cookie);
      if (cookie === undefined || session === null) return reject("unauthenticated", 401, pathname);
      if (pathname !== "/v1/sync/bootstrap" && !hasValidCsrf(request, configuration))
        return reject("csrf_denied", 403, pathname);
      if (pathname === "/v1/session/current") {
        if (!enforceRate()) return rateLimited();
        // The identity is server-derived and disclosed only to its own session,
        // so the client never has to supply (or be trusted for) a user id.
        return jsonResponse({
          userId: session.userId,
          ...(session.expiresAt === undefined
            ? {}
            : { expiresAt: session.expiresAt.toISOString() }),
        });
      }
      if (pathname === "/v1/session/rotate") {
        if (!enforceRate()) return rateLimited();
        const rotated = await sessions.rotate(cookie);
        if (rotated === null) return reject("unauthenticated", 401, pathname);
        return jsonResponse(
          { expiresAt: rotated.expiresAt.toISOString() },
          200,
          cookieHeaders(configuration, rotated.sessionToken, newCsrfToken()),
        );
      }
      if (pathname === "/v1/session/sign-out") {
        if (!enforceRate()) return rateLimited();
        await sessions.signOut(cookie);
        return jsonResponse({ signedOut: true }, 200, clearCookieHeaders(configuration));
      }
      if (pathname === "/v1/sync/bootstrap") {
        if (!enforceRate()) return rateLimited();
        return jsonResponse(await authority.bootstrap(cookie, bootstrapRequest(body)));
      }
      if (pathname === "/v1/sync/replay") {
        const intent = operationIntent(body);
        const existing = await authority.replayOutcome(cookie, intent.operationId);
        if (existing !== null) return jsonResponse(existing);
        if (!enforceRate()) return rateLimited();
        return jsonResponse(await authority.replay(cookie, intent));
      }
      const reporting = dependencies.reporting;
      if (pathname === "/v1/reports/execute") {
        if (reporting === undefined) return reject("endpoint_unavailable", 503, pathname);
        if (!enforceRate()) return rateLimited();
        return jsonResponse(await reporting.execute(cookie, reportRequest(body)));
      }
      if (pathname === "/v1/reports/export") {
        if (reporting === undefined) return reject("endpoint_unavailable", 503, pathname);
        if (!enforceRate()) return rateLimited();
        const exported = await reporting.exportCsv(cookie, reportExportRequest(body));
        return new Response(exported.body, {
          status: 200,
          headers: {
            "content-type": exported.contentType,
            "cache-control": "no-store",
            "content-disposition": `attachment; filename=\"${exported.filename}\"`,
            "x-adl-report-truncated": String(exported.truncated),
          },
        });
      }
      const administration = dependencies.administration;
      if (pathname.startsWith("/v1/admin/")) {
        if (administration === undefined) return reject("endpoint_unavailable", 503, pathname);
        if (!enforceRate()) return rateLimited();
        const scope = administrationScope(body);
        const page = {
          ...(scope.limit === undefined ? {} : { limit: scope.limit }),
          ...(scope.cursor === undefined ? {} : { cursor: scope.cursor }),
        };
        if (pathname === "/v1/admin/access-audit/list")
          return jsonResponse(
            await administration.accessAudit(cookie, scope.contextName, scope.contextId, page),
          );
        if (pathname === "/v1/admin/runtime-audit/list")
          return jsonResponse(
            await administration.runtimeAudit(cookie, scope.contextName, scope.contextId, page),
          );
        if (pathname === "/v1/admin/memberships/list")
          return jsonResponse(
            await administration.memberships(cookie, scope.contextName, scope.contextId, page),
          );
        if (pathname === "/v1/admin/invites/list")
          return jsonResponse(
            await administration.invites(cookie, scope.contextName, scope.contextId, page),
          );
        if (pathname === "/v1/admin/recovery/status")
          return jsonResponse(
            await administration.recovery(cookie, scope.contextName, scope.contextId),
          );
        if (pathname === "/v1/admin/sessions/revoke")
          return jsonResponse(
            await administration.revokeSessions(
              cookie,
              scope.contextName,
              scope.contextId,
              requiredString(body, "userId"),
            ),
          );
        return failure("not_found", 404);
      }
      const access = dependencies.accessLifecycle;
      if (access === undefined) return reject("endpoint_unavailable", 503, pathname);
      if (pathname === "/v1/invites/create") {
        if (!enforceRate()) return rateLimited();
        const recipientUserId = optionalString(body, "recipientUserId");
        const invite = await access.createInvite(cookie, {
          contextName: requiredString(body, "contextName"),
          contextId: requiredString(body, "contextId"),
          role: requiredString(body, "role"),
          expiresAt: new Date(requiredString(body, "expiresAt")),
          ...(recipientUserId === undefined ? {} : { recipientUserId }),
        });
        return jsonResponse(invite, 201);
      }
      if (pathname === "/v1/invites/claim") {
        if (!enforceRate()) return rateLimited();
        return jsonResponse(await access.claimInvite(cookie, requiredString(body, "inviteToken")));
      }
      if (pathname === "/v1/invites/revoke") {
        if (!enforceRate()) return rateLimited();
        return jsonResponse({
          revoked: await access.revokeInvite(cookie, {
            inviteId: requiredString(body, "inviteId"),
            contextName: requiredString(body, "contextName"),
            contextId: requiredString(body, "contextId"),
          }),
        });
      }
      if (pathname === "/v1/memberships/revoke") {
        if (!enforceRate()) return rateLimited();
        return jsonResponse({
          revoked: await access.revokeMembership(cookie, {
            contextName: requiredString(body, "contextName"),
            contextId: requiredString(body, "contextId"),
            userId: requiredString(body, "userId"),
            role: requiredString(body, "role"),
          }),
        });
      }
      return failure("not_found", 404);
    } catch (error) {
      logger.write({
        event: "authority_request_failed",
        outcome: "failed",
        endpoint: pathname,
        status: 400,
        reason: error instanceof Error ? error.name : "unknown",
        occurredAt: new Date().toISOString(),
      });
      metrics.incrementRejection("request_rejected");
      return failure("request_rejected", 400);
    }

    function reject(reason: string, status: number, endpoint: string): Response {
      metrics.incrementRejection(reason);
      logger.write({
        event: "authority_request_rejected",
        outcome: "denied",
        endpoint,
        status,
        reason,
        occurredAt: new Date().toISOString(),
      });
      return failure(reason, status);
    }
    function enforceRate(): boolean {
      if (rateBucket === undefined) return false;
      const rate = rateLimiter.check(
        rateBucket,
        clientKey(request),
        configuration.rateLimits[rateBucket],
      );
      if (rate.allowed) return true;
      metrics.incrementRateLimited(pathname);
      logger.write({
        event: "rate_limited",
        outcome: "denied",
        endpoint: pathname,
        status: 429,
        occurredAt: new Date().toISOString(),
      });
      return false;
    }
    function rateLimited(): Response {
      return jsonResponse({ error: "rate_limited" }, 429, { "retry-after": "60" });
    }
  };
}

function bucketFor(pathname: string): keyof AuthorityRateLimits | undefined {
  if (pathname === "/v1/session/issue") return "accountProof";
  if (pathname.startsWith("/v1/session/")) return "session";
  if (pathname.startsWith("/v1/invites/") || pathname === "/v1/memberships/revoke") return "invite";
  if (pathname === "/v1/sync/bootstrap") return "bootstrap";
  if (pathname === "/v1/sync/replay") return "replay";
  if (pathname.startsWith("/v1/reports/")) return "report";
  if (pathname.startsWith("/v1/admin/")) return "administration";
  return undefined;
}
function reportRequest(body: Record<string, JsonValue>) {
  return {
    readModelName: requiredString(body, "readModelName"),
    ...(isStringRecord(body.selectedContexts) ? { selectedContexts: body.selectedContexts } : {}),
    ...(typeof body.cursor === "string" && body.cursor.length <= 4096
      ? { cursor: body.cursor }
      : {}),
    ...(typeof body.limit === "number" && Number.isInteger(body.limit)
      ? { limit: body.limit }
      : {}),
  };
}
function reportExportRequest(body: Record<string, JsonValue>) {
  return {
    readModelName: requiredString(body, "readModelName"),
    ...(isStringRecord(body.selectedContexts) ? { selectedContexts: body.selectedContexts } : {}),
  };
}
function administrationScope(body: Record<string, JsonValue>) {
  return {
    contextName: requiredString(body, "contextName"),
    contextId: requiredString(body, "contextId"),
    ...(typeof body.limit === "number" && Number.isInteger(body.limit)
      ? { limit: body.limit }
      : {}),
    ...(typeof body.cursor === "string" && body.cursor.length <= 4_096
      ? { cursor: body.cursor }
      : {}),
  };
}
function bootstrapRequest(body: Record<string, JsonValue>): AuthorityBootstrapRequest {
  return {
    ...(isStringRecord(body.selectedContexts) ? { selectedContexts: body.selectedContexts } : {}),
    ...(typeof body.cursor === "string" ? { cursor: body.cursor } : {}),
    ...(typeof body.limit === "number" && Number.isInteger(body.limit)
      ? { limit: body.limit }
      : {}),
  };
}
function operationIntent(body: Record<string, JsonValue>): AuthorityOperationIntent {
  const kind = requiredString(body, "kind");
  const selectedContexts = isStringRecord(body.selectedContexts)
    ? body.selectedContexts
    : undefined;
  const base = {
    operationId: requiredString(body, "operationId"),
    ...(selectedContexts === undefined ? {} : { selectedContexts }),
  };
  if (kind === "create")
    return {
      ...base,
      kind,
      objectName: requiredString(body, "objectName"),
      values: requiredRecord(body, "values"),
    };
  if (kind === "command")
    return {
      ...base,
      kind,
      commandName: requiredString(body, "commandName"),
      input: requiredRecord(body, "input"),
    };
  if (kind === "update")
    return {
      ...base,
      kind,
      objectName: requiredString(body, "objectName"),
      recordId: requiredString(body, "recordId"),
      patch: requiredRecord(body, "patch"),
      baseRevision: requiredString(body, "baseRevision"),
    };
  if (kind === "delete")
    return {
      ...base,
      kind,
      objectName: requiredString(body, "objectName"),
      recordId: requiredString(body, "recordId"),
      baseRevision: requiredString(body, "baseRevision"),
    };
  if (kind === "transition")
    return {
      ...base,
      kind,
      objectName: requiredString(body, "objectName"),
      recordId: requiredString(body, "recordId"),
      actionName: requiredString(body, "actionName"),
      baseRevision: requiredString(body, "baseRevision"),
    };
  throw new RequestShapeError("malformed_request");
}
async function readJsonObject(
  request: Request,
  maxBytes: number,
): Promise<Record<string, JsonValue>> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > maxBytes) throw new RequestShapeError("request_too_large");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes)
    throw new RequestShapeError("request_too_large");
  const parsed: unknown = JSON.parse(text);
  if (!isJsonRecord(parsed)) throw new RequestShapeError("malformed_request");
  return parsed;
}
function hasAllowedOrigin(request: Request, config: AuthorityConfiguration): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && config.allowedOrigins.includes(origin);
}
function hasValidCsrf(request: Request, config: AuthorityConfiguration): boolean {
  const cookie = readCookie(request.headers.get("cookie"), config.csrfCookieName);
  const header = request.headers.get("x-adl-csrf-token");
  return cookie !== undefined && header !== null && constantTimeEqual(cookie, header);
}
function isHttps(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}
function preflight(request: Request, config: AuthorityConfiguration): Response {
  if (!hasAllowedOrigin(request, config)) return failure("origin_denied", 403);
  return new Response(null, { status: 204, headers: corsHeaders(request, config) });
}
function jsonResponse(body: unknown, status = 200, extra?: HeadersInit): Response {
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  if (extra !== undefined) new Headers(extra).forEach((value, key) => headers.append(key, value));
  return new Response(JSON.stringify(body), { status, headers });
}
function textResponse(
  body: string,
  status = 200,
  contentType = "text/plain; charset=utf-8",
): Response {
  return new Response(body, {
    status,
    headers: { "content-type": contentType, "cache-control": "no-store" },
  });
}
function failure(error: string, status: number): Response {
  return jsonResponse({ error }, status);
}
function cookieHeaders(config: AuthorityConfiguration, token: string, csrf: string): Headers {
  const headers = new Headers();
  headers.append("set-cookie", sessionCookie(config, token));
  headers.append("set-cookie", csrfCookie(config, csrf));
  return headers;
}
function clearCookieHeaders(config: AuthorityConfiguration): Headers {
  const headers = new Headers();
  headers.append("set-cookie", sessionCookie(config, "", "Max-Age=0"));
  headers.append("set-cookie", csrfCookie(config, "", "Max-Age=0"));
  return headers;
}
function sessionCookie(config: AuthorityConfiguration, value: string, extra = ""): string {
  return `${config.cookieName}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict${extra === "" ? "" : `; ${extra}`}`;
}
function csrfCookie(config: AuthorityConfiguration, value: string, extra = ""): string {
  return `${config.csrfCookieName}=${value}; Path=/; Secure; SameSite=Strict${extra === "" ? "" : `; ${extra}`}`;
}
function corsHeaders(request: Request, config: AuthorityConfiguration): Headers {
  return new Headers({
    "access-control-allow-origin": request.headers.get("origin") ?? "",
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-adl-account-proof, x-adl-csrf-token",
    "access-control-max-age": "600",
    vary: "Origin",
  });
}
function readCookie(header: string | null, name: string): string | undefined {
  return header
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}
function isJsonRecord(value: unknown): value is Record<string, JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isStringRecord(value: JsonValue | undefined): value is Record<string, string> {
  return isJsonRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}
function requiredString(body: Record<string, JsonValue>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.length === 0 || value.length > 4_096)
    throw new RequestShapeError("malformed_request");
  return value;
}
function optionalString(body: Record<string, JsonValue>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  return requiredString(body, key);
}
function requiredRecord(body: Record<string, JsonValue>, key: string): Record<string, JsonValue> {
  const value = body[key];
  if (!isJsonRecord(value)) throw new RequestShapeError("malformed_request");
  return value;
}
function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1)
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  return difference === 0;
}
function secureToken(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}
class RequestShapeError extends Error {
  constructor(readonly code: "malformed_request" | "request_too_large") {
    super(code);
  }
}
