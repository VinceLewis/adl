import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Pool } from "pg";
import {
  AuthorityService,
  HttpAuthorityTransport,
  InMemoryAuthorityCredentialStore,
  OpaqueSessionAdapter,
  PostgresAuthorityIdentitySessionStore,
  PostgresAuthorityUnitOfWork,
  PostgresObjectStorageBackend,
  resolveApplicationModel,
  resolveSessionLifetime,
  selectUpstreamIdentityVerifier,
} from "../../src/index.js";
import type { AuthorityConfiguration } from "../../src/index.js";
import { createAuthorityNodeServer } from "../../src/server/authority-node.js";
import { authorityPool, resetProjections, seedApplication } from "./pg-harness.js";

/**
 * Phase 50, server side. The client-side grace is an affordance; the authority
 * is the enforcement point, and every rule here is proven against real
 * PostgreSQL because session expiry, revocation and the device list are all
 * `where`-clause behaviour that a SQL-shaped fake would answer for itself.
 *
 * What must hold no matter what a client believes about its own grace:
 * an expired session is refused, a revoked session is refused, and a person can
 * see and end their own sessions — and only their own.
 */

const applicationId = "session-lifetime";
const csrf = "csrf-value".padEnd(48, "s");
const GRACE_DAYS = 30;

const model = resolveApplicationModel({
  app: { name: "Session lifetime", startView: "GigList", offlineGraceDays: GRACE_DAYS },
  roles: [{ name: "Member" }],
  objects: [
    {
      name: "Gig",
      fields: [{ name: "Title", type: "text", required: true }],
      views: [{ name: "GigList", kind: "list", fields: ["Title"], actions: ["read"] }],
    },
  ],
  policies: [
    {
      name: "GigPolicy",
      object: "Gig",
      rules: [
        { name: "anyone", effect: "allow", principal: { match: "authenticated" }, action: "*" },
      ],
    },
  ],
});

/**
 * The lifetime is derived exactly as the entrypoint derives it, so this proves
 * the composed value rather than a number restated in a test.
 */
const configuration: AuthorityConfiguration = resolveSessionLifetime(
  {
    environment: "test",
    databaseUrl: "postgresql://ignored/adl",
    allowedOrigins: ["https://app.test"],
    cookieName: "__Host-adl_session",
    csrfCookieName: "__Host-adl_csrf",
    sessionTtlMinutes: 480,
    maxRequestBytes: 65_536,
    upstreamIdentity: { issuer: "https://identity.test", audience: "adl-test" },
    identityVerification: { mode: "bypass" },
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
  },
  model,
);

