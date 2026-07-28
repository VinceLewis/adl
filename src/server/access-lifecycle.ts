import type { ResolvedApplicationModel, StoredObjectRecord } from "../model/resolved-model.js";
import { ApplicationRuntime } from "../runtime/application-runtime.js";
import type { ObjectStorageBackend } from "../runtime/object-storage-backend.js";
import { RuntimeContextError, cloneJson } from "../runtime/runtime-types.js";
import type { RuntimeContext } from "../runtime/runtime-types.js";
import type { AuthoritySessionAdapter } from "./authority-types.js";
import { hashSecret } from "./opaque-session-adapter.js";
import type { PostgresQueryable } from "./postgres-authority-store.js";

export interface AuthorityInvite {
  inviteId: string;
  tokenHash: string;
  contextName: string;
  contextId: string;
  role: string;
  recipientUserId?: string;
  createdBy: string;
  createdAt: Date;
  expiresAt: Date;
  claimedBy?: string;
  claimedAt?: Date;
  membershipRecordId?: string;
  revokedAt?: Date;
}

export interface AuthorityAccessAuditEvent {
  accessAuditId: string;
  kind:
    | "inviteCreated"
    | "inviteClaimed"
    | "inviteRevoked"
    | "membershipRevoked"
    | "sessionsRevoked";
  actorId: string;
  contextName: string;
  contextId: string;
  role?: string;
  inviteId?: string;
  membershipRecordId?: string;
  occurredAt: Date;
}

export type AuthorityInviteClaimResult =
  | { status: "accepted"; inviteId: string; membershipRecordId: string }
  | { status: "rejected"; code: "ADL_AUTH_UNAUTHENTICATED" | "ADL_INVITE_INVALID" };

export interface AuthorityInviteGrant {
  membershipObjectName: string;
  membership: StoredObjectRecord;
  audit: AuthorityAccessAuditEvent;
}

export interface AuthorityRevokeInviteInput {
  inviteId: string;
  contextName: string;
  contextId: string;
  revokedAt: Date;
  audit: AuthorityAccessAuditEvent;
}

export interface AuthorityRevokeMembershipStoreInput {
  objectName: string;
  tombstone: StoredObjectRecord;
  audit: AuthorityAccessAuditEvent;
}

export interface AuthorityAccessStore {
  /** Invite row and its creation audit event are written in one transaction. */
  createInvite(invite: AuthorityInvite, audit: AuthorityAccessAuditEvent): Promise<void>;
  /** Revocation and its audit event commit together; audit is skipped if nothing was revoked. */
  revokeInvite(input: AuthorityRevokeInviteInput): Promise<boolean>;
  /** Membership tombstone and its revocation audit event are written in one transaction. */
  revokeMembership(input: AuthorityRevokeMembershipStoreInput): Promise<void>;
  claimInvite(input: {
    tokenHash: string;
    userId: string;
    now: Date;
    prepareGrant: (
      invite: Pick<AuthorityInvite, "inviteId" | "contextName" | "contextId" | "role">,
    ) => AuthorityInviteGrant;
  }): Promise<AuthorityInviteClaimResult>;
  recordAudit(event: AuthorityAccessAuditEvent): Promise<void>;
}

export interface CreateAuthorityInviteInput {
  contextName: string;
  contextId: string;
  role: string;
  expiresAt: Date;
  recipientUserId?: string;
}

export interface CreatedAuthorityInvite {
  inviteId: string;
  inviteToken: string;
  expiresAt: Date;
}

export interface RevokeAuthorityMembershipInput {
  contextName: string;
  contextId: string;
  userId: string;
  role: string;
}

export interface RevokeAuthorityInviteInput {
  inviteId: string;
  contextName: string;
  contextId: string;
}

export interface AuthorityAccessLifecycleOptions {
  now?: () => Date;
  newId?: () => string;
  newToken?: () => string;
}

