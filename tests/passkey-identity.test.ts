import { describe, expect, it } from "vitest";
import {
  AuthorityAccessLifecycleService,
  InMemoryAuthorityAccessStore,
  InMemoryAuthorityIdentitySessionStore,
  InMemoryObjectStorageBackend,
  InMemoryWebAuthnCredentialStore,
  OpaqueSessionAdapter,
  PASSKEY_IDENTITY_PROVIDER,
  PasskeyIdentityService,
  counterAdvanced,
  resolveApplicationModel,
} from "../src/index.js";
import type {
  AuthorityIdentity,
  AuthoritySessionRecord,
  AuthorityWebAuthnConfiguration,
  CreatedAuthorityInvite,
  IssuedAuthoritySession,
  JsonValue,
  StoredObjectRecord,
  WebAuthnAuthenticationCheck,
  WebAuthnAuthenticationOptionsRequest,
  WebAuthnAuthenticationVerification,
  WebAuthnLibrary,
  WebAuthnRegistrationCheck,
  WebAuthnRegistrationOptionsRequest,
  WebAuthnRegistrationVerification,
} from "../src/index.js";

/**
 * The Phase 49 ceremony rules, proven hermetically. The cryptography itself is
 * the library's job and is proven against the real library and real PostgreSQL
 * in `tests/integration/`; what is proven here is everything the authority
 * decides around it — who may register at all, that a challenge is server
 * issued, single-use, short-lived and bound to its ceremony, that a cloned or
 * forged authenticator is refused with no session issued, and that recovery
 * re-links rather than re-keys.
 */

const webauthn: AuthorityWebAuthnConfiguration = {
  relyingPartyId: "app.test",
  relyingPartyName: "ADL authority test",
  origins: ["https://app.test"],
  challengeTtlSeconds: 300,
};

const model = resolveApplicationModel({
  app: { name: "Passkey identity fixture", startView: "BandList" },
  roles: [{ name: "BandAdmin" }, { name: "BandMember" }],
  contexts: [
    {
      name: "Band",
      object: "Band",
      selection: { mode: "optional" },
      membership: {
        object: "BandMember",
        userField: "User",
        contextField: "Band",
        roleField: "Role",
        roles: ["BandAdmin", "BandMember"],
      },
    },
  ],
  objects: [
    {
      name: "Band",
      fields: [{ name: "Name", type: "text", required: true }],
      views: [{ name: "BandList", kind: "list", fields: ["Name"], actions: ["read"] }],
    },
    {
      name: "BandMember",
      scope: { context: "Band", field: "Band" },
      fields: [
        { name: "User", type: "text", required: true },
        {
          name: "Band",
          type: "text",
          required: true,
          lookup: { targetObject: "Band", displayField: "Name" },
        },
        { name: "Role", type: "text", required: true },
      ],
    },
  ],
  policies: [
    {
      name: "BandMemberPolicy",
      object: "BandMember",
      rules: [
        {
          name: "membersRead",
          effect: "allow",
          principal: { match: "specific", roles: ["BandAdmin", "BandMember"] },
          action: "read",
        },
        {
          name: "adminsManageMembership",
          effect: "allow",
          principal: { match: "specific", roles: ["BandAdmin"] },
          action: "update",
        },
      ],
    },
  ],
});

/**
 * A hand-written stand-in for `@simplewebauthn/server`. It returns a
 * deterministic challenge and a verification result the test chooses, so a
 * refusal here is always the authority's rule rather than a signature check —
 * and so "the library said no" (a forged or wrong-origin assertion) can be
 * exercised without forging anything.
 */
class FakeWebAuthnLibrary implements WebAuthnLibrary {
  readonly challenges: string[] = [];
  readonly registrationRequests: WebAuthnRegistrationOptionsRequest[] = [];
  readonly registrationChecks: WebAuthnRegistrationCheck[] = [];
  readonly authenticationChecks: WebAuthnAuthenticationCheck[] = [];
  registration: WebAuthnRegistrationVerification = {
    verified: true,
    credentialId: "credential-1",
    publicKey: "public-key-1",
    counter: 0,
    backedUp: true,
  };
  authentication: WebAuthnAuthenticationVerification = { verified: true, newCounter: 1 };
  private issued = 0;

