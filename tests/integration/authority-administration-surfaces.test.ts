import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Pool } from "pg";
import {
  AuthorityAccessLifecycleService,
  AuthorityAdministrationService,
  AuthorityProjectionIntegrity,
  AuthorityReportingService,
  AuthorityRetentionRunner,
  AuthorityService,
  HttpAuthorityTransport,
  InMemoryAuthorityCredentialStore,
  OpaqueSessionAdapter,
  PostgresAuthorityAccessStore,
  PostgresAuthorityAdministrationStore,
  PostgresAuthorityIdentitySessionStore,
  PostgresAuthorityRetentionRunStore,
  PostgresAuthorityUnitOfWork,
  PostgresContextMembershipIndex,
  PostgresObjectStorageBackend,
  loadAuthorityRetentionConfiguration,
  resolveApplicationModel,
  retentionPolicy,
  selectUpstreamIdentityVerifier,
} from "../../src/index.js";
import type { AuthorityConfiguration, StoredObjectRecord } from "../../src/index.js";
// The Node deployment adapter pulls in `node:http` and is intentionally kept out
// of the browser-safe barrel export.
import { createAuthorityNodeServer } from "../../src/server/authority-node.js";
import { authorityPool, resetProjections, seedApplication } from "./pg-harness.js";

/*
 * Phase 55: the administration surfaces the browser now consumes, proven end to
 * end over a real localhost socket and real PostgreSQL.
 *
 * Everything an operator does here goes through `HttpAuthorityTransport` — the
 * same client the browser uses — so the surfaces are exercised exactly as the UI
 * exercises them, with no server object reached directly. Setup (invites,
 * membership revocation, seeding) uses the services directly, because that is
 * state the surfaces read rather than surface behaviour itself.
 *
 * The composition below mirrors `src/server/authority-entrypoint.ts`, including
 * the ninth `AuthorityAdministrationService` constructor argument: the
 * metadata-only retention status provider.
 */

const app = "administration-surfaces";
const csrf = "csrf-value".padEnd(48, "s");

/** Values that must never appear on a status surface, a log line, or an export. */
const alphaNoteOne = "internal-note-must-not-leak-1";
const alphaNoteTwo = "internal-note-must-not-leak-2";
const alphaNoteThree = "internal-note-must-not-leak-3";
const auditedAlphaTitle = "audited-alpha-title";
const betaTitle = "beta-title-must-not-leak";
const betaNote = "beta-note-must-not-leak";
const auditedBetaTitle = "audited-beta-title-must-not-leak";

const model = resolveApplicationModel({
  app: { name: "Administration surfaces", startView: "BandList" },
  roles: [{ name: "Manager" }, { name: "Member" }],
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
        roles: ["Manager", "Member"],
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
        { name: "Title", type: "text", required: true },
        { name: "InternalNotes", type: "text" },
      ],
      views: [{ name: "DocumentList", kind: "list", fields: ["Title"], actions: ["read"] }],
      sync: { mode: "localFirst", conflict: "serverWins" },
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
          name: "managerManages",
          effect: "allow",
          principal: { match: "specific", roles: ["Manager"] },
          action: "update",
        },
        {
          name: "managerReads",
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
          name: "managerCreates",
          effect: "allow",
          principal: { match: "specific", roles: ["Manager"] },
          action: "create",
        },
        {
          name: "managerSearches",
          effect: "allow",
          principal: { match: "specific", roles: ["Manager"] },
          action: "search",
        },
        {
          name: "managerReads",
          effect: "allow",
          principal: { match: "specific", roles: ["Manager"] },
          action: "read",
        },
        {
          name: "managerExports",
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

const configuration: AuthorityConfiguration = {
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
    accountProof: 2_000,
    webauthn: 2_000,
    selfRegistration: 2_000,
    session: 2_000,
    invite: 2_000,
    bootstrap: 2_000,
    replay: 2_000,
    report: 2_000,
    administration: 2_000,
  },
};

/**
 * Deliberately unusual windows and an explicit interval, so the status surface
 * can only report them if the real deployment configuration flowed through.
 */
const retentionConfiguration = loadAuthorityRetentionConfiguration({
  ADL_RETENTION_MINIMUM_DAYS: "400",
  ADL_RETENTION_SESSION_DAYS: "45",
  ADL_RETENTION_CHALLENGE_DAYS: "2",
  ADL_RETENTION_INTERVAL_MINUTES: "1440",
});

