import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Pool } from "pg";
import {
  ApplicationRuntime,
  AuthorityService,
  InMemoryAuthorityCredentialStore,
  InMemoryObjectStorageBackend,
  OpaqueSessionAdapter,
  PostgresAuthorityIdentitySessionStore,
  PostgresAuthorityUnitOfWork,
  PostgresContextMembershipIndex,
  PostgresObjectStorageBackend,
  StaticSessionAdapter,
  selectUpstreamIdentityVerifier,
} from "../../src/index.js";
import type {
  AuthorityBatchWrite,
  AuthorityConfiguration,
  AuthorityOperationIntent,
  AuthorityOutcome,
  PlannedObjectWrite,
  PostgresPool,
  PostgresQueryable,
  RuntimeContext,
  StoredObjectRecord,
  SyncStatus,
} from "../../src/index.js";
import { createGiggleBandExampleModel } from "../../src/reference/band-app.js";
// The Node deployment adapter pulls in `node:http` and is deliberately kept out
// of the browser-safe barrel, so it is imported directly.
import { createAuthorityNodeServer } from "../../src/server/authority-node.js";
import { connectBrowserAuthority } from "../../src/ui/authority-sync.js";
import { authorityPool, faultyPool, resetProjections, seedApplication } from "./pg-harness.js";

/**
 * Phase 59's staged batch against a real authority over real PostgreSQL.
 *
 * A staged batch of child edits commits as one local transaction and crosses the
 * wire as one `batch` intent. The claim that matters is the one a hermetic suite
 * cannot make: **a refused batch lands nothing**. Per-record replay — the shape
 * this kind replaces — would have committed every write before the refused one,
 * so the proof has to be rows read back out of `adl_authority_records` after a
 * genuine server-side refusal, not the outcome object the service returned.
 *
 * Everything here is therefore asserted from PostgreSQL and from the device's
 * own storage. The outcome is the server describing its own work; the rows are
 * the work, and the two have diverged before (Phase 44's NUL-byte audit id,
 * Phase 47's automatic discard) with both hermetic suites satisfied.
 */

const directApp = "edit-surface-batch";
const deviceApp = "edit-surface-batch-device";
const founderToken = "b".repeat(48);
const founderId = "user-batch-founder";
const founderProof = "founder@edit-surface-batch.test";
const csrf = "csrf-value".padEnd(48, "b");

const model = createGiggleBandExampleModel();

/** Seeding actor: `SystemAdmin` has an `ALLOW *` rule on every object. */
const systemContext: RuntimeContext = {
  userId: "seed-system",
  roles: ["SystemAdmin"],
  channel: "api",
};

let pool: Pool;

beforeAll(() => {
  pool = new Pool({ connectionString: inject("pgUrl"), max: 8 });
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await resetProjections(pool);
});

/** A runtime speaking straight to the authority's storage, as another actor would. */
function serverRuntime(applicationId: string): ApplicationRuntime {
  return new ApplicationRuntime(model, {
    storage: new PostgresObjectStorageBackend(authorityPool(pool), applicationId, model),
  });
}

/** The stored record PostgreSQL holds under an id, or null when there is none. */
async function storedRecord(
  applicationId: string,
  objectName: string,
  recordId: string,
): Promise<StoredObjectRecord | null> {
  const result = await pool.query<{ record: StoredObjectRecord }>(
    "select record from adl_authority_records where application_id=$1 and object_name=$2 and record_id=$3",
    [applicationId, objectName, recordId],
  );
  return result.rows[0]?.record ?? null;
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const result = await pool.query<{ n: number }>(sql, params);
  return Number(result.rows[0]?.n ?? 0);
}

/**
 * Every projection a replay writes, counted in one shot.
 *
 * A rollback assertion that counted only accepted records would pass while the
 * runtime audit for a refused batch stayed committed — a record of writes that
 * never happened, and exactly the half-committed state Phase 44's commit
 * boundary exists to prevent.
 */
interface ProjectionCounts {
  records: number;
  audit: number;
  outcomes: number;
  memberships: number;
}