/**
 * Server-only invite and membership lifecycle. It maps grants to the resolved
 * context membership declaration, never to roles carried by an auth token.
 */
export class AuthorityAccessLifecycleService {
  private readonly runtime: ApplicationRuntime;
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly newToken: () => string;

  constructor(
    model: ResolvedApplicationModel,
    private readonly storage: ObjectStorageBackend,
    private readonly sessions: AuthoritySessionAdapter,
    private readonly store: AuthorityAccessStore,
    options: AuthorityAccessLifecycleOptions = {},
  ) {
    this.runtime = new ApplicationRuntime(model, { storage });
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? secureId;
    this.newToken = options.newToken ?? secureToken;
  }

  async createInvite(
    sessionToken: string | undefined,
    input: CreateAuthorityInviteInput,
  ): Promise<CreatedAuthorityInvite> {
    const session = await this.requireSession(sessionToken);
    const membership = await this.requireMembershipManager(
      session.userId,
      input.contextName,
      input.contextId,
    );
    if (!membership.roles.includes(input.role))
      throw new RuntimeContextError("The invite role is not valid for its context.");
    const now = this.now();
    if (input.expiresAt <= now)
      throw new RuntimeContextError("An invite expiry must be in the future.");
    const inviteToken = this.newToken();
    const invite: AuthorityInvite = {
      inviteId: `invite-${this.newId()}`,
      tokenHash: await hashSecret(inviteToken),
      contextName: input.contextName,
      contextId: input.contextId,
      role: input.role,
      ...(input.recipientUserId === undefined ? {} : { recipientUserId: input.recipientUserId }),
      createdBy: session.userId,
      createdAt: now,
      expiresAt: input.expiresAt,
    };
    await this.store.createInvite(invite, {
      accessAuditId: `access-audit-${this.newId()}`,
      kind: "inviteCreated",
      actorId: session.userId,
      contextName: input.contextName,
      contextId: input.contextId,
      role: input.role,
      inviteId: invite.inviteId,
      occurredAt: now,
    });
    return { inviteId: invite.inviteId, inviteToken, expiresAt: new Date(input.expiresAt) };
  }

  async claimInvite(
    sessionToken: string | undefined,
    inviteToken: string | undefined,
  ): Promise<AuthorityInviteClaimResult> {
    const session = await this.sessions.verify(sessionToken);
    if (session === null) return { status: "rejected", code: "ADL_AUTH_UNAUTHENTICATED" };
    if (inviteToken === undefined || inviteToken.length < 32)
      return { status: "rejected", code: "ADL_INVITE_INVALID" };

    const now = this.now();
    const tokenHash = await hashSecret(inviteToken);
    // The store validates expiry, recipient binding, revocation, single use,
    // and persists the invitation claim and membership grant atomically.
    return this.store.claimInvite({
      tokenHash,
      userId: session.userId,
      now,
      prepareGrant: (invite) => this.prepareInviteGrant(invite, session.userId, now),
    });
  }

  async revokeInvite(
    sessionToken: string | undefined,
    input: RevokeAuthorityInviteInput,
  ): Promise<boolean> {
    const session = await this.requireSession(sessionToken);
    await this.requireMembershipManager(session.userId, input.contextName, input.contextId);
    const now = this.now();
    return this.store.revokeInvite({
      inviteId: input.inviteId,
      contextName: input.contextName,
      contextId: input.contextId,
      revokedAt: now,
      audit: {
        accessAuditId: `access-audit-${this.newId()}`,
        kind: "inviteRevoked",
        actorId: session.userId,
        contextName: input.contextName,
        contextId: input.contextId,
        inviteId: input.inviteId,
        occurredAt: now,
      },
    });
  }

