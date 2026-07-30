import type { AuthoritySession, AuthoritySessionAdapter } from "./authority-types.js";
import type { PostgresQueryable } from "./postgres-authority-store.js";

/**
 * A stable internal identity. It deliberately carries no external identifier:
 * every one of those lives in {@link AuthorityIdentityLink}, so changing
 * provider, adding a second method, or running two in parallel is linking an
 * identifier rather than re-keying the user id that memberships, sessions and
 * audit rows all reference.
 */
export interface AuthorityIdentity {
  userId: string;
  createdAt: Date;
  disabledAt?: Date;
}

/**
 * One external identifier for an identity. `provider` names the mechanism that
 * produced the subject (`passkey`, `upstream`, `bypass`, `legacy`), so two
 * providers may mint the same subject string without colliding.
 */
export interface AuthorityIdentityLink {
  provider: string;
  subject: string;
  userId: string;
  linkedAt: Date;
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
  /** Resolve an identity through one of its external identifiers. */
  findIdentityByLink(provider: string, subject: string): Promise<AuthorityIdentity | null>;
  /** The identity and its first identifier are written together. */
  createIdentity(identity: AuthorityIdentity, link: AuthorityIdentityLink): Promise<void>;
  /** Add a further identifier to an existing identity. */
  linkIdentity(link: AuthorityIdentityLink): Promise<void>;
  listIdentityLinks(userId: string): Promise<AuthorityIdentityLink[]>;
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

  /**
   * Resolves the identity holding `(provider, subject)`, minting one on a miss.
   * The provider is part of the key, so switching provider adds an identifier
   * rather than silently creating a second user.
   */
  async provisionIdentity(provider: string, subject: string): Promise<AuthorityIdentity> {
    assertIdentityKeyPart(provider, "provider");
    assertIdentityKeyPart(subject, "subject");
    const existing = await this.store.findIdentityByLink(provider, subject);
    if (existing !== null) return existing;
    const now = this.now();
    const identity: AuthorityIdentity = { userId: `user-${this.newId()}`, createdAt: now };
    await this.store.createIdentity(identity, {
      provider,
      subject,
      userId: identity.userId,
      linkedAt: now,
    });
    return { ...identity };
  }

  /**
   * Adds a further external identifier to an existing identity. This is the
   * mechanism that makes a provider or method change survivable: the same
   * `userId` — and therefore every membership scoped by it — is reached through
   * either identifier. Linking an identifier already held by a different
   * identity is refused rather than silently re-pointed.
   */
  async linkIdentity(
    userId: string,
    provider: string,
    subject: string,
  ): Promise<AuthorityIdentityLink> {
    assertIdentityKeyPart(provider, "provider");
    assertIdentityKeyPart(subject, "subject");
    const identity = await this.store.findIdentityByUserId(userId);
    if (identity === null || identity.disabledAt !== undefined)
      throw new Error("Cannot link an identifier to an unknown or disabled identity.");
    const held = await this.store.findIdentityByLink(provider, subject);
    if (held !== null && held.userId !== userId)
      throw new Error("That identifier already belongs to another identity.");
    const link: AuthorityIdentityLink = { provider, subject, userId, linkedAt: this.now() };
    if (held === null) await this.store.linkIdentity(link);
    return { ...link };
  }

  listIdentityLinks(userId: string): Promise<AuthorityIdentityLink[]> {
    return this.store.listIdentityLinks(userId);
  }

