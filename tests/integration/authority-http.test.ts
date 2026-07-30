import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Pool } from "pg";
import {
  AuthorityService,
  InMemoryAuthorityIdentitySessionStore,
  InMemoryObjectStorageBackend,
  OpaqueSessionAdapter,
  PostgresAuthorityUnitOfWork,
  resolveApplicationModel,
} from "../../src/index.js";
import type { AuthorityConfiguration } from "../../src/index.js";
// Node deployment adapter is imported directly: it pulls in `node:http` and is
// intentionally kept out of the browser-safe barrel export.
import { createAuthorityNodeServer } from "../../src/server/authority-node.js";
import { authorityPool, resetProjections, seedApplication } from "./pg-harness.js";

const httpApp = "http-app";
const csrf = "csrf-value".padEnd(48, "c");

const model = resolveApplicationModel({
  app: { name: "Integration HTTP", startView: "DocumentList" },
  objects: [
    {
      name: "Document",
      fields: [{ name: "Title", type: "text" }],
      views: [{ name: "DocumentList", kind: "list", fields: ["Title"], actions: ["read"] }],
      sync: { mode: "localFirst", conflict: "serverWins" },
    },
  ],
  policies: [
    {
      name: "DocumentPolicy",
      object: "Document",
      rules: [
        { name: "c", effect: "allow", principal: { match: "authenticated" }, action: "create" },
        { name: "r", effect: "allow", principal: { match: "authenticated" }, action: "read" },
      ],
    },
  ],
});

const configuration: AuthorityConfiguration = {
  environment: "test",
  databaseUrl: "postgresql://ignored/adl",
  allowedOrigins: ["https://app.test"],
  cookieName: "__Host-adl_session",
  csrfCookieName: "__Host-adl_csrf",
  sessionTtlMinutes: 480,
  maxRequestBytes: 4096,
  upstreamIdentity: { issuer: "https://identity.test", audience: "adl-test" },
  identityVerification: { mode: "bypass" },
  rateLimits: {
    accountProof: 50,
    session: 50,
    invite: 50,
    bootstrap: 50,
    replay: 50,
    report: 50,
    administration: 50,
  },
};

let pool: Pool;
let server: Server;
let baseUrl: string;
let sessions: OpaqueSessionAdapter;

beforeAll(async () => {
  pool = new Pool({ connectionString: inject("pgUrl"), max: 8 });
  sessions = new OpaqueSessionAdapter(new InMemoryAuthorityIdentitySessionStore());
  server = createAuthorityNodeServer({
    configuration,
    sessions,
    authority: new AuthorityService(model, new InMemoryObjectStorageBackend(), sessions, {
      unitOfWork: new PostgresAuthorityUnitOfWork(authorityPool(pool), httpApp, model),
    }),
    identityVerifier: {
      name: "test-upstream",
      verify: async (proof: string) =>
        proof === "valid-account-proof" ? { subject: "member@example.test" } : null,
    },
    readiness: async () => {
      await pool.query("select 1");
      return { ready: true };
    },
    newCsrfToken: () => csrf,
    clientKey: () => "integration-client",
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  await pool.end();
});

beforeEach(async () => {
  await resetProjections(pool);
  await seedApplication(pool, httpApp, model.modelVersion);
});

describe("authority HTTP edge over a real local network and PostgreSQL", () => {
  it("serves health and readiness (readiness runs a real database probe)", async () => {
    expect((await fetch(`${baseUrl}/healthz`)).status).toBe(200);
    const ready = await fetch(`${baseUrl}/readyz`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({
      status: "ready",
      identityVerification: { mode: "bypass", verifier: "test-upstream", bypassed: true },
    });
  });

  it("accepts an authenticated replay and persists it through the real stack", async () => {
    const user = await sessions.provisionIdentity("member@example.test");
    const session = await sessions.issueSession(user.userId);
    const response = await fetch(`${baseUrl}/v1/sync/replay`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://app.test",
        "x-forwarded-proto": "https",
        cookie: `__Host-adl_session=${session.sessionToken}; __Host-adl_csrf=${csrf}`,
        "x-adl-csrf-token": csrf,
      },
      body: JSON.stringify({
        operationId: "http-op-1",
        kind: "create",
        objectName: "Document",
        values: { Title: "via http" },
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "accepted", operationId: "http-op-1" });

    const persisted = await pool.query<{ n: number }>(
      "select count(*)::int n from adl_authority_records where application_id=$1 and object_name='Document'",
      [httpApp],
    );
    expect(Number(persisted.rows[0]?.n)).toBe(1);
    const audited = await pool.query<{ n: number }>(
      "select count(*)::int n from adl_authority_audit_events where application_id=$1",
      [httpApp],
    );
    expect(Number(audited.rows[0]?.n)).toBeGreaterThan(0);
  });

  it("rejects a mutation without a CSRF token header", async () => {
    const user = await sessions.provisionIdentity("member2@example.test");
    const session = await sessions.issueSession(user.userId);
    const response = await fetch(`${baseUrl}/v1/sync/replay`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://app.test",
        "x-forwarded-proto": "https",
        cookie: `__Host-adl_session=${session.sessionToken}; __Host-adl_csrf=${csrf}`,
      },
      body: JSON.stringify({
        operationId: "http-op-2",
        kind: "create",
        objectName: "Document",
        values: { Title: "no csrf" },
      }),
    });
    expect(response.status).toBe(403);
    expect(
      await pool.query("select 1 from adl_authority_records where application_id=$1", [httpApp]),
    ).toMatchObject({ rowCount: 0 });
  });
});
