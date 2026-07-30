import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Pool } from "pg";
import {
  ApplicationRuntime,
  AuthorityAccessLifecycleService,
  AuthorityService,
  AuthorityTransportError,
  HttpAuthorityTransport,
  InMemoryAuthorityCredentialStore,
  OpaqueSessionAdapter,
  PASSKEY_IDENTITY_PROVIDER,
  PasskeyIdentityService,
  PostgresAuthorityAccessStore,
  PostgresAuthorityIdentitySessionStore,
  PostgresAuthorityUnitOfWork,
  PostgresObjectStorageBackend,
  PostgresWebAuthnCredentialStore,
  resolveApplicationModel,
  selectUpstreamIdentityVerifier,
} from "../../src/index.js";
import type {
  AuthorityConfiguration,
  AuthorityWebAuthnConfiguration,
  RuntimeContext,
} from "../../src/index.js";
import { createAuthorityNodeServer } from "../../src/server/authority-node.js";
import { SimpleWebAuthnLibrary } from "../../src/server/simplewebauthn-adapter.js";
import { authorityPool, resetProjections, seedApplication } from "./pg-harness.js";
import { SoftwareAuthenticator } from "./webauthn-authenticator.js";

/**
 * Phase 49 over a real socket, a real `pg` pool and the real
 * `@simplewebauthn/server` verifier.
 *
 * What only a real backend can prove here: that the ceremony challenge is
 * consumed by a single PostgreSQL statement so a replay finds nothing left to
 * consume; that expiry is enforced by the row rather than by a clock the test
 * controls; that a signature counter regression is refused against the stored
 * counter; that a recovered identity keeps the *same* `userId` and therefore
 * the same membership rows; and that no challenge, invite token or assertion
 * signature reaches any durable projection.
 *
 * The software authenticator in `webauthn-authenticator.ts` only produces
 * credentials — every verification below is performed by the real library
 * against a key it has never seen.
 */

const applicationId = "passkey-identity";
const csrf = "csrf-value".padEnd(48, "p");
const origin = "https://app.test";
const relyingPartyId = "app.test";
const sessionCookieName = "__Host-adl_session";
const csrfCookieName = "__Host-adl_csrf";

const model = resolveApplicationModel({
  app: { name: "Passkey identity slice", startView: "GigList" },
  roles: [{ name: "SystemAdmin" }, { name: "BandAdmin" }, { name: "BandMember" }],
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
    { name: "Band", fields: [{ name: "Name", type: "text", required: true }] },
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
    {
      name: "Gig",
      scope: { context: "Band", field: "Band" },
      fields: [
        {
          name: "Band",
          type: "text",
          required: true,
          lookup: { targetObject: "Band", displayField: "Name" },
        },
        { name: "Title", type: "text", required: true },
      ],
      views: [
        {
          name: "GigList",
          kind: "list",
          context: { mode: "required", context: "Band" },
          fields: ["Title"],
          actions: ["create", "read", "update"],
        },
      ],
      sync: { mode: "localFirst", conflict: "serverWins" },
    },
  ],
  policies: [
    {
      name: "BandPolicy",
      object: "Band",
      rules: [
        {
          name: "systemAll",
          effect: "allow",
          principal: { match: "specific", roles: ["SystemAdmin"] },
          action: "*",
        },
        {
          name: "membersRead",
          effect: "allow",
          principal: { match: "specific", roles: ["BandAdmin", "BandMember"] },
          action: "read",
        },
      ],
    },
    {
      name: "BandMemberPolicy",
      object: "BandMember",
      rules: [
        {
          name: "systemAll",
          effect: "allow",
          principal: { match: "specific", roles: ["SystemAdmin"] },
          action: "*",
        },
        {
          name: "adminManages",
          effect: "allow",
          principal: { match: "specific", roles: ["BandAdmin"] },
          action: "*",
        },
        {
          name: "membersRead",
          effect: "allow",
          principal: { match: "specific", roles: ["BandMember"] },
          action: "read",
        },
      ],
    },
    {
      name: "GigPolicy",
      object: "Gig",
      rules: [
        {
          name: "systemAll",
          effect: "allow",
          principal: { match: "specific", roles: ["SystemAdmin"] },
          action: "*",
        },
        {
          name: "membersAll",
          effect: "allow",
          principal: { match: "specific", roles: ["BandAdmin", "BandMember"] },
          action: "*",
        },
      ],
    },
  ],
});