  findIdentity(userId: string): Promise<AuthorityIdentity | null> {
    return this.store.findIdentityByUserId(userId);
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
  private readonly linksByKey = new Map<string, AuthorityIdentityLink>();
  private readonly sessionsByHash = new Map<string, AuthoritySessionRecord>();

  async findIdentityByUserId(userId: string): Promise<AuthorityIdentity | null> {
    return cloneIdentity(this.identitiesByUserId.get(userId));
  }
  async findIdentityByLink(provider: string, subject: string): Promise<AuthorityIdentity | null> {
    const link = this.linksByKey.get(linkKey(provider, subject));
    return link === undefined ? null : this.findIdentityByUserId(link.userId);
  }
  async createIdentity(identity: AuthorityIdentity, link: AuthorityIdentityLink): Promise<void> {
    if (this.identitiesByUserId.has(identity.userId)) throw new Error("Identity already exists.");
    if (this.linksByKey.has(linkKey(link.provider, link.subject)))
      throw new Error("Identity link already exists.");
    this.identitiesByUserId.set(identity.userId, cloneIdentity(identity)!);
    this.linksByKey.set(linkKey(link.provider, link.subject), { ...link });
  }
  async linkIdentity(link: AuthorityIdentityLink): Promise<void> {
    if (!this.identitiesByUserId.has(link.userId)) throw new Error("Identity does not exist.");
    if (this.linksByKey.has(linkKey(link.provider, link.subject)))
      throw new Error("Identity link already exists.");
    this.linksByKey.set(linkKey(link.provider, link.subject), { ...link });
  }
  async listIdentityLinks(userId: string): Promise<AuthorityIdentityLink[]> {
    return [...this.linksByKey.values()]
      .filter((link) => link.userId === userId)
      .map((link) => ({ ...link, linkedAt: new Date(link.linkedAt) }));
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
      "select user_id, created_at, disabled_at from adl_authority_identities where application_id = $1 and user_id = $2",
      [this.applicationId, userId],
    );
    return result.rows[0] === undefined ? null : identityFromRow(result.rows[0]);
  }
  async findIdentityByLink(provider: string, subject: string): Promise<AuthorityIdentity | null> {
    const result = await this.database.query<IdentityRow>(
      "select identity.user_id, identity.created_at, identity.disabled_at from adl_authority_identity_links link join adl_authority_identities identity on identity.application_id = link.application_id and identity.user_id = link.user_id where link.application_id = $1 and link.provider = $2 and link.subject = $3",
      [this.applicationId, provider, subject],
    );
    return result.rows[0] === undefined ? null : identityFromRow(result.rows[0]);
  }
  /** The identity row and its first identifier commit together or not at all. */
  async createIdentity(identity: AuthorityIdentity, link: AuthorityIdentityLink): Promise<void> {
    await this.database.query("begin");
    try {
      await this.database.query(
        "insert into adl_authority_identities (application_id, user_id, created_at, disabled_at) values ($1, $2, $3, $4)",
        [this.applicationId, identity.userId, identity.createdAt, identity.disabledAt ?? null],
      );
      await this.insertLink(link);
      await this.database.query("commit");
    } catch (error) {
      await this.database.query("rollback");
      throw error;
    }
  }
  async linkIdentity(link: AuthorityIdentityLink): Promise<void> {
    await this.insertLink(link);
  }
  async listIdentityLinks(userId: string): Promise<AuthorityIdentityLink[]> {
    const result = await this.database.query<IdentityLinkRow>(
      "select provider, subject, user_id, linked_at from adl_authority_identity_links where application_id = $1 and user_id = $2 order by linked_at, provider, subject",
      [this.applicationId, userId],
    );
    return result.rows.map((row) => ({
      provider: row.provider,
      subject: row.subject,
      userId: row.user_id,
      linkedAt: new Date(row.linked_at),
    }));
  }
  private async insertLink(link: AuthorityIdentityLink): Promise<void> {
    await this.database.query(
      "insert into adl_authority_identity_links (application_id, provider, subject, user_id, linked_at) values ($1, $2, $3, $4, $5)",
      [this.applicationId, link.provider, link.subject, link.userId, link.linkedAt],
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
  created_at: Date | string;
  disabled_at: Date | string | null;
}
interface IdentityLinkRow extends Record<string, unknown> {
  provider: string;
  subject: string;
  user_id: string;
  linked_at: Date | string;
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

function linkKey(provider: string, subject: string): string {
  // Length-prefixed so ("a", "b:c") and ("a:b", "c") cannot collide.
  return `${provider.length}:${provider}:${subject}`;
}

/**
 * Both halves of an identity key reach a PostgreSQL text column, so the same
 * shape check the bypass applied to a subject applies to every identifier: real
 * PostgreSQL refuses a NUL byte in a text key, and an unbounded key must never
 * reach identity storage.
 */
export function assertIdentityKeyPart(value: string, part: "provider" | "subject"): void {
  if (value.trim().length === 0) throw new Error(`An identity ${part} is required.`);
  if (value.length > 320) throw new Error(`An identity ${part} is too long.`);
  if (/[\u0000-\u001f\u007f]/u.test(value))
    throw new Error(`An identity ${part} must not contain control characters.`);
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