  async createRegistrationOptions(
    request: WebAuthnRegistrationOptionsRequest,
  ): Promise<{ challenge: string; options: Record<string, JsonValue> }> {
    this.registrationRequests.push(request);
    return this.issue({
      relyingPartyId: request.relyingParty.relyingPartyId,
      userHandle: request.userHandle,
      excludeCredentials: [...request.excludeCredentialIds],
    });
  }
  async verifyRegistration(
    check: WebAuthnRegistrationCheck,
  ): Promise<WebAuthnRegistrationVerification> {
    this.registrationChecks.push(check);
    return this.registration;
  }
  async createAuthenticationOptions(
    request: WebAuthnAuthenticationOptionsRequest,
  ): Promise<{ challenge: string; options: Record<string, JsonValue> }> {
    return this.issue({ relyingPartyId: request.relyingParty.relyingPartyId });
  }
  async verifyAuthentication(
    check: WebAuthnAuthenticationCheck,
  ): Promise<WebAuthnAuthenticationVerification> {
    this.authenticationChecks.push(check);
    return this.authentication;
  }

  private issue(options: Record<string, JsonValue>): {
    challenge: string;
    options: Record<string, JsonValue>;
  } {
    const challenge = `challenge-value-${(this.issued += 1)}`;
    this.challenges.push(challenge);
    // The browser has to be told the challenge in order to sign it; the begin
    // options are the only place it is ever disclosed.
    return { challenge, options: { ...options, challenge } };
  }
}

/**
 * The in-memory store plus two seams the production API does not expose. The
 * session count lets "no session was issued" be asserted where the write would
 * happen rather than inferred, and the disable switch exists because nothing
 * else can currently disable an identity.
 */
class RecordingIdentitySessionStore extends InMemoryAuthorityIdentitySessionStore {
  readonly createdSessions: string[] = [];
  private readonly disabled = new Map<string, Date>();

  disable(userId: string, disabledAt: Date): void {
    this.disabled.set(userId, disabledAt);
  }
  override async findIdentityByUserId(userId: string): Promise<AuthorityIdentity | null> {
    const identity = await super.findIdentityByUserId(userId);
    const disabledAt = this.disabled.get(userId);
    return identity === null || disabledAt === undefined ? identity : { ...identity, disabledAt };
  }
  override async createSession(session: AuthoritySessionRecord): Promise<void> {
    await super.createSession(session);
    this.createdSessions.push(session.sessionId);
  }
}

function record(object: string, id: string, values: Record<string, string>): StoredObjectRecord {
  return {
    meta: {
      guid: id,
      object,
      schemaVersion: 1,
      revision: "rev-1",
      createdAt: "2026-07-30T12:00:00.000Z",
      createdBy: "seed",
      updatedAt: "2026-07-30T12:00:00.000Z",
      updatedBy: "seed",
      syncStatus: "synced",
    },
    values,
  };
}

function sequence(prefix: string): () => string {
  let value = 0;
  return () => `${prefix}-${(value += 1)}`;
}
function tokenSequence(prefix: string): () => string {
  const next = sequence(prefix);
  // Session and invite tokens are refused below 32 characters, exactly as a
  // real token would never be that short.
  return () => next().padEnd(48, "x");
}

function createFixture() {
  const clock = { value: new Date("2026-07-30T12:00:00.000Z") };
  const now = () => clock.value;
  const storage = new InMemoryObjectStorageBackend();
  const store = new RecordingIdentitySessionStore();
  const sessions = new OpaqueSessionAdapter(store, {
    now,
    newId: sequence("id"),
    newToken: tokenSequence("session-token"),
  });
  const accessStore = new InMemoryAuthorityAccessStore(storage);
  const access = new AuthorityAccessLifecycleService(model, storage, sessions, accessStore, {
    now,
    newId: sequence("access"),
    newToken: tokenSequence("invite-token"),
  });
  const credentials = new InMemoryWebAuthnCredentialStore();
  const library = new FakeWebAuthnLibrary();
  const passkeys = new PasskeyIdentityService(webauthn, sessions, credentials, library, {
    now,
    newId: sequence("ceremony"),
    newUserHandle: sequence("handle"),
    accessLifecycle: access,
  });
  return { clock, storage, store, sessions, accessStore, access, credentials, library, passkeys };
}

