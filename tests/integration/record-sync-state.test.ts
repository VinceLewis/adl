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
  PostgresContextMembershipIndex,
  PostgresObjectStorageBackend,
  selectUpstreamIdentityVerifier,
} from "../../src/index.js";
import type {
  AuthorityConfiguration,
  ObjectStorageBackend,
  RuntimeContext,
  StoredObjectRecord,
  SyncStatus,
} from "../../src/index.js";
import { createGiggleBandExampleModel } from "../../src/reference/band-app.js";
import { createAuthorityNodeServer } from "../../src/server/authority-node.js";
import { connectBrowserAuthority } from "../../src/ui/authority-sync.js";
import { authorityPool, resetProjections, seedApplication } from "./pg-harness.js";

/**
 * Phase 58 against a real authority over real PostgreSQL.
 *
 * The hermetic suite can prove the transition table; it cannot produce a real
 * verdict. Only the real authority mints real revisions, refuses a real
 * client-supplied id, and answers a real command as one transaction — and it is
 * the *command* case this phase exists for: a refused `CreateBand` must leave
 * both the band and its founder membership visibly refused, not just the record
 * its queue entry happens to be filed under.
 *
 * Everything is asserted from the device's own storage and from
 * `adl_authority_records`, never from the outcome object the service returned.
 */

const applicationId = "record-sync-state";
const csrf = "csrf-value".padEnd(48, "s");
const founderProof = "founder@record-sync.test";

const model = createGiggleBandExampleModel();

const systemContext: RuntimeContext = {
  userId: "seed-system",
  roles: ["SystemAdmin"],
  channel: "api",
};

function configuration(): AuthorityConfiguration {
  return {
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
  };
}

