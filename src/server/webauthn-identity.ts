import type { JsonValue } from "../model/resolved-model.js";
import type { AuthorityAccessLifecycleService } from "./access-lifecycle.js";
import type { AuthorityWebAuthnConfiguration } from "./authority-config.js";
import type { IssuedAuthoritySession, OpaqueSessionAdapter } from "./opaque-session-adapter.js";
import { hashSecret } from "./opaque-session-adapter.js";
import type { PostgresQueryable } from "./postgres-authority-store.js";

/**
 * The provider name under which a WebAuthn user handle is linked to an
 * identity. It is one identifier among several: an identity may also hold an
 * `upstream` subject, and both resolve to the same `userId`.
 */
export const PASSKEY_IDENTITY_PROVIDER = "passkey";

export type WebAuthnCeremony = "registration" | "authentication";

/**
 * A registered authenticator. `publicKey` and `credentialId` are not secrets and
 * are stored; no private key, attestation object, or raw assertion ever is.
 */
export interface WebAuthnCredentialRecord {
  credentialId: string;
  userId: string;
  publicKey: string;
  signatureCounter: number;
  transports?: readonly string[];
  backedUp: boolean;
  createdAt: Date;
  lastUsedAt?: Date;
}

/**
 * A server-issued ceremony challenge. It is single-use, short-lived, and bound
 * to the ceremony it was issued for, so a replayed or client-chosen challenge
 * cannot be used. It never enters an accepted record, audit event, operation
 * outcome, sync payload, or log line.
 */
export interface WebAuthnChallengeRecord {
  challengeId: string;
  ceremony: WebAuthnCeremony;
  challenge: string;
  /** Set when the ceremony targets an identity that already exists. */
  userId?: string;
  /** The WebAuthn user handle this registration will link. */
  userHandle?: string;
  inviteTokenHash?: string;
  inviteRecipientUserId?: string;
  createdAt: Date;
  expiresAt: Date;
  consumedAt?: Date;
}

export interface WebAuthnCredentialStore {
  createChallenge(challenge: WebAuthnChallengeRecord): Promise<void>;
  /**
   * Marks a challenge used and returns it, atomically. Returns null when it is
   * unknown, already consumed, expired, or was issued for another ceremony —
   * every one of which must refuse rather than proceed.
   */
  consumeChallenge(
    challengeId: string,
    ceremony: WebAuthnCeremony,
    now: Date,
  ): Promise<WebAuthnChallengeRecord | null>;
  deleteExpiredChallenges(now: Date): Promise<number>;
  createCredential(credential: WebAuthnCredentialRecord): Promise<void>;
  findCredential(credentialId: string): Promise<WebAuthnCredentialRecord | null>;
  listCredentialsForUser(userId: string): Promise<WebAuthnCredentialRecord[]>;
  /**
   * Advances the signature counter. Returns false when the asserted counter did
   * not move forward while the stored one is non-zero, which is the cloned
   * authenticator signal.
   */
  recordCredentialUse(credentialId: string, counter: number, usedAt: Date): Promise<boolean>;
}

/* -------------------------------------------------------------------------- */
/* Library seam                                                                */
/* -------------------------------------------------------------------------- */

export interface WebAuthnRegistrationOptionsRequest {
  relyingParty: AuthorityWebAuthnConfiguration;
  userHandle: string;
  userName: string;
  userDisplayName: string;
  excludeCredentialIds: readonly string[];
}

export interface WebAuthnAuthenticationOptionsRequest {
  relyingParty: AuthorityWebAuthnConfiguration;
  allowCredentialIds?: readonly string[];
}

export interface WebAuthnRegistrationCheck {
  relyingParty: AuthorityWebAuthnConfiguration;
  expectedChallenge: string;
  response: Record<string, JsonValue>;
}

export interface WebAuthnRegistrationVerification {
  verified: boolean;
  credentialId?: string;
  publicKey?: string;
  counter?: number;
  transports?: readonly string[];
  backedUp?: boolean;
}

export interface WebAuthnAuthenticationCheck {
  relyingParty: AuthorityWebAuthnConfiguration;
  expectedChallenge: string;
  response: Record<string, JsonValue>;
  credential: { id: string; publicKey: string; counter: number; transports?: readonly string[] };
}