type Fixture = ReturnType<typeof createFixture>;

/** An administrator who may issue invites, plus the band their invites scope to. */
async function seedBand(fixture: Fixture): Promise<IssuedAuthoritySession> {
  const admin = await fixture.sessions.provisionIdentity("upstream", "admin@example.test");
  await fixture.storage.create("Band", record("Band", "band-1", { Name: "Giggle" }));
  await fixture.storage.create(
    "BandMember",
    record("BandMember", "membership-admin", {
      User: admin.userId,
      Band: "band-1",
      Role: "BandAdmin",
    }),
  );
  return fixture.sessions.issueSession(admin.userId);
}

function inviteFor(
  fixture: Fixture,
  admin: IssuedAuthoritySession,
  recipientUserId?: string,
): Promise<CreatedAuthorityInvite> {
  return fixture.access.createInvite(admin.sessionToken, {
    contextName: "Band",
    contextId: "band-1",
    role: "BandMember",
    expiresAt: new Date(fixture.clock.value.getTime() + 60_000),
    ...(recipientUserId === undefined ? {} : { recipientUserId }),
  });
}

async function memberships(fixture: Fixture): Promise<StoredObjectRecord[]> {
  return (await fixture.storage.listRecords())
    .filter(
      (entry) => entry.objectName === "BandMember" && entry.record.meta.deletedAt === undefined,
    )
    .map((entry) => entry.record);
}

/** A registered identity holding one credential, reached through an invite. */
async function registerFirstCredential(fixture: Fixture) {
  const admin = await seedBand(fixture);
  const invite = await inviteFor(fixture, admin);
  const start = await fixture.passkeys.beginRegistration({ inviteToken: invite.inviteToken });
  const result = await fixture.passkeys.finishRegistration({
    challengeId: start.challengeId,
    response: { id: "credential-1" },
    inviteToken: invite.inviteToken,
  });
  return { admin, invite, start, result };
}