let pool: Pool;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  pool = new Pool({ connectionString: inject("pgUrl"), max: 8 });
  const queryable = authorityPool(pool);
  const sessions = new OpaqueSessionAdapter(
    new PostgresAuthorityIdentitySessionStore(queryable, applicationId),
  );
  const config = configuration();
  const storage = new PostgresObjectStorageBackend(queryable, applicationId, model);
  server = createAuthorityNodeServer({
    configuration: config,
    sessions,
    authority: new AuthorityService(model, storage, sessions, {
      unitOfWork: new PostgresAuthorityUnitOfWork(queryable, applicationId, model),
      membershipIndex: new PostgresContextMembershipIndex(queryable, applicationId),
    }),
    accessLifecycle: new AuthorityAccessLifecycleService(
      model,
      storage,
      sessions,
      new PostgresAuthorityAccessStore(queryable, applicationId, model),
    ),
    identityVerifier: selectUpstreamIdentityVerifier(config),
    readiness: async () => {
      await pool.query("select 1");
      return { ready: true };
    },
    logger: { write: () => undefined },
    newCsrfToken: () => csrf,
    clientKey: () => "record-sync-client",
  });
  baseUrl = await new Promise((done) => {
    server.listen(0, "127.0.0.1", () => {
      done(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
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

/** One request this device actually made, body and all. */
interface WireRequest {
  path: string;
  body: unknown;
}

/**
 * A browser-shaped device: real socket, real cookie jar, and every request body
 * kept so the wire itself can be asserted on rather than the intent the client
 * says it built.
 *
 * The storage backend is injectable so a test can throw the runtime away and
 * build a new one over the same storage — a reload, without the browser.
 */
async function device(storage: ObjectStorageBackend = new InMemoryObjectStorageBackend()) {
  const wire: WireRequest[] = [];
  const runtime = new ApplicationRuntime(model, { storage });
  let current: RuntimeContext = { userId: "unknown", roles: [], channel: "ui" };
  const connection = await connectBrowserAuthority(
    runtime,
    {
      baseUrl,
      transport: {
        credentials: new InMemoryAuthorityCredentialStore(),
        fetch: async (input, init) => {
          const body = init?.body;
          wire.push({
            path: new URL(String(input)).pathname,
            body: typeof body === "string" && body.length > 0 ? JSON.parse(body) : undefined,
          });
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
    storage,
    wire,
    context: () => current,
    setContext: (next: RuntimeContext) => {
      current = next;
    },
  };
}

/** The device's own stored record, meta and all, with no read shaping applied. */
async function localRecord(
  runtime: ApplicationRuntime,
  objectName: string,
  recordId: string,
): Promise<StoredObjectRecord | null> {
  return runtime.objectStore.getRecordForSync(objectName, recordId);
}

async function localSyncStatus(
  runtime: ApplicationRuntime,
  objectName: string,
  recordId: string,
): Promise<SyncStatus | "absent"> {
  const record = await localRecord(runtime, objectName, recordId);
  return record?.meta.syncStatus ?? "absent";
}

/** The authority's own row under an id, or null. */
async function authorityRecord(
  objectName: string,
  recordId: string,
): Promise<StoredObjectRecord | null> {
  const result = await pool.query<{ record: StoredObjectRecord }>(
    "select record from adl_authority_records where application_id=$1 and object_name=$2 and record_id=$3",
    [applicationId, objectName, recordId],
  );
  return result.rows[0]?.record ?? null;
}

async function authorityRecordCount(): Promise<number> {
  const result = await pool.query<{ n: number }>(
    "select count(*)::int n from adl_authority_records where application_id=$1",
    [applicationId],
  );
  return Number(result.rows[0]?.n ?? 0);
}

/** A runtime speaking straight to the authority's storage, as another actor would. */
function serverRuntime(): ApplicationRuntime {
  return new ApplicationRuntime(model, {
    storage: new PostgresObjectStorageBackend(authorityPool(pool), applicationId, model),
  });
}

/**
 * Signs a device in and gives it a band it administers, seeded server-side so
 * the device holds nothing until it bootstraps.
 */
async function signedInFounder(): Promise<{
  browser: Awaited<ReturnType<typeof device>>;
  userId: string;
  bandId: string;
  context: RuntimeContext;
}> {
  const browser = await device();
  await browser.connection.signIn(founderProof);
  const userId = browser.connection.session.userId ?? "";
  const server = serverRuntime();
  const band = await server.create("Band", { Name: "Alpha", CreatedBy: userId }, systemContext);
  const bandId = band.meta.guid;
  const inBand = { ...systemContext, selectedContexts: { Band: bandId } };
  await server.create(
    "BandMember",
    { User: userId, Band: bandId, Role: "BandAdmin", JoinedAt: "2026-07-01" },
    inBand,
  );
  const context: RuntimeContext = {
    userId,
    roles: ["BandAdmin"],
    channel: "ui",
    selectedContexts: { Band: bandId },
  };
  browser.setContext(context);
  return { browser, userId, bandId, context };
}

describe("Phase 58 record sync state against a real authority and real PostgreSQL", () => {
  /** Acceptance: a queued write reports `pending`, and `synced` once accepted. */
  it("leaves a queued device write pending and synced only once the authority accepts it", async () => {
    const { browser, bandId, context } = await signedInFounder();
    await browser.connection.bootstrap(context);

    const event = await browser.runtime.create(
      "Event",
      { Band: bandId, EventType: "Gig", Date: "2026-08-01", Title: "Queued gig" },
      { ...context, online: false },
    );
    const eventId = event.meta.guid;

    // Queued and unanswered: not "local", which is what a record with no
    // delivery path at all means.
    expect(await localSyncStatus(browser.runtime, "Event", eventId)).toBe("pending");
    expect(browser.runtime.syncQueue.getReplayable()).toHaveLength(1);
    expect(await authorityRecord("Event", eventId)).toBeNull();
    expect(await browser.runtime.summariseRecordSyncState()).toMatchObject({ pending: 1 });

    await browser.connection.synchronize(context);

    expect(browser.connection.recovery).toEqual([]);
    expect(browser.runtime.syncQueue.getEntries()).toEqual([]);
    expect(await localSyncStatus(browser.runtime, "Event", eventId)).toBe("synced");
    // The authority really did accept it, under the id the device minted.
    expect((await authorityRecord("Event", eventId))?.values).toMatchObject({
      Title: "Queued gig",
    });

    // A record the device holds but never wrote is settled too, not pending: a
    // bootstrapped record is the authority's own accepted state.
    expect(await localSyncStatus(browser.runtime, "Band", bandId)).toBe("synced");
  });

  /**
   * Acceptance: a refused write stays refused after the verdict is dismissed and
   * after a reload. The queue entry is gone by then, so the record is the only
   * thing left that can say what happened to it.
   */
  it("keeps a refused create rejected after the verdict is dismissed and the runtime rebuilt", async () => {
    const { browser, bandId, context } = await signedInFounder();
    await browser.connection.bootstrap(context);

    // The authority already holds this id, under another band's event that this
    // device is not a member of and will never be shown. The refusal therefore
    // leaves the local row as the only copy anywhere, which is the case the
    // rejected state has to survive: nothing will ever come along and replace
    // it.
    const takenId = "event-collision-target";
    const server = serverRuntime();
    const otherBand = await server.create(
      "Band",
      { Name: "Other", CreatedBy: "someone-else" },
      systemContext,
    );
    await server.create(
      "Event",
      {
        Band: otherBand.meta.guid,
        EventType: "Rehearsal",
        Date: "2026-08-02",
        Title: "Somebody else's",
      },
      { ...systemContext, selectedContexts: { Band: otherBand.meta.guid } },
      { recordId: takenId },
    );
    await browser.runtime.create(
      "Event",
      { Band: bandId, EventType: "Gig", Date: "2026-08-03", Title: "Mine" },
      context,
      { recordId: takenId },
    );
    expect(await localSyncStatus(browser.runtime, "Event", takenId)).toBe("pending");

    await browser.connection.reconcile(context);

    // Read from the client rather than the bridge's snapshot: a bare `reconcile`
    // does not refresh the shell's copy, and this test is about the record.
    const refused = browser.connection.client.listRecovery();
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({
      status: "rejected",
      code: "ADL_RUNTIME_RECORD_ID_TAKEN",
    });
    expect(await localSyncStatus(browser.runtime, "Event", takenId)).toBe("rejected");
    expect(await browser.runtime.listRefusedRecords()).toEqual([
      { objectName: "Event", recordId: takenId, discardable: true },
    ]);

    // The user dismisses the verdict. The queue entry — the only other place the
    // refusal was recorded — goes with it.
    await browser.connection.resolveRecovery(refused[0]?.queueId ?? "", "keepServer");
    expect(browser.connection.client.listRecovery()).toEqual([]);
    expect(browser.runtime.syncQueue.getEntries()).toEqual([]);
    expect(await localSyncStatus(browser.runtime, "Event", takenId)).toBe("rejected");

    // A reload: a brand new runtime over the same storage, with no memory of the
    // session that saw the verdict.
    const reloaded = new ApplicationRuntime(model, { storage: browser.storage });
    expect(await localSyncStatus(reloaded, "Event", takenId)).toBe("rejected");
    expect(await reloaded.listRefusedRecords()).toEqual([
      { objectName: "Event", recordId: takenId, discardable: true },
    ]);
    // The device's own row is untouched by the refusal; only its state changed.
    expect((await localRecord(reloaded, "Event", takenId))?.values).toMatchObject({
      Title: "Mine",
    });
    // And the authority's row is untouched by the attempt on its id.
    expect((await authorityRecord("Event", takenId))?.values).toMatchObject({
      Title: "Somebody else's",
    });
  });

  /**
   * The case this phase exists for.
   *
   * `CreateBand` writes a band *and* its founder membership in one transaction,
   * and the queue entry is filed under one representative record. A refusal is
   * about the whole command, so both records must be marked — a band left
   * `pending` beside a `rejected` membership is exactly the stranded, invisible
   * residue Phase 57 enlarged.
   *
   * The refusal is a real one the authority produces on its own: the band id the
   * device minted is already taken by a record it cannot see, so the whole
   * command is refused with `ADL_RUNTIME_RECORD_ID_TAKEN` and nothing it would
   * have written lands.
   */
  it("marks every record a refused command wrote, not just the one its entry is filed under", async () => {
    const browser = await device();
    await browser.connection.signIn(founderProof);
    const userId = browser.connection.session.userId ?? "";
    const context: RuntimeContext = { userId, roles: [], channel: "ui" };
    browser.setContext(context);

    const result = await browser.runtime.executeCommand(
      "CreateBand",
      { Name: "Offline Band" },
      { ...context, online: false },
    );
    const bandId = result.steps[0]?.record.meta.guid ?? "";
    const membershipId = result.steps[1]?.record.meta.guid ?? "";
    expect(bandId).not.toBe("");
    expect(membershipId).not.toBe("");

    // One entry for the whole command, covering both records, and both records
    // are queued and unanswered.
    const [entry] = browser.runtime.syncQueue.getReplayable();
    expect(entry?.operation.command?.records).toEqual([
      { objectName: "Band", recordId: bandId },
      { objectName: "BandMember", recordId: membershipId },
    ]);
    expect(await localSyncStatus(browser.runtime, "Band", bandId)).toBe("pending");
    expect(await localSyncStatus(browser.runtime, "BandMember", membershipId)).toBe("pending");

    // Somebody else takes the band id first. The authority will refuse the whole
    // command; the membership id stays free, so no authority copy of it exists.
    await serverRuntime().create(
      "Band",
      { Name: "Squatter", CreatedBy: "someone-else" },
      systemContext,
      { recordId: bandId },
    );

    await browser.connection.synchronize(context);

    // One change, refused once, presented as one thing.
    expect(browser.connection.recovery).toHaveLength(1);
    expect(browser.connection.recovery[0]).toMatchObject({
      commandName: "CreateBand",
      operation: "command",
      recordCount: 2,
      status: "rejected",
      code: "ADL_RUNTIME_RECORD_ID_TAKEN",
      choices: ["keepServer"],
    });

    // The whole point: both records the command wrote say so.
    expect(await localSyncStatus(browser.runtime, "Band", bandId)).toBe("rejected");
    expect(await localSyncStatus(browser.runtime, "BandMember", membershipId)).toBe("rejected");
    expect(await browser.runtime.listRefusedRecords()).toEqual([
      { objectName: "Band", recordId: bandId, discardable: true },
      { objectName: "BandMember", recordId: membershipId, discardable: true },
    ]);
    expect(await browser.runtime.summariseRecordSyncState()).toMatchObject({
      rejected: 2,
      pending: 0,
    });

    // Nothing the command would have written landed: the membership was never
    // created, and the squatter's band is untouched.
    expect(await authorityRecord("BandMember", membershipId)).toBeNull();
    expect((await authorityRecord("Band", bandId))?.values).toMatchObject({ Name: "Squatter" });

    // Dismissing the verdict takes the queue entry and leaves both records
    // still saying they were refused.
    await browser.connection.resolveRecovery(
      browser.connection.recovery[0]?.queueId ?? "",
      "keepServer",
    );
    expect(browser.runtime.syncQueue.getEntries()).toEqual([]);
    expect(await localSyncStatus(browser.runtime, "Band", bandId)).toBe("rejected");
    expect(await localSyncStatus(browser.runtime, "BandMember", membershipId)).toBe("rejected");
  });

  /**
   * Acceptance: a real revision mismatch reports `conflict`, and a `resubmitMine`
   * the authority accepts leaves the record `synced` with no residue.
   *
   * The revision both sides disagree about is one the authority minted; nothing
   * here is stubbed.
   */
  it("reports a real conflict on the record and clears it when the authority accepts the resubmission", async () => {
    const { browser, bandId, context } = await signedInFounder();
    const server = serverRuntime();
    const inBand = { ...systemContext, selectedContexts: { Band: bandId } };
    const event = await server.create(
      "Event",
      { Band: bandId, EventType: "Gig", Date: "2026-08-04", Title: "Original" },
      inBand,
    );
    const eventId = event.meta.guid;
    await browser.connection.bootstrap(context);
    expect(await localSyncStatus(browser.runtime, "Event", eventId)).toBe("synced");

    // Both sides edit the revision the device pulled down: a genuine conflict.
    await browser.runtime.update("Event", eventId, { Title: "Local title" }, context);
    await server.update("Event", eventId, { Title: "Server title" }, inBand);
    await browser.connection.reconcile(context);

    expect(browser.connection.client.listRecovery()[0]).toMatchObject({
      status: "manualResolution",
      requiresUserChoice: true,
    });
    expect(await localSyncStatus(browser.runtime, "Event", eventId)).toBe("conflict");

    // A bootstrap first, so the resubmission rebases on the authority's revision
    // rather than the one it already refused.
    await browser.connection.synchronize(context);
    expect(await localSyncStatus(browser.runtime, "Event", eventId)).toBe("conflict");

    const queueId = browser.connection.recovery[0]?.queueId ?? "";
    await browser.connection.resolveRecovery(queueId, "resubmitMine");

    // Accepted afresh: no verdict, no queue entry, and no residue on the record.
    expect(browser.connection.recovery).toEqual([]);
    expect(browser.runtime.syncQueue.getEntries()).toEqual([]);
    const settled = await localRecord(browser.runtime, "Event", eventId);
    expect(settled?.meta.syncStatus).toBe("synced");
    expect(settled?.meta.syncRejectedCreate).toBeUndefined();
    expect(settled?.values).toMatchObject({ Title: "Local title" });
    expect((await authorityRecord("Event", eventId))?.values).toMatchObject({
      Title: "Local title",
    });
    expect(await browser.runtime.summariseRecordSyncState()).toMatchObject({
      conflict: 0,
      rejected: 0,
      pending: 0,
    });
  });

  /**
   * The other resolution of the same real conflict. `keepServer` abandons the
   * local operation, so the record the device ends up holding is the
   * authority's — and a record holding the authority's accepted state with
   * nothing outstanding against it is `synced`, not a conflict badge nobody can
   * act on.
   */
  it("clears a conflict when the user keeps the authority's version", async () => {
    const { browser, bandId, context } = await signedInFounder();
    const server = serverRuntime();
    const inBand = { ...systemContext, selectedContexts: { Band: bandId } };
    const event = await server.create(
      "Event",
      { Band: bandId, EventType: "Gig", Date: "2026-08-08", Title: "Original" },
      inBand,
    );
    const eventId = event.meta.guid;
    await browser.connection.bootstrap(context);

    await browser.runtime.update("Event", eventId, { Title: "Local title" }, context);
    await server.update("Event", eventId, { Title: "Server title" }, inBand);
    await browser.connection.synchronize(context);

    const queueId = browser.connection.recovery[0]?.queueId ?? "";
    expect(queueId).not.toBe("");
    expect(await localSyncStatus(browser.runtime, "Event", eventId)).toBe("conflict");

    await browser.connection.resolveRecovery(queueId, "keepServer");

    expect(browser.connection.recovery).toEqual([]);
    const settled = await localRecord(browser.runtime, "Event", eventId);
    expect(settled?.values).toMatchObject({ Title: "Server title" });
    expect(settled?.meta.syncStatus).toBe("synced");
    expect(await browser.runtime.summariseRecordSyncState()).toMatchObject({ conflict: 0 });
  });

  /**
   * Acceptance: nothing about a record's sync state crosses the wire in either
   * direction. This is asserted on the bodies the real client actually sent and
   * on a real bootstrap of records whose stored state says something else.
   */
  it("never sends a record's sync state and never adopts the authority's", async () => {
    const { browser, bandId, context } = await signedInFounder();
    await browser.connection.bootstrap(context);

    // Every intent kind, including a command, over one device.
    const event = await browser.runtime.create(
      "Event",
      { Band: bandId, EventType: "Gig", Date: "2026-08-05", Title: "Wire check" },
      context,
    );
    await browser.runtime.update("Event", event.meta.guid, { Title: "Wire check 2" }, context);
    const doomed = await browser.runtime.create(
      "Event",
      { Band: bandId, EventType: "Gig", Date: "2026-08-06", Title: "To delete" },
      context,
    );
    await browser.runtime.delete("Event", doomed.meta.guid, context);
    // A command that founds its own context runs outside the selected one.
    await browser.runtime.executeCommand(
      "CreateBand",
      { Name: "Wire Band" },
      { userId: context.userId, roles: [], channel: "ui" },
    );
    // A record with no delivery path at all stays `local`: it is not waiting for
    // an answer, and it must not be reported as though it were — nor sent by the
    // sync that follows.
    const preference = await browser.runtime.create(
      "DevicePreference",
      { User: context.userId, LastOpenedView: "HomeDashboard" },
      context,
    );
    await browser.connection.synchronize(context);
    expect(await localSyncStatus(browser.runtime, "DevicePreference", preference.meta.guid)).toBe(
      "local",
    );

    const replays = browser.wire.filter((request) => request.path === "/v1/sync/replay");
    expect(replays.length).toBeGreaterThanOrEqual(4);
    expect(replays.map((request) => (request.body as { kind: string }).kind).sort()).toEqual([
      "command",
      "create",
      "create",
      "delete",
      "update",
    ]);
    for (const request of replays) {
      const body = JSON.stringify(request.body);
      expect(body).not.toContain("syncStatus");
      expect(body).not.toContain("syncRejectedCreate");
      expect(body).not.toContain("_syncStatus");
    }

    // The other direction. The authority's stored record is made to carry a sync
    // state and a discard licence; a device that adopted either would report a
    // refused, discardable record that was never refused at all.
    const hostileId = "event-hostile-state";
    await serverRuntime().create(
      "Event",
      { Band: bandId, EventType: "Gig", Date: "2026-08-07", Title: "From the authority" },
      { ...systemContext, selectedContexts: { Band: bandId } },
      { recordId: hostileId },
    );
    await pool.query(
      `update adl_authority_records
         set record = jsonb_set(jsonb_set(record, '{meta,syncStatus}', '"rejected"'), '{meta,syncRejectedCreate}', 'true')
       where application_id=$1 and object_name='Event' and record_id=$2`,
      [applicationId, hostileId],
    );
    expect((await authorityRecord("Event", hostileId))?.meta.syncStatus).toBe("rejected");

    const fresh = await device();
    await fresh.connection.signIn(founderProof);
    fresh.setContext(context);
    await fresh.connection.bootstrap(context);

    const adopted = await localRecord(fresh.runtime, "Event", hostileId);
    expect(adopted?.values).toMatchObject({ Title: "From the authority" });
    expect(adopted?.meta.syncStatus).toBe("synced");
    expect(adopted?.meta.syncRejectedCreate).toBeUndefined();
    expect(await fresh.runtime.listRefusedRecords()).toEqual([]);
  });

  /**
   * Acceptance: discarding a refused record removes it locally and settles
   * nothing with the authority. It is a local action, so it must send nothing at
   * all — and the authority's rows must be exactly as they were.
   */
  it("discards a refused create locally and sends nothing to the authority", async () => {
    const browser = await device();
    await browser.connection.signIn(founderProof);
    const userId = browser.connection.session.userId ?? "";
    const context: RuntimeContext = { userId, roles: [], channel: "ui" };
    browser.setContext(context);

    const result = await browser.runtime.executeCommand(
      "CreateBand",
      { Name: "Discardable Band" },
      { ...context, online: false },
    );
    const bandId = result.steps[0]?.record.meta.guid ?? "";
    const membershipId = result.steps[1]?.record.meta.guid ?? "";
    await serverRuntime().create(
      "Band",
      { Name: "Squatter", CreatedBy: "someone-else" },
      systemContext,
      { recordId: bandId },
    );
    await browser.connection.synchronize(context);
    await browser.connection.resolveRecovery(
      browser.connection.recovery[0]?.queueId ?? "",
      "keepServer",
    );

    const rowsBefore = await authorityRecordCount();
    const wireBefore = browser.wire.length;

    await browser.runtime.discardRefusedRecord("BandMember", membershipId, context);
    await browser.runtime.discardRefusedRecord("Band", bandId, context);

    // Gone locally, and gone from the refused list with it.
    expect(
      await browser.runtime.objectStore.getRecordForRuntime("BandMember", membershipId),
    ).toBeNull();
    expect(await browser.runtime.objectStore.getRecordForRuntime("Band", bandId)).toBeNull();
    const tombstone = await localRecord(browser.runtime, "BandMember", membershipId);
    expect(tombstone?.meta.deletedAt).toBeTruthy();
    expect(tombstone?.meta.syncStatus).toBe("local");
    expect(tombstone?.meta.syncRejectedCreate).toBeUndefined();
    expect(await browser.runtime.listRefusedRecords()).toEqual([]);
    expect(await browser.runtime.summariseRecordSyncState()).toMatchObject({
      rejected: 0,
      pending: 0,
    });

    // Nothing was sent and nothing was queued: a discard is not a sync
    // resolution, and the authority's rows are exactly as they were.
    expect(browser.wire.slice(wireBefore)).toEqual([]);
    expect(browser.runtime.syncQueue.getEntries()).toEqual([]);
    expect(await authorityRecordCount()).toBe(rowsBefore);
    expect((await authorityRecord("Band", bandId))?.values).toMatchObject({ Name: "Squatter" });

    // And it survives a reload as a removal, not as a refused record that came
    // back.
    const reloaded = new ApplicationRuntime(model, { storage: browser.storage });
    expect(await reloaded.listRefusedRecords()).toEqual([]);
    expect(await localSyncStatus(reloaded, "Band", bandId)).not.toBe("rejected");
  });
});