/**
 * Origin binding is explicit, never inferred from a request: a credential
 * registered against this relying party id will not verify against another.
 */
const relyingParty: AuthorityWebAuthnConfiguration = {
  relyingPartyId,
  relyingPartyName: "ADL passkey slice",
  origins: [origin],
  challengeTtlSeconds: 300,
};

/**
 * A `passkey` deployment. `allowedOrigins` and `webauthn.origins` are set here
 * as a literal, so the relying-party binding under test is stated by the test
 * rather than read from the environment.
 */
const configuration: AuthorityConfiguration = {
  environment: "test",
  databaseUrl: "postgresql://ignored/adl",
  allowedOrigins: [origin],
  cookieName: "__Host-adl_session",
  csrfCookieName: "__Host-adl_csrf",
  sessionTtlMinutes: 480,
  maxRequestBytes: 65_536,
  upstreamIdentity: { issuer: "https://identity.test", audience: "adl-test" },
  identityVerification: { mode: "passkey" },
  webauthn: relyingParty,
  rateLimits: {
    accountProof: 500,
    webauthn: 500,
    session: 500,
    invite: 500,
    bootstrap: 500,
    replay: 500,
    report: 500,
    administration: 500,
  },
};

let pool: Pool;
let sessions: OpaqueSessionAdapter;
let identityStore: PostgresAuthorityIdentitySessionStore;
let server: Server;
let baseUrl: string;

const systemContext: RuntimeContext = {
  userId: "seed-system",
  roles: ["SystemAdmin"],
  channel: "api",
};

beforeAll(async () => {
  pool = new Pool({ connectionString: inject("pgUrl"), max: 8 });
  identityStore = new PostgresAuthorityIdentitySessionStore(authorityPool(pool), applicationId);
  sessions = new OpaqueSessionAdapter(identityStore);
  const storage = new PostgresObjectStorageBackend(authorityPool(pool), applicationId, model);
  const accessLifecycle = new AuthorityAccessLifecycleService(
    model,
    storage,
    sessions,
    new PostgresAuthorityAccessStore(authorityPool(pool), applicationId),
  );
  server = createAuthorityNodeServer({
    configuration,
    sessions,
    authority: new AuthorityService(model, storage, sessions, {
      unitOfWork: new PostgresAuthorityUnitOfWork(authorityPool(pool), applicationId, model),
    }),
    accessLifecycle,
    // The real ceremony service over real PostgreSQL credential/challenge
    // storage and the real WebAuthn library. Nothing here is stubbed.
    passkeys: new PasskeyIdentityService(
      relyingParty,
      sessions,
      new PostgresWebAuthnCredentialStore(authorityPool(pool), applicationId),
      new SimpleWebAuthnLibrary(),
      { accessLifecycle },
    ),
    identityVerifier: selectUpstreamIdentityVerifier(configuration),
    readiness: async () => {
      await pool.query("select 1");
      return { ready: true };
    },
    logger: { write: () => undefined },
    newCsrfToken: () => csrf,
    clientKey: () => "passkey-slice-client",
  });
  baseUrl = await new Promise((done) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      done(`http://127.0.0.1:${address.port}`);
    });
  });
});

afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  await pool.end();
});

beforeEach(async () => {
  await resetProjections(pool);
  await seedApplication(pool, applicationId, model.modelVersion);
});

/* -------------------------------------------------------------------------- */
/* Test wiring                                                                 */
/* -------------------------------------------------------------------------- */

/** A caller with no user agent: real transport, real socket, injected cookie jar. */
function claimant(): HttpAuthorityTransport {
  return new HttpAuthorityTransport({
    baseUrl,
    credentials: new InMemoryAuthorityCredentialStore(),
    origin,
    forwardedProto: "https",
  });
}

