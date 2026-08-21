import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Pool } from "pg";
import {
  ApplicationRuntime,
  AuthoritySyncClient,
  AuthorityService,
  AuthorityTransportError,
  HttpAuthorityTransport,
  InMemoryAuthorityCredentialStore,
  InMemoryObjectStorageBackend,
  OpaqueSessionAdapter,
  PostgresAuthorityIdentitySessionStore,
  PostgresAuthorityUnitOfWork,
  PostgresObjectStorageBackend,
  resolveApplicationModel,
  selectUpstreamIdentityVerifier,
} from "../../src/index.js";
import type {
  AuthorityConfiguration,
  AuthorityIdentityVerificationMode,
  RuntimeContext,
  SecurityLogEvent,
} from "../../src/index.js";
// The Node deployment adapter and the composed entrypoint pull in `node:http`,
// `node:fs` and `pg`; both are intentionally kept out of the browser-safe barrel.
import { createAuthorityNodeServer } from "../../src/server/authority-node.js";
import {
  createAuthorityProcess,
  loadAuthorityProcessConfiguration,
} from "../../src/server/authority-entrypoint.js";
import { authorityPool, resetProjections, seedApplication } from "./pg-harness.js";

const applicationId = "deployment-slice";
const accountProof = "casey@deployment.test";
const csrf = "csrf-value".padEnd(48, "d");

const model = resolveApplicationModel({
  app: { name: "Deployment slice", startView: "GigList" },
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
    {
      name: "Invitation",
      scope: { context: "Band", field: "Band" },
      fields: [
        {
          name: "Band",
          type: "text",
          required: true,
          lookup: { targetObject: "Band", displayField: "Name" },
        },
        { name: "Email", type: "text", required: true },
      ],
      sync: { mode: "onlineRequired", conflict: "serverWins" },
    },
    {
      name: "PrivateNote",
      fields: [{ name: "Body", type: "text", required: true }],
      sync: { mode: "localPrivate", conflict: "serverWins" },
    },
  ],
  policies: [
    {
      name: "SystemPolicy",
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
        {
          name: "membersSearch",
          effect: "allow",
          principal: { match: "specific", roles: ["BandAdmin", "BandMember"] },
          action: "search",
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
          name: "membersRead",
          effect: "allow",
          principal: { match: "specific", roles: ["BandAdmin", "BandMember"] },
          action: "read",
        },
        {
          name: "membersSearch",
          effect: "allow",
          principal: { match: "specific", roles: ["BandAdmin", "BandMember"] },
          action: "search",
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
          name: "membersRead",
          effect: "allow",
          principal: { match: "specific", roles: ["BandAdmin", "BandMember"] },
          action: "read",
        },
        {
          name: "membersSearch",
          effect: "allow",
          principal: { match: "specific", roles: ["BandAdmin", "BandMember"] },
          action: "search",
        },
        {
          name: "adminsCreate",
          effect: "allow",
          principal: { match: "specific", roles: ["BandAdmin"] },
          action: "create",
        },
        {
          name: "adminsDelete",
          effect: "allow",
          principal: { match: "specific", roles: ["BandAdmin"] },
          action: "delete",
        },
      ],
    },
    {
      name: "InvitationPolicy",
      object: "Invitation",
      rules: [
        {
          name: "systemAll",
          effect: "allow",
          principal: { match: "specific", roles: ["SystemAdmin"] },
          action: "*",
        },
        {
          name: "adminsAll",
          effect: "allow",
          principal: { match: "specific", roles: ["BandAdmin"] },
          action: "*",
        },
      ],
    },
    {
      name: "PrivateNotePolicy",
      object: "PrivateNote",
      rules: [
        {
          name: "ownerAll",
          effect: "allow",
          principal: { match: "authenticated" },
          action: "*",
        },
      ],
    },
  ],
});