  async revokeMembership(
    sessionToken: string | undefined,
    input: RevokeAuthorityMembershipInput,
  ): Promise<boolean> {
    const session = await this.requireSession(sessionToken);
    const membership = await this.requireMembershipManager(
      session.userId,
      input.contextName,
      input.contextId,
    );
    const record = (await this.storage.listRecords()).find(
      (entry) =>
        entry.objectName === membership.object &&
        entry.record.meta.deletedAt === undefined &&
        entry.record.values[membership.userField] === input.userId &&
        entry.record.values[membership.contextField] === input.contextId &&
        entry.record.values[membership.roleField] === input.role,
    )?.record;
    if (record === undefined) return false;
    const now = this.now();
    const tombstone: StoredObjectRecord = {
      meta: {
        ...record.meta,
        revision: `revoked-${this.newId()}`,
        deletedAt: now.toISOString(),
        updatedAt: now.toISOString(),
        updatedBy: session.userId,
      },
      values: cloneJson(record.values),
    };
    // Revoke sessions first: if the atomic tombstone+audit write then fails, the
    // fail-safe state is "sessions gone, membership still active" (access denied)
    // rather than "membership revoked, stale sessions still valid".
    if (isRevocableSessionAdapter(this.sessions))
      await this.sessions.revokeUserSessions(input.userId);
    await this.store.revokeMembership({
      objectName: membership.object,
      tombstone,
      audit: {
        accessAuditId: `access-audit-${this.newId()}`,
        kind: "membershipRevoked",
        actorId: session.userId,
        contextName: input.contextName,
        contextId: input.contextId,
        role: input.role,
        membershipRecordId: record.meta.guid,
        occurredAt: now,
      },
    });
    return true;
  }

  /**
   * A deliberately narrow incident-response action. The caller must hold the
   * same existing membership-management permission as invite and revocation
   * flows; this never turns a session token into an operational role.
   */
  async revokeUserSessions(
    sessionToken: string | undefined,
    input: { contextName: string; contextId: string; userId: string },
  ): Promise<boolean> {
    const session = await this.requireSession(sessionToken);
    const membership = await this.requireMembershipManager(
      session.userId,
      input.contextName,
      input.contextId,
    );
    const targetHasContextAccess = (await this.storage.listRecords()).some(
      (entry) =>
        entry.objectName === membership.object &&
        entry.record.meta.deletedAt === undefined &&
        entry.record.values[membership.userField] === input.userId &&
        entry.record.values[membership.contextField] === input.contextId,
    );
    if (!targetHasContextAccess) return false;
    if (!isRevocableSessionAdapter(this.sessions)) return false;
    await this.sessions.revokeUserSessions(input.userId);
    await this.store.recordAudit({
      accessAuditId: `access-audit-${this.newId()}`,
      kind: "sessionsRevoked",
      actorId: session.userId,
      contextName: input.contextName,
      contextId: input.contextId,
      occurredAt: this.now(),
    });
    return true;
  }

  /** Used by server-only administration views; authorization remains ADL policy. */
  async requireAdministration(
    sessionToken: string | undefined,
    contextName: string,
    contextId: string,
  ): Promise<{ userId: string }> {
    const session = await this.requireSession(sessionToken);
    await this.requireMembershipManager(session.userId, contextName, contextId);
    return { userId: session.userId };
  }

  private async requireSession(sessionToken: string | undefined) {
    const session = await this.sessions.verify(sessionToken);
    if (session === null) throw new RuntimeContextError("A valid server session is required.");
    return session;
  }

  private async requireMembershipManager(userId: string, contextName: string, contextId: string) {
    const businessContext = (this.runtime.model.contexts ?? []).find(
      (context) => context.name === contextName,
    );
    const membership = businessContext?.membership;
    if (membership === undefined)
      throw new RuntimeContextError(`Context '${contextName}' has no membership declaration.`);
    const context: RuntimeContext = await this.runtime.withSelectedContext(contextName, contextId, {
      userId,
      roles: [],
      channel: "api",
      online: true,
    });
    this.runtime.policyEngine.requireAllowed(
      {
        objectName: membership.object,
        action: "update",
        patch: { [membership.contextField]: contextId },
      },
      context,
    );
    return membership;
  }