function authenticator(options: { backedUp?: boolean; signCount?: number } = {}) {
  return new SoftwareAuthenticator({
    rpId: relyingPartyId,
    origin,
    backedUp: options.backedUp ?? true,
    ...(options.signCount === undefined ? {} : { signCount: options.signCount }),
  });
}

/**
 * The first administrator. In `passkey` mode `/v1/session/issue` is gone, so
 * there is no bearer proof to bootstrap with: the deployment seeds its first
 * identity through the real session adapter against real PostgreSQL. Everything
 * after this point goes over the wire.
 */
async function seedAdministrator(): Promise<{ userId: string; cookie: string }> {
  const identity = await sessions.provisionIdentity("upstream", "admin@passkey.test");
  const issued = await sessions.issueSession(identity.userId);
  return {
    userId: identity.userId,
    cookie: `${sessionCookieName}=${issued.sessionToken}; ${csrfCookieName}=${csrf}`,
  };
}

/** Seeds a band, its admin membership and one gig through the runtime over PostgreSQL. */
async function seedBand(name: string, adminUserId?: string): Promise<{ bandId: string }> {
  const runtime = new ApplicationRuntime(model, {
    storage: new PostgresObjectStorageBackend(authorityPool(pool), applicationId, model),
  });
  const band = await runtime.create("Band", { Name: name }, systemContext);
  const inBand = { ...systemContext, selectedContexts: { Band: band.meta.guid } };
  if (adminUserId !== undefined)
    await runtime.create(
      "BandMember",
      { User: adminUserId, Band: band.meta.guid, Role: "BandAdmin" },
      inBand,
    );
  await runtime.create("Gig", { Band: band.meta.guid, Title: `${name} opening night` }, inBand);
  return { bandId: band.meta.guid };
}

async function createInvite(
  cookie: string,
  bandId: string,
  recipientUserId?: string,
): Promise<{ inviteId: string; inviteToken: string }> {
  const response = await fetch(`${baseUrl}/v1/invites/create`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      "x-forwarded-proto": "https",
      "x-adl-csrf-token": csrf,
      cookie,
    },
    body: JSON.stringify({
      contextName: "Band",
      contextId: bandId,
      role: "BandMember",
      ...(recipientUserId === undefined ? {} : { recipientUserId }),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    }),
  });
  const body = (await response.json()) as { inviteId?: string; inviteToken?: string };
  if (typeof body.inviteToken !== "string" || typeof body.inviteId !== "string")
    throw new Error(`The authority returned no invite token (status ${response.status}).`);
  return { inviteId: body.inviteId, inviteToken: body.inviteToken };
}

/** Registers a fresh authenticator through the real ceremony, end to end. */
async function registerPasskey(input: {
  transport: HttpAuthorityTransport;
  device: SoftwareAuthenticator;
  inviteToken?: string;
}): Promise<{ userId: string; invite?: string; challenge: string }> {
  const start = await input.transport.beginPasskeyRegistration(input.inviteToken);
  const challenge = String(start.options.challenge);
  const response = await input.device.register(start.options);
  const outcome = await input.transport.finishPasskeyRegistration({
    challengeId: start.challengeId,
    response,
    ...(input.inviteToken === undefined ? {} : { inviteToken: input.inviteToken }),
  });
  return {
    userId: outcome.userId,
    ...(outcome.invite === undefined ? {} : { invite: outcome.invite }),
    challenge,
  };
}

/** Signs in with an already-registered authenticator through the real ceremony. */
async function authenticatePasskey(
  transport: HttpAuthorityTransport,
  device: SoftwareAuthenticator,
): Promise<{ userId: string; challenge: string; signature: string }> {
  const start = await transport.beginPasskeyAuthentication();
  const assertion = await device.authenticate(start.options);
  const identity = await transport.finishPasskeyAuthentication({
    challengeId: start.challengeId,
    response: assertion,
  });
  const response = assertion.response as Record<string, string>;
  return {
    userId: identity.userId,
    challenge: String(start.options.challenge),
    signature: response.signature ?? "",
  };
}

/** Captures the refusal a ceremony must produce; a success here is the failure. */
async function refusalOf(action: () => Promise<unknown>): Promise<AuthorityTransportError> {
  try {
    await action();
  } catch (error) {
    if (error instanceof AuthorityTransportError) return error;
    throw error;
  }
  throw new Error("The authority accepted a ceremony that it must have refused.");
}