function configuration(
  mode: AuthorityIdentityVerificationMode,
  replayLimit = 500,
): AuthorityConfiguration {
  return {
    environment: "test",
    databaseUrl: "postgresql://ignored/adl",
    allowedOrigins: ["https://app.test"],
    cookieName: "__Host-adl_session",
    csrfCookieName: "__Host-adl_csrf",
    sessionTtlMinutes: 480,
    maxRequestBytes: 65_536,
    upstreamIdentity: { issuer: "https://identity.test", audience: "adl-test" },
    identityVerification: { mode },
    rateLimits: {
      accountProof: 500,
      webauthn: 500,
      selfRegistration: 500,
      session: 500,
      invite: 500,
      bootstrap: 500,
      replay: replayLimit,
      report: 500,
      administration: 500,
    },
  };
}

let pool: Pool;
let sessions: OpaqueSessionAdapter;
let bypassServer: Server;
let upstreamServer: Server;
let throttledServer: Server;
let bypassUrl: string;
/** A port nothing listens on, so a real fetch fails the way an unreachable authority does. */
let closedPort: number;
let upstreamUrl: string;
let throttledUrl: string;
const logged: SecurityLogEvent[] = [];
/** Startup events are written when each handler is constructed, before the per-test reset. */
const startupLogged: SecurityLogEvent[] = [];