async function projectionCounts(applicationId: string): Promise<ProjectionCounts> {
  return {
    records: await count(
      "select count(*)::int n from adl_authority_records where application_id=$1",
      [applicationId],
    ),
    audit: await count(
      "select count(*)::int n from adl_authority_audit_events where application_id=$1",
      [applicationId],
    ),
    outcomes: await count(
      "select count(*)::int n from adl_authority_operation_outcomes where application_id=$1",
      [applicationId],
    ),
    memberships: await count(
      "select count(*)::int n from adl_authority_context_memberships where application_id=$1",
      [applicationId],
    ),
  };
}

/**
 * The band, membership, set list and songs a staged child edit needs, seeded
 * server-side so every record exists as accepted authority state before any
 * batch is submitted.
 *
 * The membership matters twice over: `SetListItem` writes require `BandAdmin`,
 * and the authority derives that role from the real membership projection rather
 * than from anything the caller asserts.
 */
interface SeededBand {
  bandId: string;
  setListId: string;
  songOneId: string;
  songTwoId: string;
}

async function seedBand(applicationId: string, userId: string): Promise<SeededBand> {
  const runtime = serverRuntime(applicationId);
  const bandId = `band-${applicationId}`;
  await runtime.create("Band", { Name: "Batch Band", CreatedBy: userId }, systemContext, {
    recordId: bandId,
  });
  const inBand: RuntimeContext = { ...systemContext, selectedContexts: { Band: bandId } };
  await runtime.create(
    "BandMember",
    { User: userId, Band: bandId, Role: "BandAdmin", JoinedAt: "2026-07-01" },
    inBand,
    { recordId: `member-${applicationId}` },
  );
  const setListId = `setlist-${applicationId}`;
  await runtime.create(
    "SetList",
    { Band: bandId, Name: "Main Set", Description: "Seeded" },
    inBand,
    { recordId: setListId },
  );
  const songOneId = `song-one-${applicationId}`;
  const songTwoId = `song-two-${applicationId}`;
  await runtime.create("Song", { Band: bandId, Title: "Neon Map" }, inBand, {
    recordId: songOneId,
  });
  await runtime.create("Song", { Band: bandId, Title: "Slow Harbour" }, inBand, {
    recordId: songTwoId,
  });
  return { bandId, setListId, songOneId, songTwoId };
}

/** The revision the authority currently holds, which an update must be planned against. */
async function authorityRevision(
  applicationId: string,
  objectName: string,
  recordId: string,
): Promise<string> {
  const record = await storedRecord(applicationId, objectName, recordId);
  if (record === null) throw new Error(`No authority record for ${objectName}/${recordId}.`);
  return record.meta.revision;
}

function requireAccepted(outcome: AuthorityOutcome): AuthorityOutcome {
  if (outcome.status !== "accepted") {
    throw new Error(`Expected an accepted outcome, got ${JSON.stringify(outcome)}`);
  }
  return outcome;
}

