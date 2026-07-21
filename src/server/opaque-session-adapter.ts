import type { AuthoritySession, AuthoritySessionAdapter } from "./authority-types.js";
import type { PostgresQueryable } from "./postgres-authority-store.js";

export interface AuthorityIdentity {
  userId: string;
  subject: string;
  createdAt: Date;
  disabledAt?: Date;
}

export interface AuthoritySessionRecord {
  sessionId: string;
  userId: string;
  tokenHash: string;
  issuedAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
  rotatedToSessionId?: string;
}

/** Storage boundary for a custom opaque-session authority adapter. */
export interface AuthorityIdentitySessionStore {
  findIdentityByUserId(userId: string): Promise<AuthorityIdentity | null>;
  findIdentityBySubject(subject: string): Promise<AuthorityIdentity | null>;
  createIdentity(identity: AuthorityIdentity): Promise<void>;
  findSessionByTokenHash(tokenHash: string): Promise<AuthoritySessionRecord | null>;
  createSession(session: AuthoritySessionRecord): Promise<void>;
  revokeSession(sessionId: string, revokedAt: Date, rotatedToSessionId?: string): Promise<void>;
  revokeSessionsForUser(userId: string, revokedAt: Date): Promise<void>;
}

export interface IssuedAuthoritySession {
  sessionId: string;
  sessionToken: string;
  userId: string;
  expiresAt: Date;
}

export interface OpaqueSessionAdapterOptions {
  now?: () => Date;
  sessionTtlMs?: number;
  newId?: () => string;
  newToken?: () => string;
}

/**
 * Production adapter for server-issued opaque sessions. The caller must invoke
 * provisioning/issuance only after its own trusted account proof; this class
 * intentionally never accepts business roles or memberships as auth claims.
 */
export class OpaqueSessionAdapter implements AuthoritySessionAdapter {
  private readonly now: () => Date;
  private readonly sessionTtlMs: number;
  private readonly newId: () => string;
  private readonly newToken: () => string;

  constructor(
    private readonly store: AuthorityIdentitySessionStore,
    options: OpaqueSessionAdapterOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.sessionTtlMs = options.sessionTtlMs ?? 1000 * 60 * 60 * 8;
    this.newId = options.newId ?? secureId;
    this.newToken = options.newToken ?? secureToken;
  }

  async provisionIdentity(subject: string): Promise<AuthorityIdentity> {
    if (subject.trim().length === 0) throw new Error("An identity subject is required.");
    const existing = await this.store.findIdentityBySubject(subject);
    if (existing !== null) return existing;
    const identity: AuthorityIdentity = {
      userId: `user-${this.newId()}`,
      subject,
      createdAt: this.now(),
    };
    await this.store.createIdentity(identity);
    return { ...identity };
  }

  async issueSession(userId: string, expiresAt?: Date): Promise<IssuedAuthoritySession> {
    const identity = await this.store.findIdentityByUserId(userId);
    const now = this.now();
    if (identity === null || identity.disabledAt !== undefined) {
      throw new Error("Cannot issue a session for an unknown or disabled identity.");
    }
    const sessionToken = this.newToken();
    const session: AuthoritySessionRecord = {
      sessionId: `session-${this.newId()}`,
      userId,
      tokenHash: await hashSecret(sessionToken),
      issuedAt: now,
      expiresAt: expiresAt ?? new Date(now.getTime() + this.sessionTtlMs),
    };
    if (session.expiresAt <= now) throw new Error("A session expiry must be in the future.");
    await this.store.createSession(session);
    return {
      sessionId: session.sessionId,
      sessionToken,
      userId,
      expiresAt: new Date(session.expiresAt),
    };
  }

  async verify(sessionToken: string | undefined): Promise<AuthoritySession | null> {
    if (sessionToken === undefined || sessionToken.length < 32) return null;
    const session = await this.store.findSessionByTokenHash(await hashSecret(sessionToken));
    if (session === null || session.revokedAt !== undefined || session.expiresAt <= this.now())
      return null;
    const identity = await this.store.findIdentityByUserId(session.userId);
    if (identity === null || identity.disabledAt !== undefined) return null;
    return { userId: session.userId, expiresAt: new Date(session.expiresAt) };
  }

