import { describe, expect, it } from "vitest";
import {
  AuthorityAccessLifecycleService,
  AuthorityService,
  InMemoryAuthorityAccessStore,
  InMemoryAuthorityIdentitySessionStore,
  InMemoryObjectStorageBackend,
  InMemoryWebAuthnCredentialStore,
  OpaqueSessionAdapter,
  PasskeyIdentityService,
  createAuthorityHttpHandler,
  hashSecret,
  resolveApplicationModel,
  selectUpstreamIdentityVerifier,
} from "../src/index.js";
import type {
  AuthorityConfiguration,
  AuthorityWebAuthnConfiguration,
  SecurityLogEvent,
  SecurityLogger,
  WebAuthnLibrary,
} from "../src/index.js";

/**
 * The Phase 49 HTTP edge in `passkey` mode. The ceremony rules themselves are
 * proven in `tests/passkey-identity.test.ts`; what is proven here is the
 * boundary around them — that the ceremony routes exist only in passkey mode,
 * that the account-proof route is not a second and weaker way in, where the
 * CSRF boundary falls now that a mutating route may legitimately precede a
 * session, and that a refusal discloses nothing but its stable code.
 */

const CHALLENGE = "challenge-value-1";
const inviteToken = "invite-token".padEnd(48, "i");
const csrfToken = "csrf-token-value".padEnd(48, "c");

const webauthn: AuthorityWebAuthnConfiguration = {
  relyingPartyId: "app.test",
  relyingPartyName: "ADL authority test",
  origins: ["https://app.test"],
  challengeTtlSeconds: 300,
};

const passkeyConfiguration: AuthorityConfiguration = {
  environment: "test",
  databaseUrl: "postgresql://authority.test/adl",
  allowedOrigins: ["https://app.test"],
  cookieName: "__Host-adl_session",
  csrfCookieName: "__Host-adl_csrf",
  sessionTtlMinutes: 480,
  maxRequestBytes: 4_096,
  upstreamIdentity: { issuer: "https://identity.test", audience: "adl-test" },
  identityVerification: { mode: "passkey" },
  webauthn,
  rateLimits: {
    accountProof: 10,
    webauthn: 10,
    session: 10,
    invite: 10,
    bootstrap: 10,
    replay: 10,
    report: 10,
    administration: 10,
  },
};

const model = resolveApplicationModel({
  app: { name: "Passkey HTTP fixture", startView: "DocumentList" },
  objects: [
    {
      name: "Document",
      fields: [{ name: "Title", type: "text" }],
      views: [{ name: "DocumentList", kind: "list", fields: ["Title"], actions: ["read"] }],
    },
  ],
});

/**
 * Deterministic stand-in for `@simplewebauthn/server`. These tests never reach
 * a verification, so it only has to hand back a challenge the edge can return.
 */
const library: WebAuthnLibrary = {
  createRegistrationOptions: async () => ({
    challenge: CHALLENGE,
    options: { challenge: CHALLENGE },
  }),
  verifyRegistration: async () => ({
    verified: true,
    credentialId: "credential-1",
    publicKey: "public-key-1",
    counter: 0,
  }),
  createAuthenticationOptions: async () => ({
    challenge: CHALLENGE,
    options: { challenge: CHALLENGE },
  }),
  verifyAuthentication: async () => ({ verified: true, newCounter: 1 }),
};