describe("a staged batch replayed to a real authority over real PostgreSQL", () => {
  beforeEach(() => seedApplication(pool, directApp, model.modelVersion));

  /**
   * Wired the way the authority is: every accepted write goes through the
   * PostgreSQL unit-of-work, and context roles are resolved from the real
   * membership projection rather than from a set held in memory.
   */
  function service(database: (PostgresPool & PostgresQueryable) | undefined = undefined) {
    const queryable = database ?? authorityPool(pool);
    return new AuthorityService(
      model,
      new PostgresObjectStorageBackend(queryable, directApp, model),
      new StaticSessionAdapter(new Map([[founderToken, { userId: founderId }]])),
      {
        unitOfWork: new PostgresAuthorityUnitOfWork(queryable, directApp, model),
        membershipIndex: new PostgresContextMembershipIndex(queryable, directApp),
      },
    );
  }

  function batchIntent(
    operationId: string,
    bandId: string,
    writes: AuthorityBatchWrite[],
  ): AuthorityOperationIntent {
    return { operationId, kind: "batch", writes, selectedContexts: { Band: bandId } };
  }

  function createItem(
    seeded: SeededBand,
    recordId: string,
    songId: string,
    position: number,
  ): AuthorityBatchWrite {
    return {
      operation: "create",
      objectName: "SetListItem",
      recordId,
      values: {
        Band: seeded.bandId,
        SetList: seeded.setListId,
        Song: songId,
        Position: position,
      },
    };
  }

  /**
   * The accepted case, end to end: several child writes of different kinds land
   * together under one operation id, each under the id the device named.
   */
  it("lands every write of a staged batch as one accepted operation", async () => {
    const seeded = await seedBand(directApp, founderId);
    const before = await projectionCounts(directApp);

    const outcome = await service().replay(
      founderToken,
      batchIntent("op-batch-accepted", seeded.bandId, [
        createItem(seeded, "item-accepted-1", seeded.songOneId, 1),
        createItem(seeded, "item-accepted-2", seeded.songTwoId, 2),
        {
          operation: "update",
          objectName: "SetList",
          recordId: seeded.setListId,
          patch: { Description: "Two songs staged" },
          baseRevision: await authorityRevision(directApp, "SetList", seeded.setListId),
        },
      ]),
    );
    requireAccepted(outcome);
    // One outcome carrying every record the transaction wrote, in planned order.
    expect(
      outcome.status === "accepted" ? outcome.records.map((record) => record.meta.guid) : [],
    ).toEqual(["item-accepted-1", "item-accepted-2", seeded.setListId]);

    const items = await pool.query<{ record_id: string; song: string; position: string }>(
      "select record_id, record->'values'->>'Song' as song, record->'values'->>'Position' as position from adl_authority_records where application_id=$1 and object_name='SetListItem' order by record_id",
      [directApp],
    );
    // `toEqual` on the whole set is the "and nothing else" assertion as well.
    expect(items.rows).toEqual([
      { record_id: "item-accepted-1", song: seeded.songOneId, position: "1" },
      { record_id: "item-accepted-2", song: seeded.songTwoId, position: "2" },
    ]);
    expect((await storedRecord(directApp, "SetList", seeded.setListId))?.values).toMatchObject({
      Description: "Two songs staged",
    });

    const after = await projectionCounts(directApp);
    expect(after.records).toBe(before.records + 2);
    // One operation, so exactly one durable verdict for all three writes.
    expect(after.outcomes).toBe(before.outcomes + 1);
    expect(after.audit).toBe(before.audit + 3);
  });

  /**
   * The case the kind exists for.
   *
   * The last write duplicates a `Song` title the authority already holds, which
   * `uniqueSongTitleInBand` refuses at commit — a refusal the device could not
   * have anticipated, because it never held the colliding row. Replayed as three
   * per-record intents the first two would have been accepted and committed;
   * replayed as one batch, none of them exists afterwards.
   */
  it("lands nothing at all when one write of the batch is refused server-side", async () => {
    const seeded = await seedBand(directApp, founderId);
    await serverRuntime(directApp).create(
      "Song",
      { Band: seeded.bandId, Title: "Encore" },
      { ...systemContext, selectedContexts: { Band: seeded.bandId } },
      { recordId: "song-existing-encore" },
    );
    const before = await projectionCounts(directApp);

    const refused = batchIntent("op-batch-refused", seeded.bandId, [
      createItem(seeded, "item-refused-1", seeded.songOneId, 1),
      {
        operation: "create",
        objectName: "Song",
        recordId: "song-refused-new",
        values: { Band: seeded.bandId, Title: "Chorus" },
      },
      {
        operation: "create",
        objectName: "Song",
        recordId: "song-refused-clash",
        values: { Band: seeded.bandId, Title: "Encore" },
      },
    ]);
    const outcome = await service().replay(founderToken, refused);

    expect(outcome).toMatchObject({
      status: "rejected",
      operationId: "op-batch-refused",
      code: "ADL_RUNTIME_VALIDATION_FAILED",
    });

    // The whole point: not one row of the batch exists, including the two writes
    // that were perfectly acceptable on their own.
    expect(await storedRecord(directApp, "SetListItem", "item-refused-1")).toBeNull();
    expect(await storedRecord(directApp, "Song", "song-refused-new")).toBeNull();
    expect(await storedRecord(directApp, "Song", "song-refused-clash")).toBeNull();

    const after = await projectionCounts(directApp);
    expect(after.records).toBe(before.records);
    // Nor may the runtime audit have committed: an audit event for a rolled-back
    // write is a record of something that never happened.
    expect(after.audit).toBe(before.audit);
    expect(after.memberships).toBe(before.memberships);
    // The refusal itself is durable, so the retry is served from it rather than
    // re-running the batch.
    expect(after.outcomes).toBe(before.outcomes + 1);
    expect(await service().replay(founderToken, refused)).toEqual(outcome);
    expect(await projectionCounts(directApp)).toEqual(after);

    // The row whose title the batch collided with is untouched by the attempt.
    expect((await storedRecord(directApp, "Song", "song-existing-encore"))?.values).toMatchObject({
      Title: "Encore",
    });

    // The control that makes the claim above mean something: the two writes that
    // did not land are accepted the moment they are submitted without the third.
    // They were refused because the batch was, not because of anything about
    // them — which is exactly what a per-record replay would have got wrong.
    requireAccepted(
      await service().replay(
        founderToken,
        batchIntent("op-batch-refused-control", seeded.bandId, [
          createItem(seeded, "item-refused-1", seeded.songOneId, 1),
          {
            operation: "create",
            objectName: "Song",
            recordId: "song-refused-new",
            values: { Band: seeded.bandId, Title: "Chorus" },
          },
        ]),
      ),
    );
    expect(await storedRecord(directApp, "SetListItem", "item-refused-1")).not.toBeNull();
    expect(await storedRecord(directApp, "Song", "song-refused-new")).not.toBeNull();
  });

  /**
   * Idempotency for the whole transaction under one operation id. A resubmission
   * that re-ran the batch would refuse itself — every id it names is now taken —
   * so the stored outcome has to be what comes back.
   */
  it("returns the stored outcome when the same batch operation id is submitted again", async () => {
    const seeded = await seedBand(directApp, founderId);
    const authority = service();
    const intent = batchIntent("op-batch-retry", seeded.bandId, [
      createItem(seeded, "item-retry-1", seeded.songOneId, 1),
      createItem(seeded, "item-retry-2", seeded.songTwoId, 2),
    ]);

    const first = requireAccepted(await authority.replay(founderToken, intent));
    const afterFirst = await projectionCounts(directApp);

    expect(await authority.replay(founderToken, intent)).toEqual(first);
    expect(await projectionCounts(directApp)).toEqual(afterFirst);
    // Explicitly, not only by total count: no second set of rows was written
    // under authority-minted ids beside the ones the device named.
    expect(
      await count(
        "select count(*)::int n from adl_authority_records where application_id=$1 and object_name='SetListItem'",
        [directApp],
      ),
    ).toBe(2);
  });

  /**
   * An update inside a batch carries the revision it was planned against,
   * exactly as a single update intent does. A stale one is a conflict the user
   * or the declared strategy resolves — never an unconditional overwrite — and
   * the rest of the batch goes down with it.
   *
   * `SetList` declares no conflict strategy, so it takes the resolved default,
   * `manual`: the verdict is `manualResolution` and a person decides. That is
   * asserted as the observed contract rather than assumed to be `serverWins` —
   * what matters here is that the authority answered with a conflict verdict
   * over its own revision and applied nothing.
   */
  it("settles a stale base revision as a conflict and lands nothing else in the batch", async () => {
    const seeded = await seedBand(directApp, founderId);
    const stale = await authorityRevision(directApp, "SetList", seeded.setListId);
    await serverRuntime(directApp).update(
      "SetList",
      seeded.setListId,
      { Description: "Changed on the authority" },
      { ...systemContext, selectedContexts: { Band: seeded.bandId } },
    );
    const current = await authorityRevision(directApp, "SetList", seeded.setListId);
    expect(current).not.toBe(stale);
    const before = await projectionCounts(directApp);

    const outcome = await service().replay(
      founderToken,
      batchIntent("op-batch-stale", seeded.bandId, [
        createItem(seeded, "item-stale-1", seeded.songOneId, 1),
        {
          operation: "update",
          objectName: "SetList",
          recordId: seeded.setListId,
          patch: { Description: "Staged while offline" },
          baseRevision: stale,
        },
      ]),
    );

    expect(outcome).toMatchObject({
      status: "manualResolution",
      operationId: "op-batch-stale",
      code: "ADL_SYNC_MANUAL_RESOLUTION",
      recovery: "manual",
    });

    // Not a silent overwrite: the authority's value and revision both stand.
    const setList = await storedRecord(directApp, "SetList", seeded.setListId);
    expect(setList?.values).toMatchObject({ Description: "Changed on the authority" });
    expect(setList?.meta.revision).toBe(current);
    // And the write that was beside it, which had nothing wrong with it, did not
    // land either.
    expect(await storedRecord(directApp, "SetListItem", "item-stale-1")).toBeNull();

    const after = await projectionCounts(directApp);
    expect(after.records).toBe(before.records);
    expect(after.audit).toBe(before.audit);
  });

  /**
   * An infrastructure failure part-way through the commit is not a verdict.
   *
   * The fault is injected on the *second* record insert, so the transaction has
   * already written a row when it fails: only a real rollback can leave nothing
   * behind. And no durable outcome may be recorded, because a cached rejection
   * for a fault nobody decided would make the batch unreplayable for ever —
   * `classifyFailure` returns null for a non-`RuntimeError` precisely so this
   * stays retryable, which the retry below proves rather than assumes.
   */
  it("rolls the whole batch back and stays retryable when the commit fails mid-write", async () => {
    const seeded = await seedBand(directApp, founderId);
    const before = await projectionCounts(directApp);

    let inserts = 0;
    const faulty = faultyPool(pool, (sql) => {
      if (!sql.startsWith("insert into adl_authority_records")) return false;
      inserts += 1;
      return inserts === 2;
    });

    const intent = batchIntent("op-batch-fault", seeded.bandId, [
      createItem(seeded, "item-fault-1", seeded.songOneId, 1),
      createItem(seeded, "item-fault-2", seeded.songTwoId, 2),
    ]);
    await expect(service(faulty).replay(founderToken, intent)).rejects.toThrow(
      "injected infrastructure failure",
    );

    // The fault really did land mid-transaction: the first record insert had
    // already executed when the second threw. Without this the test would pass
    // just as well against a batch that never wrote anything at all.
    expect(inserts).toBe(2);

    const afterFault = await projectionCounts(directApp);
    expect(afterFault.records).toBe(before.records);
    expect(afterFault.audit).toBe(before.audit);
    // The failure was not classified as a verdict, so nothing durable was
    // recorded against the operation id.
    expect(afterFault.outcomes).toBe(before.outcomes);
    expect(await storedRecord(directApp, "SetListItem", "item-fault-1")).toBeNull();

    // Retryable, under the same operation id and the same ids: the rollback left
    // no half-taken names behind.
    requireAccepted(await service().replay(founderToken, intent));
    expect(await storedRecord(directApp, "SetListItem", "item-fault-1")).not.toBeNull();
    expect(await storedRecord(directApp, "SetListItem", "item-fault-2")).not.toBeNull();
  });

  /**
   * A batch that claims to have written nothing is refused in the service, not
   * only at the edge — the edge rejects an empty `writes` array as a malformed
   * request, but `AuthorityService` is constructed directly by tests and tooling,
   * so an edge-only check would be no check at all on that path. Accepting it
   * would record an accepted verdict covering no records, which the originating
   * device would then apply to the records it believes the batch wrote.
   */
  it("refuses a batch carrying no writes, in the service rather than only at the edge", async () => {
    const seeded = await seedBand(directApp, founderId);
    const before = await projectionCounts(directApp);
    const authority = service();

    expect(
      await authority.replay(founderToken, batchIntent("op-batch-empty", seeded.bandId, [])),
    ).toMatchObject({
      status: "rejected",
      operationId: "op-batch-empty",
      code: "ADL_RUNTIME_BATCH_WRITES_MISSING",
    });

    // The same refusal when the field is absent altogether. The cast is the
    // point: this shape cannot be built through the typed client, and the
    // service must still refuse it rather than read `undefined` as "no writes,
    // nothing to do, accepted".
    expect(
      await authority.replay(founderToken, {
        operationId: "op-batch-no-writes",
        kind: "batch",
        selectedContexts: { Band: seeded.bandId },
      } as unknown as AuthorityOperationIntent),
    ).toMatchObject({
      status: "rejected",
      operationId: "op-batch-no-writes",
      code: "ADL_RUNTIME_BATCH_WRITES_MISSING",
    });

    const after = await projectionCounts(directApp);
    expect(after.records).toBe(before.records);
    expect(after.audit).toBe(before.audit);
  });
});

