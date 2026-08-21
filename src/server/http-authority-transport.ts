import type {
  AuthorityBootstrapRequest,
  AuthorityBootstrapResponse,
  AuthorityOperationIntent,
  AuthorityOutcome,
} from "./authority-types.js";
import type { AuthorityTransport } from "./sync-client.js";

/** Server-derived session identity. The client never supplies a user id. */
export interface AuthoritySessionIdentity {
  userId: string;
  expiresAt?: Date;
}

/**
 * The authority's own description of how it verifies identity, read from
 * `/readyz`. The browser uses it only to label a bypassed deployment as a
 * development mode; it never widens what the client may do.
 */
export interface AuthorityIdentityReadiness {
  ready: boolean;
  mode: string;
  verifier: string;
  bypassed: boolean;
  /**
   * Whether this deployment admits people nobody invited. Parsed fail-closed:
   * absent, non-boolean, or an unreachable authority all mean `false`. A
   * missing flag must never be read as permission.
   */
  selfServiceRegistration: boolean;
}

/**
 * A ceremony the authority has started. `options` is the WebAuthn options JSON
 * to hand to the authenticator; `challengeId` names the server-side challenge
 * the answering assertion will be checked against. The challenge is never
 * chosen here: the client cannot influence what it is asked to sign.
 */
export interface AuthorityPasskeyCeremony {
  challengeId: string;
  options: Record<string, unknown>;
}

/** Outcome of a completed registration. The membership, if any, is server-written. */
export interface PasskeyRegistrationOutcome {
  userId: string;
  /** `membershipGranted` for a first-time invite, `identityRecovered` for a re-link. */
  invite?: "membershipGranted" | "identityRecovered";
  expiresAt?: Date;
}

/** What a rotation reports back. The replacement token itself stays in a cookie. */
export interface AuthoritySessionRotation {
  expiresAt?: Date;
}

/**
 * One of the caller's own active sessions, as the device list shows it. It
 * carries no token or token hash: the verifier for a live session never leaves
 * the server.
 */
export interface AuthorityDeviceSession {
  sessionId: string;
  /** ISO instants, passed through unparsed so the surface formats them once. */
  issuedAt: string;
  expiresAt: string;
  /** True for the session this request was made with. */
  current: boolean;
}

/** Outcome of claiming an invitation. The membership itself is server-written. */
export type AuthorityInviteClaimOutcome =
  | { status: "accepted"; inviteId: string; membershipRecordId: string }
  | { status: "rejected"; code: string };

/**
 * How the transport obtains request credentials. In a browser the session
 * cookie is `__Host-` Secure HttpOnly SameSite=Strict and is attached by the
 * user agent, so only the readable double-submit CSRF cookie is visible here.
 * Non-browser callers (integration tests, tooling) supply their own jar.
 */
export interface AuthorityCredentialStore {
  /** Cookie header to send, or undefined when the environment attaches cookies itself. */
  cookieHeader(): string | undefined;
  /** Double-submit CSRF token, mirrored from the readable CSRF cookie. */
  csrfToken(): string | undefined;
  capture(setCookies: readonly string[]): void;
}

/** Reads only the non-HttpOnly CSRF cookie; the session cookie stays unreadable. */
export class BrowserAuthorityCredentialStore implements AuthorityCredentialStore {
  constructor(private readonly csrfCookieName = "__Host-adl_csrf") {}
  cookieHeader(): string | undefined {
    return undefined;
  }
  csrfToken(): string | undefined {
    return readCookieValue(globalThis.document?.cookie ?? "", this.csrfCookieName);
  }
  capture(): void {
    // Set-Cookie is applied by the user agent and is not readable here.
  }
}