  async signOut(sessionToken: string | undefined): Promise<void> {
    if (sessionToken === undefined) return;
    const session = await this.store.findSessionByTokenHash(await hashSecret(sessionToken));
    if (session !== null) await this.store.revokeSession(session.sessionId, this.now());
  }

  async rotate(
    sessionToken: string | undefined,
    expiresAt?: Date,
  ): Promise<IssuedAuthoritySession | null> {
    if (sessionToken === undefined) return null;
    const session = await this.store.findSessionByTokenHash(await hashSecret(sessionToken));
    if (session === null || session.revokedAt !== undefined || session.expiresAt <= this.now())
      return null;
    const replacement = await this.issueSession(session.userId, expiresAt);
    await this.store.revokeSession(session.sessionId, this.now(), replacement.sessionId);
    return replacement;
  }

  async revokeUserSessions(userId: string): Promise<void> {
    await this.store.revokeSessionsForUser(userId, this.now());
  }
}

export class InMemoryAuthorityIdentitySessionStore implements AuthorityIdentitySessionStore {
  private readonly identitiesByUserId = new Map<string, AuthorityIdentity>();
  private readonly userIdBySubject = new Map<string, string>();
  private readonly sessionsByHash = new Map<string, AuthoritySessionRecord>();

  async findIdentityByUserId(userId: string): Promise<AuthorityIdentity | null> {
    return cloneIdentity(this.identitiesByUserId.get(userId));
  }
  async findIdentityBySubject(subject: string): Promise<AuthorityIdentity | null> {
    const userId = this.userIdBySubject.get(subject);
    return userId === undefined ? null : this.findIdentityByUserId(userId);
  }
  async createIdentity(identity: AuthorityIdentity): Promise<void> {
    if (
      this.identitiesByUserId.has(identity.userId) ||
      this.userIdBySubject.has(identity.subject)
    ) {
      throw new Error("Identity already exists.");
    }
    this.identitiesByUserId.set(identity.userId, cloneIdentity(identity)!);
    this.userIdBySubject.set(identity.subject, identity.userId);
  }
  async findSessionByTokenHash(tokenHash: string): Promise<AuthoritySessionRecord | null> {
    return cloneSession(this.sessionsByHash.get(tokenHash));
  }
  async createSession(session: AuthoritySessionRecord): Promise<void> {
    if (this.sessionsByHash.has(session.tokenHash)) throw new Error("Session token collision.");
    this.sessionsByHash.set(session.tokenHash, cloneSession(session)!);
  }
  async revokeSession(
    sessionId: string,
    revokedAt: Date,
    rotatedToSessionId?: string,
  ): Promise<void> {
    for (const session of this.sessionsByHash.values()) {
      if (session.sessionId !== sessionId) continue;
      session.revokedAt ??= new Date(revokedAt);
      if (rotatedToSessionId !== undefined) session.rotatedToSessionId = rotatedToSessionId;
      return;
    }
  }
  async revokeSessionsForUser(userId: string, revokedAt: Date): Promise<void> {
    for (const session of this.sessionsByHash.values()) {
      if (session.userId === userId) session.revokedAt ??= new Date(revokedAt);
    }
  }
}