export interface WebAuthnAuthenticationVerification {
  verified: boolean;
  newCounter?: number;
}

/**
 * Structural boundary over the WebAuthn implementation. `@simplewebauthn/server`
 * is confined to its adapter in `src/server/`, the discipline `pg` already
 * follows, so the resolved model, runtime and UI stay free of it.
 */
export interface WebAuthnLibrary {
  createRegistrationOptions(
    request: WebAuthnRegistrationOptionsRequest,
  ): Promise<{ challenge: string; options: Record<string, JsonValue> }>;
  verifyRegistration(check: WebAuthnRegistrationCheck): Promise<WebAuthnRegistrationVerification>;
  createAuthenticationOptions(
    request: WebAuthnAuthenticationOptionsRequest,
  ): Promise<{ challenge: string; options: Record<string, JsonValue> }>;
  verifyAuthentication(
    check: WebAuthnAuthenticationCheck,
  ): Promise<WebAuthnAuthenticationVerification>;
}

/* -------------------------------------------------------------------------- */
/* Ceremony service                                                            */
/* -------------------------------------------------------------------------- */

export type PasskeyRefusal =
  | "ADL_PASSKEY_UNAUTHORIZED"
  | "ADL_PASSKEY_CHALLENGE_INVALID"
  | "ADL_PASSKEY_ASSERTION_INVALID"
  | "ADL_PASSKEY_CREDENTIAL_IN_USE"
  | "ADL_PASSKEY_CREDENTIAL_UNKNOWN"
  | "ADL_PASSKEY_COUNTER_REGRESSED"
  | "ADL_PASSKEY_INVITE_INVALID";

export class PasskeyCeremonyError extends Error {
  constructor(readonly code: PasskeyRefusal) {
    super(code);
    this.name = "PasskeyCeremonyError";
  }
}

export interface PasskeyCeremonyStart {
  challengeId: string;
  options: Record<string, JsonValue>;
}

export interface PasskeyBeginRegistrationInput {
  /** An authenticated caller adding a further authenticator to their own identity. */
  sessionToken?: string;
  /** An unauthenticated first-time or recovery registration. */
  inviteToken?: string;
}

export interface PasskeyFinishRegistrationInput {
  challengeId: string;
  response: Record<string, JsonValue>;
  /**
   * Re-supplied rather than stored: only its hash lives on the challenge, so a
   * raw invite token never reaches challenge storage, and the token presented
   * here must be the one the ceremony was started with.
   */
  inviteToken?: string;
}

export interface PasskeyRegistrationResult {
  userId: string;
  credentialId: string;
  /** Absent when the caller already held a session; the ceremony does not rotate it. */
  session?: IssuedAuthoritySession;
  /** How the invite, if any, was applied. */
  invite?: "membershipGranted" | "identityRecovered";
}

export interface PasskeyAuthenticationResult {
  userId: string;
  session: IssuedAuthoritySession;
}

export interface PasskeyIdentityServiceOptions {
  now?: () => Date;
  newId?: () => string;
  newUserHandle?: () => string;
  accessLifecycle?: AuthorityAccessLifecycleService;
  /**
   * Whether a caller presenting neither a session nor an invite may mint an
   * identity. Defaults to **false**: the option exists so a deployment whose
   * model declares `REGISTRATION SELF_SERVICE` can turn it on, never so a
   * caller can. See `resolveSelfServiceRegistration`
   * (`src/server/authority-config.ts`), which is the only thing that should
   * ever compute this value.
   */
  selfServiceRegistration?: boolean;
}

/**
 * Server-side WebAuthn ceremonies.
 *
 * Four rules are load-bearing and must survive any edit:
 *
 * 1. The browser never asserts its own identity. An assertion is evidence this
 *    service verifies against a stored public key and a challenge it issued.
 * 2. Registration is anonymous only where the application asked for it. A
 *    caller either already holds a session (adding an authenticator to their
 *    own identity), or presents a valid invite, or the service was constructed
 *    with `selfServiceRegistration: true` — which happens only when the served
 *    model declares `REGISTRATION SELF_SERVICE`, the deployment has not
 *    switched it off, and the identity mode is `passkey`. Nothing else can mint
 *    an identity, and the anonymous case is re-checked at finish so a challenge
 *    cannot outlive the configuration that allowed it.
 * 3. A passkey grants identity only. No ADL role is derived from it; context
 *    roles keep resolving from accepted membership records on every call. A
 *    self-registered identity is therefore a member of nothing, and no
 *    membership row is written anywhere by this path.
 * 4. Recovery re-links. A recipient-bound invite attaches the new credential to
 *    the identity the invite names, so memberships and history stay intact, and
 *    it grants no membership of its own.
 */