/** Test/tooling jar. Raw tokens stay in memory and are never logged or persisted. */
export class InMemoryAuthorityCredentialStore implements AuthorityCredentialStore {
  private readonly cookies = new Map<string, string>();
  constructor(private readonly csrfCookieName = "__Host-adl_csrf") {}
  cookieHeader(): string | undefined {
    if (this.cookies.size === 0) return undefined;
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
  csrfToken(): string | undefined {
    return this.cookies.get(this.csrfCookieName);
  }
  capture(setCookies: readonly string[]): void {
    for (const entry of setCookies) {
      const [pair, ...attributes] = entry.split(";");
      const separator = pair?.indexOf("=") ?? -1;
      if (pair === undefined || separator < 1) continue;
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      const expired = attributes.some((attribute) => /^\s*max-age=0\s*$/iu.test(attribute));
      if (value.length === 0 || expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
}

/** One business context an operator administers. The server re-derives their role in it. */
export interface AuthorityAdministrationScope {
  contextName: string;
  contextId: string;
}

export interface AuthorityAdministrationClientRequest extends AuthorityAdministrationScope {
  limit?: number;
  cursor?: string;
}

/** A bounded administration page. Entries stay opaque records: the server shapes them. */
export interface AuthorityAdministrationPage {
  entries: Array<Record<string, unknown>>;
  nextCursor?: string;
}

export interface AuthorityReportClientRequest {
  readModelName: string;
  selectedContexts?: Record<string, string>;
  cursor?: string;
  limit?: number;
}

export interface AuthorityReportPage {
  readModelName: string;
  fields: string[];
  rows: Array<Record<string, unknown>>;
  nextCursor?: string;
  truncated: boolean;
}

export interface AuthorityReportCsv {
  filename: string;
  contentType: string;
  body: string;
  truncated: boolean;
}

export class AuthorityTransportError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "AuthorityTransportError";
  }
}

export interface HttpAuthorityTransportOptions {
  /** Authority origin, for example `https://authority.example`. */
  baseUrl: string;
  credentials?: AuthorityCredentialStore;
  fetch?: typeof globalThis.fetch;
  /** Explicit Origin header for non-browser callers; browsers set it themselves. */
  origin?: string;
  /** Forwarded-proto marker for a deployment terminating TLS ahead of the process. */
  forwardedProto?: string;
}

/**
 * Browser-facing HTTP transport for the authority edge. It carries the Phase 42
 * session cookie and double-submit CSRF token and nothing else: no user id,
 * role, audit actor, accepted revision, or timestamp is ever sent, because the
 * server derives all of those. `sessionToken` arguments are ignored by design —
 * the raw token is HttpOnly and unreadable to this code.
 */
export class HttpAuthorityTransport implements AuthorityTransport {
  private readonly baseUrl: string;
  private readonly credentials: AuthorityCredentialStore;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(private readonly options: HttpAuthorityTransportOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/u, "");
    this.credentials = options.credentials ?? new BrowserAuthorityCredentialStore();
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /** Exchanges an upstream account proof for a session. The proof is never stored or logged. */
  async signIn(accountProof: string): Promise<AuthoritySessionIdentity> {
    const body = await this.post("/v1/session/issue", {}, { "x-adl-account-proof": accountProof });
    return sessionIdentity(body);
  }

  /**
   * Starts a passkey registration. With no invite token the caller must already
   * hold a session, and is adding a further authenticator to their own
   * identity; with one, the authority decides from the invite whether this is a
   * first-time member or the re-admission of an existing identity. The browser
   * never states which: it only presents what it was given.
   */
  async beginPasskeyRegistration(inviteToken?: string): Promise<AuthorityPasskeyCeremony> {
    return ceremonyStart(
      await this.post(
        "/v1/webauthn/register/begin",
        inviteToken === undefined ? {} : { inviteToken },
      ),
    );
  }

  /**
   * Completes a registration. The invite token is re-supplied rather than held
   * server-side between the two requests: only its hash is stored on the
   * challenge, so a raw invite token never reaches challenge storage.
   */
  async finishPasskeyRegistration(input: {
    challengeId: string;
    response: Record<string, unknown>;
    inviteToken?: string;
  }): Promise<PasskeyRegistrationOutcome> {
    const body = await this.post("/v1/webauthn/register/finish", {
      challengeId: input.challengeId,
      response: input.response,
      ...(input.inviteToken === undefined ? {} : { inviteToken: input.inviteToken }),
    });
    const userId = body.userId;
    if (typeof userId !== "string" || userId.length === 0)
      throw new AuthorityTransportError("The authority server returned no session identity.", 502);
    const expiresAt = typeof body.expiresAt === "string" ? new Date(body.expiresAt) : undefined;
    return {
      userId,
      ...(body.invite === "membershipGranted" || body.invite === "identityRecovered"
        ? { invite: body.invite }
        : {}),
      ...(expiresAt === undefined || Number.isNaN(expiresAt.getTime()) ? {} : { expiresAt }),
    };
  }

  async beginPasskeyAuthentication(): Promise<AuthorityPasskeyCeremony> {
    return ceremonyStart(await this.post("/v1/webauthn/authenticate/begin", {}));
  }

  /** A verified assertion yields an ordinary opaque session, exactly as a proof would. */
  async finishPasskeyAuthentication(input: {
    challengeId: string;
    response: Record<string, unknown>;
  }): Promise<AuthoritySessionIdentity> {
    return sessionIdentity(
      await this.post("/v1/webauthn/authenticate/finish", {
        challengeId: input.challengeId,
        response: input.response,
      }),
    );
  }

  /** Resolves the identity of an existing session cookie, or null when there is none. */
  async currentSession(): Promise<AuthoritySessionIdentity | null> {
    try {
      return sessionIdentity(await this.post("/v1/session/current", {}));
    } catch (error) {
      if (error instanceof AuthorityTransportError && error.status === 401) return null;
      throw error;
    }
  }

  /**
   * Restarts the offline grace using a still-valid session. The authority
   * issues a replacement session and revokes the old one, so this is a
   * successful authentication in its own right — no credential is presented,
   * and a session that has already expired or been revoked is refused.
   */
  async rotateSession(): Promise<AuthoritySessionRotation> {
    const body = await this.post("/v1/session/rotate", {});
    const expiresAt = typeof body.expiresAt === "string" ? new Date(body.expiresAt) : undefined;
    return expiresAt === undefined || Number.isNaN(expiresAt.getTime()) ? {} : { expiresAt };
  }

  /** The caller's own active sessions. The authority scopes this to their identity. */
  async listSessions(): Promise<AuthorityDeviceSession[]> {
    const body = await this.post("/v1/session/list", {});
    const sessions = body.sessions;
    if (!Array.isArray(sessions)) return [];
    return sessions.flatMap((entry) => {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return [];
      const row = entry as Record<string, unknown>;
      if (typeof row.sessionId !== "string" || row.sessionId.length === 0) return [];
      return [
        {
          sessionId: row.sessionId,
          issuedAt: typeof row.issuedAt === "string" ? row.issuedAt : "",
          expiresAt: typeof row.expiresAt === "string" ? row.expiresAt : "",
          current: row.current === true,
        },
      ];
    });
  }

  /** Ends one of the caller's own sessions. The authority refuses anyone else's. */
  async revokeSession(sessionId: string): Promise<void> {
    await this.post("/v1/session/revoke", { sessionId });
  }

  async signOut(): Promise<void> {
    await this.post("/v1/session/sign-out", {});
  }

  /**
   * Claims an invitation. This is online-only and server-authoritative: the
   * membership record is written by the authority inside its own transaction,
   * and nothing here pre-grants access or caches the token for later replay.
   */
  async claimInvite(inviteToken: string): Promise<AuthorityInviteClaimOutcome> {
    const body = await this.post("/v1/invites/claim", { inviteToken });
    if (body.status === "accepted")
      return {
        status: "accepted",
        inviteId: typeof body.inviteId === "string" ? body.inviteId : "",
        membershipRecordId:
          typeof body.membershipRecordId === "string" ? body.membershipRecordId : "",
      };
    return {
      status: "rejected",
      code: typeof body.code === "string" ? body.code : "ADL_INVITE_INVALID",
    };
  }

  /**
   * Reads `/readyz`. It is a GET outside the CSRF and session surface, so a
   * signed-out browser can still learn that this deployment runs a bypassed
   * verifier and must be presented as a development mode.
   */
  async readiness(): Promise<AuthorityIdentityReadiness> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/readyz`, {
        method: "GET",
        credentials: "include",
      });
    } catch (error) {
      throw new AuthorityTransportError(
        "The authority server could not be reached (/readyz).",
        0,
        error instanceof Error ? error.name : "network_error",
      );
    }
    const payload = await readJson(response);
    const identity = payload?.identityVerification;
    const verification =
      identity !== null && typeof identity === "object" && !Array.isArray(identity)
        ? (identity as Record<string, unknown>)
        : {};
    return {
      ready: payload?.status === "ready",
      mode: typeof verification.mode === "string" ? verification.mode : "unknown",
      verifier: typeof verification.verifier === "string" ? verification.verifier : "unknown",
      // Unknown means "assume this needs the development warning": a missing
      // flag must not be read as a verified deployment.
      bypassed: verification.bypassed !== false,
      // The mirror image of `bypassed` above, and deliberately so: that one
      // fails closed towards *warning*, this one fails closed towards
      // *refusing*, so both defaults are the safe answer for what they gate.
      selfServiceRegistration: verification.selfServiceRegistration === true,
    };
  }

  /**
   * Executes one named read model as a report. The name and the selected
   * contexts are all that is sent: there is no field list, filter, object name
   * or projection to widen, and the authority shapes every row through the
   * runtime's read policy before it is serialised.
   *
   * A denied or unknown report comes back as an empty one rather than an error,
   * by design on the server — so nothing here should try to distinguish them.
   */
  async executeReport(request: AuthorityReportClientRequest): Promise<AuthorityReportPage> {
    const body = await this.post("/v1/reports/execute", {
      readModelName: request.readModelName,
      ...(request.selectedContexts === undefined
        ? {}
        : { selectedContexts: request.selectedContexts }),
      ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
      ...(request.limit === undefined ? {} : { limit: request.limit }),
    });
    return {
      readModelName: typeof body.readModelName === "string" ? body.readModelName : "",
      fields: Array.isArray(body.fields)
        ? body.fields.filter((field): field is string => typeof field === "string")
        : [],
      rows: Array.isArray(body.rows)
        ? body.rows.filter((row): row is Record<string, unknown> => isRecord(row))
        : [],
      ...(typeof body.nextCursor === "string" ? { nextCursor: body.nextCursor } : {}),
      truncated: body.truncated === true,
    };
  }

  /**
   * Exports a report as CSV. The response is not JSON, so this is the one call
   * that reads the body as text; the filename comes from the authority's own
   * `content-disposition` rather than being composed here.
   */
  async exportReport(request: {
    readModelName: string;
    selectedContexts?: Record<string, string>;
  }): Promise<AuthorityReportCsv> {
    const headers = new Headers({ "content-type": "application/json" });
    const cookie = this.credentials.cookieHeader();
    if (cookie !== undefined) headers.set("cookie", cookie);
    const csrf = this.credentials.csrfToken();
    if (csrf !== undefined) headers.set("x-adl-csrf-token", csrf);
    if (this.options.origin !== undefined) headers.set("origin", this.options.origin);
    if (this.options.forwardedProto !== undefined)
      headers.set("x-forwarded-proto", this.options.forwardedProto);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v1/reports/export`, {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({
          readModelName: request.readModelName,
          ...(request.selectedContexts === undefined
            ? {}
            : { selectedContexts: request.selectedContexts }),
        }),
      });
    } catch (error) {
      throw new AuthorityTransportError(
        "The authority server could not be reached (/v1/reports/export).",
        0,
        error instanceof Error ? error.name : "network_error",
      );
    }
    this.credentials.capture(readSetCookies(response));
    const text = await response.text();
    if (!response.ok)
      throw new AuthorityTransportError(
        "The authority server rejected /v1/reports/export.",
        response.status,
      );
    return {
      filename: filenameFromDisposition(response.headers.get("content-disposition")),
      contentType: response.headers.get("content-type") ?? "text/csv; charset=utf-8",
      body: text,
      truncated: response.headers.get("x-adl-report-truncated") === "true",
    };
  }

  /** Bounded, actor-bound access-audit review for one context. */
  async listAccessAudit(request: AuthorityAdministrationClientRequest) {
    return administrationPage(await this.post("/v1/admin/access-audit/list", scopeBody(request)));
  }
  /** Bounded, actor-bound runtime-audit review for one context. */
  async listRuntimeAudit(request: AuthorityAdministrationClientRequest) {
    return administrationPage(await this.post("/v1/admin/runtime-audit/list", scopeBody(request)));
  }
  /** Membership status for one context, revoked memberships included. */
  async listMemberships(request: AuthorityAdministrationClientRequest) {
    return administrationPage(await this.post("/v1/admin/memberships/list", scopeBody(request)));
  }
  /** Invitation status for one context. Tokens and verifiers never leave the server. */
  async listInvites(request: AuthorityAdministrationClientRequest) {
    return administrationPage(await this.post("/v1/admin/invites/list", scopeBody(request)));
  }
  /** Restore-verification status. Counts and flags only. */
  async recoveryStatus(request: AuthorityAdministrationScope): Promise<Record<string, unknown>> {
    return this.post("/v1/admin/recovery/status", scopeBody(request));
  }
  /**
   * Retention status. There is deliberately no counterpart that *runs*
   * retention: it is application-wide and this session is context-scoped.
   */
  async retentionStatus(
    request: AuthorityAdministrationScope,
  ): Promise<Record<string, unknown> | null> {
    const body = await this.post("/v1/admin/retention/status", scopeBody(request));
    return isRecord(body.retention) ? body.retention : null;
  }
  /**
   * Ends every session of a member of the context being administered. The
   * authority refuses a user who is not a current member of that context, so
   * this cannot reach past the caller's own administrative scope.
   *
   * The answer is deliberately a boolean rather than a count: the authority
   * revokes the identity's sessions wholesale and tells the caller whether that
   * applied, not how many rows it touched. How many devices somebody had signed
   * in is not something an administrator is owed, and reporting a count here
   * would be inventing a number the server never sent.
   */
  async revokeUserSessions(
    request: AuthorityAdministrationScope & { userId: string },
  ): Promise<boolean> {
    const body = await this.post("/v1/admin/sessions/revoke", {
      ...scopeBody(request),
      userId: request.userId,
    });
    return body.revoked === true;
  }

  async bootstrap(
    _sessionToken: string | undefined,
    request: AuthorityBootstrapRequest = {},
  ): Promise<AuthorityBootstrapResponse> {
    return (await this.post("/v1/sync/bootstrap", {
      ...(request.selectedContexts === undefined
        ? {}
        : { selectedContexts: request.selectedContexts }),
      ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
      ...(request.limit === undefined ? {} : { limit: request.limit }),
    })) as unknown as AuthorityBootstrapResponse;
  }

  async replay(
    _sessionToken: string | undefined,
    intent: AuthorityOperationIntent,
  ): Promise<AuthorityOutcome> {
    return (await this.post("/v1/sync/replay", {
      ...intent,
    })) as unknown as AuthorityOutcome;
  }

  private async post(
    path: string,
    body: Record<string, unknown>,
    extraHeaders: Record<string, string> = {},
  ): Promise<Record<string, unknown>> {
    const headers = new Headers({ "content-type": "application/json", ...extraHeaders });
    const cookie = this.credentials.cookieHeader();
    if (cookie !== undefined) headers.set("cookie", cookie);
    const csrf = this.credentials.csrfToken();
    if (csrf !== undefined) headers.set("x-adl-csrf-token", csrf);
    if (this.options.origin !== undefined) headers.set("origin", this.options.origin);
    if (this.options.forwardedProto !== undefined)
      headers.set("x-forwarded-proto", this.options.forwardedProto);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify(body),
      });
    } catch (error) {
      // A network failure is retryable, not a verdict: the caller must keep the
      // queued operation rather than mark it rejected.
      throw new AuthorityTransportError(
        `The authority server could not be reached (${path}).`,
        0,
        error instanceof Error ? error.name : "network_error",
      );
    }
    this.credentials.capture(readSetCookies(response));
    const payload = await readJson(response);
    if (!response.ok)
      throw new AuthorityTransportError(
        `The authority server rejected ${path}.`,
        response.status,
        typeof payload?.error === "string" ? payload.error : undefined,
      );
    if (payload === null)
      throw new AuthorityTransportError(`The authority server returned no JSON for ${path}.`, 502);
    return payload;
  }
}

