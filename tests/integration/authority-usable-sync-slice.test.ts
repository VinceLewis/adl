import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Pool } from "pg";
import {
  ApplicationRuntime,
  AuthorityAccessLifecycleService,
  AuthorityService,
  InMemoryAuthorityCredentialStore,
  InMemoryObjectStorageBackend,
  OpaqueSessionAdapter,
  PostgresAuthorityAccessStore,
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
} from "../../src/index.js";
import { createAuthorityNodeServer } from "../../src/server/authority-node.js";
import { connectBrowserAuthority } from "../../src/ui/authority-sync.js";
import { shouldCacheResponse } from "../../src/ui/service-worker-policy.js";
import { authorityPool, resetProjections, seedApplication } from "./pg-harness.js";

/**
 * Phase 47 over a real socket and real PostgreSQL. What a fake could not prove
 * here is exactly what matters: that a real invite claim writes a real
 * membership row inside the store's own transaction, that the context it grants
 * only becomes visible on the bootstrap that follows the server's confirmation,
 * and that an offline claim never reaches the wire at all.
 *
 * The browser bridge itself is under test, driven through `connectBrowserAuthority`
 * with an injected cookie jar. That injection is test wiring for a caller with
 * no user agent, not a second transport.
 */

const applicationId = "usable-sync-slice";
const csrf = "csrf-value".padEnd(48, "u");
const adminProof = "admin@usable-slice.test";
const inviteeProof = "invitee@usable-slice.test";