let pool: Pool;
let server: Server;
let baseUrl: string;
let sessions: OpaqueSessionAdapter;
let accessLifecycle: AuthorityAccessLifecycleService;
let retentionRuns: PostgresAuthorityRetentionRunStore;
/** Monotonic clock for the access-lifecycle, so audit ordering is deterministic. */
let accessClockMs = Date.parse("2026-07-31T00:00:00.000Z");
let accessIdCounter = 0;

function database() {
  return authorityPool(pool);
}
function storage(): PostgresObjectStorageBackend {
  return new PostgresObjectStorageBackend(database(), app, model);
}
function membershipIndex(): PostgresContextMembershipIndex {
  return new PostgresContextMembershipIndex(database(), app);
}

beforeAll(async () => {
  pool = new Pool({ connectionString: inject("pgUrl"), max: 8 });
  sessions = new OpaqueSessionAdapter(new PostgresAuthorityIdentitySessionStore(database(), app));
  accessLifecycle = new AuthorityAccessLifecycleService(
    model,
    storage(),
    sessions,
    new PostgresAuthorityAccessStore(database(), app, model),
    {
      now: () => new Date((accessClockMs += 1_000)),
      newId: () => `id${(accessIdCounter += 1)}`,
      membershipIndex: membershipIndex(),
    },
  );
  const administrationStore = new PostgresAuthorityAdministrationStore(database(), app);
  const integrity = new AuthorityProjectionIntegrity(database(), app, model);
  retentionRuns = new PostgresAuthorityRetentionRunStore(database(), app);
  const retention = new AuthorityRetentionRunner(database(), app, {
    policy: retentionPolicy(retentionConfiguration),
    runs: retentionRuns,
    logger: { write: () => undefined },
  });

  server = createAuthorityNodeServer({
    configuration,
    sessions,
    authority: new AuthorityService(model, storage(), sessions, {
      unitOfWork: new PostgresAuthorityUnitOfWork(database(), app, model),
      membershipIndex: membershipIndex(),
    }),
    identityVerifier: selectUpstreamIdentityVerifier(configuration),
    accessLifecycle,
    reporting: new AuthorityReportingService(model, storage(), sessions, administrationStore),
    administration: new AuthorityAdministrationService(
      model,
      storage(),
      accessLifecycle,
      administrationStore,
      administrationStore,
      () => integrity.recoveryStatus(),
      () => new Date(),
      membershipIndex(),
      // The ninth argument: metadata-only retention status, shaped exactly as
      // `authority-entrypoint.ts` shapes it. It is a read; nothing here runs.
      async () => {
        const latest = await retention.latest();
        return {
          scheduled: retentionConfiguration.intervalMinutes !== undefined,
          ...(retentionConfiguration.intervalMinutes === undefined
            ? {}
            : { intervalMinutes: retentionConfiguration.intervalMinutes }),
          legalHold: retentionConfiguration.legalHold,
          minimumRetentionDays: retentionConfiguration.minimumRetentionDays,
          sessionRetentionDays: retentionConfiguration.sessionRetentionDays,
          challengeRetentionDays: retentionConfiguration.challengeRetentionDays,
          ...(latest === null
            ? {}
            : { lastRun: (({ applicationId: _drop, ...summary }) => summary)(latest) }),
        };
      },
    ),
    logger: { write: () => undefined },
    newCsrfToken: () => csrf,
    clientKey: () => "administration-surfaces-client",
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  await pool.end();
});

beforeEach(async () => {
  await resetProjections(pool);
  await seedApplication(pool, app, model.modelVersion);
});

/** A browser-shaped operator: real socket, real cookie jar, server-derived identity. */
interface Operator {
  credentials: InMemoryAuthorityCredentialStore;
  transport: HttpAuthorityTransport;
  userId: string;
  /** The raw session cookie value, used only to drive setup services directly. */
  sessionToken: string;
}

async function signIn(proof: string): Promise<Operator> {
  const credentials = new InMemoryAuthorityCredentialStore();
  const transport = new HttpAuthorityTransport({
    baseUrl,
    credentials,
    origin: "https://app.test",
    forwardedProto: "https",
  });
  const identity = await transport.signIn(proof);
  const cookie = credentials.cookieHeader() ?? "";
  return {
    credentials,
    transport,
    userId: identity.userId,
    sessionToken: /__Host-adl_session=([^;]+)/u.exec(cookie)?.[1] ?? "",
  };
}

function record(object: string, id: string, values: Record<string, string>): StoredObjectRecord {
  return {
    meta: {
      guid: id,
      object,
      schemaVersion: 1,
      revision: `rev-${id}`,
      createdAt: "2026-07-31T00:00:00.000Z",
      createdBy: "seed",
      updatedAt: "2026-07-31T00:00:00.000Z",
      updatedBy: "seed",
      syncStatus: "synced",
    },
    values,
  };
}

interface Fixture {
  managerA: Operator;
  coManager: Operator;
  member: Operator;
  managerB: Operator;
  outsider: Operator;
  inviteTokens: string[];
}

/**
 * Two bands, two managers, one plain member, one signed-in outsider with no
 * membership anywhere, documents in both bands, one replayed document per band
 * (so there is real scoped runtime audit and a real operation outcome), and two
 * invites in band-1 (so there is real access audit to page through).
 */
async function setup(): Promise<Fixture> {
  const managerA = await signIn("manager-a@admin.test");
  const coManager = await signIn("co-manager@admin.test");
  const member = await signIn("member@admin.test");
  const managerB = await signIn("manager-b@admin.test");
  const outsider = await signIn("outsider@admin.test");

  await storage().create("Band", record("Band", "band-1", { Name: "Alpha" }));
  await storage().create("Band", record("Band", "band-2", { Name: "Beta" }));
  await storage().create(
    "BandMember",
    record("BandMember", "membership-manager-a", {
      User: managerA.userId,
      Band: "band-1",
      Role: "Manager",
    }),
  );
  await storage().create(
    "BandMember",
    record("BandMember", "membership-co-manager", {
      User: coManager.userId,
      Band: "band-1",
      Role: "Manager",
    }),
  );
  await storage().create(
    "BandMember",
    record("BandMember", "membership-member", {
      User: member.userId,
      Band: "band-1",
      Role: "Member",
    }),
  );
  await storage().create(
    "BandMember",
    record("BandMember", "membership-manager-b", {
      User: managerB.userId,
      Band: "band-2",
      Role: "Manager",
    }),
  );

  await storage().create(
    "Document",
    record("Document", "document-alpha-1", {
      Band: "band-1",
      Title: "Alpha stage plan",
      InternalNotes: alphaNoteOne,
    }),
  );
  await storage().create(
    "Document",
    record("Document", "document-alpha-2", {
      Band: "band-1",
      Title: "Alpha rider",
      InternalNotes: alphaNoteTwo,
    }),
  );
  await storage().create(
    "Document",
    record("Document", "document-beta-1", {
      Band: "band-2",
      Title: betaTitle,
      InternalNotes: betaNote,
    }),
  );

  // Replayed writes, so the runtime-audit and operation-outcome projections hold
  // real rows stamped with their business context rather than seeded fictions.
  const alpha = await managerA.transport.replay(undefined, {
    operationId: "op-alpha-document",
    kind: "create",
    objectName: "Document",
    recordId: "document-alpha-3",
    values: { Band: "band-1", Title: auditedAlphaTitle, InternalNotes: alphaNoteThree },
    selectedContexts: { Band: "band-1" },
  });
  expect(alpha.status).toBe("accepted");
  const beta = await managerB.transport.replay(undefined, {
    operationId: "op-beta-document",
    kind: "create",
    objectName: "Document",
    recordId: "document-beta-2",
    values: { Band: "band-2", Title: auditedBetaTitle, InternalNotes: betaNote },
    selectedContexts: { Band: "band-2" },
  });
  expect(beta.status).toBe("accepted");

  // Two invites, so the access-audit review has more than one page to walk.
  const inviteTokens: string[] = [];
  for (let index = 0; index < 2; index += 1) {
    const created = await accessLifecycle.createInvite(managerA.sessionToken, {
      contextName: "Band",
      contextId: "band-1",
      role: "Member",
      expiresAt: new Date("2027-07-31T00:00:00.000Z"),
    });
    inviteTokens.push(created.inviteToken);
  }

  return { managerA, coManager, member, managerB, outsider, inviteTokens };
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const result = await pool.query<{ n: number }>(sql, params);
  return Number(result.rows[0]?.n ?? 0);
}

/** Every projection a retention run could touch, plus the run log itself. */
async function projectionCounts(): Promise<Record<string, number>> {
  return {
    records: await count(
      "select count(*)::int n from adl_authority_records where application_id=$1",
      [app],
    ),
    runtimeAudit: await count(
      "select count(*)::int n from adl_authority_audit_events where application_id=$1",
      [app],
    ),
    outcomes: await count(
      "select count(*)::int n from adl_authority_operation_outcomes where application_id=$1",
      [app],
    ),
    sessions: await count(
      "select count(*)::int n from adl_authority_sessions where application_id=$1",
      [app],
    ),
    challenges: await count(
      "select count(*)::int n from adl_authority_webauthn_challenges where application_id=$1",
      [app],
    ),
    retentionRuns: await count(
      "select count(*)::int n from adl_authority_retention_runs where application_id=$1",
      [app],
    ),
  };
}

/** Every administration/reporting route the browser can reach. */
const SURFACE_ROUTES = [
  "/v1/reports/execute",
  "/v1/reports/export",
  "/v1/admin/access-audit/list",
  "/v1/admin/runtime-audit/list",
  "/v1/admin/memberships/list",
  "/v1/admin/invites/list",
  "/v1/admin/recovery/status",
  "/v1/admin/retention/status",
  "/v1/admin/sessions/revoke",
] as const;

function requestBody(path: string, contextId: string, userId: string): Record<string, unknown> {
  if (path.startsWith("/v1/reports/"))
    return { readModelName: "BandDocuments", selectedContexts: { Band: contextId } };
  return {
    contextName: "Band",
    contextId,
    ...(path === "/v1/admin/sessions/revoke" ? { userId } : {}),
  };
}

interface RawResponse {
  status: number;
  body: string;
  headers: Headers;
}

async function rawPost(path: string, body: unknown, operator?: Operator): Promise<RawResponse> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    origin: "https://app.test",
    "x-forwarded-proto": "https",
  };
  if (operator !== undefined) {
    headers.cookie = operator.credentials.cookieHeader() ?? "";
    headers["x-adl-csrf-token"] = csrf;
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.text(), headers: response.headers };
}