let pool: Pool;
let sessions: OpaqueSessionAdapter;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  pool = new Pool({ connectionString: inject("pgUrl"), max: 8 });
  sessions = new OpaqueSessionAdapter(
    new PostgresAuthorityIdentitySessionStore(authorityPool(pool), applicationId),
    { sessionTtlMs: configuration.sessionTtlMinutes * 60_000 },
  );
  server = createAuthorityNodeServer({
    configuration,
    sessions,
    authority: new AuthorityService(
      model,
      new PostgresObjectStorageBackend(authorityPool(pool), applicationId, model),
      sessions,
      { unitOfWork: new PostgresAuthorityUnitOfWork(authorityPool(pool), applicationId, model) },
    ),
    identityVerifier: selectUpstreamIdentityVerifier(configuration),
    newCsrfToken: () => csrf,
    clientKey: () => "session-lifetime-client",
  });
  await new Promise<void>((done) => {
    server.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      done();
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

describe("offline session lifetime against real PostgreSQL", () => {
  it("issues a session that spans the declared offline grace, in a persistent cookie", async () => {
    expect(configuration.sessionTtlMinutes).toBe(GRACE_DAYS * 24 * 60);

    const browser = browserClient();
    const identity = await browser.transport.signIn("casey@lifetime.test");

    const stored = await pool.query<{ issued_at: Date; expires_at: Date }>(
      "select issued_at, expires_at from adl_authority_sessions where application_id = $1 and user_id = $2",
      [applicationId, identity.userId],
    );
    const row = stored.rows[0];
    expect(row).toBeDefined();
    const lifetimeDays =
      (new Date(row?.expires_at ?? 0).getTime() - new Date(row?.issued_at ?? 0).getTime()) /
      (24 * 60 * 60 * 1000);
    expect(Math.round(lifetimeDays)).toBe(GRACE_DAYS);

    // Persistent, not a browser-session cookie: closing the browser must not
    // sign a user out inside their grace.
    const raw = await fetch(`${baseUrl}/v1/session/issue`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://app.test",
        "x-forwarded-proto": "https",
        "x-adl-account-proof": "second@lifetime.test",
      },
      body: "{}",
    });
    const cookies = raw.headers.getSetCookie();
    expect(cookies.every((cookie) => cookie.includes(`Max-Age=${GRACE_DAYS * 24 * 60 * 60}`))).toBe(
      true,
    );
  });

  /*
   * The client-side grace check is an affordance. A client that skips it gains
   * nothing, because the session it would present has genuinely expired.
   */
  it("refuses a sync presenting an expired session, whatever the client believes", async () => {
    const browser = browserClient();
    const identity = await browser.transport.signIn("expired@lifetime.test");
    expect(await browser.transport.currentSession()).toMatchObject({ userId: identity.userId });

    // Move the stored expiry into the past: exactly what a device that stayed
    // away past its grace presents on its next contact.
    await pool.query(
      "update adl_authority_sessions set expires_at = now() - interval '1 minute' where application_id = $1 and user_id = $2",
      [applicationId, identity.userId],
    );

    expect(await browser.transport.currentSession()).toBeNull();
    await expect(browser.transport.bootstrap(undefined, {})).rejects.toMatchObject({
      status: 401,
      code: "unauthenticated",
    });
    // Rotation is not a way back in either: it needs a still-valid session.
    await expect(browser.transport.rotateSession()).rejects.toMatchObject({ status: 401 });
  });

  it("refuses a sync presenting a revoked session, regardless of remaining grace", async () => {
    const browser = browserClient();
    const identity = await browser.transport.signIn("revoked@lifetime.test");

    // Weeks of grace remain; revocation must take effect on the next contact
    // anyway. The grace is a maximum, never a minimum.
    const remaining = await pool.query<{ expires_at: Date }>(
      "select expires_at from adl_authority_sessions where application_id = $1 and user_id = $2",
      [applicationId, identity.userId],
    );
    expect(new Date(remaining.rows[0]?.expires_at ?? 0).getTime()).toBeGreaterThan(Date.now());

    await sessions.revokeUserSessions(identity.userId);

    expect(await browser.transport.currentSession()).toBeNull();
    await expect(browser.transport.bootstrap(undefined, {})).rejects.toMatchObject({ status: 401 });
  });

  it("restarts the grace on rotation and retires the token it replaced", async () => {
    const browser = browserClient();
    const identity = await browser.transport.signIn("rotating@lifetime.test");
    const firstToken = sessionToken(browser);
    await pool.query(
      "update adl_authority_sessions set issued_at = now() - interval '20 days', expires_at = now() + interval '10 days' where application_id = $1 and user_id = $2",
      [applicationId, identity.userId],
    );

    const rotated = await browser.transport.rotateSession();
    expect(rotated.expiresAt).toBeDefined();
    // A full grace again, measured from this contact.
    const daysLeft = ((rotated.expiresAt?.getTime() ?? 0) - Date.now()) / (24 * 60 * 60 * 1000);
    expect(Math.round(daysLeft)).toBe(GRACE_DAYS);

    const replacement = sessionToken(browser);
    expect(replacement).not.toBe(firstToken);
    // The replaced session is revoked and recorded as rotated, so the old
    // cookie cannot be replayed.
    const rows = await pool.query<{
      revoked_at: Date | null;
      rotated_to_session_id: string | null;
    }>(
      "select revoked_at, rotated_to_session_id from adl_authority_sessions where application_id = $1 and user_id = $2 order by issued_at",
      [applicationId, identity.userId],
    );
    expect(rows.rows[0]?.revoked_at).not.toBeNull();
    expect(rows.rows[0]?.rotated_to_session_id).not.toBeNull();
  });

  /*
   * The device list is the compensating control for the grace window: a lost
   * device keeps syncing until its session is revoked, so its owner must be
   * able to end it. It must disclose only the caller's own sessions, and never
   * a token verifier.
   */
  it("lists only the caller's own active sessions and lets them revoke one", async () => {
    const first = browserClient();
    const identity = await first.transport.signIn("owner@lifetime.test");
    const second = browserClient();
    await second.transport.signIn("owner@lifetime.test");
    const other = browserClient();
    const otherIdentity = await other.transport.signIn("someone-else@lifetime.test");
    expect(otherIdentity.userId).not.toBe(identity.userId);

    const listed = await first.transport.listSessions();
    expect(listed).toHaveLength(2);
    expect(listed.filter((entry) => entry.current)).toHaveLength(1);
    // No token, and no other identity's session.
    expect(JSON.stringify(listed)).not.toContain(sessionToken(first));
    expect(JSON.stringify(listed)).not.toContain("tokenHash");
    const otherSessionIds = (await other.transport.listSessions()).map((entry) => entry.sessionId);
    expect(listed.some((entry) => otherSessionIds.includes(entry.sessionId))).toBe(false);

    const target = listed.find((entry) => !entry.current);
    expect(target).toBeDefined();
    await first.transport.revokeSession(target?.sessionId ?? "");

    // The revoked device is out of the list and refused on its next contact,
    // while the caller's own session keeps working.
    expect(await first.transport.listSessions()).toHaveLength(1);
    expect(await second.transport.currentSession()).toBeNull();
    expect(await first.transport.currentSession()).toMatchObject({ userId: identity.userId });
  });

  it("refuses to revoke another identity's session, and says nothing about it", async () => {
    const owner = browserClient();
    await owner.transport.signIn("owner2@lifetime.test");
    const stranger = browserClient();
    await stranger.transport.signIn("stranger@lifetime.test");
    const strangerSessionId = (await stranger.transport.listSessions())[0]?.sessionId ?? "";
    expect(strangerSessionId).not.toBe("");

    // Identical to an unknown id, so this cannot be used to probe what exists.
    await expect(owner.transport.revokeSession(strangerSessionId)).rejects.toMatchObject({
      status: 404,
      code: "session_not_found",
    });
    await expect(owner.transport.revokeSession("session-that-never-existed")).rejects.toMatchObject(
      {
        status: 404,
        code: "session_not_found",
      },
    );
    expect(await stranger.transport.currentSession()).not.toBeNull();
  });

  it("excludes revoked and expired sessions from the device list", async () => {
    const browser = browserClient();
    const identity = await browser.transport.signIn("stale@lifetime.test");
    const stale = browserClient();
    await stale.transport.signIn("stale@lifetime.test");
    expect(await browser.transport.listSessions()).toHaveLength(2);

    const staleId = (await stale.transport.listSessions()).find(
      (entry) => entry.current,
    )?.sessionId;
    await pool.query(
      "update adl_authority_sessions set expires_at = now() - interval '1 day' where application_id = $1 and session_id = $2",
      [applicationId, staleId ?? ""],
    );

    // Rotation history and lapsed sessions must not read as phantom devices.
    const remaining = await browser.transport.listSessions();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.sessionId).not.toBe(staleId);
    expect(remaining[0]?.current).toBe(true);
    expect(remaining[0]?.sessionId).toBeDefined();
    expect(identity.userId).toMatch(/^user-/u);
  });
});

/** A browser-shaped client: real socket, real cookie jar. */
function browserClient() {
  const credentials = new InMemoryAuthorityCredentialStore();
  return {
    credentials,
    transport: new HttpAuthorityTransport({
      baseUrl,
      credentials,
      origin: "https://app.test",
      forwardedProto: "https",
    }),
  };
}

function sessionToken(browser: ReturnType<typeof browserClient>): string {
  const header = browser.credentials.cookieHeader() ?? "";
  return /__Host-adl_session=([^;]+)/u.exec(header)?.[1] ?? "unset";
}