export class PasskeyIdentityService {
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly newUserHandle: () => string;
  private readonly accessLifecycle: AuthorityAccessLifecycleService | undefined;
  private readonly selfServiceRegistration: boolean;

  constructor(
    private readonly configuration: AuthorityWebAuthnConfiguration,
    private readonly sessions: OpaqueSessionAdapter,
    private readonly credentials: WebAuthnCredentialStore,
    private readonly library: WebAuthnLibrary,
    options: PasskeyIdentityServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? secureToken;
    this.newUserHandle = options.newUserHandle ?? secureToken;
    this.accessLifecycle = options.accessLifecycle;
    this.selfServiceRegistration = options.selfServiceRegistration ?? false;
  }

  async beginRegistration(input: PasskeyBeginRegistrationInput): Promise<PasskeyCeremonyStart> {
    const now = this.now();
    const session =
      input.sessionToken === undefined ? null : await this.sessions.verify(input.sessionToken);

    let userId: string | undefined;
    let inviteTokenHash: string | undefined;
    let inviteRecipientUserId: string | undefined;
    let userName = "New member";

    if (session !== null) {
      userId = session.userId;
      userName = session.userId;
    } else if (input.inviteToken === undefined) {
      // No session and no invite. Self-service is the only thing that permits
      // this, and it needs no access lifecycle: nothing is being claimed.
      if (!this.selfServiceRegistration) throw new PasskeyCeremonyError("ADL_PASSKEY_UNAUTHORIZED");
    } else {
      if (this.accessLifecycle === undefined)
        throw new PasskeyCeremonyError("ADL_PASSKEY_UNAUTHORIZED");
      const invite = await this.accessLifecycle.peekInvite(input.inviteToken, now);
      if (invite === null) throw new PasskeyCeremonyError("ADL_PASSKEY_INVITE_INVALID");
      inviteTokenHash = await hashSecret(input.inviteToken);
      if (invite.recipientUserId !== undefined) {
        // Recovery: the invite names the identity the new credential attaches to.
        const identity = await this.sessions.findIdentity(invite.recipientUserId);
        if (identity === null || identity.disabledAt !== undefined)
          throw new PasskeyCeremonyError("ADL_PASSKEY_INVITE_INVALID");
        userId = invite.recipientUserId;
        inviteRecipientUserId = invite.recipientUserId;
        userName = invite.recipientUserId;
      }
    }

    // Reuse the handle an identity already registered under, so a second
    // authenticator joins the same identity instead of forking a new one.
    const existing =
      userId === undefined ? [] : await this.credentials.listCredentialsForUser(userId);
    const links = userId === undefined ? [] : await this.sessions.listIdentityLinks(userId);
    const userHandle =
      links.find((link) => link.provider === PASSKEY_IDENTITY_PROVIDER)?.subject ??
      this.newUserHandle();

    const { challenge, options } = await this.library.createRegistrationOptions({
      relyingParty: this.configuration,
      userHandle,
      userName,
      userDisplayName: userName,
      excludeCredentialIds: existing.map((credential) => credential.credentialId),
    });
    const challengeId = `challenge-${this.newId()}`;
    await this.credentials.createChallenge({
      challengeId,
      ceremony: "registration",
      challenge,
      ...(userId === undefined ? {} : { userId }),
      userHandle,
      ...(inviteTokenHash === undefined ? {} : { inviteTokenHash }),
      ...(inviteRecipientUserId === undefined ? {} : { inviteRecipientUserId }),
      createdAt: now,
      expiresAt: new Date(now.getTime() + this.configuration.challengeTtlSeconds * 1000),
    });
    return { challengeId, options };
  }

