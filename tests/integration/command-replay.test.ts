import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Pool } from "pg";
import {
  AuthorityService,
  InMemoryAuthorityIdentitySessionStore,
  OpaqueSessionAdapter,
  PostgresAuthorityUnitOfWork,
  PostgresContextMembershipIndex,
  PostgresObjectStorageBackend,
  StaticSessionAdapter,
} from "../../src/index.js";
import type {
  AuthorityCommandRecordId,
  AuthorityConfiguration,
  AuthorityOperationIntent,
  AuthorityOutcome,
  StoredObjectRecord,
} from "../../src/index.js";
import { createGiggleBandExampleModel } from "../../src/reference/band-app.js";
// Node deployment adapter is imported directly: it pulls in `node:http` and is
// intentionally kept out of the browser-safe barrel export.
import { createAuthorityNodeServer } from "../../src/server/authority-node.js";
import { authorityPool, resetProjections, seedApplication } from "./pg-harness.js";

/**
 * Phase 57 against real PostgreSQL: a model-declared command executed offline
 * replays as **one** `command` intent under one operation id, carrying the ids
 * the device already minted for every record the command creates.
 *
 * Everything here is asserted by reading rows back out of PostgreSQL rather
 * than from the outcome the service returned. The outcome is the server
 * describing its own work; the rows are the work. The two have diverged before
 * (Phase 44's NUL-byte audit id, Phase 47's automatic discard), and both times
 * the hermetic suites were satisfied.
 */

const replayApp = "command-replay-app";
const httpApp = "command-replay-http-app";
const founderToken = "f".repeat(48);
const founderId = "user-founder";
const csrf = "csrf-value".padEnd(48, "c");

const model = await createGiggleBandExampleModel();

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

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const result = await pool.query<{ n: number }>(sql, params);
  return Number(result.rows[0]?.n ?? 0);
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

/**
 * Every projection a replay writes, counted in one shot.
 *
 * A rollback assertion that counts only accepted records would pass while the
 * runtime audit for a refused command stayed committed, which is exactly the
 * half-committed state Phase 44's commit boundary exists to prevent.
 */
/**
 * Named rather than `Record<string, number>` so a caller can do arithmetic on a
 * count without the index signature making every field possibly undefined.
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

/** The manifest `CreateBand` produces locally: two creates, neither iterating. */
function createBandManifest(bandId: string, membershipId: string): AuthorityCommandRecordId[] {
  return [
    { step: "createBand", objectName: "Band", recordId: bandId },
    { step: "createFounderMembership", objectName: "BandMember", recordId: membershipId },
  ];
}

/** The manifest `ImportSongs` produces locally: one create per item of one step. */
function importSongsManifest(recordIds: string[]): AuthorityCommandRecordId[] {
  return recordIds.map((recordId, itemIndex) => ({
    step: "importSongs",
    itemIndex,
    objectName: "Song",
    recordId,
  }));
}

function requireAccepted(outcome: AuthorityOutcome): AuthorityOutcome {
  if (outcome.status !== "accepted") {
    throw new Error(`Expected an accepted outcome, got ${JSON.stringify(outcome)}`);
  }
  return outcome;
}