function ceremonyStart(body: Record<string, unknown>): AuthorityPasskeyCeremony {
  const challengeId = body.challengeId;
  const options = body.options;
  if (
    typeof challengeId !== "string" ||
    challengeId.length === 0 ||
    options === null ||
    typeof options !== "object" ||
    Array.isArray(options)
  )
    throw new AuthorityTransportError("The authority server returned no ceremony options.", 502);
  return { challengeId, options: options as Record<string, unknown> };
}

function sessionIdentity(body: Record<string, unknown>): AuthoritySessionIdentity {
  const userId = body.userId;
  if (typeof userId !== "string" || userId.length === 0)
    throw new AuthorityTransportError("The authority server returned no session identity.", 502);
  const expiresAt = typeof body.expiresAt === "string" ? new Date(body.expiresAt) : undefined;
  return {
    userId,
    ...(expiresAt === undefined || Number.isNaN(expiresAt.getTime()) ? {} : { expiresAt }),
  };
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  const text = await response.text();
  if (text.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readSetCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const single = response.headers.get("set-cookie");
  return single === null ? [] : [single];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function scopeBody(request: AuthorityAdministrationClientRequest): Record<string, unknown> {
  return {
    contextName: request.contextName,
    contextId: request.contextId,
    ...(request.limit === undefined ? {} : { limit: request.limit }),
    ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
  };
}

function administrationPage(body: Record<string, unknown>): AuthorityAdministrationPage {
  return {
    entries: Array.isArray(body.entries)
      ? body.entries.filter((entry): entry is Record<string, unknown> => isRecord(entry))
      : [],
    ...(typeof body.nextCursor === "string" ? { nextCursor: body.nextCursor } : {}),
  };
}

/**
 * The filename the authority chose, taken from `content-disposition`. Anything
 * outside a conservative character set is refused and replaced: this string
 * becomes a download name, so it must not be able to carry a path.
 */
function filenameFromDisposition(header: string | null): string {
  const match = header?.match(/filename="([^"]*)"/u)?.[1];
  return match !== undefined && /^[a-z0-9._-]{1,120}$/iu.test(match) ? match : "report.csv";
}

function readCookieValue(header: string, name: string): string | undefined {
  return header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}