  async finishRegistration(
    input: PasskeyFinishRegistrationInput,
  ): Promise<PasskeyRegistrationResult> {
    const now = this.now();
    const challenge = await this.credentials.consumeChallenge(
      input.challengeId,
      "registration",
      now,
    );
    if (challenge === null || challenge.userHandle === undefined)
      throw new PasskeyCeremonyError("ADL_PASSKEY_CHALLENGE_INVALID");

    /*
     * Defence in depth, and it is re-checked rather than trusted from `begin`:
     * a challenge that started while self-service was on must not still be
     * finishable after the process restarted with it off, and a forged
     * challenge row must not be a way past the check either.
     */
    const anonymous = challenge.userId === undefined && challenge.inviteTokenHash === undefined;
    if (anonymous && !this.selfServiceRegistration)
      throw new PasskeyCeremonyError("ADL_PASSKEY_UNAUTHORIZED");

    // The invite presented now must be the one the ceremony was started with.
    if (challenge.inviteTokenHash !== undefined) {
      if (input.inviteToken === undefined)
        throw new PasskeyCeremonyError("ADL_PASSKEY_UNAUTHORIZED");
      if ((await hashSecret(input.inviteToken)) !== challenge.inviteTokenHash)
        throw new PasskeyCeremonyError("ADL_PASSKEY_INVITE_INVALID");
    }

    const verification = await this.library.verifyRegistration({
      relyingParty: this.configuration,
      expectedChallenge: challenge.challenge,
      response: input.response,
    });
    if (
      !verification.verified ||
      verification.credentialId === undefined ||
      verification.publicKey === undefined
    )
      throw new PasskeyCeremonyError("ADL_PASSKEY_ASSERTION_INVALID");
    if ((await this.credentials.findCredential(verification.credentialId)) !== null)
      throw new PasskeyCeremonyError("ADL_PASSKEY_CREDENTIAL_IN_USE");

    // Recovery consumes its invite before anything is written, so a
    // simultaneously claimed or revoked invite refuses with nothing granted.
    const recovering = challenge.inviteRecipientUserId !== undefined;
    if (recovering) {
      if (this.accessLifecycle === undefined || input.inviteToken === undefined)
        throw new PasskeyCeremonyError("ADL_PASSKEY_UNAUTHORIZED");
      const redeemed = await this.accessLifecycle.redeemInviteForIdentityRecovery(
        challenge.inviteRecipientUserId as string,
        input.inviteToken,
        now,
      );
      if (!redeemed) throw new PasskeyCeremonyError("ADL_PASSKEY_INVITE_INVALID");
    }

    const userId =
      challenge.userId ??
      (await this.sessions.provisionIdentity(PASSKEY_IDENTITY_PROVIDER, challenge.userHandle))
        .userId;
    if (challenge.userId !== undefined)
      await this.sessions.linkIdentity(userId, PASSKEY_IDENTITY_PROVIDER, challenge.userHandle);

    await this.credentials.createCredential({
      credentialId: verification.credentialId,
      userId,
      publicKey: verification.publicKey,
      signatureCounter: verification.counter ?? 0,
      ...(verification.transports === undefined ? {} : { transports: verification.transports }),
      backedUp: verification.backedUp ?? false,
      createdAt: now,
    });

    /*
     * A ceremony that started *without* a session gets one; a session-gated one
     * keeps the session it already had, because replacing the cookie there
     * would silently swap the caller's session and leave the previous one live,
     * so adding an authenticator deliberately issues nothing.
     *
     * The discriminator used to be `challenge.inviteTokenHash`, which asked the
     * question indirectly and breaks for self-service, which has neither an
     * invite nor a session. This asks it directly, and is behaviour-identical
     * for all three pre-existing cases:
     *
     * | ceremony                     | userId | inviteRecipientUserId | session |
     * | ---------------------------- | ------ | --------------------- | ------- |
     * | add another authenticator    | set    | --                    | no      |
     * | invited new member           | --     | --                    | yes     |
     * | identity recovery            | set    | set                   | yes     |
     * | self-service                 | --     | --                    | yes     |
     */
    const sessionGated =
      challenge.userId !== undefined && challenge.inviteRecipientUserId === undefined;
    const session = sessionGated ? undefined : await this.sessions.issueSession(userId);
    let invite: PasskeyRegistrationResult["invite"];
    if (recovering) invite = "identityRecovered";
    else if (session !== undefined && input.inviteToken !== undefined) {
      // A first-time member is granted the invited membership through the
      // ordinary claim path, so the grant is written by the same server-side
      // transaction as every other claim.
      const claim = await this.accessLifecycle?.claimInvite(
        session.sessionToken,
        input.inviteToken,
      );
      if (claim?.status === "accepted") invite = "membershipGranted";
    }
    return {
      userId,
      credentialId: verification.credentialId,
      ...(session === undefined ? {} : { session }),
      ...(invite === undefined ? {} : { invite }),
    };
  }