describe("passkey registration authorisation", () => {
  it("refuses a registration that presents neither a session nor an invite", async () => {
    const fixture = createFixture();
    // Registration is never anonymous: nothing else in the system can mint an
    // identity, so an unauthenticated caller with no invite has no way in.
    await expect(fixture.passkeys.beginRegistration({})).rejects.toMatchObject({
      code: "ADL_PASSKEY_UNAUTHORIZED",
    });
    await expect(
      fixture.passkeys.beginRegistration({ sessionToken: "not-a-session".padEnd(48, "x") }),
    ).rejects.toMatchObject({ code: "ADL_PASSKEY_UNAUTHORIZED" });
    await expect(
      fixture.passkeys.beginRegistration({ inviteToken: "not-an-invite".padEnd(48, "x") }),
    ).rejects.toMatchObject({ code: "ADL_PASSKEY_INVITE_INVALID" });
    expect(fixture.store.createdSessions).toEqual([]);
    expect(fixture.library.challenges).toEqual([]);
  });

  it("mints an identity, stores the credential and grants the invited membership", async () => {
    const fixture = createFixture();
    const { admin, result } = await registerFirstCredential(fixture);

    expect(result.invite).toBe("membershipGranted");
    expect(result.credentialId).toBe("credential-1");
    expect(result.userId).not.toBe(admin.userId);
    expect(await fixture.sessions.verify(result.session?.sessionToken)).toMatchObject({
      userId: result.userId,
    });
    expect(await fixture.credentials.findCredential("credential-1")).toMatchObject({
      userId: result.userId,
      publicKey: "public-key-1",
      signatureCounter: 0,
      backedUp: true,
    });

    // The identity is keyed on the passkey handle the ceremony issued, never on
    // anything the browser chose.
    const handle = fixture.library.registrationRequests[0]?.userHandle;
    expect(handle).toBe("handle-1");
    expect(
      await fixture.store.findIdentityByLink(PASSKEY_IDENTITY_PROVIDER, handle ?? ""),
    ).toMatchObject({ userId: result.userId });

    // The membership is written by the ordinary claim path, so the grant comes
    // from an accepted membership record rather than from the passkey.
    expect((await memberships(fixture)).map((entry) => entry.values)).toContainEqual({
      User: result.userId,
      Band: "band-1",
      Role: "BandMember",
    });
    expect(fixture.accessStore.getAuditEvents().map((event) => event.kind)).toEqual([
      "inviteCreated",
      "inviteClaimed",
    ]);
  });

  it("re-links a recovering member to their existing identity and grants no membership", async () => {
    const fixture = createFixture();
    const admin = await seedBand(fixture);
    const member = await fixture.sessions.provisionIdentity("upstream", "member@example.test");
    await fixture.storage.create(
      "BandMember",
      record("BandMember", "membership-member", {
        User: member.userId,
        Band: "band-1",
        Role: "BandMember",
      }),
    );
    const invite = await inviteFor(fixture, admin, member.userId);

    const start = await fixture.passkeys.beginRegistration({ inviteToken: invite.inviteToken });
    const result = await fixture.passkeys.finishRegistration({
      challengeId: start.challengeId,
      response: { id: "credential-1" },
      inviteToken: invite.inviteToken,
    });

    // Recovery re-links: the same user id keeps every membership and every
    // record scoped by it, which is the whole point of not re-keying.
    expect(result.userId).toBe(member.userId);
    expect(result.invite).toBe("identityRecovered");
    expect((await memberships(fixture)).map((entry) => entry.values)).toEqual([
      { User: admin.userId, Band: "band-1", Role: "BandAdmin" },
      { User: member.userId, Band: "band-1", Role: "BandMember" },
    ]);
    expect(
      (await fixture.sessions.listIdentityLinks(member.userId)).map((link) => [
        link.provider,
        link.subject,
      ]),
    ).toEqual([
      ["upstream", "member@example.test"],
      [PASSKEY_IDENTITY_PROVIDER, "handle-1"],
    ]);
    expect(fixture.accessStore.getAuditEvents().map((event) => event.kind)).toEqual([
      "inviteCreated",
      "identityRecovered",
    ]);
  });

  it("adds a second authenticator to the same identity under one passkey handle", async () => {
    const fixture = createFixture();
    const { result } = await registerFirstCredential(fixture);
    const session = result.session?.sessionToken;

    fixture.library.registration = {
      verified: true,
      credentialId: "credential-2",
      publicKey: "public-key-2",
      counter: 0,
      backedUp: false,
    };
    const start = await fixture.passkeys.beginRegistration({ sessionToken: session ?? "" });
    const second = await fixture.passkeys.finishRegistration({
      challengeId: start.challengeId,
      response: { id: "credential-2" },
    });

    expect(second.userId).toBe(result.userId);
    // The handle an identity already registered under is reused, so a second
    // authenticator joins that identity instead of forking a new one.
    expect(fixture.library.registrationRequests[1]?.userHandle).toBe("handle-1");
    expect(fixture.library.registrationRequests[1]?.excludeCredentialIds).toEqual(["credential-1"]);
    expect(
      (await fixture.sessions.listIdentityLinks(result.userId)).filter(
        (link) => link.provider === PASSKEY_IDENTITY_PROVIDER,
      ),
    ).toHaveLength(1);
    expect(
      (await fixture.credentials.listCredentialsForUser(result.userId)).map(
        (credential) => credential.credentialId,
      ),
    ).toEqual(["credential-1", "credential-2"]);
    // No further membership: a passkey grants identity, never a role.
    expect(await memberships(fixture)).toHaveLength(2);
  });

  it("refuses a credential id that is already registered", async () => {
    const fixture = createFixture();
    const { result } = await registerFirstCredential(fixture);
    const start = await fixture.passkeys.beginRegistration({
      sessionToken: result.session?.sessionToken ?? "",
    });
    // The library reports the same credential id a second time, which is what a
    // re-registered or transplanted authenticator looks like.
    await expect(
      fixture.passkeys.finishRegistration({
        challengeId: start.challengeId,
        response: { id: "credential-1" },
      }),
    ).rejects.toMatchObject({ code: "ADL_PASSKEY_CREDENTIAL_IN_USE" });
    expect(await fixture.credentials.listCredentialsForUser(result.userId)).toHaveLength(1);
  });
});