/**
 * The same claims from the device's side of the wire: a real browser-shaped
 * client, a real socket, the real HTTP edge, and the real authority behind it.
 *
 * This half is what proves the batch is *one* operation rather than several —
 * the assertion is on the request bodies the client actually sent — and that
 * Phase 58 record sync state is applied across every record the batch wrote.
 */
describe("a staged batch from a real device over the real HTTP edge", () => {
  let server: Server;
  let baseUrl: string;

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

  beforeAll(async () => {
    const queryable = authorityPool(pool);
    const sessions = new OpaqueSessionAdapter(
      new PostgresAuthorityIdentitySessionStore(queryable, deviceApp),
    );
    const config = configuration();
    server = createAuthorityNodeServer({
      configuration: config,
      sessions,
      authority: new AuthorityService(
        model,
        new PostgresObjectStorageBackend(queryable, deviceApp, model),
        sessions,
        {
          unitOfWork: new PostgresAuthorityUnitOfWork(queryable, deviceApp, model),
          membershipIndex: new PostgresContextMembershipIndex(queryable, deviceApp),
        },
      ),
      identityVerifier: selectUpstreamIdentityVerifier(config),
      logger: { write: () => undefined },
      newCsrfToken: () => csrf,
      clientKey: () => "edit-surface-batch-client",
    });
    baseUrl = await new Promise((done) => {
      server.listen(0, "127.0.0.1", () => {
        done(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((done) => server.close(() => done()));
  });

  beforeEach(() => seedApplication(pool, deviceApp, model.modelVersion));

  /** One request this device actually made, body and all. */
  interface WireRequest {
    path: string;
    body: unknown;
  }

  /**
   * A browser-shaped device: real socket, real cookie jar, and every request
   * body kept so the wire itself can be asserted on rather than the intent the
   * client says it built.
   */
  async function device() {
    const wire: WireRequest[] = [];
    const runtime = new ApplicationRuntime(model, { storage: new InMemoryObjectStorageBackend() });
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
      wire,
      setContext: (next: RuntimeContext) => {
        current = next;
      },
      replays: () => wire.filter((request) => request.path === "/v1/sync/replay"),
    };
  }

  async function localSyncStatus(
    runtime: ApplicationRuntime,
    objectName: string,
    recordId: string,
  ): Promise<SyncStatus | "absent"> {
    const record = await runtime.objectStore.getRecordForSync(objectName, recordId);
    return record?.meta.syncStatus ?? "absent";
  }

  /**
   * The commit an edit surface's staged child changes make.
   *
   * `EditSurfaceRuntime.applyStagedChanges` plans every staged operation and
   * hands the whole list to `ObjectStore.commitPlannedTransaction` under a batch
   * label — `ApplicationRuntime` wires the edit surface's `commitBatch` to
   * exactly this call. Driving it here keeps this file's subject the authority's
   * behaviour rather than one model's edit-section declaration, while still
   * producing the real queue entry the real client sends.
   */
  async function commitStagedBatch(
    runtime: ApplicationRuntime,
    writes: PlannedObjectWrite[],
    context: RuntimeContext,
    label: string,
  ): Promise<StoredObjectRecord[]> {
    return runtime.objectStore.commitPlannedTransaction(writes, context, { batch: { label } });
  }

  /** A signed-in device that administers a seeded band and holds its records. */
  async function signedInFounder(): Promise<{
    browser: Awaited<ReturnType<typeof device>>;
    seeded: SeededBand;
    context: RuntimeContext;
  }> {
    const browser = await device();
    await browser.connection.signIn(founderProof);
    const userId = browser.connection.session.userId ?? "";
    const seeded = await seedBand(deviceApp, userId);
    const context: RuntimeContext = {
      userId,
      roles: ["BandAdmin"],
      channel: "ui",
      selectedContexts: { Band: seeded.bandId },
    };
    browser.setContext(context);
    await browser.connection.bootstrap(context);
    return { browser, seeded, context };
  }

  /**
   * Acceptance: a staged batch reaches the authority as **one** operation, every
   * record it wrote is in PostgreSQL under the id the device minted, and every
   * one of them reports `synced` afterwards.
   */
  it("replays a staged batch as one operation and leaves every record it wrote synced", async () => {
    const { browser, seeded, context } = await signedInFounder();
    const offline: RuntimeContext = { ...context, online: false };
    const store = browser.runtime.objectStore;

    const staged: PlannedObjectWrite[] = [
      await store.planCreateForTransaction(
        "SetListItem",
        {
          Band: seeded.bandId,
          SetList: seeded.setListId,
          Song: seeded.songOneId,
          Position: 1,
        },
        offline,
      ),
      await store.planCreateForTransaction(
        "SetListItem",
        {
          Band: seeded.bandId,
          SetList: seeded.setListId,
          Song: seeded.songTwoId,
          Position: 2,
        },
        offline,
      ),
      await store.planUpdateForTransaction(
        "SetList",
        seeded.setListId,
        { Description: "Two songs staged" },
        offline,
      ),
    ];
    const committed = await commitStagedBatch(
      browser.runtime,
      staged,
      offline,
      "SetListForm child changes",
    );
    const firstId = committed[0]?.meta.guid ?? "";
    const secondId = committed[1]?.meta.guid ?? "";
    expect(firstId).not.toBe("");
    expect(secondId).not.toBe("");

    // One queue entry for the whole staged batch, carrying its writes rather
    // than one entry per child change.
    const replayable = browser.runtime.syncQueue.getReplayable();
    expect(replayable).toHaveLength(1);
    expect(replayable[0]?.operation.operation).toBe("batch");
    expect(replayable[0]?.operation.batch?.label).toBe("SetListForm child changes");
    expect(
      replayable[0]?.operation.batch?.writes.map((write) => [write.operation, write.recordId]),
    ).toEqual([
      ["create", firstId],
      ["create", secondId],
      ["update", seeded.setListId],
    ]);
    // Queued and unanswered, all three of them.
    for (const [objectName, recordId] of [
      ["SetListItem", firstId],
      ["SetListItem", secondId],
      ["SetList", seeded.setListId],
    ] as const) {
      expect(await localSyncStatus(browser.runtime, objectName, recordId)).toBe("pending");
    }
    expect(await storedRecord(deviceApp, "SetListItem", firstId)).toBeNull();

    await browser.connection.synchronize(context);

    // One request, one intent, three writes: the assertion that this is a single
    // operation rather than a per-record replay wearing a batch's name.
    const replays = browser.replays();
    expect(replays).toHaveLength(1);
    expect(replays[0]?.body).toMatchObject({ kind: "batch" });
    expect((replays[0]?.body as { writes: unknown[] }).writes).toHaveLength(3);

    expect(browser.connection.recovery).toEqual([]);
    expect(browser.runtime.syncQueue.getEntries()).toEqual([]);
    for (const [objectName, recordId] of [
      ["SetListItem", firstId],
      ["SetListItem", secondId],
      ["SetList", seeded.setListId],
    ] as const) {
      expect(await localSyncStatus(browser.runtime, objectName, recordId)).toBe("synced");
    }

    // The authority holds every one of them, under the device's own ids.
    expect((await storedRecord(deviceApp, "SetListItem", firstId))?.values).toMatchObject({
      Song: seeded.songOneId,
      Position: 1,
    });
    expect((await storedRecord(deviceApp, "SetListItem", secondId))?.values).toMatchObject({
      Song: seeded.songTwoId,
      Position: 2,
    });
    expect((await storedRecord(deviceApp, "SetList", seeded.setListId))?.values).toMatchObject({
      Description: "Two songs staged",
    });
    expect(await browser.runtime.summariseRecordSyncState()).toMatchObject({
      pending: 0,
      rejected: 0,
      conflict: 0,
    });
  });

  /**
   * Acceptance, and the reason the kind exists: a refused batch lands nothing,
   * and every record it wrote locally says it was refused.
   *
   * The device stages a new song and the set-list entry that uses it — one
   * transaction, as an edit surface produces. While it is offline another member
   * creates a song with that title, so `uniqueSongTitleInBand` refuses the batch
   * at the authority. The device could not have known: it never held the
   * colliding row, and its own commit was perfectly valid locally.
   */
  it("marks every record of a refused batch rejected and lands none of them", async () => {
    const { browser, seeded, context } = await signedInFounder();
    const offline: RuntimeContext = { ...context, online: false };
    const store = browser.runtime.objectStore;

    const stagedSong = await store.planCreateForTransaction(
      "Song",
      { Band: seeded.bandId, Title: "Encore" },
      offline,
    );
    const songId = stagedSong.record.meta.guid;
    const stagedItem = await store.planCreateForTransaction(
      "SetListItem",
      { Band: seeded.bandId, SetList: seeded.setListId, Song: songId, Position: 1 },
      offline,
    );
    const itemId = stagedItem.record.meta.guid;
    await commitStagedBatch(
      browser.runtime,
      [stagedSong, stagedItem],
      offline,
      "SetListForm child changes",
    );

    expect(browser.runtime.syncQueue.getReplayable()).toHaveLength(1);
    expect(await localSyncStatus(browser.runtime, "Song", songId)).toBe("pending");
    expect(await localSyncStatus(browser.runtime, "SetListItem", itemId)).toBe("pending");

    // Somebody else uses the title first, while this device is offline.
    await serverRuntime(deviceApp).create(
      "Song",
      { Band: seeded.bandId, Title: "Encore" },
      { ...systemContext, selectedContexts: { Band: seeded.bandId } },
      { recordId: "song-other-encore" },
    );
    const before = await projectionCounts(deviceApp);

    await browser.connection.synchronize(context);

    // One change, refused once, presented as one thing.
    expect(browser.connection.recovery).toHaveLength(1);
    expect(browser.connection.recovery[0]).toMatchObject({
      operation: "batch",
      commandLabel: "SetListForm child changes",
      recordCount: 2,
      status: "rejected",
      code: "ADL_RUNTIME_VALIDATION_FAILED",
      choices: ["keepServer"],
    });

    // Nothing landed — not the song the constraint refused, and not the set-list
    // entry beside it, which a per-record replay would have committed first.
    expect(await storedRecord(deviceApp, "Song", songId)).toBeNull();
    expect(await storedRecord(deviceApp, "SetListItem", itemId)).toBeNull();
    const after = await projectionCounts(deviceApp);
    expect(after.records).toBe(before.records);
    expect(after.audit).toBe(before.audit);
    expect((await storedRecord(deviceApp, "Song", "song-other-encore"))?.values).toMatchObject({
      Title: "Encore",
    });

    // Phase 58 across the whole batch: every record it wrote reports the verdict,
    // and both are discardable because the batch is what created them.
    expect(await localSyncStatus(browser.runtime, "Song", songId)).toBe("rejected");
    expect(await localSyncStatus(browser.runtime, "SetListItem", itemId)).toBe("rejected");
    // Sorted because `listRefusedRecords` walks storage rather than the batch,
    // so its order is the store's; the claim is about the whole set.
    const refused = [...(await browser.runtime.listRefusedRecords())].sort((left, right) =>
      left.objectName.localeCompare(right.objectName),
    );
    expect(refused).toEqual([
      { objectName: "SetListItem", recordId: itemId, discardable: true },
      { objectName: "Song", recordId: songId, discardable: true },
    ]);
    expect(await browser.runtime.summariseRecordSyncState()).toMatchObject({
      rejected: 2,
      pending: 0,
    });

    // Dismissing the verdict takes the queue entry — the only other place the
    // refusal was recorded — and leaves both records still saying they were
    // refused.
    await browser.connection.resolveRecovery(
      browser.connection.recovery[0]?.queueId ?? "",
      "keepServer",
    );
    expect(browser.runtime.syncQueue.getEntries()).toEqual([]);
    expect(await localSyncStatus(browser.runtime, "Song", songId)).toBe("rejected");
    expect(await localSyncStatus(browser.runtime, "SetListItem", itemId)).toBe("rejected");
  });
});