/** PostgreSQL persistence for opaque identities and token verifiers. */
export class PostgresAuthorityIdentitySessionStore implements AuthorityIdentitySessionStore {
  constructor(
    private readonly database: PostgresQueryable,
    private readonly applicationId: string,
  ) {}
  async findIdentityByUserId(userId: string): Promise<AuthorityIdentity | null> {
    const result = await this.database.query<IdentityRow>(
      "select user_id, subject, created_at, disabled_at from adl_authority_identities where application_id = $1 and user_id = $2",
      [this.applicationId, userId],
    );
    return result.rows[0] === undefined ? null : identityFromRow(result.rows[0]);
  }
  async findIdentityBySubject(subject: string): Promise<AuthorityIdentity | null> {
    const result = await this.database.query<IdentityRow>(
      "select user_id, subject, created_at, disabled_at from adl_authority_identities where application_id = $1 and subject = $2",
      [this.applicationId, subject],
    );
    return result.rows[0] === undefined ? null : identityFromRow(result.rows[0]);
  }
  async createIdentity(identity: AuthorityIdentity): Promise<void> {
    await this.database.query(
      "insert into adl_authority_identities (application_id, user_id, subject, created_at, disabled_at) values ($1, $2, $3, $4, $5)",
      [
        this.applicationId,
        identity.userId,
        identity.subject,
        identity.createdAt,
        identity.disabledAt ?? null,
      ],
    );
  }
  async findSessionByTokenHash(tokenHash: string): Promise<AuthoritySessionRecord | null> {
    const result = await this.database.query<SessionRow>(
      "select session_id, user_id, token_hash, issued_at, expires_at, revoked_at, rotated_to_session_id from adl_authority_sessions where application_id = $1 and token_hash = $2",
      [this.applicationId, tokenHash],
    );
    return result.rows[0] === undefined ? null : sessionFromRow(result.rows[0]);
  }
  async createSession(session: AuthoritySessionRecord): Promise<void> {
    await this.database.query(
      "insert into adl_authority_sessions (session_id, application_id, user_id, token_hash, issued_at, expires_at) values ($1, $2, $3, $4, $5, $6)",
      [
        session.sessionId,
        this.applicationId,
        session.userId,
        session.tokenHash,
        session.issuedAt,
        session.expiresAt,
      ],
    );
  }
  async revokeSession(
    sessionId: string,
    revokedAt: Date,
    rotatedToSessionId?: string,
  ): Promise<void> {
    await this.database.query(
      "update adl_authority_sessions set revoked_at = coalesce(revoked_at, $3), rotated_to_session_id = coalesce(rotated_to_session_id, $4) where application_id = $1 and session_id = $2",
      [this.applicationId, sessionId, revokedAt, rotatedToSessionId ?? null],
    );
  }
  async revokeSessionsForUser(userId: string, revokedAt: Date): Promise<void> {
    await this.database.query(
      "update adl_authority_sessions set revoked_at = coalesce(revoked_at, $3) where application_id = $1 and user_id = $2",
      [this.applicationId, userId, revokedAt],
    );
  }
}

interface IdentityRow extends Record<string, unknown> {
  user_id: string;
  subject: string;
  created_at: Date | string;
  disabled_at: Date | string | null;
}
interface SessionRow extends Record<string, unknown> {
  session_id: string;
  user_id: string;
  token_hash: string;
  issued_at: Date | string;
  expires_at: Date | string;
  revoked_at: Date | string | null;
  rotated_to_session_id: string | null;
}

function identityFromRow(row: IdentityRow): AuthorityIdentity {
  return {
    userId: row.user_id,
    subject: row.subject,
    createdAt: new Date(row.created_at),
    ...(row.disabled_at === null ? {} : { disabledAt: new Date(row.disabled_at) }),
  };
}
function sessionFromRow(row: SessionRow): AuthoritySessionRecord {
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    issuedAt: new Date(row.issued_at),
    expiresAt: new Date(row.expires_at),
    ...(row.revoked_at === null ? {} : { revokedAt: new Date(row.revoked_at) }),
    ...(row.rotated_to_session_id === null
      ? {}
      : { rotatedToSessionId: row.rotated_to_session_id }),
  };
}
function cloneIdentity(identity: AuthorityIdentity | undefined): AuthorityIdentity | null {
  return identity === undefined
    ? null
    : {
        ...identity,
        createdAt: new Date(identity.createdAt),
        ...(identity.disabledAt === undefined ? {} : { disabledAt: new Date(identity.disabledAt) }),
      };
}
function cloneSession(session: AuthoritySessionRecord | undefined): AuthoritySessionRecord | null {
  return session === undefined
    ? null
    : {
        ...session,
        issuedAt: new Date(session.issuedAt),
        expiresAt: new Date(session.expiresAt),
        ...(session.revokedAt === undefined ? {} : { revokedAt: new Date(session.revokedAt) }),
      };
}

export async function hashSecret(secret: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function secureId(): string {
  return secureToken();
}
function secureToken(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}