describe("command replay against real PostgreSQL", () => {
  beforeEach(() => seedApplication(pool, replayApp, model.modelVersion));

  /**
   * Wired the way the authority is: every accepted write goes through the
   * PostgreSQL unit-of-work, and context resolution reads the real membership
   * projection rather than scanning an in-memory set.
   */
  function service(): AuthorityService {
    const authorityQueryable = authorityPool(pool);
    return new AuthorityService(
      model,
      new PostgresObjectStorageBackend(authorityQueryable, replayApp, model),
      new StaticSessionAdapter(new Map([[founderToken, { userId: founderId }]])),
      {
        unitOfWork: new PostgresAuthorityUnitOfWork(authorityQueryable, replayApp, model),
        membershipIndex: new PostgresContextMembershipIndex(authorityQueryable, replayApp),
      },
    );
  }

  async function createBand(
    authority: AuthorityService,
    operationId: string,
    name: string,
    bandId: string,
    membershipId: string,
  ): Promise<AuthorityOutcome> {
    return authority.replay(founderToken, {
      operationId,
      kind: "command",
      commandName: "CreateBand",
      input: { Name: name },
      recordIds: createBandManifest(bandId, membershipId),
    });
  }

  /**
   * The case Phase 57 exists for.
   *
   * `CreateBand` uses `ESTABLISHES CONTEXT`, which is transaction-local. Split
   * into per-record intents (below) the authority must refuse the membership,
   * because the caller is not a member of a context whose only membership
   * record is the one being refused. Replayed as one command intent the whole
   * transaction runs server-side, so the founder ends up an actual member — and
   * that is read back out of `adl_authority_records`, not out of the response.
   */
  it("accepts a context-establishing command replayed as one intent and commits the founder's membership", async () => {
    const outcome = await createBand(
      service(),
      "op-create-band",
      "Giggle Band",
      "band-offline-1",
      "member-offline-1",
    );
    requireAccepted(outcome);

    const band = await storedRecord(replayApp, "Band", "band-offline-1");
    expect(band?.values).toMatchObject({ Name: "Giggle Band", CreatedBy: founderId });

    // The membership the split replay can never produce, committed under the id
    // the device minted so the local row converges rather than duplicating.
    const membership = await storedRecord(replayApp, "BandMember", "member-offline-1");
    expect(membership?.values).toMatchObject({
      User: founderId,
      Band: "band-offline-1",
      Role: "BandAdmin",
    });

    // Phase 54: an accepted membership record is only usable once the
    // projection carries it, and the projection is written inside the same
    // transaction. Without this row the founder holds no context at all.
    const projected = await pool.query<{
      context_name: string;
      context_id: string;
      user_id: string;
      role: string;
      revoked_at: string | null;
    }>(
      "select context_name, context_id, user_id, role, revoked_at from adl_authority_context_memberships where application_id=$1 and membership_record_id=$2",
      [replayApp, "member-offline-1"],
    );
    expect(projected.rows).toEqual([
      {
        context_name: "Band",
        context_id: "band-offline-1",
        user_id: founderId,
        role: "BandAdmin",
        revoked_at: null,
      },
    ]);

    // Exactly one operation, so exactly one outcome for the whole command.
    expect(
      await count(
        "select count(*)::int n from adl_authority_operation_outcomes where application_id=$1",
        [replayApp],
      ),
    ).toBe(1);
  });

  /**
   * The negative half of the same case, over the real stack.
   *
   * `tests/command-authority-replay.test.ts` pins this hermetically over an
   * in-memory backend. It is repeated here rather than left there alone because
   * over PostgreSQL the refusal travels a different route: context resolution
   * reads `adl_authority_context_memberships` through
   * `PostgresContextMembershipIndex`, which the in-memory test never exercises.
   * A projection that wrongly reported a membership would make the split replay
   * succeed and hide the very gap this phase closes.
   */
  it("refuses the same work submitted as separate per-record intents", async () => {
    const authority = service();

    const band = await authority.replay(founderToken, {
      operationId: "op-split-band",
      kind: "create",
      objectName: "Band",
      recordId: "band-split-1",
      values: { Name: "The Split", CreatedBy: founderId },
    });
    expect(band.status).toBe("accepted");

    const membership = await authority.replay(founderToken, {
      operationId: "op-split-membership",
      kind: "create",
      objectName: "BandMember",
      recordId: "member-split-1",
      values: {
        User: founderId,
        Band: "band-split-1",
        Role: "BandAdmin",
        JoinedAt: "2026-07-31",
      },
      selectedContexts: { Band: "band-split-1" },
    });

    expect(membership).toMatchObject({ status: "rejected", code: "ADL_RUNTIME_CONTEXT_ERROR" });
    expect(await storedRecord(replayApp, "BandMember", "member-split-1")).toBeNull();
    expect(
      await count(
        "select count(*)::int n from adl_authority_context_memberships where application_id=$1",
        [replayApp],
      ),
    ).toBe(0);
  });

  /**
   * A `FOR EACH` step turns "the id for step N" into "the id for item M of step
   * N". Every created row must land under the id the manifest names, in the
   * order the manifest names it, with nothing extra — that is what stops a
   * replayed import producing a second copy of every song.
   *
   * The ids are deliberately not in the same order as the items, so a
   * re-execution that minted its own ids, or paired them by any order other
   * than the planned one, cannot accidentally satisfy this.
   */
  it("preserves every client-minted id across an iterating step, in planned order", async () => {
    const authority = service();
    requireAccepted(
      await createBand(
        authority,
        "op-band-for-import",
        "Import Band",
        "band-import",
        "member-import",
      ),
    );

    const outcome = await authority.replay(founderToken, {
      operationId: "op-import-songs",
      kind: "command",
      commandName: "ImportSongs",
      input: {
        Band: "band-import",
        Songs: [
          { Title: "Neon Map", Composer: "Ada" },
          { Title: "Slow Harbour", Composer: "Grace" },
          { Title: "Third Rail" },
        ],
      },
      recordIds: importSongsManifest(["song-c-import", "song-a-import", "song-b-import"]),
      selectedContexts: { Band: "band-import" },
    });
    requireAccepted(outcome);

    const songs = await pool.query<{ record_id: string; title: string; band: string }>(
      "select record_id, record->'values'->>'Title' as title, record->'values'->>'Band' as band from adl_authority_records where application_id=$1 and object_name='Song' order by record_id",
      [replayApp],
    );
    // Exactly three rows, each under the id its item was named by. `toEqual`
    // on the whole set is the "no extra rows" assertion as well.
    expect(songs.rows).toEqual([
      { record_id: "song-a-import", title: "Slow Harbour", band: "band-import" },
      { record_id: "song-b-import", title: "Third Rail", band: "band-import" },
      { record_id: "song-c-import", title: "Neon Map", band: "band-import" },
    ]);
  });

  /**
   * Idempotency holds for the whole command under one operation id, including
   * every item of an iterating step, on the transactional path — where the
   * outcome insert is the concurrency gate.
   */
  it("returns the stored outcome on retry and writes nothing twice", async () => {
    const authority = service();
    const bandIntent: AuthorityOperationIntent = {
      operationId: "op-retry-band",
      kind: "command",
      commandName: "CreateBand",
      input: { Name: "Retry Band" },
      recordIds: createBandManifest("band-retry", "member-retry"),
    };
    const firstBand = requireAccepted(await authority.replay(founderToken, bandIntent));
    const afterBand = await projectionCounts(replayApp);

    expect(await authority.replay(founderToken, bandIntent)).toEqual(firstBand);
    expect(await projectionCounts(replayApp)).toEqual(afterBand);

    const importIntent: AuthorityOperationIntent = {
      operationId: "op-retry-import",
      kind: "command",
      commandName: "ImportSongs",
      input: {
        Band: "band-retry",
        Songs: [{ Title: "Once Only" }, { Title: "Also Once" }],
      },
      recordIds: importSongsManifest(["song-retry-1", "song-retry-2"]),
      selectedContexts: { Band: "band-retry" },
    };
    const firstImport = requireAccepted(await authority.replay(founderToken, importIntent));
    const afterImport = await projectionCounts(replayApp);
    expect(afterImport.records).toBe(afterBand.records + 2);

    expect(await authority.replay(founderToken, importIntent)).toEqual(firstImport);
    expect(await projectionCounts(replayApp)).toEqual(afterImport);
    // Explicitly, not only by count: neither song was written a second time
    // under an authority-minted id.
    expect(
      await count(
        "select count(*)::int n from adl_authority_records where application_id=$1 and object_name='Song'",
        [replayApp],
      ),
    ).toBe(2);
  });

  /**
   * A client-supplied id is a name, never a claim. A command naming an id that
   * already exists is refused exactly as a direct create is — and, because the
   * command is one transaction, *nothing else the command would have written*
   * survives either. A band committed beside a refused membership would be the
   * partial state this phase exists to prevent.
   */
  it("refuses a taken id and leaves nothing the command would have written", async () => {
    const authority = service();
    requireAccepted(
      await createBand(authority, "op-first-band", "First Band", "band-taken", "member-taken"),
    );
    const before = await projectionCounts(replayApp);

    const colliding: AuthorityOperationIntent = {
      operationId: "op-colliding-band",
      kind: "command",
      commandName: "CreateBand",
      // The first step's id is free; the second names a membership that exists.
      recordIds: createBandManifest("band-never-written", "member-taken"),
      input: { Name: "Second Band" },
    };
    const collided = await authority.replay(founderToken, colliding);

    expect(collided).toMatchObject({
      status: "rejected",
      operationId: "op-colliding-band",
      code: "ADL_RUNTIME_RECORD_ID_TAKEN",
    });
    expect(await storedRecord(replayApp, "Band", "band-never-written")).toBeNull();

    const after = await projectionCounts(replayApp);
    expect(after.records).toBe(before.records);
    // The runtime audit must not have committed either: a rolled-back write
    // that left its audit event behind would be a record of something that
    // never happened.
    expect(after.audit).toBe(before.audit);
    expect(after.memberships).toBe(before.memberships);
    // The refusal itself is durable, so the retry is served from it rather than
    // re-running the command.
    expect(after.outcomes).toBe(before.outcomes + 1);
    expect(await authority.replay(founderToken, colliding)).toEqual(collided);
    expect(await projectionCounts(replayApp)).toEqual(after);

    // The existing membership is untouched by the attempt on its id.
    expect((await storedRecord(replayApp, "BandMember", "member-taken"))?.values).toMatchObject({
      Band: "band-taken",
      Role: "BandAdmin",
    });
  });

  /**
   * A manifest that does not describe the writes the re-execution plans is
   * refused outright rather than patched over: an id adopted against a
   * different write than the one it names is a silent identity swap, which is
   * worse than no id at all.
   */
  it("refuses a manifest that names a step the command does not plan", async () => {
    const authority = service();
    const before = await projectionCounts(replayApp);

    const outcome = await authority.replay(founderToken, {
      operationId: "op-mismatched-step",
      kind: "command",
      commandName: "CreateBand",
      input: { Name: "Mismatch Band" },
      recordIds: [
        { step: "createBand", objectName: "Band", recordId: "band-mismatch" },
        // `createFounderMembership` is the step this command plans.
        { step: "createBandMembership", objectName: "BandMember", recordId: "member-mismatch" },
      ],
    });

    expect(outcome).toMatchObject({
      status: "rejected",
      code: "ADL_RUNTIME_COMMAND_RECORD_IDS_MISMATCH",
    });
    expect(await storedRecord(replayApp, "Band", "band-mismatch")).toBeNull();
    const after = await projectionCounts(replayApp);
    expect(after.records).toBe(before.records);
    expect(after.audit).toBe(before.audit);
    expect(after.memberships).toBe(before.memberships);
  });

  /** The same refusal when an iterating step and the manifest disagree on length. */
  it("refuses a manifest that describes fewer items than the iterating step plans", async () => {
    const authority = service();
    requireAccepted(
      await createBand(authority, "op-band-for-short", "Short Band", "band-short", "member-short"),
    );
    const before = await projectionCounts(replayApp);

    const outcome = await authority.replay(founderToken, {
      operationId: "op-short-manifest",
      kind: "command",
      commandName: "ImportSongs",
      input: {
        Band: "band-short",
        Songs: [{ Title: "One" }, { Title: "Two" }, { Title: "Three" }],
      },
      recordIds: importSongsManifest(["song-short-1", "song-short-2"]),
      selectedContexts: { Band: "band-short" },
    });

    expect(outcome).toMatchObject({
      status: "rejected",
      code: "ADL_RUNTIME_COMMAND_RECORD_IDS_MISMATCH",
    });
    const after = await projectionCounts(replayApp);
    expect(after.records).toBe(before.records);
    expect(after.audit).toBe(before.audit);
    expect(
      await count(
        "select count(*)::int n from adl_authority_records where application_id=$1 and object_name='Song'",
        [replayApp],
      ),
    ).toBe(0);
  });

  /**
   * Phase 58. Every record a command commits is stored as the authority's own
   * accepted state, and carries no device bookkeeping.
   *
   * This is the row a device reconciles against, so a device state persisted
   * here would come straight back down the wire as one — and the device is
   * required to impose `synced` rather than adopt whatever it is sent. Asserting
   * it at the source as well means neither side is relying on the other to have
   * been careful.
   */
  it("stores every record an accepted command wrote as authority-accepted state", async () => {
    requireAccepted(
      await createBand(service(), "op-state-band", "State Band", "band-state", "member-state"),
    );

    for (const [objectName, recordId] of [
      ["Band", "band-state"],
      ["BandMember", "member-state"],
    ] as const) {
      const stored = await storedRecord(replayApp, objectName, recordId);
      expect(stored?.meta.syncStatus).toBe("synced");
      // Device-local bookkeeping about a refusal has no business on an accepted
      // authority row.
      expect(stored?.meta.syncRejectedCreate).toBeUndefined();
    }
  });

  /**
   * Phase 58. A record's sync state is not part of the intent contract in either
   * direction, and the authority is where that is enforced rather than assumed:
   * a client that names it is refused, for both intent kinds that carry values.
   */
  it("refuses an intent that tries to assert a record's sync state", async () => {
    const authority = service();
    const before = await projectionCounts(replayApp);

    const created = await authority.replay(founderToken, {
      operationId: "op-asserted-state-create",
      kind: "create",
      objectName: "Band",
      recordId: "band-asserted-state",
      values: { Name: "Asserted", CreatedBy: founderId, _syncStatus: "synced" },
    });
    expect(created).toMatchObject({ status: "rejected" });
    expect(await storedRecord(replayApp, "Band", "band-asserted-state")).toBeNull();

    const commanded = await authority.replay(founderToken, {
      operationId: "op-asserted-state-command",
      kind: "command",
      commandName: "CreateBand",
      input: { Name: "Asserted Band", _syncStatus: "synced" },
      recordIds: createBandManifest("band-asserted-cmd", "member-asserted-cmd"),
    });
    expect(commanded).toMatchObject({ status: "rejected" });
    expect(await storedRecord(replayApp, "Band", "band-asserted-cmd")).toBeNull();
    expect(await storedRecord(replayApp, "BandMember", "member-asserted-cmd")).toBeNull();

    const after = await projectionCounts(replayApp);
    expect(after.records).toBe(before.records);
    expect(after.audit).toBe(before.audit);
  });
});

