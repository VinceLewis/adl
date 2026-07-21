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
  rateLimits: {
    accountProof: 1,
    session: 10,
    invite: 10,
    bootstrap: 10,
    replay: 10,
    report: 10,
    administration: 10,
  },
};

const model = resolveApplicationModel({
  app: { name: "HTTP fixture", startView: "DocumentList" },
  objects: [
    {
      name: "Document",
      fields: [{ name: "Title", type: "text" }],
      views: [{ name: "DocumentList", kind: "list", fields: ["Title"], actions: ["read"] }],
    },
  ],
});

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
        identityVerifier: { verify: async () => null },
      }),
    ).toThrow("StaticSessionAdapter");
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
    expect(await issued.json()).toEqual({ expiresAt: expect.any(String) });
    expect(issued.headers.get("set-cookie")).toContain("__Host-adl_session=");
    expect(issued.headers.get("set-cookie")).toContain("Secure; HttpOnly; SameSite=Strict");
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
    const user = await sessions.provisionIdentity("member@example.test");
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