  async beginAuthentication(): Promise<PasskeyCeremonyStart> {
    const now = this.now();
    // No allow-list: passkeys are discoverable, so the authenticator names the
    // credential and the authority never has to be told who is signing in.
    const { challenge, options } = await this.library.createAuthenticationOptions({
      relyingParty: this.configuration,
    });
    const challengeId = `challenge-${this.newId()}`;
    await this.credentials.createChallenge({
      challengeId,
      ceremony: "authentication",
      challenge,
      createdAt: now,
      expiresAt: new Date(now.getTime() + this.configuration.challengeTtlSeconds * 1000),
    });
    return { challengeId, options };
  }

  async finishAuthentication(input: {
    challengeId: string;
    response: Record<string, JsonValue>;
  }): Promise<PasskeyAuthenticationResult> {
    const now = this.now();
    const challenge = await this.credentials.consumeChallenge(
      input.challengeId,
      "authentication",
      now,
    );
    if (challenge === null) throw new PasskeyCeremonyError("ADL_PASSKEY_CHALLENGE_INVALID");

    const credentialId = typeof input.response.id === "string" ? input.response.id : undefined;
    if (credentialId === undefined) throw new PasskeyCeremonyError("ADL_PASSKEY_ASSERTION_INVALID");
    const stored = await this.credentials.findCredential(credentialId);
    if (stored === null) throw new PasskeyCeremonyError("ADL_PASSKEY_CREDENTIAL_UNKNOWN");

    const verification = await this.library.verifyAuthentication({
      relyingParty: this.configuration,
      expectedChallenge: challenge.challenge,
      response: input.response,
      credential: {
        id: stored.credentialId,
        publicKey: stored.publicKey,
        counter: stored.signatureCounter,
        ...(stored.transports === undefined ? {} : { transports: stored.transports }),
      },
    });
    if (!verification.verified) throw new PasskeyCeremonyError("ADL_PASSKEY_ASSERTION_INVALID");

    // Checked before the counter is advanced: a disabled identity must leave no
    // trace of the attempt on its credential row.
    const identity = await this.sessions.findIdentity(stored.userId);
    if (identity === null || identity.disabledAt !== undefined)
      throw new PasskeyCeremonyError("ADL_PASSKEY_UNAUTHORIZED");

    // A counter that did not advance while the stored one is non-zero is the
    // cloned-authenticator signal, and it refuses.
    const advanced = await this.credentials.recordCredentialUse(
      stored.credentialId,
      verification.newCounter ?? stored.signatureCounter,
      now,
    );
    if (!advanced) throw new PasskeyCeremonyError("ADL_PASSKEY_COUNTER_REGRESSED");

    return { userId: stored.userId, session: await this.sessions.issueSession(stored.userId) };
  }

  /** Housekeeping for expired challenges; safe to call on any schedule. */
  pruneChallenges(now: Date = this.now()): Promise<number> {
    return this.credentials.deleteExpiredChallenges(now);
  }
}

/* -------------------------------------------------------------------------- */
/* Stores                                                                      */
/* -------------------------------------------------------------------------- */

export class InMemoryWebAuthnCredentialStore implements WebAuthnCredentialStore {
  private readonly challenges = new Map<string, WebAuthnChallengeRecord>();
  private readonly credentials = new Map<string, WebAuthnCredentialRecord>();