describe("command intents over the real HTTP edge", () => {
  let server: Server;
  let baseUrl: string;
  let sessions: OpaqueSessionAdapter;

  const configuration: AuthorityConfiguration = {
    environment: "test",
    databaseUrl: "postgresql://ignored/adl",
    allowedOrigins: ["https://app.test"],
    cookieName: "__Host-adl_session",
    csrfCookieName: "__Host-adl_csrf",
    sessionTtlMinutes: 480,
    maxRequestBytes: 8192,
    upstreamIdentity: { issuer: "https://identity.test", audience: "adl-test" },
    identityVerification: { mode: "bypass" },
    rateLimits: {
      accountProof: 50,
      webauthn: 50,
      session: 50,
      invite: 50,
      bootstrap: 50,
      replay: 50,
      report: 50,
      administration: 50,
    },
  };

  beforeAll(async () => {
    const authorityQueryable = authorityPool(pool);
    sessions = new OpaqueSessionAdapter(new InMemoryAuthorityIdentitySessionStore());
    server = createAuthorityNodeServer({
      configuration,
      sessions,
      authority: new AuthorityService(
        model,
        new PostgresObjectStorageBackend(authorityQueryable, httpApp, model),
        sessions,
        {
          unitOfWork: new PostgresAuthorityUnitOfWork(authorityQueryable, httpApp, model),
          membershipIndex: new PostgresContextMembershipIndex(authorityQueryable, httpApp),
        },
      ),
      identityVerifier: {
        name: "test-upstream",
        verify: async (proof: string) =>
          proof === "valid-account-proof" ? { subject: "founder@example.test" } : null,
      },
      newCsrfToken: () => csrf,
      clientKey: () => "integration-client",
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((done) => server.close(() => done()));
  });

  beforeEach(async () => {
    await seedApplication(pool, httpApp, model.modelVersion);
  });

  let identityCounter = 0;
  async function replay(body: Record<string, unknown>): Promise<Response> {
    identityCounter += 1;
    const user = await sessions.provisionIdentity("bypass", `founder-${identityCounter}@test`);
    const session = await sessions.issueSession(user.userId);
    return fetch(`${baseUrl}/v1/sync/replay`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://app.test",
        "x-forwarded-proto": "https",
        cookie: `__Host-adl_session=${session.sessionToken}; __Host-adl_csrf=${csrf}`,
        "x-adl-csrf-token": csrf,
      },
      body: JSON.stringify(body),
    });
  }

  it("accepts a command intent with a well-formed manifest and persists it under those ids", async () => {
    const response = await replay({
      operationId: "http-command-1",
      kind: "command",
      commandName: "CreateBand",
      input: { Name: "HTTP Band" },
      recordIds: createBandManifest("band-http-1", "member-http-1"),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "accepted",
      operationId: "http-command-1",
    });
    expect(await storedRecord(httpApp, "Band", "band-http-1")).not.toBeNull();
    expect((await storedRecord(httpApp, "BandMember", "member-http-1"))?.values).toMatchObject({
      Band: "band-http-1",
      Role: "BandAdmin",
    });
  });

  /**
   * A control character in a record id is refused at the edge, before the
   * runtime ever sees the intent. It is the same rule a create's `recordId`
   * carries and for the same reason: a NUL in a text key is a real PostgreSQL
   * failure (the Phase 44 `audit_id` defect), and neither layer may assume the
   * other ran.
   */
  it("refuses a manifest entry with a control-character record id before the runtime sees it", async () => {
    const response = await replay({
      operationId: "http-command-bad-id",
      kind: "command",
      commandName: "CreateBand",
      input: { Name: "Never Created" },
      recordIds: [
        { step: "createBand", objectName: "Band", recordId: "band-http-2" },
        {
          step: "createFounderMembership",
          objectName: "BandMember",
          recordId: `member-${String.fromCodePoint(0)}2`,
        },
      ],
    });

    expect(response.status).toBe(400);
    // The edge classifies this as `malformed_request` internally, but intent
    // parsing happens inside the route's own try block, so the wire body is the
    // generic `request_rejected`. That is pre-existing and shared with a
    // create's `recordId`; it is pinned here as the observed contract rather
    // than assumed to be the internal name.
    expect(await response.json()).toEqual({ error: "request_rejected" });
    // Nothing was applied and no verdict was recorded: the request never
    // reached `AuthorityService.replay` at all.
    expect(await projectionCounts(httpApp)).toMatchObject({ records: 0, outcomes: 0, audit: 0 });
  });

  it("refuses a command body whose manifest is not an array", async () => {
    const response = await replay({
      operationId: "http-command-not-an-array",
      kind: "command",
      commandName: "CreateBand",
      input: { Name: "Never Created" },
      recordIds: "band-http-3",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "request_rejected" });
    expect(await projectionCounts(httpApp)).toMatchObject({ records: 0, outcomes: 0, audit: 0 });
  });

  it("refuses a command body carrying no manifest at all", async () => {
    const response = await replay({
      operationId: "http-command-no-manifest",
      kind: "command",
      commandName: "CreateBand",
      input: { Name: "Never Created" },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "request_rejected" });
    expect(await projectionCounts(httpApp)).toMatchObject({ records: 0, outcomes: 0, audit: 0 });
  });
});
