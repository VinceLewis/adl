import { describe, expect, it } from "vitest";
import {
  AuthorityConfigurationError,
  AuthorityMetrics,
  AuthorityService,
  InMemoryAuthorityIdentitySessionStore,
  InMemoryObjectStorageBackend,
  OpaqueSessionAdapter,
  StaticSessionAdapter,
  createAuthorityHttpHandler,
  loadAuthorityConfiguration,
  resolveApplicationModel,
  resolveSessionLifetime,
} from "../src/index.js";
import type { AuthorityConfiguration, SecurityLogger } from "../src/index.js";

const configuration: AuthorityConfiguration = {
  environment: "test",
  databaseUrl: "postgresql://authority.test/adl",
  allowedOrigins: ["https://app.test"],
  cookieName: "__Host-adl_session",
  csrfCookieName: "__Host-adl_csrf",
  sessionTtlMinutes: 480,
  maxRequestBytes: 120,
  upstreamIdentity: { issuer: "https://identity.test", audience: "adl-test" },
  identityVerification: { mode: "bypass" },
  rateLimits: {
    accountProof: 1,
    webauthn: 1,
    selfRegistration: 1,
    session: 10,
    invite: 10,
    bootstrap: 10,
    replay: 10,
    report: 10,
    administration: 10,
  },
};

const gracePartialModel = {
  app: { name: "HTTP fixture", startView: "DocumentList" },
  objects: [
    {
      name: "Document",
      fields: [{ name: "Title", type: "text" as const }],
      views: [
        { name: "DocumentList", kind: "list" as const, fields: ["Title"], actions: ["read"] },
      ],
    },
  ],
};

const model = resolveApplicationModel(gracePartialModel);