  async createChallenge(challenge: WebAuthnChallengeRecord): Promise<void> {
    if (this.challenges.has(challenge.challengeId)) throw new Error("Challenge id collision.");
    this.challenges.set(challenge.challengeId, { ...challenge });
  }
  async consumeChallenge(
    challengeId: string,
    ceremony: WebAuthnCeremony,
    now: Date,
  ): Promise<WebAuthnChallengeRecord | null> {
    const challenge = this.challenges.get(challengeId);
    if (
      challenge === undefined ||
      challenge.ceremony !== ceremony ||
      challenge.consumedAt !== undefined ||
      challenge.expiresAt <= now
    )
      return null;
    challenge.consumedAt = new Date(now);
    return { ...challenge };
  }
  async deleteExpiredChallenges(now: Date): Promise<number> {
    let removed = 0;
    for (const [id, challenge] of this.challenges) {
      if (challenge.expiresAt > now) continue;
      this.challenges.delete(id);
      removed += 1;
    }
    return removed;
  }
  async createCredential(credential: WebAuthnCredentialRecord): Promise<void> {
    if (this.credentials.has(credential.credentialId))
      throw new Error("Credential already registered.");
    this.credentials.set(credential.credentialId, { ...credential });
  }
  async findCredential(credentialId: string): Promise<WebAuthnCredentialRecord | null> {
    const credential = this.credentials.get(credentialId);
    return credential === undefined ? null : { ...credential };
  }
  async listCredentialsForUser(userId: string): Promise<WebAuthnCredentialRecord[]> {
    return [...this.credentials.values()]
      .filter((credential) => credential.userId === userId)
      .map((credential) => ({ ...credential }));
  }
  async recordCredentialUse(credentialId: string, counter: number, usedAt: Date): Promise<boolean> {
    const credential = this.credentials.get(credentialId);
    if (credential === undefined) return false;
    if (!counterAdvanced(credential.signatureCounter, counter)) return false;
    credential.signatureCounter = counter;
    credential.lastUsedAt = new Date(usedAt);
    return true;
  }
}

/** PostgreSQL persistence for registered authenticators and ceremony challenges. */
export class PostgresWebAuthnCredentialStore implements WebAuthnCredentialStore {
  constructor(
    private readonly database: PostgresQueryable,
    private readonly applicationId: string,
  ) {}

  async createChallenge(challenge: WebAuthnChallengeRecord): Promise<void> {
    await this.database.query(
      "insert into adl_authority_webauthn_challenges (challenge_id, application_id, ceremony, challenge, user_id, user_handle, invite_token_hash, invite_recipient_user_id, created_at, expires_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
      [
        challenge.challengeId,
        this.applicationId,
        challenge.ceremony,
        challenge.challenge,
        challenge.userId ?? null,
        challenge.userHandle ?? null,
        challenge.inviteTokenHash ?? null,
        challenge.inviteRecipientUserId ?? null,
        challenge.createdAt,
        challenge.expiresAt,
      ],
    );
  }

  /**
   * Single use is enforced by the update itself: only a row that is still
   * unconsumed, unexpired and of the right ceremony is returned, so two
   * simultaneous finishes cannot both win.
   */
  async consumeChallenge(
    challengeId: string,
    ceremony: WebAuthnCeremony,
    now: Date,
  ): Promise<WebAuthnChallengeRecord | null> {
    const result = await this.database.query<ChallengeRow>(
      "update adl_authority_webauthn_challenges set consumed_at = $4 where application_id = $1 and challenge_id = $2 and ceremony = $3 and consumed_at is null and expires_at > $4 returning challenge_id, ceremony, challenge, user_id, user_handle, invite_token_hash, invite_recipient_user_id, created_at, expires_at, consumed_at",
      [this.applicationId, challengeId, ceremony, now],
    );
    return result.rows[0] === undefined ? null : challengeFromRow(result.rows[0]);
  }

  async deleteExpiredChallenges(now: Date): Promise<number> {
    const result = await this.database.query<{ challenge_id: string }>(
      "delete from adl_authority_webauthn_challenges where application_id = $1 and expires_at <= $2 returning challenge_id",
      [this.applicationId, now],
    );
    return result.rows.length;
  }