function startServer(
  mode: AuthorityIdentityVerificationMode,
  replayLimit?: number,
): Promise<{ server: Server; baseUrl: string }> {
  const config = configuration(mode, replayLimit);
  const server = createAuthorityNodeServer({
    configuration: config,
    sessions,
    authority: new AuthorityService(
      model,
      new PostgresObjectStorageBackend(authorityPool(pool), applicationId, model),
      sessions,
      { unitOfWork: new PostgresAuthorityUnitOfWork(authorityPool(pool), applicationId, model) },
    ),
    identityVerifier: selectUpstreamIdentityVerifier(config),
    readiness: async () => {
      await pool.query("select 1");
      return { ready: true };
    },
    logger: { write: (event) => logged.push(event) },
    newCsrfToken: () => csrf,
    clientKey: () => `client-${mode}-${replayLimit ?? "default"}`,
  });
  return new Promise((done) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      done({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

beforeAll(async () => {
  pool = new Pool({ connectionString: inject("pgUrl"), max: 8 });
  sessions = new OpaqueSessionAdapter(
    new PostgresAuthorityIdentitySessionStore(authorityPool(pool), applicationId),
  );
  const bypass = await startServer("bypass");
  const upstream = await startServer("upstream");
  const throttled = await startServer("bypass", 1);
  closedPort = await reserveClosedPort();
  bypassServer = bypass.server;
  bypassUrl = bypass.baseUrl;
  upstreamServer = upstream.server;
  upstreamUrl = upstream.baseUrl;
  throttledServer = throttled.server;
  throttledUrl = throttled.baseUrl;
  startupLogged.push(...logged);
});

afterAll(async () => {
  for (const server of [bypassServer, upstreamServer, throttledServer])
    await new Promise<void>((done) => server.close(() => done()));
  await pool.end();
});

beforeEach(async () => {
  logged.length = 0;
  await resetProjections(pool);
  await seedApplication(pool, applicationId, model.modelVersion);
});

/**
 * Binds a port and immediately releases it. Nothing is listening there, so a
 * request to it fails in the transport rather than being answered — which is the
 * only way to exercise a delivery failure without stubbing the transport out.
 */
async function reserveClosedPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, "127.0.0.1", () => done()));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((done) => probe.close(() => done()));
  return port;
}

/** A browser-shaped client: real socket, real cookie jar, recorded wire payloads. */
function browserClient(baseUrl: string) {
  const credentials = new InMemoryAuthorityCredentialStore();
  const wire: { path: string; body: string }[] = [];
  const recordingFetch: typeof globalThis.fetch = async (input, init) => {
    wire.push({
      path: new URL(String(input)).pathname,
      body: typeof init?.body === "string" ? init.body : "",
    });
    return globalThis.fetch(input, init);
  };
  const transport = new HttpAuthorityTransport({
    baseUrl,
    credentials,
    fetch: recordingFetch,
    origin: "https://app.test",
    forwardedProto: "https",
  });
  const runtime = new ApplicationRuntime(model, { storage: new InMemoryObjectStorageBackend() });
  return {
    credentials,
    wire,
    transport,
    runtime,
    client: new AuthoritySyncClient(runtime, transport),
    requests: (path: string) => wire.filter((entry) => entry.path === path),
  };
}

const systemContext: RuntimeContext = {
  userId: "seed-system",
  roles: ["SystemAdmin"],
  channel: "api",
};

/** Seeds accepted server state directly through the runtime over PostgreSQL. */
async function seedAcceptedState(memberUserId: string, gigCount: number) {
  const runtime = new ApplicationRuntime(model, {
    storage: new PostgresObjectStorageBackend(authorityPool(pool), applicationId, model),
  });
  const bandA = await runtime.create("Band", { Name: "Alpha" }, systemContext);
  const bandB = await runtime.create("Band", { Name: "Beta" }, systemContext);
  const inA = { ...systemContext, selectedContexts: { Band: bandA.meta.guid } };
  const inB = { ...systemContext, selectedContexts: { Band: bandB.meta.guid } };
  await runtime.create(
    "BandMember",
    { User: memberUserId, Band: bandA.meta.guid, Role: "BandAdmin" },
    inA,
  );
  const titles: string[] = [];
  for (let index = 0; index < gigCount; index += 1) {
    const title = `Alpha gig ${String(index).padStart(3, "0")}`;
    titles.push(title);
    await runtime.create("Gig", { Band: bandA.meta.guid, Title: title }, inA);
  }
  await runtime.create("Gig", { Band: bandB.meta.guid, Title: "Beta private gig" }, inB);
  await runtime.create("PrivateNote", { Body: "server-side local-private note" }, systemContext);
  return { bandA: bandA.meta.guid, bandB: bandB.meta.guid, titles };
}

describe("Phase 46 deployment slice over a real socket and real PostgreSQL", () => {
  it("serves health, readiness and metrics, and names the active identity verifier", async () => {
    expect((await fetch(`${bypassUrl}/healthz`)).status).toBe(200);
    const ready = await fetch(`${bypassUrl}/readyz`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({
      status: "ready",
      identityVerification: { mode: "bypass", verifier: "bypass", bypassed: true },
    });
    const metrics = await fetch(`${bypassUrl}/metrics`);
    expect(metrics.status).toBe(200);
    expect(metrics.headers.get("content-type")).toContain("text/plain");

    const upstreamReady = await fetch(`${upstreamUrl}/readyz`);
    expect(await upstreamReady.json()).toMatchObject({
      identityVerification: {
        mode: "upstream",
        verifier: "upstream-unconfigured",
        bypassed: false,
      },
    });
  });

  it("issues a session from an account proof while verification is bypassed", async () => {
    const browser = browserClient(bypassUrl);
    const session = await browser.transport.signIn(accountProof);
    expect(session.userId).toMatch(/^user-/u);

    // The subject no longer lives on the identity: it is one link among the
    // several an identity may hold, and the verifier that produced it is part
    // of the key. That is what makes a later provider change a link rather
    // than a re-keying of everything scoped by this user id.
    const identities = await pool.query<{ user_id: string; provider: string; subject: string }>(
      "select identity.user_id, link.provider, link.subject from adl_authority_identities identity join adl_authority_identity_links link on link.application_id = identity.application_id and link.user_id = identity.user_id where identity.application_id = $1",
      [applicationId],
    );
    expect(identities.rows).toEqual([
      { user_id: session.userId, provider: "bypass", subject: accountProof },
    ]);
    expect(
      await pool.query("select 1 from adl_authority_sessions where application_id = $1", [
        applicationId,
      ]),
    ).toMatchObject({ rowCount: 1 });

    // The bypass is disclosed at startup and no log line carries the proof.
    expect(
      startupLogged.filter((event) => event.event === "identity_verification_configured"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mode: "bypass", verifier: "bypass", bypassed: true }),
        expect.objectContaining({
          mode: "upstream",
          verifier: "upstream-unconfigured",
          bypassed: false,
        }),
      ]),
    );
    expect(JSON.stringify(startupLogged)).not.toContain(accountProof);
    expect(JSON.stringify(logged)).not.toContain(accountProof);

    // The same cookie jar resolves the identity again without a second sign-in.
    expect(await browser.transport.currentSession()).toMatchObject({ userId: session.userId });
  });

  it("rejects an unverifiable proof and issues no session when the switch is on", async () => {
    const browser = browserClient(upstreamUrl);
    await expect(browser.transport.signIn(accountProof)).rejects.toMatchObject({
      name: "AuthorityTransportError",
      status: 401,
      code: "authentication_failed",
    });
    expect(
      await pool.query("select 1 from adl_authority_sessions where application_id = $1", [
        applicationId,
      ]),
    ).toMatchObject({ rowCount: 0 });
    expect(
      await pool.query("select 1 from adl_authority_identities where application_id = $1", [
        applicationId,
      ]),
    ).toMatchObject({ rowCount: 0 });
    expect(JSON.stringify(logged)).not.toContain(accountProof);
  });

  it("bootstraps every page of the permitted dataset and drops nothing to nextCursor", async () => {
    const browser = browserClient(bypassUrl);
    const session = await browser.transport.signIn(accountProof);
    const seeded = await seedAcceptedState(session.userId, 130);

    const context: RuntimeContext = {
      userId: session.userId,
      roles: [],
      channel: "ui",
      selectedContexts: { Band: seeded.bandA },
    };
    const response = await browser.client.bootstrap(undefined, context);

    // More than one page was fetched, and the walk completed.
    expect(browser.requests("/v1/sync/bootstrap").length).toBeGreaterThan(1);
    expect(response.nextCursor).toBeUndefined();

    const applied = new Set(
      response.records
        .filter((entry) => entry.objectName === "Gig")
        .map((entry) => String(entry.record.values.Title)),
    );
    for (const title of seeded.titles) expect(applied.has(title)).toBe(true);
    // A record only reachable beyond page one must still have been applied locally.
    const localContext = await browser.runtime.withSelectedContext("Band", seeded.bandA, {
      userId: session.userId,
      roles: [],
      channel: "ui",
    });
    const localGigs = await browser.runtime.search("Gig", undefined, localContext);
    expect(localGigs.map((record) => String(record.values.Title))).toContain(
      seeded.titles.at(-1) ?? "",
    );

    // Nothing from a band the caller is not a member of, and no local-private data.
    expect(applied.has("Beta private gig")).toBe(false);
    expect(response.records.some((entry) => entry.objectName === "PrivateNote")).toBe(false);
    for (const request of browser.requests("/v1/sync/bootstrap"))
      expect(request.body).not.toContain("PrivateNote");
  });

  it("replays queued offline work exactly once and keeps local-private data off the wire", async () => {
    const browser = browserClient(bypassUrl);
    const session = await browser.transport.signIn(accountProof);
    const seeded = await seedAcceptedState(session.userId, 2);
    const online: RuntimeContext = {
      userId: session.userId,
      roles: [],
      channel: "ui",
      selectedContexts: { Band: seeded.bandA },
    };
    await browser.client.bootstrap(undefined, online);

    // Roles come from the bootstrapped membership record, never from the client.
    const bandContext = await browser.runtime.withSelectedContext("Band", seeded.bandA, {
      userId: session.userId,
      roles: [],
      channel: "ui",
      online: false,
    });
    expect(bandContext.contextRoles?.map((entry) => entry.role)).toContain("BandAdmin");

    await browser.runtime.create(
      "Gig",
      { Band: seeded.bandA, Title: "Written while offline" },
      bandContext,
    );
    await browser.runtime.create(
      "PrivateNote",
      { Body: "never leaves the browser" },
      { ...bandContext, online: false },
    );
    expect(browser.runtime.syncQueue.getEntries()).toHaveLength(1);

    const outcomes = await browser.client.reconcile(undefined, { ...bandContext, online: true });
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["accepted"]);
    expect(browser.runtime.syncQueue.getEntries()).toHaveLength(0);
    expect(browser.requests("/v1/sync/replay")).toHaveLength(1);

    const persisted = await pool.query<{ n: number }>(
      "select count(*)::int n from adl_authority_records where application_id = $1 and object_name = 'Gig' and record ->> 'values' is not null",
      [applicationId],
    );
    expect(Number(persisted.rows[0]?.n)).toBe(4);

    // A second reconcile has nothing left to send: the entry replayed exactly once.
    await browser.client.reconcile(undefined, { ...bandContext, online: true });
    expect(browser.requests("/v1/sync/replay")).toHaveLength(1);

    // Local-private records and their operation data never reach the wire.
    const bodies = browser.wire.map((entry) => entry.body).join("\n");
    expect(bodies).not.toContain("PrivateNote");
    expect(bodies).not.toContain("never leaves the browser");
    // The seeded server-side note is authority state; the browser's own
    // local-private record must never have been projected there.
    expect(
      await pool.query(
        "select 1 from adl_authority_records where record -> 'values' ->> 'Body' = $1",
        ["never leaves the browser"],
      ),
    ).toMatchObject({ rowCount: 0 });

    // No credential appears in any structured log line.
    const cookieHeader = browser.credentials.cookieHeader() ?? "";
    const sessionToken = /__Host-adl_session=([^;]+)/u.exec(cookieHeader)?.[1] ?? "unset";
    expect(sessionToken).not.toBe("unset");
    expect(JSON.stringify(logged)).not.toContain(sessionToken);
    expect(JSON.stringify(logged)).not.toContain(accountProof);
  });

  it("delivers an online-required write to the authority and reads it back on bootstrap", async () => {
    const browser = browserClient(bypassUrl);
    const session = await browser.transport.signIn(accountProof);
    const seeded = await seedAcceptedState(session.userId, 1);
    const online: RuntimeContext = {
      userId: session.userId,
      roles: [],
      channel: "ui",
      selectedContexts: { Band: seeded.bandA },
    };
    await browser.client.bootstrap(undefined, online);
    const bandContext = await browser.runtime.withSelectedContext("Band", seeded.bandA, online);

    // The mode permits this write only while online, which is exactly when it
    // used to be accepted locally and then never sent to anyone.
    const invitation = await browser.runtime.create(
      "Invitation",
      { Band: seeded.bandA, Email: "player@deployment.test" },
      bandContext,
    );
    expect(browser.runtime.syncQueue.getEntries()).toHaveLength(1);

    const outcomes = await browser.client.deliverPending(undefined, bandContext);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["accepted"]);
    expect(browser.runtime.syncQueue.getEntries()).toHaveLength(0);
    expect(browser.client.listUndelivered()).toEqual([]);

    // The authority holds it under the id the client minted, not a second one.
    const stored = await pool.query<{ guid: string; email: string }>(
      "select record -> 'meta' ->> 'guid' guid, record -> 'values' ->> 'Email' email from adl_authority_records where application_id = $1 and object_name = 'Invitation'",
      [applicationId],
    );
    expect(stored.rows).toEqual([{ guid: invitation.meta.guid, email: "player@deployment.test" }]);

    // And a device that has never seen it reads it back: the record has a path
    // to the authority *and* a path home.
    const second = browserClient(bypassUrl);
    await second.transport.signIn(accountProof);
    const pulled = await second.client.bootstrap(undefined, online);
    expect(
      pulled.records
        .filter((entry) => entry.objectName === "Invitation")
        .map((entry) => entry.record.meta.guid),
    ).toEqual([invitation.meta.guid]);
  });

  it("refuses a local-private replay rather than storing a record no bootstrap returns", async () => {
    const browser = browserClient(bypassUrl);
    await browser.transport.signIn(accountProof);

    // A conforming client never sends this; the authority must refuse it anyway,
    // symmetrically with cache-readonly.
    const outcome = await browser.transport.replay(undefined, {
      operationId: "op-local-private-replay",
      kind: "create",
      objectName: "PrivateNote",
      recordId: "private-note-smuggled",
      values: { Body: "should never be stored" },
    });

    expect(outcome).toMatchObject({ status: "rejected", code: "ADL_SYNC_POLICY_DENIED" });
    expect(
      await pool.query(
        "select 1 from adl_authority_records where application_id = $1 and object_name = 'PrivateNote' and record -> 'meta' ->> 'guid' = $2",
        [applicationId, "private-note-smuggled"],
      ),
    ).toMatchObject({ rowCount: 0 });
  });

  it("makes an undelivered online-required write visible instead of losing it", async () => {
    const browser = browserClient(bypassUrl);
    const session = await browser.transport.signIn(accountProof);
    const seeded = await seedAcceptedState(session.userId, 1);
    const online: RuntimeContext = {
      userId: session.userId,
      roles: [],
      channel: "ui",
      selectedContexts: { Band: seeded.bandA },
    };
    await browser.client.bootstrap(undefined, online);
    const bandContext = await browser.runtime.withSelectedContext("Band", seeded.bandA, online);
    await browser.runtime.create(
      "Invitation",
      { Band: seeded.bandA, Email: "unreachable@deployment.test" },
      bandContext,
    );

    // The same runtime and queue, pointed at an authority that is not there.
    const unreachable = new AuthoritySyncClient(
      browser.runtime,
      new HttpAuthorityTransport({
        baseUrl: `http://127.0.0.1:${String(closedPort)}`,
        credentials: browser.credentials,
        origin: "https://app.test",
        forwardedProto: "https",
      }),
    );
    await expect(unreachable.deliverPending(undefined, bandContext)).resolves.toEqual([]);

    const [undelivered] = unreachable.listUndelivered();
    expect(undelivered).toMatchObject({ objectName: "Invitation", operation: "create" });
    // A transport failure is not a verdict: nothing is settled, and the entry
    // is still there to be sent.
    expect(unreachable.listRecovery()).toEqual([]);
    expect(browser.runtime.syncQueue.getReplayable()).toHaveLength(1);

    // Retried against the real authority under the same operation id.
    const outcome = await browser.client.retryDelivery(
      undefined,
      bandContext,
      undelivered?.queueId ?? "",
    );
    expect(outcome?.status).toBe("accepted");
    expect(browser.client.listUndelivered()).toEqual([]);
    expect(
      await pool.query(
        "select 1 from adl_authority_records where application_id = $1 and object_name = 'Invitation' and record -> 'values' ->> 'Email' = $2",
        [applicationId, "unreachable@deployment.test"],
      ),
    ).toMatchObject({ rowCount: 1 });
  });

  it("replays a queued delete so the authority tombstones the accepted record", async () => {
    const browser = browserClient(bypassUrl);
    const session = await browser.transport.signIn(accountProof);
    const seeded = await seedAcceptedState(session.userId, 1);
    const online: RuntimeContext = {
      userId: session.userId,
      roles: [],
      channel: "ui",
      selectedContexts: { Band: seeded.bandA },
    };
    await browser.client.bootstrap(undefined, online);
    const bandContext = await browser.runtime.withSelectedContext("Band", seeded.bandA, {
      userId: session.userId,
      roles: [],
      channel: "ui",
      online: false,
    });
    const local = await browser.runtime.search("Gig", undefined, bandContext);
    const target = local[0];
    expect(target).toBeDefined();

    await browser.runtime.delete("Gig", target?.meta.guid ?? "", bandContext);
    expect(browser.runtime.syncQueue.getEntries()).toHaveLength(1);

    // A deleted record has no active local row; the queued delete must still be
    // replayed rather than skipped and stranded in the queue.
    const outcomes = await browser.client.reconcile(undefined, { ...bandContext, online: true });
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["accepted"]);
    expect(browser.runtime.syncQueue.getEntries()).toHaveLength(0);
    const tombstoned = await pool.query<{ deleted_at: string | null }>(
      "select deleted_at from adl_authority_records where application_id = $1 and object_name = 'Gig' and record_id = $2",
      [applicationId, target?.meta.guid ?? ""],
    );
    expect(tombstoned.rows[0]?.deleted_at).not.toBeNull();
  });

  it("returns the stored outcome for a repeated operation id instead of applying it twice", async () => {
    const browser = browserClient(bypassUrl);
    const session = await browser.transport.signIn(accountProof);
    const seeded = await seedAcceptedState(session.userId, 1);
    const intent = {
      operationId: "repeated-operation",
      kind: "create" as const,
      objectName: "Gig",
      recordId: "gig-repeated-operation",
      values: { Band: seeded.bandA, Title: "Submitted twice" },
      selectedContexts: { Band: seeded.bandA },
    };
    const first = await browser.transport.replay(undefined, intent);
    const second = await browser.transport.replay(undefined, intent);
    expect(first).toEqual(second);
    expect(first.status).toBe("accepted");
    const gigs = await pool.query<{ n: number }>(
      "select count(*)::int n from adl_authority_records where application_id = $1 and object_name = 'Gig'",
      [applicationId],
    );
    // Two seeded gigs plus the one accepted create: the retry added nothing.
    expect(Number(gigs.rows[0]?.n)).toBe(3);
  });

  it("ignores crafted identity, role and context input from the client", async () => {
    const browser = browserClient(bypassUrl);
    const session = await browser.transport.signIn(accountProof);
    const seeded = await seedAcceptedState(session.userId, 1);

    // A foreign context the caller has no membership in yields nothing, and is
    // indistinguishable from an empty dataset.
    const foreign = await browser.client.bootstrap(undefined, {
      userId: session.userId,
      roles: ["SystemAdmin"],
      channel: "ui",
      selectedContexts: { Band: seeded.bandB },
    });
    expect(foreign.records).toHaveLength(0);

    // Crafted user id, roles, actor, revision and timestamp are ignored, and the
    // write into a foreign context is not accepted.
    const crafted = await fetch(`${bypassUrl}/v1/sync/replay`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://app.test",
        "x-forwarded-proto": "https",
        cookie: browser.credentials.cookieHeader() ?? "",
        "x-adl-csrf-token": csrf,
      },
      body: JSON.stringify({
        operationId: "crafted-1",
        kind: "create",
        objectName: "Gig",
        recordId: "gig-crafted-1",
        values: { Band: seeded.bandB, Title: "Crafted" },
        selectedContexts: { Band: seeded.bandB },
        userId: "someone-else",
        roles: ["SystemAdmin"],
        actorId: "someone-else",
        baseRevision: "1",
        _updatedAt: "2000-01-01T00:00:00.000Z",
      }),
    });
    expect(crafted.status).toBe(200);
    expect(await crafted.json()).toMatchObject({ status: "rejected" });
    const betaGigs = await pool.query<{ n: number }>(
      "select count(*)::int n from adl_authority_records where application_id = $1 and object_name = 'Gig' and record -> 'values' ->> 'Title' = 'Crafted'",
      [applicationId],
    );
    expect(Number(betaGigs.rows[0]?.n)).toBe(0);
  });

  it("keeps the Phase 42 controls over the real transport", async () => {
    const browser = browserClient(bypassUrl);
    await browser.transport.signIn(accountProof);
    const cookie = browser.credentials.cookieHeader() ?? "";

    const withoutCsrf = await fetch(`${bypassUrl}/v1/sync/replay`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://app.test",
        "x-forwarded-proto": "https",
        cookie,
      },
      body: JSON.stringify({
        operationId: "no-csrf",
        kind: "create",
        objectName: "Gig",
        values: {},
      }),
    });
    expect(withoutCsrf.status).toBe(403);

    const hostileOrigin = await fetch(`${bypassUrl}/v1/sync/bootstrap`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.test",
        "x-forwarded-proto": "https",
        cookie,
      },
      body: "{}",
    });
    expect(hostileOrigin.status).toBe(403);
  });

  it("engages the replay rate limit", async () => {
    const browser = browserClient(throttledUrl);
    const session = await browser.transport.signIn(accountProof);
    const seeded = await seedAcceptedState(session.userId, 1);
    const submit = (operationId: string) =>
      browser.transport.replay(undefined, {
        operationId,
        kind: "create",
        objectName: "Gig",
        recordId: `gig-${operationId}`,
        values: { Band: seeded.bandA, Title: operationId },
        selectedContexts: { Band: seeded.bandA },
      });
    await submit("rate-1");
    await expect(submit("rate-2")).rejects.toBeInstanceOf(AuthorityTransportError);
    await expect(submit("rate-2")).rejects.toMatchObject({ status: 429 });
  });
});