describe("passkey challenge binding", () => {
  it("consumes a challenge exactly once", async () => {
    const fixture = createFixture();
    const { result } = await registerFirstCredential(fixture);
    const start = await fixture.passkeys.beginRegistration({
      sessionToken: result.session?.sessionToken ?? "",
    });
    fixture.library.registration = {
      verified: true,
      credentialId: "credential-2",
      publicKey: "public-key-2",
      counter: 0,
      backedUp: false,
    };
    await fixture.passkeys.finishRegistration({
      challengeId: start.challengeId,
      response: { id: "credential-2" },
    });
    // A replayed challenge is refused before anything is verified, so a captured
    // ceremony cannot be replayed even with a valid-looking response.
    await expect(
      fixture.passkeys.finishRegistration({
        challengeId: start.challengeId,
        response: { id: "credential-2" },
      }),
    ).rejects.toMatchObject({ code: "ADL_PASSKEY_CHALLENGE_INVALID" });
  });

  it("refuses a challenge that has outlived its window", async () => {
    const fixture = createFixture();
    const identity = await fixture.sessions.provisionIdentity("upstream", "alex@example.test");
    const session = await fixture.sessions.issueSession(identity.userId);
    const start = await fixture.passkeys.beginRegistration({ sessionToken: session.sessionToken });
    fixture.clock.value = new Date(
      fixture.clock.value.getTime() + (webauthn.challengeTtlSeconds + 1) * 1000,
    );
    await expect(
      fixture.passkeys.finishRegistration({
        challengeId: start.challengeId,
        response: { id: "credential-1" },
      }),
    ).rejects.toMatchObject({ code: "ADL_PASSKEY_CHALLENGE_INVALID" });
    expect(await fixture.credentials.findCredential("credential-1")).toBeNull();
  });

  it("refuses a challenge used for the ceremony it was not issued for", async () => {
    const fixture = createFixture();
    const identity = await fixture.sessions.provisionIdentity("upstream", "alex@example.test");
    const session = await fixture.sessions.issueSession(identity.userId);
    const registration = await fixture.passkeys.beginRegistration({
      sessionToken: session.sessionToken,
    });
    const authentication = await fixture.passkeys.beginAuthentication();

    // A registration challenge is not an authentication challenge: without this
    // binding, a challenge collected from one ceremony would be spendable in the
    // other.
    await expect(
      fixture.passkeys.finishAuthentication({
        challengeId: registration.challengeId,
        response: { id: "credential-1" },
      }),
    ).rejects.toMatchObject({ code: "ADL_PASSKEY_CHALLENGE_INVALID" });
    await expect(
      fixture.passkeys.finishRegistration({
        challengeId: authentication.challengeId,
        response: { id: "credential-1" },
      }),
    ).rejects.toMatchObject({ code: "ADL_PASSKEY_CHALLENGE_INVALID" });
    expect(fixture.store.createdSessions).toHaveLength(1);
  });

  it("refuses an invite at finish that is not the one the ceremony began with", async () => {
    const fixture = createFixture();
    const admin = await seedBand(fixture);
    const started = await inviteFor(fixture, admin);
    const other = await inviteFor(fixture, admin);
    const start = await fixture.passkeys.beginRegistration({ inviteToken: started.inviteToken });

    // Only the hash of the started invite reaches challenge storage, and the
    // token presented at finish must match it — so a second valid invite cannot
    // be swapped in to redirect the grant.
    await expect(
      fixture.passkeys.finishRegistration({
        challengeId: start.challengeId,
        response: { id: "credential-1" },
        inviteToken: other.inviteToken,
      }),
    ).rejects.toMatchObject({ code: "ADL_PASSKEY_INVITE_INVALID" });
    await expect(
      fixture.passkeys.finishRegistration({
        challengeId: start.challengeId,
        response: { id: "credential-1" },
      }),
    ).rejects.toMatchObject({ code: "ADL_PASSKEY_CHALLENGE_INVALID" });
    expect(await memberships(fixture)).toHaveLength(1);
    expect(await fixture.credentials.findCredential("credential-1")).toBeNull();
  });

  it("verifies the response against the challenge the server issued", async () => {
    const fixture = createFixture();
    await registerFirstCredential(fixture);
    // The expected challenge is the stored one, not anything supplied by the
    // caller: a client-chosen challenge has nowhere to enter.
    expect(fixture.library.registrationChecks[0]?.expectedChallenge).toBe(
      fixture.library.challenges[0],
    );
    expect(fixture.library.registrationChecks[0]?.relyingParty).toBe(webauthn);
  });
});