  private prepareInviteGrant(
    invite: Pick<AuthorityInvite, "inviteId" | "contextName" | "contextId" | "role">,
    userId: string,
    now: Date,
  ): AuthorityInviteGrant {
    const businessContext = (this.runtime.model.contexts ?? []).find(
      (context) => context.name === invite.contextName,
    );
    const membership = businessContext?.membership;
    if (membership === undefined || !membership.roles.includes(invite.role)) {
      throw new RuntimeContextError("The invite does not describe a valid membership grant.");
    }
    const membershipRecordId = `membership-${this.newId()}`;
    return {
      membershipObjectName: membership.object,
      membership: {
        meta: {
          guid: membershipRecordId,
          object: membership.object,
          schemaVersion: 1,
          revision: "rev-1",
          createdAt: now.toISOString(),
          createdBy: userId,
          updatedAt: now.toISOString(),
          updatedBy: userId,
          syncStatus: "synced",
        },
        values: {
          [membership.userField]: userId,
          [membership.contextField]: invite.contextId,
          [membership.roleField]: invite.role,
        },
      },
      audit: {
        accessAuditId: `access-audit-${this.newId()}`,
        kind: "inviteClaimed",
        actorId: userId,
        contextName: invite.contextName,
        contextId: invite.contextId,
        role: invite.role,
        inviteId: invite.inviteId,
        membershipRecordId,
        occurredAt: now,
      },
    };
  }
}

/** In-memory adapter used by tests; PostgreSQL is the durable production store. */
export class InMemoryAuthorityAccessStore implements AuthorityAccessStore {
  private readonly invitesByHash = new Map<string, AuthorityInvite>();
  private readonly audits: AuthorityAccessAuditEvent[] = [];

  constructor(private readonly storage: ObjectStorageBackend) {}

  async createInvite(invite: AuthorityInvite, audit: AuthorityAccessAuditEvent): Promise<void> {
    if (this.invitesByHash.has(invite.tokenHash)) throw new Error("Invite token collision.");
    this.invitesByHash.set(invite.tokenHash, cloneInvite(invite));
    this.audits.push(cloneAudit(audit));
  }

  async revokeInvite(input: AuthorityRevokeInviteInput): Promise<boolean> {
    for (const invite of this.invitesByHash.values()) {
      if (
        invite.inviteId !== input.inviteId ||
        invite.contextName !== input.contextName ||
        invite.contextId !== input.contextId ||
        invite.claimedBy !== undefined ||
        invite.revokedAt !== undefined
      )
        continue;
      invite.revokedAt = new Date(input.revokedAt);
      this.audits.push(cloneAudit(input.audit));
      return true;
    }
    return false;
  }

  async revokeMembership(input: AuthorityRevokeMembershipStoreInput): Promise<void> {
    await this.storage.update(input.objectName, input.tombstone);
    this.audits.push(cloneAudit(input.audit));
  }

  async claimInvite(input: {
    tokenHash: string;
    userId: string;
    now: Date;
    prepareGrant: (
      invite: Pick<AuthorityInvite, "inviteId" | "contextName" | "contextId" | "role">,
    ) => AuthorityInviteGrant;
  }): Promise<AuthorityInviteClaimResult> {
    const invite = this.invitesByHash.get(input.tokenHash);
    if (
      invite === undefined ||
      invite.revokedAt !== undefined ||
      invite.expiresAt <= input.now ||
      (invite.recipientUserId !== undefined && invite.recipientUserId !== input.userId)
    ) {
      return { status: "rejected", code: "ADL_INVITE_INVALID" };
    }
    if (invite.claimedBy !== undefined) {
      return invite.claimedBy === input.userId && invite.membershipRecordId !== undefined
        ? {
            status: "accepted",
            inviteId: invite.inviteId,
            membershipRecordId: invite.membershipRecordId,
          }
        : { status: "rejected", code: "ADL_INVITE_INVALID" };
    }
    const grant = input.prepareGrant(invite);
    await this.storage.create(grant.membershipObjectName, grant.membership);
    invite.claimedBy = input.userId;
    invite.claimedAt = new Date(input.now);
    invite.membershipRecordId = grant.membership.meta.guid;
    this.audits.push(cloneAudit(grant.audit));
    return {
      status: "accepted",
      inviteId: invite.inviteId,
      membershipRecordId: grant.membership.meta.guid,
    };
  }

