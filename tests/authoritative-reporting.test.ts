import { describe, expect, it } from "vitest";
import {
  AuthorityAccessLifecycleService,
  AuthorityAdministrationService,
  AuthorityMetrics,
  AuthorityReportingService,
  AuthorityService,
  InMemoryAuthorityAccessStore,
  InMemoryAuthorityAdministrationStore,
  InMemoryAuthorityIdentitySessionStore,
  InMemoryObjectStorageBackend,
  OpaqueSessionAdapter,
  createAuthorityHttpHandler,
  resolveApplicationModel,
  validateApplicationModel,
} from "../src/index.js";
import type { AuthorityConfiguration, StoredObjectRecord } from "../src/index.js";

const configuration: AuthorityConfiguration = {
  environment: "test",
  databaseUrl: "postgresql://authority.test/adl",
  allowedOrigins: ["https://app.test"],
  cookieName: "__Host-adl_session",
  csrfCookieName: "__Host-adl_csrf",
  sessionTtlMinutes: 480,
  maxRequestBytes: 4096,
  upstreamIdentity: { issuer: "https://identity.test", audience: "adl-test" },
  identityVerification: { mode: "bypass" },
  rateLimits: {
    accountProof: 10,
    webauthn: 10,
    session: 10,
    invite: 10,
    bootstrap: 10,
    replay: 10,
    report: 3,
    administration: 10,
  },
};

const model = resolveApplicationModel({
  app: { name: "Reporting fixture", startView: "BandList" },
  roles: [{ name: "Manager" }],
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
        roles: ["Manager"],
      },
    },
  ],
  objects: [
    {
      name: "Band",
      fields: [{ name: "Name", type: "text" }],
      views: [{ name: "BandList", kind: "list", fields: ["Name"] }],
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
    {
      name: "Document",
      scope: { context: "Band", field: "Band" },
      fields: [
        {
          name: "Band",
          type: "text",
          required: true,
          lookup: { targetObject: "Band", displayField: "Name" },
        },
        { name: "Title", type: "text" },
        { name: "InternalNotes", type: "text" },
      ],
      views: [{ name: "DocumentList", kind: "list", fields: ["Title"] }],
    },
  ],
  readModels: [
    {
      name: "BandDocuments",
      context: { mode: "required", context: "Band" },
      sources: [{ name: "document", object: "Document", scope: "currentContext" }],
      fields: [
        { name: "Title", source: "document", field: "Title", type: "text" },
        { name: "InternalNotes", source: "document", field: "InternalNotes", type: "text" },
      ],
    },
  ],
  policies: [
    {
      name: "BandMembershipManagement",
      object: "BandMember",
      rules: [
        {
          name: "manager",
          effect: "allow",
          principal: { match: "specific", roles: ["Manager"] },
          action: "update",
        },
        {
          name: "managerRead",
          effect: "allow",
          principal: { match: "specific", roles: ["Manager"] },
          action: "read",
        },
      ],
    },
    {
      name: "Documents",
      object: "Document",
      rules: [
        {
          name: "managerSearch",
          effect: "allow",
          principal: { match: "specific", roles: ["Manager"] },
          action: "search",
        },
        {
          name: "managerRead",
          effect: "allow",
          principal: { match: "specific", roles: ["Manager"] },
          action: "read",
        },
        {
          name: "managerExport",
          effect: "allow",
          principal: { match: "specific", roles: ["Manager"] },
          action: "export",
        },
        {
          name: "maskNotes",
          effect: "mask",
          principal: { match: "specific", roles: ["Manager"] },
          action: "read",
          fields: ["InternalNotes"],
        },
      ],
    },
  ],
});

function record(object: string, id: string, values: Record<string, string>): StoredObjectRecord {
  return {
    meta: {
      guid: id,
      object,
      schemaVersion: 1,
      revision: "rev-1",
      createdAt: "2026-07-21T00:00:00.000Z",
      createdBy: "seed",
      updatedAt: "2026-07-21T00:00:00.000Z",
      updatedBy: "seed",
      syncStatus: "synced",
    },
    values,
  };
}