function request(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://app.test${path}`, {
    method: "POST",
    headers: { origin: "https://app.test", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function fixture() {
  const sessions = new OpaqueSessionAdapter(new InMemoryAuthorityIdentitySessionStore(), {
    newId: (() => {
      let number = 0;
      return () => `id-${++number}`;
    })(),
    newToken: (() => {
      let number = 0;
      return () => `token-${++number}`.padEnd(48, "x");
    })(),
  });
  const entries: unknown[] = [];
  const logger: SecurityLogger = { write: (event) => entries.push(event) };
  const metrics = new AuthorityMetrics();
  return {
    sessions,
    entries,
    metrics,
    handle: createAuthorityHttpHandler({
      configuration,
      sessions,
      authority: new AuthorityService(model, new InMemoryObjectStorageBackend(), sessions),
      identityVerifier: {
        name: "test-upstream",
        verify: async (proof) =>
          proof === "valid-account-proof" ? { subject: "alex@example.test" } : null,
      },
      logger,
      metrics,
      clientKey: () => "test-client",
      newCsrfToken: () => "csrf-token-value".padEnd(48, "c"),
    }),
  };
}

describe("production authority HTTP boundary", () => {
  it("fails closed for incomplete production configuration and static sessions", () => {
    expect(() => loadAuthorityConfiguration({ ADL_ENV: "production" })).toThrow(
      AuthorityConfigurationError,
    );
    const production = { ...configuration, environment: "production" as const };
    const staticSessions = new StaticSessionAdapter(new Map());
    expect(() =>
      createAuthorityHttpHandler({
        configuration: production,
        sessions: staticSessions as unknown as OpaqueSessionAdapter,
        authority: new AuthorityService(model, new InMemoryObjectStorageBackend(), staticSessions),
        identityVerifier: { name: "test-reject", verify: async () => null },
      }),
    ).toThrow("StaticSessionAdapter");
  });

  /*
   * The session must be able to span the grace the model declares, so the
   * declared value is the lifetime and `ADL_SESSION_TTL_MINUTES` may only
   * shorten it. An environment variable must never grant more time away than
   * the application declared.
   */
  it("derives the session lifetime from the declared offline grace, capped by the operator", () => {
    const environment = {
      ADL_ENV: "test",
      ADL_DATABASE_URL: "postgresql://authority.test/adl",
      ADL_ALLOWED_ORIGINS: "https://app.test",
      ADL_UPSTREAM_IDENTITY_ISSUER: "https://identity.test",
      ADL_UPSTREAM_IDENTITY_AUDIENCE: "adl-test",
    };
    const graceModel = (days: number) =>
      resolveApplicationModel({
        ...gracePartialModel,
        app: { ...gracePartialModel.app, offlineGraceDays: days },
      });

    const uncapped = loadAuthorityConfiguration(environment);
    expect(uncapped.sessionTtlMinutesCap).toBeUndefined();
    expect(resolveSessionLifetime(uncapped, graceModel(30)).sessionTtlMinutes).toBe(30 * 24 * 60);
    expect(resolveSessionLifetime(uncapped, graceModel(7)).sessionTtlMinutes).toBe(7 * 24 * 60);

    const capped = loadAuthorityConfiguration({
      ...environment,
      ADL_SESSION_TTL_MINUTES: "1440",
    });
    expect(capped.sessionTtlMinutesCap).toBe(1440);
    expect(resolveSessionLifetime(capped, graceModel(30)).sessionTtlMinutes).toBe(1440);
    // A cap longer than the declared grace never lengthens it.
    const generous = loadAuthorityConfiguration({
      ...environment,
      ADL_SESSION_TTL_MINUTES: String(365 * 24 * 60),
    });
    expect(resolveSessionLifetime(generous, graceModel(30)).sessionTtlMinutes).toBe(30 * 24 * 60);
  });

  it("requires HTTPS/origin/content shape, sets host-only secure cookies, and redacts proof failures", async () => {
    const { handle, entries } = fixture();
    const crossOrigin = await handle(
      new Request("https://app.test/v1/session/issue", {
        method: "POST",
        headers: {
          origin: "https://evil.test",
          "content-type": "application/json",
          "x-adl-account-proof": "valid-account-proof",
        },
        body: "{}",
      }),
    );
    expect(crossOrigin.status).toBe(403);
    const issued = await handle(
      request("/v1/session/issue", {}, { "x-adl-account-proof": "valid-account-proof" }),
    );
    expect(issued.status).toBe(201);
    expect(await issued.json()).toEqual({
      userId: expect.any(String),
      expiresAt: expect.any(String),
    });
    expect(issued.headers.get("set-cookie")).toContain("__Host-adl_session=");
    expect(issued.headers.get("set-cookie")).toContain("Secure; HttpOnly; SameSite=Strict");
    // Persistent, not a browser-session cookie: closing the browser must not
    // sign a user out inside the offline grace. The CSRF cookie carries the
    // same lifetime, or a restored session could read but never write.
    const cookies = issued.headers.getSetCookie();
    expect(cookies).toEqual([
      expect.stringContaining(`__Host-adl_session=`),
      expect.stringContaining(`__Host-adl_csrf=`),
    ]);
    expect(cookies.every((cookie) => cookie.includes(`Max-Age=${480 * 60}`))).toBe(true);
    expect(JSON.stringify(entries)).not.toContain("valid-account-proof");
    const malformed = await handle(request("/v1/sync/replay", { operationId: "missing-kind" }));
    expect(malformed.status).toBe(401);
  });

  it("applies CSRF, body-size, and endpoint rate controls without exposing credentials", async () => {
    const { handle, metrics, sessions } = fixture();
    const identity = await handle(
      request("/v1/session/issue", {}, { "x-adl-account-proof": "valid-account-proof" }),
    );
    expect(identity.status).toBe(201);
    const user = await sessions.provisionIdentity("bypass", "member@example.test");
    const session = await sessions.issueSession(user.userId);
    const csrf = "csrf-token-value".padEnd(48, "c");
    const withSession = {
      cookie: `__Host-adl_session=${session.sessionToken}; __Host-adl_csrf=${csrf}`,
    };
    const csrfDenied = await handle(
      request(
        "/v1/sync/replay",
        { operationId: "op-1", kind: "create", objectName: "Document", values: { Title: "x" } },
        withSession,
      ),
    );
    expect(csrfDenied.status).toBe(403);
    const tooLarge = await handle(request("/v1/sync/replay", { value: "x".repeat(300) }));
    expect(tooLarge.status).toBe(400);
    const limited = await handle(
      request("/v1/session/issue", {}, { "x-adl-account-proof": "valid-account-proof" }),
    );
    expect(limited.status).toBe(429);
    expect(metrics.snapshot().rateLimited["/v1/session/issue"]).toBe(1);
  });
});