  async recordAudit(event: AuthorityAccessAuditEvent): Promise<void> {
    this.audits.push(cloneAudit(event));
  }
  getAuditEvents(): AuthorityAccessAuditEvent[] {
    return this.audits.map(cloneAudit);
  }
}

/** PostgreSQL store; `claimInvite` holds the invite row while inserting membership and audit. */
export class PostgresAuthorityAccessStore implements AuthorityAccessStore {
  constructor(
    private readonly database: PostgresQueryable,
    private readonly applicationId: string,
  ) {}
  async createInvite(invite: AuthorityInvite, audit: AuthorityAccessAuditEvent): Promise<void> {
    await this.database.query("begin");
    try {
      await this.database.query(
        "insert into adl_authority_invites (invite_id, application_id, token_hash, context_name, context_id, role, recipient_user_id, created_by, created_at, expires_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        [
          invite.inviteId,
          this.applicationId,
          invite.tokenHash,
          invite.contextName,
          invite.contextId,
          invite.role,
          invite.recipientUserId ?? null,
          invite.createdBy,
          invite.createdAt,
          invite.expiresAt,
        ],
      );
      await this.writeAudit(audit);
      await this.database.query("commit");
    } catch (error) {
      await this.database.query("rollback");
      throw error;
    }
  }
  async revokeInvite(input: AuthorityRevokeInviteInput): Promise<boolean> {
    await this.database.query("begin");
    try {
      const result = await this.database.query<{ invite_id: string }>(
        "update adl_authority_invites set revoked_at = $5 where application_id = $1 and invite_id = $2 and context_name = $3 and context_id = $4 and claimed_by is null and revoked_at is null returning invite_id",
        [this.applicationId, input.inviteId, input.contextName, input.contextId, input.revokedAt],
      );
      if (result.rows.length === 0) {
        await this.database.query("rollback");
        return false;
      }
      await this.writeAudit(input.audit);
      await this.database.query("commit");
      return true;
    } catch (error) {
      await this.database.query("rollback");
      throw error;
    }
  }
  async revokeMembership(input: AuthorityRevokeMembershipStoreInput): Promise<void> {
    await this.database.query("begin");
    try {
      const result = await this.database.query<{ record_id: string }>(
        "update adl_authority_records set revision = $4, deleted_at = $5, record = $6::jsonb where application_id = $1 and object_name = $2 and record_id = $3 returning record_id",
        [
          this.applicationId,
          input.objectName,
          input.tombstone.meta.guid,
          input.tombstone.meta.revision,
          input.tombstone.meta.deletedAt ?? null,
          JSON.stringify(input.tombstone),
        ],
      );
      if (result.rows.length === 0)
        throw new Error(`Membership record '${input.tombstone.meta.guid}' is missing.`);
      await this.writeAudit(input.audit);
      await this.database.query("commit");
    } catch (error) {
      await this.database.query("rollback");
      throw error;
    }
  }
  async claimInvite(input: {
    tokenHash: string;
    userId: string;
    now: Date;
    prepareGrant: (
      invite: Pick<AuthorityInvite, "inviteId" | "contextName" | "contextId" | "role">,
    ) => AuthorityInviteGrant;
  }): Promise<AuthorityInviteClaimResult> {
    await this.database.query("begin");
    try {
      const result = await this.database.query<InviteRow>(
        "select invite_id, context_name, context_id, role, recipient_user_id, expires_at, claimed_by, membership_record_id, revoked_at from adl_authority_invites where application_id = $1 and token_hash = $2 for update",
        [this.applicationId, input.tokenHash],
      );
      const invite = result.rows[0];
      if (!inviteValid(invite, input.userId, input.now)) {
        await this.database.query("rollback");
        return { status: "rejected", code: "ADL_INVITE_INVALID" };
      }
      if (invite.claimed_by !== null) {
        await this.database.query("rollback");
        return invite.claimed_by === input.userId && invite.membership_record_id !== null
          ? {
              status: "accepted",
              inviteId: invite.invite_id,
              membershipRecordId: invite.membership_record_id,
            }
          : { status: "rejected", code: "ADL_INVITE_INVALID" };
      }
      const grant = input.prepareGrant({
        inviteId: invite.invite_id,
        contextName: invite.context_name,
        contextId: invite.context_id,
        role: invite.role,
      });
      await this.database.query(
        "insert into adl_authority_records (application_id, object_name, record_id, revision, deleted_at, record) values ($1, $2, $3, $4, $5, $6::jsonb)",
        [
          this.applicationId,
          grant.membershipObjectName,
          grant.membership.meta.guid,
          grant.membership.meta.revision,
          null,
          JSON.stringify(grant.membership),
        ],
      );
      await this.database.query(
        "update adl_authority_invites set claimed_by = $3, claimed_at = $4, membership_record_id = $5 where invite_id = $1 and application_id = $2",
        [invite.invite_id, this.applicationId, input.userId, input.now, grant.membership.meta.guid],
      );
      await this.writeAudit(grant.audit);
      await this.database.query("commit");
      return {
        status: "accepted",
        inviteId: invite.invite_id,
        membershipRecordId: grant.membership.meta.guid,
      };
    } catch (error) {
      await this.database.query("rollback");
      throw error;
    }
  }
  async recordAudit(event: AuthorityAccessAuditEvent): Promise<void> {
    await this.writeAudit(event);
  }
  private async writeAudit(event: AuthorityAccessAuditEvent): Promise<void> {
    await this.database.query(
      "insert into adl_authority_access_audit_events (access_audit_id, application_id, event, occurred_at) values ($1, $2, $3::jsonb, $4)",
      [event.accessAuditId, this.applicationId, JSON.stringify(event), event.occurredAt],
    );
  }
}