function request(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://app.test${path}`, {
    method: "POST",
    headers: { origin: "https://app.test", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function fixture(
  configuration: AuthorityConfiguration = passkeyConfiguration,
  options: { withPasskeys?: boolean } = {},
) {
  const storage = new InMemoryObjectStorageBackend();
  const sessions = new OpaqueSessionAdapter(new InMemoryAuthorityIdentitySessionStore(), {
    newId: (() => {
      let number = 0;
      return () => `id-${++number}`;
    })(),
    newToken: (() => {
      let number = 0;
      return () => `session-token-${++number}`.padEnd(48, "x");
    })(),
  });
  const accessStore = new InMemoryAuthorityAccessStore(storage);
  const access = new AuthorityAccessLifecycleService(model, storage, sessions, accessStore);
  // Seeded through the store so the ceremony has a genuinely claimable invite
  // without this test having to model a membership-managing administrator.
  await accessStore.createInvite(
    {
      inviteId: "invite-1",
      tokenHash: await hashSecret(inviteToken),
      contextName: "Band",
      contextId: "band-1",
      role: "BandMember",
      createdBy: "seed",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
    {
      accessAuditId: "access-audit-1",
      kind: "inviteCreated",
      actorId: "seed",
      contextName: "Band",
      contextId: "band-1",
      role: "BandMember",
      inviteId: "invite-1",
      occurredAt: new Date(),
    },
  );
  const passkeys = new PasskeyIdentityService(
    webauthn,
    sessions,
    new InMemoryWebAuthnCredentialStore(),
    library,
    { accessLifecycle: access },
  );
  const entries: SecurityLogEvent[] = [];
  const logger: SecurityLogger = { write: (event) => entries.push(event) };
  return {
    sessions,
    entries,
    handle: createAuthorityHttpHandler({
      configuration,
      sessions,
      authority: new AuthorityService(model, storage, sessions),
      identityVerifier: selectUpstreamIdentityVerifier(configuration),
      ...(options.withPasskeys === false ? {} : { passkeys }),
      accessLifecycle: access,
      logger,
      clientKey: () => "passkey-http-client",
      newCsrfToken: () => csrfToken,
    }),
  };
}

/** A signed-in caller, for the post-session half of the CSRF boundary. */
async function signedIn(sessions: OpaqueSessionAdapter) {
  const identity = await sessions.provisionIdentity("upstream", "alex@example.test");
  const session = await sessions.issueSession(identity.userId);
  return {
    userId: identity.userId,
    cookie: `__Host-adl_session=${session.sessionToken}; __Host-adl_csrf=${csrfToken}`,
  };
}

describe("passkey ceremony availability", () => {
  it("serves the ceremony routes only when the mode is passkey and a service is wired", async () => {
    // Fail closed: a deployment that has not turned passkeys on has no ceremony
    // surface at all, rather than a half-configured one.
    const bypassed = await fixture({
      ...passkeyConfiguration,
      identityVerification: { mode: "bypass" },
    });
    const unavailable = await bypassed.handle(request("/v1/webauthn/authenticate/begin", {}));
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: "endpoint_unavailable" });

    const unwired = await fixture(passkeyConfiguration, { withPasskeys: false });
    const missing = await unwired.handle(request("/v1/webauthn/authenticate/begin", {}));
    expect(missing.status).toBe(503);
    expect(await missing.json()).toEqual({ error: "endpoint_unavailable" });
  });

  it("withdraws the account-proof route so the ceremony is the only way in", async () => {
    const { handle } = await fixture();
    // A passkey deployment has no bearer proof to exchange. Leaving
    // /v1/session/issue reachable would be a second, weaker entry point beside
    // the ceremony it replaced.
    const issued = await handle(
      request("/v1/session/issue", {}, { "x-adl-account-proof": "a-plausible-account-proof" }),
    );
    expect(issued.status).toBe(503);
    expect(await issued.json()).toEqual({ error: "endpoint_unavailable" });
    expect(issued.headers.get("set-cookie")).toBeNull();
  });

  it("discloses the active identity boundary on /readyz", async () => {
    const { handle } = await fixture();
    const ready = await handle(new Request("https://app.test/readyz"));
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({
      status: "ready",
      identityVerification: { mode: "passkey", verifier: "passkey", bypassed: false },
    });
  });
});

describe("passkey CSRF boundary", () => {
  it("binds the double-submit token to the presence of a session, not to the path", async () => {
    const { handle, sessions } = await fixture();

    // Pre-session: a first registration happens before any session exists, so
    // there is no ambient credential to abuse and no CSRF token to require. The
    // request is bound instead by the Origin, the rate bucket and the
    // server-issued single-use challenge.
    const preSession = await handle(request("/v1/webauthn/register/begin", { inviteToken }));
    expect(preSession.status).toBe(200);
    expect(await preSession.json()).toEqual({
      challengeId: expect.any(String),
      options: { challenge: CHALLENGE },
    });

    // Post-session: the same route used to add a further authenticator carries a
    // session cookie, so it is protected exactly as every other authenticated
    // mutation is.
    const { cookie } = await signedIn(sessions);
    const noToken = await handle(request("/v1/webauthn/register/begin", {}, { cookie }));
    expect(noToken.status).toBe(403);
    expect(await noToken.json()).toEqual({ error: "csrf_denied" });

    const wrongToken = await handle(
      request("/v1/webauthn/register/begin", {}, { cookie, "x-adl-csrf-token": "not-the-token" }),
    );
    expect(wrongToken.status).toBe(403);

    const accepted = await handle(
      request("/v1/webauthn/register/begin", {}, { cookie, "x-adl-csrf-token": csrfToken }),
    );
    expect(accepted.status).toBe(200);
  });
});

describe("passkey transport controls", () => {
  it("keeps the Phase 42 controls and gives the ceremony its own rate bucket", async () => {
    const { handle, sessions } = await fixture({
      ...passkeyConfiguration,
      rateLimits: { ...passkeyConfiguration.rateLimits, webauthn: 1 },
    });

    const insecure = await handle(
      new Request("http://app.test/v1/webauthn/authenticate/begin", {
        method: "POST",
        headers: { origin: "https://app.test", "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(insecure.status).toBe(400);
    expect(await insecure.json()).toEqual({ error: "https_required" });

    const crossOrigin = await handle(
      new Request("https://app.test/v1/webauthn/authenticate/begin", {
        method: "POST",
        headers: { origin: "https://evil.test", "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(crossOrigin.status).toBe(403);
    expect(await crossOrigin.json()).toEqual({ error: "origin_denied" });

    const wrongType = await handle(
      new Request("https://app.test/v1/webauthn/authenticate/begin", {
        method: "POST",
        headers: { origin: "https://app.test", "content-type": "text/plain" },
        body: "{}",
      }),
    );
    expect(wrongType.status).toBe(415);

    expect((await handle(request("/v1/webauthn/authenticate/begin", {}))).status).toBe(200);
    const limited = await handle(request("/v1/webauthn/authenticate/begin", {}));
    expect(limited.status).toBe(429);

    // A separate bucket: mostly pre-session ceremony traffic must not spend an
    // authenticated caller's session allowance, or exhaust it for them.
    const { cookie, userId } = await signedIn(sessions);
    const current = await handle(
      request("/v1/session/current", {}, { cookie, "x-adl-csrf-token": csrfToken }),
    );
    expect(current.status).toBe(200);
    expect(await current.json()).toMatchObject({ userId });
  });

  it("answers a ceremony refusal with its stable code and logs nothing else", async () => {
    const { handle, entries } = await fixture();
    const refused = await handle(
      request("/v1/webauthn/register/finish", {
        challengeId: "challenge-never-issued",
        response: { id: "credential-1", clientDataJSON: "an-assertion-blob" },
        inviteToken,
      }),
    );
    expect(refused.status).toBe(401);
    expect(await refused.json()).toEqual({ error: "ADL_PASSKEY_CHALLENGE_INVALID" });
    expect(refused.headers.get("set-cookie")).toBeNull();

    expect(entries).toContainEqual(
      expect.objectContaining({
        event: "authority_request_rejected",
        outcome: "denied",
        endpoint: "/v1/webauthn/register/finish",
        status: 401,
        reason: "ADL_PASSKEY_CHALLENGE_INVALID",
      }),
    );
    // The logger here records raw events, so this proves nothing secret is even
    // handed to a logger rather than that a redacting logger removed it later.
    const written = JSON.stringify(entries);
    for (const secret of [
      CHALLENGE,
      inviteToken,
      "challenge-never-issued",
      "an-assertion-blob",
      "public-key-1",
    ])
      expect(written).not.toContain(secret);
  });
});