describe("passkey assertion verification", () => {
  it("writes nothing when the library refuses the assertion", async () => {
    const fixture = createFixture();
    const admin = await seedBand(fixture);
    const invite = await inviteFor(fixture, admin);
    const start = await fixture.passkeys.beginRegistration({ inviteToken: invite.inviteToken });
    const sessionsBefore = fixture.store.createdSessions.length;
    // What a forged or wrong-origin assertion looks like from here: the real
    // library refuses it, and no partial state may survive that refusal.
    fixture.library.registration = { verified: false };

    await expect(
      fixture.passkeys.finishRegistration({
        challengeId: start.challengeId,
        response: { id: "credential-1" },
        inviteToken: invite.inviteToken,
      }),
    ).rejects.toMatchObject({ code: "ADL_PASSKEY_ASSERTION_INVALID" });
    expect(fixture.store.createdSessions).toHaveLength(sessionsBefore);
    expect(await fixture.credentials.findCredential("credential-1")).toBeNull();
    const handle = fixture.library.registrationRequests[0]?.userHandle ?? "";
    expect(await fixture.store.findIdentityByLink(PASSKEY_IDENTITY_PROVIDER, handle)).toBeNull();
    expect(await memberships(fixture)).toHaveLength(1);
  });

  it("signs in a registered credential and refuses an unknown one", async () => {
    const fixture = createFixture();
    const { result } = await registerFirstCredential(fixture);
    const sessionsBefore = fixture.store.createdSessions.length;

    const unknown = await fixture.passkeys.beginAuthentication();
    await expect(
      fixture.passkeys.finishAuthentication({
        challengeId: unknown.challengeId,
        response: { id: "credential-unknown" },
      }),
    ).rejects.toMatchObject({ code: "ADL_PASSKEY_CREDENTIAL_UNKNOWN" });
    expect(fixture.store.createdSessions).toHaveLength(sessionsBefore);

    const start = await fixture.passkeys.beginAuthentication();
    const authenticated = await fixture.passkeys.finishAuthentication({
      challengeId: start.challengeId,
      response: { id: "credential-1" },
    });
    expect(authenticated.userId).toBe(result.userId);
    expect(await fixture.sessions.verify(authenticated.session.sessionToken)).toMatchObject({
      userId: result.userId,
    });
    // The stored public key is what the assertion is checked against; the
    // browser never supplies it.
    expect(fixture.library.authenticationChecks[0]?.credential).toMatchObject({
      id: "credential-1",
      publicKey: "public-key-1",
    });
  });

  it("refuses a signature counter that regresses or stalls", async () => {
    const fixture = createFixture();
    fixture.library.registration = {
      verified: true,
      credentialId: "credential-1",
      publicKey: "public-key-1",
      counter: 5,
      backedUp: false,
    };
    const { result } = await registerFirstCredential(fixture);
    const sessionsBefore = fixture.store.createdSessions.length;

    // A counter that does not move forward is the cloned-authenticator signal.
    for (const asserted of [5, 3]) {
      const start = await fixture.passkeys.beginAuthentication();
      fixture.library.authentication = { verified: true, newCounter: asserted };
      await expect(
        fixture.passkeys.finishAuthentication({
          challengeId: start.challengeId,
          response: { id: "credential-1" },
        }),
      ).rejects.toMatchObject({ code: "ADL_PASSKEY_COUNTER_REGRESSED" });
      expect(fixture.store.createdSessions).toHaveLength(sessionsBefore);
      expect(await fixture.credentials.findCredential("credential-1")).toMatchObject({
        signatureCounter: 5,
      });
    }

    const start = await fixture.passkeys.beginAuthentication();
    fixture.library.authentication = { verified: true, newCounter: 6 };
    expect(
      (
        await fixture.passkeys.finishAuthentication({
          challengeId: start.challengeId,
          response: { id: "credential-1" },
        })
      ).userId,
    ).toBe(result.userId);
    expect(await fixture.credentials.findCredential("credential-1")).toMatchObject({
      signatureCounter: 6,
    });
  });

  it("permits an authenticator that implements no counter at all", async () => {
    // Some authenticators always report zero. That is allowed, but a counter
    // that was ever non-zero may never return to zero or stall.
    expect(counterAdvanced(0, 0)).toBe(true);
    expect(counterAdvanced(0, 1)).toBe(true);
    expect(counterAdvanced(5, 6)).toBe(true);
    expect(counterAdvanced(5, 5)).toBe(false);
    expect(counterAdvanced(5, 3)).toBe(false);
    expect(counterAdvanced(3, 0)).toBe(false);

    const fixture = createFixture();
    const { result } = await registerFirstCredential(fixture);
    const start = await fixture.passkeys.beginAuthentication();
    fixture.library.authentication = { verified: true, newCounter: 0 };
    expect(
      (
        await fixture.passkeys.finishAuthentication({
          challengeId: start.challengeId,
          response: { id: "credential-1" },
        })
      ).userId,
    ).toBe(result.userId);
  });

  it("refuses a disabled identity even with a valid assertion", async () => {
    const fixture = createFixture();
    const { result } = await registerFirstCredential(fixture);
    fixture.store.disable(result.userId, new Date("2026-07-30T13:00:00.000Z"));
    const sessionsBefore = fixture.store.createdSessions.length;

    const start = await fixture.passkeys.beginAuthentication();
    fixture.library.authentication = { verified: true, newCounter: 2 };
    await expect(
      fixture.passkeys.finishAuthentication({
        challengeId: start.challengeId,
        response: { id: "credential-1" },
      }),
    ).rejects.toMatchObject({ code: "ADL_PASSKEY_UNAUTHORIZED" });
    expect(fixture.store.createdSessions).toHaveLength(sessionsBefore);
  });
});