describe("Phase 55 administration surfaces over a real socket and real PostgreSQL", () => {
  it("lets an authorised context manager use all nine surfaces, and records each review", async () => {
    const { managerA, member } = await setup();
    await retentionRuns.record({
      runId: "retention-seeded-1",
      applicationId: app,
      startedAt: "2026-07-30T01:00:00.000Z",
      finishedAt: "2026-07-30T01:00:05.000Z",
      outcome: "completed",
      dryRun: false,
      held: false,
      effectiveCutoff: "2025-07-30T01:00:00.000Z",
      prunedRuntimeAudit: 7,
      prunedOutcomes: 3,
      prunedSessions: 5,
      prunedChallenges: 2,
      prunedTotal: 17,
    });
    const scope = { contextName: "Band", contextId: "band-1" };

    // 1. Execute a report.
    const report = await managerA.transport.executeReport({
      readModelName: "BandDocuments",
      selectedContexts: { Band: "band-1" },
    });
    expect(report.readModelName).toBe("BandDocuments");
    expect(report.fields).toEqual(["Title", "InternalNotes"]);
    expect(report.rows.map((row) => String(row.Title)).sort()).toEqual([
      "Alpha rider",
      "Alpha stage plan",
      auditedAlphaTitle,
    ]);
    // Read masking survives the trip: the notes are shaped by runtime policy.
    expect(JSON.stringify(report)).not.toContain(alphaNoteOne);
    expect(JSON.stringify(report)).not.toContain(betaTitle);

    // 2. Export it as CSV.
    const exported = await managerA.transport.exportReport({
      readModelName: "BandDocuments",
      selectedContexts: { Band: "band-1" },
    });
    expect(exported.contentType).toContain("text/csv");
    expect(exported.filename).toBe("banddocuments.csv");
    expect(exported.body.split("\r\n")[0]).toBe(report.fields.join(","));
    expect(exported.truncated).toBe(false);
    expect(exported.body).toContain('"Alpha stage plan"');
    expect(exported.body).not.toContain(alphaNoteOne);

    // 3. Review access audit.
    const accessAudit = await managerA.transport.listAccessAudit(scope);
    expect(accessAudit.entries.map((entry) => entry.kind)).toEqual([
      "inviteCreated",
      "inviteCreated",
    ]);
    expect(JSON.stringify(accessAudit)).not.toContain("tokenHash");

    // 4. Review runtime audit.
    const runtimeAudit = await managerA.transport.listRuntimeAudit(scope);
    expect(runtimeAudit.entries.map((entry) => entry.recordId)).toContain("document-alpha-3");
    // A summary, never the audited payload.
    expect(JSON.stringify(runtimeAudit)).not.toContain(alphaNoteThree);
    expect(JSON.stringify(runtimeAudit)).not.toContain(auditedAlphaTitle);

    // 5. Review membership status.
    const memberships = await managerA.transport.listMemberships(scope);
    expect(memberships.entries.map((entry) => entry.membershipRecordId).sort()).toEqual([
      "membership-co-manager",
      "membership-manager-a",
      "membership-member",
    ]);
    expect(memberships.entries.every((entry) => entry.status === "active")).toBe(true);

    // 6. Review invite status.
    const invites = await managerA.transport.listInvites(scope);
    expect(invites.entries).toHaveLength(2);
    expect(invites.entries.every((entry) => entry.status === "active")).toBe(true);
    expect(JSON.stringify(invites)).not.toContain("tokenHash");

    // 7. Read recovery status — the real projection-integrity read.
    const recovery = await managerA.transport.recoveryStatus(scope);
    expect(recovery).toMatchObject({ ready: true, recoveryRequired: false });

    // 8. Read retention status.
    const retention = await managerA.transport.retentionStatus(scope);
    expect(retention).toMatchObject({
      scheduled: true,
      minimumRetentionDays: 400,
      lastRun: expect.objectContaining({ runId: "retention-seeded-1", outcome: "completed" }),
    });

    // 9. Revoke another member's sessions.
    expect(
      await count(
        "select count(*)::int n from adl_authority_sessions where application_id=$1 and user_id=$2 and revoked_at is null",
        [app, member.userId],
      ),
    ).toBe(1);
    const revoked = await managerA.transport.revokeUserSessions({
      ...scope,
      userId: member.userId,
    });
    expect(
      await count(
        "select count(*)::int n from adl_authority_sessions where application_id=$1 and user_id=$2 and revoked_at is null",
        [app, member.userId],
      ),
    ).toBe(0);
    // The revoked member's own session is really gone.
    expect(await member.transport.currentSession()).toBeNull();

    // Every review is recorded as metadata, bound to the acting operator.
    const events = await pool.query<{ kind: string; actor: string; payload: string }>(
      "select event->>'kind' kind, event->>'actorId' actor, event::text payload from adl_authority_administration_audit_events where application_id=$1",
      [app],
    );
    const kinds = new Set(events.rows.map((row) => row.kind));
    expect([...kinds].sort()).toEqual([
      "accessAuditReviewed",
      "inviteStatusReviewed",
      "membershipStatusReviewed",
      "recoveryStatusReviewed",
      "reportExported",
      "reportViewed",
      "retentionStatusReviewed",
      "runtimeAuditReviewed",
    ]);
    expect(new Set(events.rows.map((row) => row.actor))).toEqual(new Set([managerA.userId]));
    const auditText = events.rows.map((row) => row.payload).join("\n");
    for (const secret of [alphaNoteOne, alphaNoteTwo, alphaNoteThree, auditedAlphaTitle])
      expect(auditText).not.toContain(secret);
    // A session revocation is an access-audit action, not an administration review.
    expect(
      await count(
        "select count(*)::int n from adl_authority_access_audit_events where application_id=$1 and event->>'kind' = 'sessionsRevoked'",
        [app],
      ),
    ).toBe(1);

    /*
     * Asserted last so the surfaces above are proven either way. The revocation
     * really happened — the rows above say so — but the transport must also
     * *report* it, otherwise a browser surface cannot tell a successful
     * revocation from a refused one and would show an operator nothing after a
     * destructive action succeeded.
     */
    expect(revoked).toBe(true);
  });

  it("exports real CSV: declared header row, content type, filename, and a truncated flag that round-trips", async () => {
    const { managerA } = await setup();
    await storage().create("Band", record("Band", "band-big", { Name: "Big" }));
    await storage().create(
      "BandMember",
      record("BandMember", "membership-manager-a-big", {
        User: managerA.userId,
        Band: "band-big",
        Role: "Manager",
      }),
    );
    // One more than the 100-row export bound, so truncation is real rather than
    // asserted from a flag nothing set.
    for (let index = 0; index < 101; index += 1)
      await storage().create(
        "Document",
        record("Document", `document-big-${index}`, {
          Band: "band-big",
          Title: `Big document ${String(index).padStart(3, "0")}`,
          InternalNotes: "big-note-must-not-leak",
        }),
      );

    const exported = await managerA.transport.exportReport({
      readModelName: "BandDocuments",
      selectedContexts: { Band: "band-big" },
    });
    expect(exported.contentType).toBe("text/csv; charset=utf-8");
    expect(exported.filename).toBe("banddocuments.csv");
    expect(exported.truncated).toBe(true);

    const lines = exported.body.split("\r\n");
    // Header row is the read model's declared field list, in declaration order.
    expect(lines[0]).toBe("Title,InternalNotes");
    // Bounded at 100 data rows plus the header, and every note is still masked.
    expect(lines).toHaveLength(101);
    expect(exported.body).not.toContain("big-note-must-not-leak");
    expect(exported.body).toContain('"••••••"');

    // The flag the transport read is a real response header.
    const raw = await rawPost(
      "/v1/reports/export",
      { readModelName: "BandDocuments", selectedContexts: { Band: "band-big" } },
      managerA,
    );
    expect(raw.status).toBe(200);
    expect(raw.headers.get("x-adl-report-truncated")).toBe("true");
    expect(raw.headers.get("content-disposition")).toBe('attachment; filename="banddocuments.csv"');
    expect(raw.headers.get("content-type")).toBe("text/csv; charset=utf-8");
  });

  it("pages a report, and refuses a forged or other-actor cursor with an empty report rather than an oracle", async () => {
    const { managerA, managerB } = await setup();
    const first = await managerA.transport.executeReport({
      readModelName: "BandDocuments",
      selectedContexts: { Band: "band-1" },
      limit: 2,
    });
    expect(first.rows).toHaveLength(2);
    expect(first.nextCursor).toEqual(expect.any(String));

    // A different actor presenting the cursor learns nothing at all, and does not
    // consume the page it belongs to.
    const stolen = await managerB.transport.executeReport({
      readModelName: "BandDocuments",
      cursor: first.nextCursor ?? "",
    });
    expect(stolen).toEqual({
      readModelName: "BandDocuments",
      fields: [],
      rows: [],
      truncated: false,
    });
    const forged = await managerA.transport.executeReport({
      readModelName: "BandDocuments",
      cursor: "report-forged-cursor",
    });
    expect(forged).toEqual(stolen);

    const second = await managerA.transport.executeReport({
      readModelName: "BandDocuments",
      cursor: first.nextCursor ?? "",
      limit: 2,
    });
    expect(second.rows).toHaveLength(1);
    expect(second.nextCursor).toBeUndefined();

    const titles = [...first.rows, ...second.rows].map((row) => String(row.Title));
    expect(new Set(titles).size).toBe(3);
    expect(titles.sort()).toEqual(["Alpha rider", "Alpha stage plan", auditedAlphaTitle]);
  });

  it("pages an administration review list, and refuses a forged or other-actor cursor", async () => {
    const { managerA, coManager } = await setup();
    const scope = { contextName: "Band", contextId: "band-1" };
    const first = await managerA.transport.listAccessAudit({ ...scope, limit: 1 });
    expect(first.entries).toHaveLength(1);
    expect(first.nextCursor).toEqual(expect.any(String));

    // Another manager of the same context still cannot use someone else's cursor.
    const stolen = await coManager.transport.listAccessAudit({
      ...scope,
      cursor: first.nextCursor ?? "",
    });
    expect(stolen).toEqual({ entries: [] });
    const forged = await managerA.transport.listAccessAudit({
      ...scope,
      cursor: "admin-forged-cursor",
    });
    expect(forged).toEqual({ entries: [] });

    const second = await managerA.transport.listAccessAudit({
      ...scope,
      cursor: first.nextCursor ?? "",
      limit: 1,
    });
    expect(second.entries).toHaveLength(1);
    const ids = [...first.entries, ...second.entries].map((entry) => entry.accessAuditId);
    expect(new Set(ids).size).toBe(2);
  });

  it("reports a revoked membership as revoked rather than omitting it", async () => {
    const { managerA, member } = await setup();
    expect(
      await accessLifecycle.revokeMembership(managerA.sessionToken, {
        contextName: "Band",
        contextId: "band-1",
        userId: member.userId,
        role: "Member",
      }),
    ).toBe(true);

    const review = await managerA.transport.listMemberships({
      contextName: "Band",
      contextId: "band-1",
    });
    const entries = review.entries as Array<{ membershipRecordId: string; status: string }>;
    expect(entries.map((entry) => entry.membershipRecordId).sort()).toEqual([
      "membership-co-manager",
      "membership-manager-a",
      "membership-member",
    ]);
    expect(entries.find((entry) => entry.membershipRecordId === "membership-member")?.status).toBe(
      "revoked",
    );
  });

  it("gives an unauthorised signed-in caller nothing, and makes denied indistinguishable from absent", async () => {
    const { outsider, member } = await setup();
    const scope = { contextName: "Band", contextId: "band-1" };

    // Nothing additional through any surface.
    const report = await outsider.transport.executeReport({
      readModelName: "BandDocuments",
      selectedContexts: { Band: "band-1" },
    });
    expect(report).toEqual({
      readModelName: "BandDocuments",
      fields: [],
      rows: [],
      truncated: false,
    });
    for (const call of [
      () => outsider.transport.exportReport({ readModelName: "BandDocuments" }),
      () => outsider.transport.listAccessAudit(scope),
      () => outsider.transport.listRuntimeAudit(scope),
      () => outsider.transport.listMemberships(scope),
      () => outsider.transport.listInvites(scope),
      () => outsider.transport.recoveryStatus(scope),
      () => outsider.transport.retentionStatus(scope),
      () => outsider.transport.revokeUserSessions({ ...scope, userId: member.userId }),
    ])
      await expect(call()).rejects.toMatchObject({ name: "AuthorityTransportError" });

    // Their refusal for a context that exists is byte-identical to the refusal
    // for one that does not, so they cannot use these surfaces to learn which
    // contexts, memberships or reports exist.
    for (const path of SURFACE_ROUTES) {
      const present = await rawPost(path, requestBody(path, "band-1", member.userId), outsider);
      const absent = await rawPost(path, requestBody(path, "band-absent", member.userId), outsider);
      expect({ path, ...present, headers: undefined }).toEqual({
        path,
        ...absent,
        headers: undefined,
      });
      for (const secret of [alphaNoteOne, auditedAlphaTitle, "membership-member", betaTitle])
        expect(present.body).not.toContain(secret);
    }

    // The member's sessions are untouched by the outsider's attempt.
    expect(
      await count(
        "select count(*)::int n from adl_authority_sessions where application_id=$1 and user_id=$2 and revoked_at is null",
        [app, member.userId],
      ),
    ).toBe(1);
  });

  it("shows a manager of one context nothing of another", async () => {
    const { managerA, managerB } = await setup();
    const other = { contextName: "Band", contextId: "band-2" };

    for (const call of [
      () => managerA.transport.listAccessAudit(other),
      () => managerA.transport.listRuntimeAudit(other),
      () => managerA.transport.listMemberships(other),
    ])
      await expect(call()).rejects.toMatchObject({ name: "AuthorityTransportError" });

    // And asking about band-2 looks exactly like asking about a band that is not
    // there: a manager cannot enumerate the deployment's other contexts.
    for (const path of [
      "/v1/admin/access-audit/list",
      "/v1/admin/runtime-audit/list",
      "/v1/admin/memberships/list",
    ]) {
      const wrong = await rawPost(path, requestBody(path, "band-2", managerB.userId), managerA);
      const absent = await rawPost(
        path,
        requestBody(path, "band-absent", managerB.userId),
        managerA,
      );
      expect(wrong.status).toBe(absent.status);
      expect(wrong.body).toBe(absent.body);
    }

    // Nothing of band-2 reaches band-1's own reviews.
    const runtimeAudit = await managerA.transport.listRuntimeAudit({
      contextName: "Band",
      contextId: "band-1",
    });
    expect(runtimeAudit.entries.map((entry) => entry.recordId)).not.toContain("document-beta-2");
    const memberships = await managerA.transport.listMemberships({
      contextName: "Band",
      contextId: "band-1",
    });
    expect(memberships.entries.map((entry) => entry.membershipRecordId)).not.toContain(
      "membership-manager-b",
    );
    expect(JSON.stringify(memberships)).not.toContain(managerB.userId);
    const report = await managerA.transport.executeReport({
      readModelName: "BandDocuments",
      selectedContexts: { Band: "band-1" },
    });
    expect(JSON.stringify(report)).not.toContain(betaTitle);
  });

  it("refuses every surface to an unauthenticated caller", async () => {
    const { member } = await setup();
    for (const path of SURFACE_ROUTES) {
      const response = await rawPost(path, requestBody(path, "band-1", member.userId));
      expect({ path, status: response.status, body: response.body }).toEqual({
        path,
        status: 401,
        body: JSON.stringify({ error: "unauthenticated" }),
      });
    }
  });

  it("returns retention metadata only, and no protected value anywhere in the payload", async () => {
    const { managerA, inviteTokens } = await setup();
    await retentionRuns.record({
      runId: "retention-seeded-2",
      applicationId: app,
      startedAt: "2026-07-30T02:00:00.000Z",
      finishedAt: "2026-07-30T02:00:09.000Z",
      outcome: "completed",
      dryRun: false,
      held: false,
      effectiveCutoff: "2025-07-30T02:00:00.000Z",
      prunedRuntimeAudit: 11,
      prunedOutcomes: 4,
      prunedSessions: 6,
      prunedChallenges: 1,
      prunedTotal: 22,
    });
    const scope = { contextName: "Band", contextId: "band-1" };

    const status = await managerA.transport.retentionStatus(scope);
    expect(status).not.toBeNull();
    expect(status).toEqual({
      // The schedule flag and every declared window.
      scheduled: true,
      intervalMinutes: 1440,
      legalHold: false,
      minimumRetentionDays: 400,
      sessionRetentionDays: 45,
      challengeRetentionDays: 2,
      // The last run's outcome and its counts, and nothing else.
      lastRun: {
        runId: "retention-seeded-2",
        startedAt: "2026-07-30T02:00:00.000Z",
        finishedAt: "2026-07-30T02:00:09.000Z",
        outcome: "completed",
        dryRun: false,
        held: false,
        effectiveCutoff: "2025-07-30T02:00:00.000Z",
        prunedRuntimeAudit: 11,
        prunedOutcomes: 4,
        prunedSessions: 6,
        prunedChallenges: 1,
        prunedTotal: 22,
      },
    });

    // The whole serialised response, checked against everything protected that
    // this fixture actually seeded.
    const raw = await rawPost(
      "/v1/admin/retention/status",
      requestBody("/v1/admin/retention/status", "band-1", managerA.userId),
      managerA,
    );
    expect(raw.status).toBe(200);
    const verifier = await pool.query<{ token_hash: string }>(
      "select token_hash from adl_authority_sessions where application_id=$1 and user_id=$2",
      [app, managerA.userId],
    );
    const outcome = await pool.query<{ outcome: string }>(
      "select outcome::text outcome from adl_authority_operation_outcomes where application_id=$1",
      [app],
    );
    const auditPayload = await pool.query<{ event: string }>(
      "select event::text event from adl_authority_audit_events where application_id=$1",
      [app],
    );
    expect(verifier.rows.length).toBeGreaterThan(0);
    expect(outcome.rows.length).toBeGreaterThan(0);
    expect(auditPayload.rows.length).toBeGreaterThan(0);

    const protectedValues = [
      // Accepted record values.
      alphaNoteOne,
      alphaNoteTwo,
      alphaNoteThree,
      auditedAlphaTitle,
      "Alpha stage plan",
      // Session tokens and their verifiers.
      managerA.sessionToken,
      ...verifier.rows.map((row) => row.token_hash),
      // Invite tokens.
      ...inviteTokens,
      // Outcome bodies and audit payloads.
      ...outcome.rows.map((row) => row.outcome),
      ...auditPayload.rows.map((row) => row.event),
    ];
    for (const secret of protectedValues) {
      expect(secret.length).toBeGreaterThan(0);
      expect(raw.body).not.toContain(secret);
      expect(JSON.stringify(status)).not.toContain(secret);
    }
    // Nor the application id the entrypoint strips from the run summary.
    expect(Object.keys((status as { lastRun: Record<string, unknown> }).lastRun)).not.toContain(
      "applicationId",
    );
  });

  it("exposes no way to run retention over HTTP, and leaves the projections untouched when asked", async () => {
    const { managerA } = await setup();
    const before = await projectionCounts();

    for (const path of ["/v1/admin/retention/run", "/v1/admin/retention/dry-run"]) {
      const response = await rawPost(path, { contextName: "Band", contextId: "band-1" }, managerA);
      // Not-found shaped: there is no such route, and being an authorised manager
      // of the context does not conjure one.
      expect({ path, status: response.status, body: response.body }).toEqual({
        path,
        status: 404,
        body: JSON.stringify({ error: "not_found" }),
      });
    }
    // A GET is refused before routing even considers the path.
    const viaGet = await fetch(`${baseUrl}/v1/admin/retention/run`, {
      method: "GET",
      headers: { origin: "https://app.test", "x-forwarded-proto": "https" },
    });
    expect(viaGet.status).toBe(404);

    expect(await projectionCounts()).toEqual(before);
    // Nothing was recorded as a run, either.
    expect(before.retentionRuns).toBe(0);
  });
});