async function sessionRowCount(): Promise<number> {
  const result = await pool.query<{ count: number }>(
    "select count(*)::int as count from adl_authority_sessions",
  );
  return result.rows[0]?.count ?? 0;
}

async function membershipsFor(userId: string): Promise<{ recordId: string; role: string }[]> {
  const result = await pool.query<{
    record_id: string;
    record: { values: Record<string, string> };
  }>(
    "select record_id, record from adl_authority_records where application_id = $1 and object_name = 'BandMember' and deleted_at is null and record->'values'->>'User' = $2 order by record_id",
    [applicationId, userId],
  );
  return result.rows.map((row) => ({
    recordId: row.record_id,
    role: row.record.values.Role ?? "",
  }));
}

async function passkeyHandleFor(userId: string): Promise<string> {
  const result = await pool.query<{ subject: string }>(
    "select subject from adl_authority_identity_links where application_id = $1 and user_id = $2 and provider = $3",
    [applicationId, userId, PASSKEY_IDENTITY_PROVIDER],
  );
  return result.rows[0]?.subject ?? "";
}

/* -------------------------------------------------------------------------- */
/* Acceptance criteria                                                         */
/* -------------------------------------------------------------------------- */

describe("Phase 49 passkey identity over a real socket, real PostgreSQL and the real verifier", () => {
  it("registers an authenticator through an invite and signs the same identity back in", async () => {
    const admin = await seedAdministrator();
    const { bandId } = await seedBand("Alpha", admin.userId);
    const invite = await createInvite(admin.cookie, bandId);

    const device = authenticator();
    const registration = claimant();
    const registered = await registerPasskey({
      transport: registration,
      device,
      inviteToken: invite.inviteToken,
    });

    // A first-time member is granted the invited membership by the ordinary
    // server-side claim, and holds an ordinary opaque session afterwards.
    expect(registered.invite).toBe("membershipGranted");
    await expect(registration.currentSession()).resolves.toMatchObject({
      userId: registered.userId,
    });
    expect(await membershipsFor(registered.userId)).toEqual([
      { recordId: expect.any(String) as string, role: "BandMember" },
    ]);

    // The credential is real and durable: a public key and counter, nothing more.
    const credentials = await pool.query<{
      credential_id: string;
      user_id: string;
      public_key: string;
      signature_counter: string;
      transports: string | null;
      backed_up: boolean;
    }>(
      "select credential_id, user_id, public_key, signature_counter, transports, backed_up from adl_authority_webauthn_credentials where application_id = $1",
      [applicationId],
    );
    expect(credentials.rows).toHaveLength(1);
    expect(credentials.rows[0]).toMatchObject({
      credential_id: device.credentialId,
      user_id: registered.userId,
      transports: "internal,hybrid",
      backed_up: true,
    });
    expect(credentials.rows[0]?.public_key.length).toBeGreaterThan(0);

    // The identity is keyed on a (provider, subject) link, not on a subject column.
    const links = await pool.query<{ provider: string; subject: string; user_id: string }>(
      "select provider, subject, user_id from adl_authority_identity_links where application_id = $1 and user_id = $2",
      [applicationId, registered.userId],
    );
    expect(links.rows).toEqual([
      {
        provider: PASSKEY_IDENTITY_PROVIDER,
        subject: expect.any(String) as string,
        user_id: registered.userId,
      },
    ]);
    expect(await sessionRowCount()).toBe(2); // the seeded admin, and this member.

    // A later ceremony, from a browser that holds no cookie at all, signs the
    // same identity back in and issues a second ordinary session.
    const returning = claimant();
    const signedIn = await authenticatePasskey(returning, device);

    expect(signedIn.userId).toBe(registered.userId);
    await expect(returning.currentSession()).resolves.toMatchObject({ userId: registered.userId });
    const memberSessions = await pool.query<{ count: number }>(
      "select count(*)::int as count from adl_authority_sessions where application_id = $1 and user_id = $2",
      [applicationId, registered.userId],
    );
    expect(memberSessions.rows[0]?.count).toBe(2);
    // The counter advanced, so a clone that replays the old one is detectable.
    const used = await pool.query<{ signature_counter: string; last_used_at: Date | null }>(
      "select signature_counter, last_used_at from adl_authority_webauthn_credentials where application_id = $1 and credential_id = $2",
      [applicationId, device.credentialId],
    );
    expect(Number(used.rows[0]?.signature_counter)).toBe(1);
    expect(used.rows[0]?.last_used_at).not.toBeNull();
  });

  it("refuses a forged, replayed, expired, wrong-origin or counter-regressed assertion and issues no session", async () => {
    const admin = await seedAdministrator();
    const { bandId } = await seedBand("Alpha", admin.userId);
    const invite = await createInvite(admin.cookie, bandId);
    const device = authenticator();
    await registerPasskey({
      transport: claimant(),
      device,
      inviteToken: invite.inviteToken,
    });

    /** Every refusal is judged the same way: no session anywhere, and no new row. */
    async function refusesWithoutIssuingASession(
      attempt: (transport: HttpAuthorityTransport) => Promise<unknown>,
    ): Promise<AuthorityTransportError> {
      const before = await sessionRowCount();
      const transport = claimant();
      const error = await refusalOf(() => attempt(transport));
      expect(error.status).toBe(401);
      // The caller is still signed out, by the authority's own account of it.
      await expect(transport.currentSession()).resolves.toBeNull();
      expect(await sessionRowCount()).toBe(before);
      return error;
    }

    // A forged signature: well-formed DER over bytes that are not the ones presented.
    const forged = await refusesWithoutIssuingASession(async (transport) => {
      const start = await transport.beginPasskeyAuthentication();
      return transport.finishPasskeyAuthentication({
        challengeId: start.challengeId,
        response: await device.authenticate(start.options, { forgeSignature: true }),
      });
    });
    expect(forged.code).toBe("ADL_PASSKEY_ASSERTION_INVALID");

    // A replayed challenge. The first finish succeeds and consumes it; the
    // second finds nothing left to consume, because single use is enforced by
    // the update statement itself rather than by a read-then-write.
    const replayed = claimant();
    const replayedStart = await replayed.beginPasskeyAuthentication();
    await replayed.finishPasskeyAuthentication({
      challengeId: replayedStart.challengeId,
      response: await device.authenticate(replayedStart.options),
    });
    const replay = await refusesWithoutIssuingASession(async (transport) =>
      transport.finishPasskeyAuthentication({
        challengeId: replayedStart.challengeId,
        response: await device.authenticate(replayedStart.options),
      }),
    );
    expect(replay.code).toBe("ADL_PASSKEY_CHALLENGE_INVALID");

    // An expired challenge. Expiry is aged in the row, so real PostgreSQL — not
    // a stubbed clock — decides that the challenge is no longer consumable.
    const expiring = claimant();
    const expiringStart = await expiring.beginPasskeyAuthentication();
    const aged = await pool.query(
      "update adl_authority_webauthn_challenges set expires_at = $2 where challenge_id = $1",
      [expiringStart.challengeId, new Date(Date.now() - 60_000)],
    );
    expect(aged.rowCount).toBe(1);
    const expired = await refusesWithoutIssuingASession(async (transport) =>
      transport.finishPasskeyAuthentication({
        challengeId: expiringStart.challengeId,
        response: await device.authenticate(expiringStart.options),
      }),
    );
    expect(expired.code).toBe("ADL_PASSKEY_CHALLENGE_INVALID");

    // A wrong-origin assertion. A credential bound to one origin is worthless
    // at another, which is what makes development and production separate.
    const wrongOrigin = await refusesWithoutIssuingASession(async (transport) => {
      const start = await transport.beginPasskeyAuthentication();
      return transport.finishPasskeyAuthentication({
        challengeId: start.challengeId,
        response: await device.authenticate(start.options, { origin: "https://evil.test" }),
      });
    });
    expect(wrongOrigin.code).toBe("ADL_PASSKEY_ASSERTION_INVALID");

    // A counter-regressed assertion: a stale counter replayed while the stored
    // one has already moved on. The library refuses it against the stored
    // counter before the store's own `counterAdvanced` rule is reached, so the
    // code is the assertion refusal; the store rule remains the backstop for a
    // counter that advances concurrently between check and write.
    const stored = await pool.query<{ signature_counter: string }>(
      "select signature_counter from adl_authority_webauthn_credentials where application_id = $1 and credential_id = $2",
      [applicationId, device.credentialId],
    );
    const storedCounter = Number(stored.rows[0]?.signature_counter);
    expect(storedCounter).toBeGreaterThan(0);
    const regressed = await refusesWithoutIssuingASession(async (transport) => {
      const start = await transport.beginPasskeyAuthentication();
      return transport.finishPasskeyAuthentication({
        challengeId: start.challengeId,
        response: await device.authenticate(start.options, { signCount: storedCounter }),
      });
    });
    expect(regressed.code).toBe("ADL_PASSKEY_ASSERTION_INVALID");
    // The refused assertion did not move the stored counter either.
    const after = await pool.query<{ signature_counter: string }>(
      "select signature_counter from adl_authority_webauthn_credentials where application_id = $1 and credential_id = $2",
      [applicationId, device.credentialId],
    );
    expect(Number(after.rows[0]?.signature_counter)).toBe(storedCounter);
  });

  /**
   * The headline criterion. An identity that holds two external identifiers is
   * the proof that changing provider, adding a second method, or dropping one
   * later is a linking operation rather than a re-keying of every membership.
   */
  it("resolves one identity through either of two identifiers with its memberships intact", async () => {
    const admin = await seedAdministrator();
    const { bandId } = await seedBand("Alpha", admin.userId);
    const invite = await createInvite(admin.cookie, bandId);
    const device = authenticator();
    const registered = await registerPasskey({
      transport: claimant(),
      device,
      inviteToken: invite.inviteToken,
    });
    const membershipsBefore = await membershipsFor(registered.userId);
    expect(membershipsBefore).toHaveLength(1);

    // A second provider is adopted. The identity gains an identifier; nothing
    // about the user id, the memberships or the sessions changes.
    const handle = await passkeyHandleFor(registered.userId);
    expect(handle.length).toBeGreaterThan(0);
    await sessions.linkIdentity(registered.userId, "upstream", "member@corp.test");

    await expect(
      identityStore.findIdentityByLink(PASSKEY_IDENTITY_PROVIDER, handle),
    ).resolves.toMatchObject({ userId: registered.userId });
    await expect(
      identityStore.findIdentityByLink("upstream", "member@corp.test"),
    ).resolves.toMatchObject({ userId: registered.userId });

    // Provisioning through the *new* provider finds the existing identity rather
    // than minting a second one — the failure mode this phase exists to remove.
    const throughUpstream = await sessions.provisionIdentity("upstream", "member@corp.test");
    expect(throughUpstream.userId).toBe(registered.userId);
    const identities = await pool.query<{ count: number }>(
      "select count(*)::int as count from adl_authority_identities where application_id = $1",
      [applicationId],
    );
    expect(identities.rows[0]?.count).toBe(2); // the admin and this member, still.
    expect(await membershipsFor(registered.userId)).toEqual(membershipsBefore);

    // And a session issued to the identity reached through the second
    // identifier sees exactly the same data over the wire.
    const issued = await sessions.issueSession(throughUpstream.userId);
    const cookie = `${sessionCookieName}=${issued.sessionToken}; ${csrfCookieName}=${csrf}`;
    const current = await fetch(`${baseUrl}/v1/session/current`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        "x-forwarded-proto": "https",
        "x-adl-csrf-token": csrf,
        cookie,
      },
      body: "{}",
    });
    expect(await current.json()).toMatchObject({ userId: registered.userId });
  });

  /**
   * Recovery. A member who still holds a membership but has lost every
   * authenticator is re-admitted through a recipient-bound invite. No email
   * sender exists anywhere in this path: an admin issues an invite through the
   * ordinary endpoint and the member registers a fresh credential.
   */
  it("re-admits a member who lost every authenticator without granting a second membership", async () => {
    const admin = await seedAdministrator();
    const { bandId } = await seedBand("Alpha", admin.userId);
    const firstInvite = await createInvite(admin.cookie, bandId);
    const lostDevice = authenticator();
    const member = await registerPasskey({
      transport: claimant(),
      device: lostDevice,
      inviteToken: firstInvite.inviteToken,
    });
    const membershipsBefore = await membershipsFor(member.userId);
    expect(membershipsBefore).toHaveLength(1);

    // Every authenticator is gone.
    const removed = await pool.query(
      "delete from adl_authority_webauthn_credentials where application_id = $1 and user_id = $2",
      [applicationId, member.userId],
    );
    expect(removed.rowCount).toBe(1);
    await expect(authenticatePasskey(claimant(), lostDevice)).rejects.toBeInstanceOf(
      AuthorityTransportError,
    );

    // The admin re-invites the member by name; the invite is recipient-bound.
    const recovery = await createInvite(admin.cookie, bandId, member.userId);
    const replacement = authenticator();
    const readmitted = await registerPasskey({
      transport: claimant(),
      device: replacement,
      inviteToken: recovery.inviteToken,
    });

    // The same identity came back, not a new one.
    expect(readmitted.userId).toBe(member.userId);
    expect(readmitted.invite).toBe("identityRecovered");
    // Recovery restores the ability to sign in, never a grant: the membership
    // the member never lost is untouched, and there is no second one.
    expect(await membershipsFor(member.userId)).toEqual(membershipsBefore);
    const credentials = await pool.query<{ credential_id: string }>(
      "select credential_id from adl_authority_webauthn_credentials where application_id = $1 and user_id = $2",
      [applicationId, member.userId],
    );
    expect(credentials.rows.map((row) => row.credential_id)).toEqual([replacement.credentialId]);

    // The invite is consumed and audited as a recovery, not as a claim.
    const inviteRow = await pool.query<{
      claimed_by: string | null;
      claimed_at: Date | null;
      membership_record_id: string | null;
    }>(
      "select claimed_by, claimed_at, membership_record_id from adl_authority_invites where application_id = $1 and invite_id = $2",
      [applicationId, recovery.inviteId],
    );
    expect(inviteRow.rows[0]?.claimed_by).toBe(member.userId);
    expect(inviteRow.rows[0]?.claimed_at).not.toBeNull();
    expect(inviteRow.rows[0]?.membership_record_id).toBeNull();
    const audit = await pool.query<{ event: { kind: string; actorId: string; inviteId: string } }>(
      "select event from adl_authority_access_audit_events where application_id = $1 and event->>'kind' = 'identityRecovered'",
      [applicationId],
    );
    expect(audit.rows.map((row) => row.event)).toEqual([
      expect.objectContaining({
        kind: "identityRecovered",
        actorId: member.userId,
        inviteId: recovery.inviteId,
      }) as unknown,
    ]);

    // And the replacement authenticator signs the same identity in from scratch.
    const signedIn = await authenticatePasskey(claimant(), replacement);
    expect(signedIn.userId).toBe(member.userId);
  });

  it("persists no challenge, invite token or assertion signature in any projection", async () => {
    const admin = await seedAdministrator();
    const { bandId } = await seedBand("Alpha", admin.userId);
    const invite = await createInvite(admin.cookie, bandId);
    const device = authenticator();
    const registered = await registerPasskey({
      transport: claimant(),
      device,
      inviteToken: invite.inviteToken,
    });
    const returning = claimant();
    const signedIn = await authenticatePasskey(returning, device);

    // Give every projection something to hold: an accepted write produces a
    // record, a runtime audit event and an operation outcome.
    const accepted = await returning.replay(undefined, {
      operationId: "op-secret-scan",
      kind: "create",
      objectName: "Gig",
      recordId: "gig-secret-scan",
      values: { Band: bandId, Title: "Recorded by a passkey session" },
      selectedContexts: { Band: bandId },
    });
    expect(accepted.status).toBe("accepted");

    const secrets = [
      registered.challenge,
      signedIn.challenge,
      invite.inviteToken,
      signedIn.signature,
    ];
    for (const secret of secrets) expect(secret.length).toBeGreaterThan(0);

    for (const table of [
      "adl_authority_records",
      "adl_authority_audit_events",
      "adl_authority_access_audit_events",
      "adl_authority_operation_outcomes",
    ]) {
      // The whole row is cast to text, so a secret cannot hide in a column the
      // assertion forgot to name.
      const dump = await pool.query<{ blob: string }>(
        `select coalesce(string_agg(rows::text, ' '), '') as blob from ${table} rows`,
      );
      const blob = dump.rows[0]?.blob ?? "";
      expect(blob.length).toBeGreaterThan(0);
      for (const secret of secrets) expect(blob).not.toContain(secret);
    }
  });

  it("keeps the Phase 42 edge controls on the new ceremony routes", async () => {
    const routes = [
      "/v1/webauthn/register/begin",
      "/v1/webauthn/register/finish",
      "/v1/webauthn/authenticate/begin",
      "/v1/webauthn/authenticate/finish",
    ];
    for (const route of routes) {
      const denied = await fetch(`${baseUrl}${route}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.test",
          "x-forwarded-proto": "https",
        },
        body: "{}",
      });
      expect([route, denied.status, await denied.json()]).toEqual([
        route,
        403,
        { error: "origin_denied" },
      ]);

      // No forwarded-proto marker: the edge will not serve a ceremony in clear.
      const insecure = await fetch(`${baseUrl}${route}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: "{}",
      });
      expect([route, insecure.status, await insecure.json()]).toEqual([
        route,
        400,
        { error: "https_required" },
      ]);

      const wrongType = await fetch(`${baseUrl}${route}`, {
        method: "POST",
        headers: { "content-type": "text/plain", origin, "x-forwarded-proto": "https" },
        body: "{}",
      });
      expect([route, wrongType.status, await wrongType.json()]).toEqual([
        route,
        415,
        { error: "content_type_required" },
      ]);
    }
  });

  /**
   * A passkey grants identity only. The same session sees one band and not the
   * other, and its writes are judged by membership records — not by anything
   * the credential asserted.
   */
  it("grants identity only, leaving roles to membership records on every call", async () => {
    const admin = await seedAdministrator();
    const alpha = await seedBand("Alpha", admin.userId);
    const beta = await seedBand("Beta");
    const invite = await createInvite(admin.cookie, alpha.bandId);
    const device = authenticator();
    const transport = claimant();
    const registered = await registerPasskey({
      transport,
      device,
      inviteToken: invite.inviteToken,
    });

    const inAlpha = await transport.bootstrap(undefined, {
      selectedContexts: { Band: alpha.bandId },
    });
    expect(
      inAlpha.records
        .filter((entry) => entry.objectName === "Gig")
        .map((entry) => entry.record.values.Title),
    ).toEqual(["Alpha opening night"]);

    // No membership in Beta, so Beta simply is not there for this identity.
    const inBeta = await transport.bootstrap(undefined, {
      selectedContexts: { Band: beta.bandId },
    });
    expect(inBeta.records).toEqual([]);

    const acceptedInAlpha = await transport.replay(undefined, {
      operationId: "op-passkey-alpha",
      kind: "create",
      objectName: "Gig",
      recordId: "gig-passkey-alpha",
      values: { Band: alpha.bandId, Title: "Booked by a passkey session" },
      selectedContexts: { Band: alpha.bandId },
    });
    expect(acceptedInAlpha.status).toBe("accepted");

    const refusedInBeta = await transport.replay(undefined, {
      operationId: "op-passkey-beta",
      kind: "create",
      objectName: "Gig",
      recordId: "gig-passkey-beta",
      values: { Band: beta.bandId, Title: "Not this identity's band" },
      selectedContexts: { Band: beta.bandId },
    });
    expect(refusedInBeta.status).not.toBe("accepted");
    const betaGigs = await pool.query<{ count: number }>(
      "select count(*)::int as count from adl_authority_records where application_id = $1 and record_id = 'gig-passkey-beta'",
      [applicationId],
    );
    expect(betaGigs.rows[0]?.count).toBe(0);
    // The identity that did all of this is still the one the ceremony derived.
    await expect(transport.currentSession()).resolves.toMatchObject({
      userId: registered.userId,
    });
  });
});