interface InviteRow extends Record<string, unknown> {
  invite_id: string;
  context_name: string;
  context_id: string;
  role: string;
  recipient_user_id: string | null;
  expires_at: Date | string;
  claimed_by: string | null;
  membership_record_id: string | null;
  revoked_at: Date | string | null;
}

function inviteValid(
  invite: InviteRow | undefined,
  userId: string,
  now: Date,
): invite is InviteRow {
  return (
    invite !== undefined &&
    invite.revoked_at === null &&
    new Date(invite.expires_at) > now &&
    (invite.recipient_user_id === null || invite.recipient_user_id === userId)
  );
}
function isRevocableSessionAdapter(
  sessions: AuthoritySessionAdapter,
): sessions is AuthoritySessionAdapter & { revokeUserSessions(userId: string): Promise<void> } {
  return "revokeUserSessions" in sessions;
}
function cloneInvite(invite: AuthorityInvite): AuthorityInvite {
  return {
    ...invite,
    createdAt: new Date(invite.createdAt),
    expiresAt: new Date(invite.expiresAt),
    ...(invite.claimedAt === undefined ? {} : { claimedAt: new Date(invite.claimedAt) }),
    ...(invite.revokedAt === undefined ? {} : { revokedAt: new Date(invite.revokedAt) }),
  };
}
function cloneAudit(event: AuthorityAccessAuditEvent): AuthorityAccessAuditEvent {
  return { ...event, occurredAt: new Date(event.occurredAt) };
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