async function fixture() {
  const storage = new InMemoryObjectStorageBackend();
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
  const manager = await sessions.provisionIdentity("bypass", "manager@example.test");
  const outsider = await sessions.provisionIdentity("bypass", "outsider@example.test");
  const managerSession = await sessions.issueSession(manager.userId);
  const outsiderSession = await sessions.issueSession(outsider.userId);
  await storage.create("Band", record("Band", "band-1", { Name: "One" }));
  await storage.create("Band", record("Band", "band-2", { Name: "Two" }));
  await storage.create(
    "BandMember",
    record("BandMember", "member-1", { User: manager.userId, Band: "band-1", Role: "Manager" }),
  );
  await storage.create(
    "Document",
    record("Document", "document-1", {
      Band: "band-1",
      Title: "Visible",
      InternalNotes: "do not export",
    }),
  );
  await storage.create(
    "Document",
    record("Document", "document-3", {
      Band: "band-1",
      Title: "Visible later",
      InternalNotes: "also protected",
    }),
  );
  await storage.create(
    "Document",
    record("Document", "document-2", {
      Band: "band-2",
      Title: "Hidden",
      InternalNotes: "other context",
    }),
  );
  const administrationStore = new InMemoryAuthorityAdministrationStore();
  administrationStore.accessEvents.push({
    accessAuditId: "access-1",
    kind: "inviteCreated",
    contextName: "Band",
    contextId: "band-1",
    occurredAt: "2026-07-21T00:00:00.000Z",
  });
  administrationStore.accessEvents.push({
    accessAuditId: "access-2",
    kind: "inviteRevoked",
    contextName: "Band",
    contextId: "band-1",
    occurredAt: "2026-07-21T00:01:00.000Z",
  });
  administrationStore.invites.push({
    inviteId: "invite-1",
    contextName: "Band",
    contextId: "band-1",
    role: "Manager",
    recipientUserId: outsider.userId,
    expiresAt: "2026-08-01T00:00:00.000Z",
    status: "active",
  });
  const accessStore = new InMemoryAuthorityAccessStore(storage);
  const access = new AuthorityAccessLifecycleService(model, storage, sessions, accessStore);
  return {
    storage,
    sessions,
    manager,
    managerSession,
    outsiderSession,
    administrationStore,
    access,
    accessStore,
    reporting: new AuthorityReportingService(model, storage, sessions, administrationStore, {
      newCursor: () => "cursor",
    }),
    administration: new AuthorityAdministrationService(
      model,
      storage,
      access,
      administrationStore,
      administrationStore,
    ),
  };
}