  async createCredential(credential: WebAuthnCredentialRecord): Promise<void> {
    await this.database.query(
      "insert into adl_authority_webauthn_credentials (application_id, credential_id, user_id, public_key, signature_counter, transports, backed_up, created_at, last_used_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      [
        this.applicationId,
        credential.credentialId,
        credential.userId,
        credential.publicKey,
        credential.signatureCounter,
        credential.transports === undefined ? null : credential.transports.join(","),
        credential.backedUp,
        credential.createdAt,
        credential.lastUsedAt ?? null,
      ],
    );
  }

  async findCredential(credentialId: string): Promise<WebAuthnCredentialRecord | null> {
    const result = await this.database.query<CredentialRow>(
      "select credential_id, user_id, public_key, signature_counter, transports, backed_up, created_at, last_used_at from adl_authority_webauthn_credentials where application_id = $1 and credential_id = $2",
      [this.applicationId, credentialId],
    );
    return result.rows[0] === undefined ? null : credentialFromRow(result.rows[0]);
  }

  async listCredentialsForUser(userId: string): Promise<WebAuthnCredentialRecord[]> {
    const result = await this.database.query<CredentialRow>(
      "select credential_id, user_id, public_key, signature_counter, transports, backed_up, created_at, last_used_at from adl_authority_webauthn_credentials where application_id = $1 and user_id = $2 order by created_at",
      [this.applicationId, userId],
    );
    return result.rows.map(credentialFromRow);
  }

  /**
   * The counter rule is in the `where` clause, so a regressed counter updates
   * nothing and returns false rather than racing a read-then-write.
   */
  async recordCredentialUse(credentialId: string, counter: number, usedAt: Date): Promise<boolean> {
    const result = await this.database.query<{ credential_id: string }>(
      "update adl_authority_webauthn_credentials set signature_counter = $3, last_used_at = $4 where application_id = $1 and credential_id = $2 and (signature_counter < $3 or (signature_counter = 0 and $3 = 0)) returning credential_id",
      [this.applicationId, credentialId, counter, usedAt],
    );
    return result.rows.length > 0;
  }
}

interface ChallengeRow extends Record<string, unknown> {
  challenge_id: string;
  ceremony: string;
  challenge: string;
  user_id: string | null;
  user_handle: string | null;
  invite_token_hash: string | null;
  invite_recipient_user_id: string | null;
  created_at: Date | string;
  expires_at: Date | string;
  consumed_at: Date | string | null;
}

interface CredentialRow extends Record<string, unknown> {
  credential_id: string;
  user_id: string;
  public_key: string;
  signature_counter: string | number;
  transports: string | null;
  backed_up: boolean;
  created_at: Date | string;
  last_used_at: Date | string | null;
}

function challengeFromRow(row: ChallengeRow): WebAuthnChallengeRecord {
  return {
    challengeId: row.challenge_id,
    ceremony: row.ceremony === "authentication" ? "authentication" : "registration",
    challenge: row.challenge,
    ...(row.user_id === null ? {} : { userId: row.user_id }),
    ...(row.user_handle === null ? {} : { userHandle: row.user_handle }),
    ...(row.invite_token_hash === null ? {} : { inviteTokenHash: row.invite_token_hash }),
    ...(row.invite_recipient_user_id === null
      ? {}
      : { inviteRecipientUserId: row.invite_recipient_user_id }),
    createdAt: new Date(row.created_at),
    expiresAt: new Date(row.expires_at),
    ...(row.consumed_at === null ? {} : { consumedAt: new Date(row.consumed_at) }),
  };
}

function credentialFromRow(row: CredentialRow): WebAuthnCredentialRecord {
  const transports =
    row.transports === null || row.transports.length === 0 ? undefined : row.transports.split(",");
  return {
    credentialId: row.credential_id,
    userId: row.user_id,
    publicKey: row.public_key,
    // bigint arrives as a string from the driver.
    signatureCounter: Number(row.signature_counter),
    ...(transports === undefined ? {} : { transports }),
    backedUp: row.backed_up,
    createdAt: new Date(row.created_at),
    ...(row.last_used_at === null ? {} : { lastUsedAt: new Date(row.last_used_at) }),
  };
}

/**
 * An authenticator that implements a counter must always report a higher one.
 * Some implement none and always report zero; that is permitted, but a
 * previously non-zero counter may never go back to zero or stall.
 */
export function counterAdvanced(stored: number, asserted: number): boolean {
  if (stored === 0 && asserted === 0) return true;
  return asserted > stored;
}

function secureToken(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}