const model = resolveApplicationModel({
  app: { name: "Usable sync slice", startView: "GigList" },
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
      name: "Note",
      scope: { context: "Band", field: "Band" },
      fields: [
        {
          name: "Band",
          type: "text",
          required: true,
          lookup: { targetObject: "Band", displayField: "Name" },
        },
        { name: "Body", type: "text", required: true },
      ],
      sync: { mode: "localFirst", conflict: "manual" },
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
    {
      name: "NotePolicy",
      object: "Note",
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

function configuration(mode: AuthorityIdentityVerificationMode): AuthorityConfiguration {
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
      session: 500,
      invite: 500,
      bootstrap: 500,
      replay: 500,
      report: 500,
      administration: 500,
    },
  };
}

let pool: Pool;
let sessions: OpaqueSessionAdapter;
let server: Server;
let baseUrl: string;

const systemContext: RuntimeContext = {
  userId: "seed-system",
  roles: ["SystemAdmin"],
  channel: "api",
};

beforeAll(async () => {
  pool = new Pool({ connectionString: inject("pgUrl"), max: 8 });
  sessions = new OpaqueSessionAdapter(
    new PostgresAuthorityIdentitySessionStore(authorityPool(pool), applicationId),
  );
  const config = configuration("bypass");
  const storage = new PostgresObjectStorageBackend(authorityPool(pool), applicationId, model);
  server = createAuthorityNodeServer({
    configuration: config,
    sessions,
    authority: new AuthorityService(model, storage, sessions, {
      unitOfWork: new PostgresAuthorityUnitOfWork(authorityPool(pool), applicationId, model),
    }),
    accessLifecycle: new AuthorityAccessLifecycleService(
      model,
      storage,
      sessions,
      new PostgresAuthorityAccessStore(authorityPool(pool), applicationId),
    ),
    identityVerifier: selectUpstreamIdentityVerifier(config),
    readiness: async () => {
      await pool.query("select 1");
      return { ready: true };
    },
    logger: { write: () => undefined },
    newCsrfToken: () => csrf,
    clientKey: () => "usable-slice-client",
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

/** A browser-shaped bridge: real socket, real cookie jar, recorded wire paths. */
async function browserBridge(context: RuntimeContext) {
  const paths: string[] = [];
  const runtime = new ApplicationRuntime(model, { storage: new InMemoryObjectStorageBackend() });
  let current = context;
  const connection = await connectBrowserAuthority(
    runtime,
    {
      baseUrl,
      transport: {
        credentials: new InMemoryAuthorityCredentialStore(),
        fetch: async (input, init) => {
          paths.push(new URL(String(input)).pathname);
          return globalThis.fetch(input, init);
        },
        origin: "https://app.test",
        forwardedProto: "https",
      },
    },
    { getContext: () => current, onChange: () => undefined },
  );
  return {
    connection,
    runtime,
    paths,
    context: () => current,
    setContext: (next: RuntimeContext) => {
      current = next;
    },
  };
}

/** Seeds a band and its admin membership through the runtime over PostgreSQL. */
async function seedBand(adminUserId: string): Promise<string> {
  const runtime = new ApplicationRuntime(model, {
    storage: new PostgresObjectStorageBackend(authorityPool(pool), applicationId, model),
  });
  const band = await runtime.create("Band", { Name: "Alpha" }, systemContext);
  const inBand = { ...systemContext, selectedContexts: { Band: band.meta.guid } };
  await runtime.create(
    "BandMember",
    { User: adminUserId, Band: band.meta.guid, Role: "BandAdmin" },
    inBand,
  );
  await runtime.create("Gig", { Band: band.meta.guid, Title: "Alpha opening night" }, inBand);
  return band.meta.guid;
}

describe("Phase 47 usable sync slice over a real socket and real PostgreSQL", () => {
  it("signs in through the bridge and reports the bypass as a development mode", async () => {
    const browser = await browserBridge({ userId: "unknown", roles: [], channel: "ui" });

    expect(browser.connection.session).toMatchObject({
      status: "signedOut",
      // The authority names its own verifier; the browser never assumes one.
      developmentMode: true,
    });

    await browser.connection.signIn(adminProof);

    expect(browser.connection.session).toMatchObject({
      status: "signedIn",
      developmentMode: true,
      busy: false,
    });
    // The server derived the identity; the browser asserted none.
    expect(browser.connection.session.userId).toBeTruthy();
    expect(browser.paths).toContain("/readyz");
    expect(browser.paths).toContain("/v1/session/issue");
  });

  it("claims an invitation and only then discloses the granted context's records", async () => {
    const admin = await browserBridge({ userId: "unknown", roles: [], channel: "ui" });
    await admin.connection.signIn(adminProof);
    const adminUserId = admin.connection.session.userId ?? "";
    const bandId = await seedBand(adminUserId);
    admin.setContext({
      userId: adminUserId,
      roles: [],
      channel: "ui",
      selectedContexts: { Band: bandId },
    });

    const invitee = await browserBridge({ userId: "unknown", roles: [], channel: "ui" });
    await invitee.connection.signIn(inviteeProof);
    const inviteeUserId = invitee.connection.session.userId ?? "";
    invitee.setContext({
      userId: inviteeUserId,
      roles: [],
      channel: "ui",
      selectedContexts: { Band: bandId },
    });

    // Before the grant the band's records are simply not there for this caller.
    const disclosedBefore = await invitee.connection.bootstrap(invitee.context());
    expect(disclosedBefore).toBe(0);

    const created = await createInvite(admin, bandId, inviteeUserId);
    await invitee.connection.claimInvite(created.inviteToken);

    expect(invitee.connection.invite).toMatchObject({ status: "accepted" });
    // The membership record is real, written by the server inside the claim's
    // own transaction, as an ordinary accepted ADL record.
    const memberships = await pool.query(
      "select record from adl_authority_records where application_id = $1 and object_name = 'BandMember' and record->'values'->>'User' = $2",
      [applicationId, inviteeUserId],
    );
    expect(
      memberships.rows.map(
        (row) => (row as { record: { values: Record<string, string> } }).record.values,
      ),
    ).toEqual([{ User: inviteeUserId, Band: bandId, Role: "BandMember" }]);
    // Only now, after server confirmation and the bootstrap it triggers, does
    // the newly permitted context's data appear locally.
    const gigs = await invitee.runtime.search(
      "Gig",
      {},
      { ...invitee.context(), roles: ["BandMember"] },
    );
    expect(gigs.map((record) => record.values.Title)).toEqual(["Alpha opening night"]);
  });

  it("refuses an offline invite claim rather than queuing it, and sends nothing", async () => {
    const invitee = await browserBridge({ userId: "unknown", roles: [], channel: "ui" });
    await invitee.connection.signIn(inviteeProof);
    invitee.setContext({
      userId: invitee.connection.session.userId ?? "",
      roles: [],
      channel: "ui",
      online: false,
    });

    const before = invitee.paths.length;
    await invitee.connection.claimInvite("a-token-long-enough-to-look-plausible-0001");

    expect(invitee.connection.invite.status).toBe("offline");
    // Nothing reached the wire: no claim may be cached, queued or pre-granted.
    expect(invitee.paths.slice(before)).toEqual([]);
    const claims = await pool.query(
      "select count(*)::int as count from adl_authority_access_audit_events",
    );
    expect(claims.rows[0]?.count).toBe(0);
  });

  it("resolves a serverWins conflict against the authority's real accepted state", async () => {
    const browser = await browserBridge({ userId: "unknown", roles: [], channel: "ui" });
    await browser.connection.signIn(adminProof);
    const adminUserId = browser.connection.session.userId ?? "";
    const bandId = await seedBand(adminUserId);
    const context: RuntimeContext = {
      userId: adminUserId,
      roles: ["BandAdmin"],
      channel: "ui",
      selectedContexts: { Band: bandId },
    };
    browser.setContext(context);
    await browser.connection.bootstrap(context);

    const gigs = await browser.runtime.search("Gig", {}, context);
    const gigId = gigs[0]?.meta.guid ?? "";

    // The authority moves on while this browser is offline.
    const serverRuntime = new ApplicationRuntime(model, {
      storage: new PostgresObjectStorageBackend(authorityPool(pool), applicationId, model),
    });
    await serverRuntime.update(
      "Gig",
      gigId,
      { Title: "Alpha opening night (server)" },
      { ...systemContext, selectedContexts: { Band: bandId } },
    );

    await browser.runtime.update("Gig", gigId, { Title: "Local edit" }, context);
    await browser.connection.synchronize(context);

    // No user input was needed and nothing is left awaiting a person.
    expect(browser.connection.recovery).toEqual([]);
    await expect(browser.runtime.read("Gig", gigId, context)).resolves.toMatchObject({
      values: { Title: "Alpha opening night (server)" },
    });
  });

  it("holds a manual conflict for a person and keeps the queue entry until resolved", async () => {
    const browser = await browserBridge({ userId: "unknown", roles: [], channel: "ui" });
    await browser.connection.signIn(adminProof);
    const adminUserId = browser.connection.session.userId ?? "";
    const bandId = await seedBand(adminUserId);
    const context: RuntimeContext = {
      userId: adminUserId,
      roles: ["BandAdmin"],
      channel: "ui",
      selectedContexts: { Band: bandId },
    };
    browser.setContext(context);

    // The note starts as accepted server state and is pulled down, so both
    // sides share a revision to disagree about.
    const serverRuntime = new ApplicationRuntime(model, {
      storage: new PostgresObjectStorageBackend(authorityPool(pool), applicationId, model),
    });
    const serverContext = { ...systemContext, selectedContexts: { Band: bandId } };
    const note = await serverRuntime.create(
      "Note",
      { Band: bandId, Body: "Original note" },
      serverContext,
    );
    await browser.connection.bootstrap(context);

    // Both sides edit the same revision: a genuine manual conflict.
    await browser.runtime.update("Note", note.meta.guid, { Body: "Local note" }, context);
    await serverRuntime.update("Note", note.meta.guid, { Body: "Server note" }, serverContext);
    await browser.connection.synchronize(context);

    const recovery = browser.connection.recovery;
    expect(recovery).toHaveLength(1);
    expect(recovery[0]).toMatchObject({
      status: "manualResolution",
      strategy: "manual",
      requiresUserChoice: true,
      choices: ["keepServer", "resubmitMine"],
    });
    // Automatic recovery left it alone and the queue entry is still there: it
    // is discarded only once a person resolves it.
    expect(browser.runtime.syncQueue.getAwaitingRecovery()).toHaveLength(1);

    await browser.connection.resolveRecovery(recovery[0]?.queueId ?? "", "keepServer");

    expect(browser.connection.recovery).toEqual([]);
    expect(browser.runtime.syncQueue.getEntries()).toEqual([]);
    // "Keep the server version" is actually true locally, not merely a dropped
    // queue entry.
    await expect(browser.runtime.read("Note", note.meta.guid, context)).resolves.toMatchObject({
      values: { Body: "Server note" },
    });
  });

  it("resubmits a manual conflict for the authority to judge afresh", async () => {
    const browser = await browserBridge({ userId: "unknown", roles: [], channel: "ui" });
    await browser.connection.signIn(adminProof);
    const adminUserId = browser.connection.session.userId ?? "";
    const bandId = await seedBand(adminUserId);
    const context: RuntimeContext = {
      userId: adminUserId,
      roles: ["BandAdmin"],
      channel: "ui",
      selectedContexts: { Band: bandId },
    };
    browser.setContext(context);

    const serverRuntime = new ApplicationRuntime(model, {
      storage: new PostgresObjectStorageBackend(authorityPool(pool), applicationId, model),
    });
    const serverContext = { ...systemContext, selectedContexts: { Band: bandId } };
    const note = await serverRuntime.create(
      "Note",
      { Band: bandId, Body: "Original note" },
      serverContext,
    );
    await browser.connection.bootstrap(context);
    await browser.runtime.update("Note", note.meta.guid, { Body: "Local note" }, context);
    await serverRuntime.update("Note", note.meta.guid, { Body: "Server note" }, serverContext);
    await browser.connection.synchronize(context);

    const queueId = browser.connection.recovery[0]?.queueId ?? "";
    await browser.connection.resolveRecovery(queueId, "resubmitMine");

    // The authority accepted the rebased resubmission and its own record now
    // carries the local edit. Nothing was decided client-side.
    expect(browser.connection.recovery).toEqual([]);
    const rows = await pool.query(
      "select record from adl_authority_records where application_id = $1 and object_name = 'Note' and record_id = $2",
      [applicationId, note.meta.guid],
    );
    expect(
      (rows.rows[0] as { record: { values: Record<string, string> } } | undefined)?.record.values
        .Body,
    ).toBe("Local note");
  });

  /**
   * Phase 48, and the defect this phase exists for. A create intent used to carry
   * no record id, so the authority minted its own: the accepted record arrived
   * under a *different* id, reconciled in as a second local row, and the
   * originating row kept its local guid and `syncStatus: "local"` forever with its
   * queue entry already discarded as accepted. A hermetic fake had masked it for
   * two phases by echoing the client's guid back; only a real authority over real
   * PostgreSQL showed it.
   */
  it("keeps one identity for an offline-created record end to end", async () => {
    const browser = await browserBridge({ userId: "unknown", roles: [], channel: "ui" });
    await browser.connection.signIn(adminProof);
    const adminUserId = browser.connection.session.userId ?? "";
    const bandId = await seedBand(adminUserId);
    const context: RuntimeContext = {
      userId: adminUserId,
      roles: ["BandAdmin"],
      channel: "ui",
      selectedContexts: { Band: bandId },
    };
    browser.setContext(context);

    // Created offline, in the browser, under an id only the browser knows.
    const localNote = await browser.runtime.create(
      "Note",
      { Band: bandId, Body: "Written offline" },
      { ...context, online: false },
    );
    const localId = localNote.meta.guid;

    await browser.connection.synchronize(context);

    expect(browser.connection.recovery).toEqual([]);
    // Exactly one local row, under the id the browser has held all along.
    const localNotes = await browser.runtime.search("Note", {}, context);
    expect(localNotes.map((row) => row.meta.guid)).toEqual([localId]);
    await expect(browser.runtime.read("Note", localId, context)).resolves.toMatchObject({
      meta: { guid: localId, syncStatus: "synced" },
      values: { Body: "Written offline" },
    });
    // Exactly one authority row, under the same id. Two rows here, or a row under
    // a server-minted id, is the defect.
    const accepted = await pool.query<{ record_id: string; record: { values: { Body: string } } }>(
      "select record_id, record from adl_authority_records where application_id = $1 and object_name = 'Note'",
      [applicationId],
    );
    expect(accepted.rows.map((row) => row.record_id)).toEqual([localId]);
    expect(accepted.rows[0]?.record.values.Body).toBe("Written offline");

    // An update issued immediately afterwards addresses the same id, with no
    // translation step: the authority has heard of this record.
    await browser.runtime.update("Note", localId, { Body: "Edited after sync" }, context);
    await browser.connection.synchronize(context);
    expect(browser.connection.recovery).toEqual([]);
    const afterUpdate = await pool.query<{ record: { values: { Body: string } } }>(
      "select record from adl_authority_records where application_id = $1 and record_id = $2",
      [applicationId, localId],
    );
    expect(afterUpdate.rows[0]?.record.values.Body).toBe("Edited after sync");

    // And so does a delete: the authority tombstones the record the browser named.
    await browser.runtime.delete("Note", localId, context);
    await browser.connection.synchronize(context);
    expect(browser.connection.recovery).toEqual([]);
    const afterDelete = await pool.query<{ deleted_at: Date | null }>(
      "select deleted_at from adl_authority_records where application_id = $1 and record_id = $2",
      [applicationId, localId],
    );
    expect(afterDelete.rows[0]?.deleted_at).not.toBeNull();
  });

  /**
   * Naming a record is not authority over it. A create whose id already names an
   * accepted record is refused, the refusal reaches the person through the Phase
   * 47 recovery surface, and it can never be resurrected as accepted.
   */
  it("refuses a create that collides with an accepted record and surfaces it for recovery", async () => {
    const browser = await browserBridge({ userId: "unknown", roles: [], channel: "ui" });
    await browser.connection.signIn(adminProof);
    const adminUserId = browser.connection.session.userId ?? "";
    const bandId = await seedBand(adminUserId);
    const context: RuntimeContext = {
      userId: adminUserId,
      roles: ["BandAdmin"],
      channel: "ui",
      selectedContexts: { Band: bandId },
    };
    browser.setContext(context);

    // The authority already holds this id, and this browser has not pulled it.
    const serverRuntime = new ApplicationRuntime(model, {
      storage: new PostgresObjectStorageBackend(authorityPool(pool), applicationId, model),
    });
    const collidingId = "note-collision-target";
    await serverRuntime.create(
      "Note",
      { Band: bandId, Body: "Somebody else's note" },
      { ...systemContext, selectedContexts: { Band: bandId } },
      { recordId: collidingId },
    );
    await browser.runtime.create("Note", { Band: bandId, Body: "Mine" }, context, {
      recordId: collidingId,
    });

    await browser.connection.synchronize(context);

    // Visible, and terminal: a rejection carries no strategy, so automatic
    // recovery left it alone, and acknowledging it is the only move.
    expect(browser.connection.recovery).toHaveLength(1);
    expect(browser.connection.recovery[0]).toMatchObject({
      objectName: "Note",
      recordId: collidingId,
      operation: "create",
      status: "rejected",
      code: "ADL_RUNTIME_RECORD_ID_TAKEN",
      requiresUserChoice: false,
      choices: ["keepServer"],
    });
    expect(browser.connection.recovery[0]?.strategy).toBeUndefined();
    // The recovery surface still discloses no record values, its own or anyone's.
    expect(JSON.stringify(browser.connection.recovery)).not.toContain("Somebody else's note");
    // The authority's record stands untouched: not overwritten, not merged.
    const rows = await pool.query<{ record: { values: { Body: string } } }>(
      "select record from adl_authority_records where application_id = $1 and record_id = $2",
      [applicationId, collidingId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.record.values.Body).toBe("Somebody else's note");

    // Asking to resubmit a refused write falls back to abandoning it: the
    // authority said no, and no client choice may turn that into an accept.
    await browser.connection.resolveRecovery(
      browser.connection.recovery[0]?.queueId ?? "",
      "resubmitMine",
    );

    expect(browser.connection.recovery).toEqual([]);
    expect(browser.runtime.syncQueue.getEntries()).toEqual([]);
    const afterResolution = await pool.query<{ record: { values: { Body: string } } }>(
      "select record from adl_authority_records where application_id = $1 and record_id = $2",
      [applicationId, collidingId],
    );
    expect(afterResolution.rows[0]?.record.values.Body).toBe("Somebody else's note");
  });

  it("refuses a malformed or absent record id at the HTTP edge", async () => {
    const browser = await browserBridge({ userId: "unknown", roles: [], channel: "ui" });
    await browser.connection.signIn(adminProof);
    const adminUserId = browser.connection.session.userId ?? "";
    const bandId = await seedBand(adminUserId);

    async function replay(body: Record<string, unknown>): Promise<Response> {
      return fetch(`${baseUrl}/v1/sync/replay`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://app.test",
          "x-forwarded-proto": "https",
          "x-adl-csrf-token": csrf,
          cookie: adminCookie(browser),
        },
        body: JSON.stringify(body),
      });
    }
    const intent = {
      kind: "create",
      objectName: "Note",
      values: { Band: bandId, Body: "Crafted" },
      selectedContexts: { Band: bandId },
    };

    // A NUL in a text key is a real PostgreSQL failure, so it is refused at the
    // edge as well as in the runtime; neither layer assumes the other ran.
    const control = await replay({
      ...intent,
      operationId: "op-edge-control",
      recordId: `note-${String.fromCodePoint(0)}1`,
    });
    expect(control.status).toBe(400);
    const overLong = await replay({
      ...intent,
      operationId: "op-edge-long",
      recordId: "n".repeat(321),
    });
    expect(overLong.status).toBe(400);
    const absent = await replay({ ...intent, operationId: "op-edge-absent" });
    expect(absent.status).toBe(400);

    // Nothing was written, and no outcome was recorded for a request that never
    // became an intent.
    const notes = await pool.query<{ count: number }>(
      "select count(*)::int as count from adl_authority_records where application_id = $1 and object_name = 'Note'",
      [applicationId],
    );
    expect(notes.rows[0]?.count).toBe(0);
    const outcomes = await pool.query<{ count: number }>(
      "select count(*)::int as count from adl_authority_operation_outcomes where operation_id like 'op-edge-%'",
    );
    expect(outcomes.rows[0]?.count).toBe(0);
  });

  it("refuses to let the service worker cache a real authority response", async () => {
    const browser = await browserBridge({ userId: "unknown", roles: [], channel: "ui" });
    await browser.connection.signIn(adminProof);

    // A genuine authority response, headers and all, straight off the socket.
    const response = await fetch(`${baseUrl}/v1/session/current`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://app.test",
        "x-forwarded-proto": "https",
        "x-adl-csrf-token": csrf,
        cookie: `__Host-adl_csrf=${csrf}`,
      },
      body: "{}",
    });

    const workerOrigin = "https://app.test";
    expect(
      shouldCacheResponse(
        {
          url: `${workerOrigin}/v1/session/current`,
          method: "GET",
          mode: "cors",
          destination: "",
        },
        response,
        workerOrigin,
      ),
    ).toBe(false);
  });
});

async function createInvite(
  admin: Awaited<ReturnType<typeof browserBridge>>,
  bandId: string,
  recipientUserId: string,
): Promise<{ inviteToken: string }> {
  const response = await fetch(`${baseUrl}/v1/invites/create`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://app.test",
      "x-forwarded-proto": "https",
      "x-adl-csrf-token": csrf,
      cookie: adminCookie(admin),
    },
    body: JSON.stringify({
      contextName: "Band",
      contextId: bandId,
      role: "BandMember",
      recipientUserId,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    }),
  });
  const body = (await response.json()) as { inviteToken?: string };
  if (typeof body.inviteToken !== "string")
    throw new Error(`The authority returned no invite token (status ${response.status}).`);
  return { inviteToken: body.inviteToken };
}

function adminCookie(admin: Awaited<ReturnType<typeof browserBridge>>): string {
  const credentials = (
    admin.connection.transport as unknown as { credentials: InMemoryAuthorityCredentialStore }
  ).credentials;
  return credentials.cookieHeader() ?? "";
}