describe("the composed authority process", () => {
  it("refuses to start with no ADL_MODEL_PATH rather than defaulting to a reference app", () => {
    expect(() =>
      loadAuthorityProcessConfiguration({
        ADL_APPLICATION_ID: "entrypoint-app",
      }),
    ).toThrow("ADL_MODEL_PATH is required.");
    expect(() =>
      loadAuthorityProcessConfiguration({
        ADL_APPLICATION_ID: "entrypoint-app",
        ADL_MODEL_PATH: "   ",
      }),
    ).toThrow("ADL_MODEL_PATH is required.");
  });

  it("starts against real PostgreSQL and serves health, readiness and metrics", async () => {
    const port = await freePort();
    const started = await createAuthorityProcess({
      environment: {
        ADL_ENV: "test",
        ADL_DATABASE_URL: inject("pgUrl"),
        ADL_ALLOWED_ORIGINS: "https://app.test",
        ADL_UPSTREAM_IDENTITY_ISSUER: "https://identity.test",
        ADL_UPSTREAM_IDENTITY_AUDIENCE: "adl-test",
        ADL_APPLICATION_ID: "entrypoint-app",
        ADL_MODEL_PATH: "src/reference/giggle-band",
        ADL_HOST: "127.0.0.1",
        ADL_PORT: String(port),
      },
    });
    try {
      const address = await started.listen();
      const baseUrl = `http://127.0.0.1:${address.port}`;
      expect((await fetch(`${baseUrl}/healthz`)).status).toBe(200);

      const ready = await fetch(`${baseUrl}/readyz`);
      expect(ready.status).toBe(200);
      expect(await ready.json()).toMatchObject({
        status: "ready",
        identityVerification: { mode: "bypass", verifier: "bypass", bypassed: true },
      });
      expect((await fetch(`${baseUrl}/metrics`)).status).toBe(200);

      // The process registered its own application model row from the compiled
      // ADL project; accepted records reference it by foreign key.
      const registered = await pool.query<{ model_version: string }>(
        "select model_version from adl_authority_models where application_id = $1",
        ["entrypoint-app"],
      );
      expect(registered.rows[0]?.model_version).toBe(started.model.modelVersion);
    } finally {
      await started.close();
    }
  });
});

/** Reserve an ephemeral port, then release it for the process under test. */
async function freePort(): Promise<number> {
  const { createServer } = await import("node:net");
  const probe = createServer();
  return new Promise((settle) => {
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => settle(port));
    });
  });
}