describe("authoritative reporting and administration", () => {
  it("executes resolved read models with policy shaping, actor-bound cursors, bounded CSV exports, and auditable metadata", async () => {
    expect(validateApplicationModel(model)).toEqual([]);
    const { reporting, managerSession, outsiderSession, administrationStore } = await fixture();
    const report = await reporting.execute(managerSession.sessionToken, {
      readModelName: "BandDocuments",
      selectedContexts: { Band: "band-1" },
      limit: 1,
    });
    expect(report.rows).toEqual([{ Title: "Visible", InternalNotes: "••••••" }]);
    expect(report.nextCursor).toBe("report-cursor");
    await expect(
      reporting.execute(outsiderSession.sessionToken, {
        readModelName: "BandDocuments",
        cursor: report.nextCursor!,
      }),
    ).resolves.toMatchObject({ rows: [] });
    await expect(
      reporting.execute(outsiderSession.sessionToken, {
        readModelName: "BandDocuments",
        selectedContexts: { Band: "band-1" },
      }),
    ).resolves.toMatchObject({ rows: [] });
    const exported = await reporting.exportCsv(managerSession.sessionToken, {
      readModelName: "BandDocuments",
      selectedContexts: { Band: "band-1" },
    });
    expect(exported.body).toContain('"••••••"');
    expect(exported.body).not.toContain("do not export");
    expect(administrationStore.events.map((event) => event.kind)).toEqual([
      "reportViewed",
      "reportExported",
    ]);
    expect(JSON.stringify(administrationStore.events)).not.toContain("do not export");
  });

  it("reviews only a managed context, returns status summaries rather than verifiers/payloads, and audits the review", async () => {
    const { administration, managerSession, outsiderSession, administrationStore } =
      await fixture();
    await expect(
      administration.accessAudit(outsiderSession.sessionToken, "Band", "band-1"),
    ).rejects.toMatchObject({ code: "ADL_RUNTIME_CONTEXT_ERROR" });
    const firstPage = await administration.accessAudit(
      managerSession.sessionToken,
      "Band",
      "band-1",
      {
        limit: 1,
      },
    );
    expect(firstPage.entries).toEqual([
      expect.objectContaining({ accessAuditId: "access-1", kind: "inviteCreated" }),
    ]);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    await expect(
      administration.accessAudit(managerSession.sessionToken, "Band", "band-1", {
        cursor: firstPage.nextCursor!,
      }),
    ).resolves.toMatchObject({
      entries: [expect.objectContaining({ accessAuditId: "access-2", kind: "inviteRevoked" })],
    });
    const invitations = await administration.invites(managerSession.sessionToken, "Band", "band-1");
    expect(invitations.entries[0]).toEqual(
      expect.objectContaining({ inviteId: "invite-1", status: "active" }),
    );
    expect(JSON.stringify(invitations)).not.toContain("tokenHash");
    expect(administrationStore.events.map((event) => event.kind)).toEqual([
      "accessAuditReviewed",
      "accessAuditReviewed",
      "inviteStatusReviewed",
    ]);
  });

  it("protects reporting HTTP endpoints with the Phase 42 session, CSRF, origin, and rate controls", async () => {
    const { reporting, administration, sessions, managerSession, storage } = await fixture();
    const csrf = "csrf".padEnd(48, "c");
    const metrics = new AuthorityMetrics();
    const handle = createAuthorityHttpHandler({
      configuration,
      sessions,
      authority: new AuthorityService(model, storage, sessions),
      reporting,
      administration,
      identityVerifier: { name: "test-reject", verify: async () => null },
      metrics,
      logger: { write: () => undefined },
      clientKey: () => "report-client",
    });
    const headers = {
      origin: "https://app.test",
      "content-type": "application/json",
      cookie: `__Host-adl_session=${managerSession.sessionToken}; __Host-adl_csrf=${csrf}`,
      "x-adl-csrf-token": csrf,
    };
    const first = await handle(
      new Request("https://app.test/v1/reports/execute", {
        method: "POST",
        headers,
        body: JSON.stringify({
          readModelName: "BandDocuments",
          selectedContexts: { Band: "band-1" },
        }),
      }),
    );
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      rows: expect.arrayContaining([{ Title: "Visible", InternalNotes: "••••••" }]),
    });
    const unauthenticated = await handle(
      new Request("https://app.test/v1/reports/execute", {
        method: "POST",
        headers: { origin: "https://app.test", "content-type": "application/json" },
        body: JSON.stringify({ readModelName: "BandDocuments" }),
      }),
    );
    expect(unauthenticated.status).toBe(401);
    const malformed = await handle(
      new Request("https://app.test/v1/reports/execute", {
        method: "POST",
        headers,
        body: "{}",
      }),
    );
    expect(malformed.status).toBe(400);
    const oversized = await handle(
      new Request("https://app.test/v1/reports/execute", {
        method: "POST",
        headers,
        body: JSON.stringify({ readModelName: "x".repeat(5_000) }),
      }),
    );
    expect(oversized.status).toBe(400);
    const csrfDenied = await handle(
      new Request("https://app.test/v1/reports/execute", {
        method: "POST",
        headers: { ...headers, "x-adl-csrf-token": "wrong" },
        body: JSON.stringify({ readModelName: "BandDocuments" }),
      }),
    );
    expect(csrfDenied.status).toBe(403);
    const crossOrigin = await handle(
      new Request("https://app.test/v1/reports/execute", {
        method: "POST",
        headers: { ...headers, origin: "https://evil.test" },
        body: "{}",
      }),
    );
    expect(crossOrigin.status).toBe(403);
    const accessAudit = await handle(
      new Request("https://app.test/v1/admin/access-audit/list", {
        method: "POST",
        headers,
        body: JSON.stringify({ contextName: "Band", contextId: "band-1", limit: 1 }),
      }),
    );
    expect(accessAudit.status).toBe(200);
    expect(JSON.stringify(await accessAudit.json())).not.toContain("tokenHash");
    const second = await handle(
      new Request("https://app.test/v1/reports/execute", {
        method: "POST",
        headers,
        body: JSON.stringify({
          readModelName: "BandDocuments",
          selectedContexts: { Band: "band-1" },
        }),
      }),
    );
    expect(second.status).toBe(200);
    const rateLimited = await handle(
      new Request("https://app.test/v1/reports/execute", {
        method: "POST",
        headers,
        body: JSON.stringify({
          readModelName: "BandDocuments",
          selectedContexts: { Band: "band-1" },
        }),
      }),
    );
    expect(rateLimited.status).toBe(429);
    expect(metrics.snapshot().rateLimited["/v1/reports/execute"]).toBe(1);
  });
});