describe("passkey ceremony disclosure", () => {
  it("keeps challenges, invites and key material out of results and refusals", async () => {
    const fixture = createFixture();
    const { invite, result } = await registerFirstCredential(fixture);
    const secrets = [
      ...fixture.library.challenges,
      invite.inviteToken,
      "public-key-1",
      result.session?.sessionToken ?? "",
    ];

    const start = await fixture.passkeys.beginAuthentication();
    const authenticated = await fixture.passkeys.finishAuthentication({
      challengeId: start.challengeId,
      response: { id: "credential-1" },
    });
    // A ceremony result names the identity and the credential; the session
    // token it carries is the one thing it is allowed to disclose, and it is
    // returned to its own holder rather than written anywhere.
    for (const disclosed of [
      JSON.stringify({ ...result, session: undefined }),
      JSON.stringify({ ...authenticated, session: undefined }),
    ]) {
      for (const secret of secrets) expect(disclosed).not.toContain(secret);
    }

    const refusal = await fixture.passkeys
      .finishRegistration({
        challengeId: start.challengeId,
        response: { id: "credential-1" },
        inviteToken: invite.inviteToken,
      })
      .then(
        () => null,
        (error: unknown) => error,
      );
    // A refusal states only its stable code, so nothing is leaked by an error
    // that reaches a log line or an HTTP body.
    expect(refusal).toMatchObject({
      code: "ADL_PASSKEY_CHALLENGE_INVALID",
      message: "ADL_PASSKEY_CHALLENGE_INVALID",
    });

    // The public key lives in the credential record and nowhere else.
    expect(await fixture.credentials.findCredential("credential-1")).toMatchObject({
      publicKey: "public-key-1",
    });
    expect(JSON.stringify(fixture.accessStore.getAuditEvents())).not.toContain(invite.inviteToken);
  });
});
