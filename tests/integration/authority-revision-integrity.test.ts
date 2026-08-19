import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Pool } from "pg";
import {
  ApplicationRuntime,
  AuthorityService,
  PostgresAuthorityUnitOfWork,
  PostgresContextMembershipIndex,
  PostgresObjectStorageBackend,
  StaticSessionAdapter,
} from "../../src/index.js";
import type {
  AuthorityBatchWrite,
  AuthorityOperationIntent,
  RuntimeContext,
  StoredObjectRecord,
} from "../../src/index.js";
import { createGiggleBandExampleModel } from "../../src/reference/band-app.js";
import { authorityPool, resetProjections, seedApplication } from "./pg-harness.js";

/**
 * Phase 61 against a real authority over real PostgreSQL: an authority restart
 * cannot make a stale `baseRevision` pass the optimistic-concurrency check.
 *
 * The check is a plain string equality — `AuthorityService.apply` for a single
 * intent, `applyBatch` for a batch — so everything rests on a revision naming
 * exactly one version of one record, for the life of the persisted state rather
 * than for the life of the process that minted it. Until Phase 61 it did not:
 * `ObjectStore` held `private nextRevisionId = 1`, seeded at 1 in every
 * constructor and never rehydrated, so a new authority process handed out
 * `rev-1`, `rev-2`, `rev-3` again over records that had already worn them. A
 * device's stale `baseRevision` could then equal the *current* revision of a
 * different version of the same record and be accepted silently: a lost update
 * with no conflict, no `manualResolution` and nothing left to detect it.
 *
 * That failure is invisible to a hermetic suite that builds one runtime and
 * keeps it, and invisible to the outcome object the service returns — the
 * outcome would say `accepted`, truthfully, about a write that destroyed three
 * edits. So the claims here are read back out of `adl_authority_records`, and
 * the restart is a genuine one: every process-local object is discarded and
 * rebuilt over the same PostgreSQL state.
 *
 * ## Why the write counts below are what they are
 *
 * The old revision was the position of a counter held on the writing
 * `ObjectStore`, one per `ApplicationRuntime`. So the k-th record write a
 * runtime made came back as `rev-k`, whatever record it was for and whatever
 * the record had worn before. Two consequences shape this test:
 *
 * - a fresh authority process's runtime restarted that counter at 1, so its
 *   k-th write reissued `rev-k`; and
 * - to make a *stale* value equal the *current* one, the post-restart process
 *   has to walk its counter to exactly the position the device's held revision
 *   came from — no further.
 *
 * Each test therefore advances the record exactly {@link WRITES} times through
 * the first process's own runtime, which writes nothing else, so the device's
 * held revision is that runtime's {@link WRITES}-th — `rev-3` under the old
 * scheme. After the restart the second process's runtime advances the same
 * record exactly {@link WRITES} times, so its counter stops on the same
 * position: under the old scheme the record wears `rev-3` again at the moment
 * the stale write is replayed, and the equality check passes. Fewer or more
 * post-restart writes and the counters would miss each other, and the test
 * would pass against the defect while proving nothing.
 *
 * Three rather than one is the conservative choice. The transaction-scoped
 * runtime `PostgresAuthorityUnitOfWork` builds per replay also restarted the
 * counter, so a single replayed write reissued `rev-1` too; a test built on
 * that alone would not distinguish "the counter is per process" from "the
 * counter is per transaction". Advancing three times through one long-lived
 * process runtime catches both readings, and the revision-distinctness
 * assertion below states the underlying property directly, independently of
 * the conflict check.
 */

const applicationId = "authority-revision-integrity";
const founderToken = "r".repeat(48);
const founderId = "user-revision-founder";

/**
 * How many times each authority process advances the record. See the header:
 * the two counts must be equal, or the old counter would not have walked back
 * onto the revision the device still holds.
 */
const WRITES = 3;

const model = await createGiggleBandExampleModel();

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
  await seedApplication(pool, applicationId, model.modelVersion);
});

function inBand(bandId: string): RuntimeContext {
  return { ...systemContext, selectedContexts: { Band: bandId } };
}

/**
 * One authority process: every object a restart destroys, over PostgreSQL state
 * that a restart does not.
 *
 * The pool is deliberately shared — it stands for the database, which survives
 * the restart by definition. What must not be shared is anything holding
 * process-local state: the service, the unit of work, the storage backends and
 * the runtime whose `ObjectStore` used to carry the counter.
 */
interface AuthorityProcess {
  /** The replay path a device reaches, wired the way the real authority is. */
  service: AuthorityService;
  /** This process's own runtime, as another member writing server-side uses. */
  runtime: ApplicationRuntime;
}

function startAuthority(): AuthorityProcess {
  const queryable = authorityPool(pool);
  return {
    service: new AuthorityService(
      model,
      new PostgresObjectStorageBackend(queryable, applicationId, model),
      new StaticSessionAdapter(new Map([[founderToken, { userId: founderId }]])),
      {
        unitOfWork: new PostgresAuthorityUnitOfWork(queryable, applicationId, model),
        membershipIndex: new PostgresContextMembershipIndex(queryable, applicationId),
      },
    ),
    runtime: new ApplicationRuntime(model, {
      storage: new PostgresObjectStorageBackend(queryable, applicationId, model),
    }),
  };
}

/** The stored record PostgreSQL holds under an id, or null when there is none. */
async function storedRecord(
  objectName: string,
  recordId: string,
): Promise<StoredObjectRecord | null> {
  const result = await pool.query<{ record: StoredObjectRecord }>(
    "select record from adl_authority_records where application_id=$1 and object_name=$2 and record_id=$3",
    [applicationId, objectName, recordId],
  );
  return result.rows[0]?.record ?? null;
}

/** The revision PostgreSQL currently holds — the value the equality check reads. */
async function revisionOf(objectName: string, recordId: string): Promise<string> {
  const record = await storedRecord(objectName, recordId);
  if (record === null) throw new Error(`No authority record for ${objectName}/${recordId}.`);
  return record.meta.revision;
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const result = await pool.query<{ n: number }>(sql, params);
  return Number(result.rows[0]?.n ?? 0);
}

interface ProjectionCounts {
  records: number;
  audit: number;
}

async function projectionCounts(): Promise<ProjectionCounts> {
  return {
    records: await count(
      "select count(*)::int n from adl_authority_records where application_id=$1",
      [applicationId],
    ),
    audit: await count(
      "select count(*)::int n from adl_authority_audit_events where application_id=$1",
      [applicationId],
    ),
  };
}

interface SeededBand {
  bandId: string;
  setListId: string;
  songOneId: string;
}

/**
 * The band, membership, set list and song the tests write against.
 *
 * Seeded through a runtime of its own, which is then discarded: the two
 * authority processes below must write nothing but the record under test, or
 * their counters would not line up and the write counts in the header would be
 * wrong. The membership is what gives the founder `BandAdmin` — the authority
 * derives that from the real membership projection, not from anything the
 * caller asserts.
 */
async function seedBand(suffix: string): Promise<SeededBand> {
  const runtime = new ApplicationRuntime(model, {
    storage: new PostgresObjectStorageBackend(authorityPool(pool), applicationId, model),
  });
  const bandId = `band-${suffix}`;
  await runtime.create("Band", { Name: "Revision Band", CreatedBy: founderId }, systemContext, {
    recordId: bandId,
  });
  await runtime.create(
    "BandMember",
    { User: founderId, Band: bandId, Role: "BandAdmin", JoinedAt: "2026-07-01" },
    inBand(bandId),
    { recordId: `member-${suffix}` },
  );
  const setListId = `setlist-${suffix}`;
  await runtime.create(
    "SetList",
    { Band: bandId, Name: "Main Set", Description: "Seeded" },
    inBand(bandId),
    { recordId: setListId },
  );
  const songOneId = `song-one-${suffix}`;
  await runtime.create("Song", { Band: bandId, Title: "Neon Map" }, inBand(bandId), {
    recordId: songOneId,
  });
  return { bandId, setListId, songOneId };
}

/**
 * Advance the set list through one process's own runtime, returning the
 * revision PostgreSQL holds after each write.
 *
 * The writes go through the process runtime rather than through `replay` on
 * purpose: that runtime lives for the whole process, which is what "the
 * authority's counter" meant, and it is how the rest of this suite models
 * another member editing server-side.
 */
async function advance(
  process: AuthorityProcess,
  seeded: SeededBand,
  descriptions: readonly string[],
): Promise<string[]> {
  const revisions: string[] = [];
  for (const description of descriptions) {
    await process.runtime.update(
      "SetList",
      seeded.setListId,
      { Description: description },
      inBand(seeded.bandId),
    );
    revisions.push(await revisionOf("SetList", seeded.setListId));
  }
  return revisions;
}

function labelled(prefix: string): string[] {
  return Array.from({ length: WRITES }, (_unused, index) => `${prefix} ${index + 1}`);
}

describe("a stale base revision across an authority restart, over real PostgreSQL", () => {
  /**
   * The intent path (`AuthorityService.apply`, the single `baseRevision`
   * equality).
   *
   * A device holds the set list at the revision the first authority process
   * left it on. That process ends; a second one is built over the same
   * PostgreSQL state and another member edits the same record three times
   * through it — enough for the old counter to hand out the device's held
   * revision again. The device then replays the write it staged before the
   * restart.
   */
  it("refuses a stale update intent whose revision a restarted authority could have reissued", async () => {
    const seeded = await seedBand("intent");
    const createdRevision = await revisionOf("SetList", seeded.setListId);

    // --- authority process #1 ------------------------------------------
    let authority: AuthorityProcess | null = startAuthority();
    const beforeRestart = await advance(authority, seeded, labelled("Before the restart"));
    // What the device took away with it: the revision the authority held when
    // its form was opened.
    const held = beforeRestart[WRITES - 1] ?? "";
    expect(held).toBe(await revisionOf("SetList", seeded.setListId));

    // --- the restart ---------------------------------------------------
    // The process ends. Everything it held goes with it; PostgreSQL does not.
    authority = null;
    const restarted = startAuthority();

    // --- authority process #2 ------------------------------------------
    // Another member's edits, exactly as many as the first process made, so a
    // counter-based scheme stops on the same position it stopped on before.
    const afterRestart = await advance(restarted, seeded, labelled("After the restart"));
    const current = afterRestart[WRITES - 1] ?? "";

    // The property the conflict check depends on, asserted directly: no version
    // of this record has ever worn another version's name. Against the old
    // counter the three post-restart revisions were the three pre-restart ones,
    // and this fails on its own.
    const everyRevision = [createdRevision, ...beforeRestart, ...afterRestart];
    expect(new Set(everyRevision).size).toBe(everyRevision.length);
    expect(current).not.toBe(held);

    const before = await projectionCounts();

    // --- the stale replay ----------------------------------------------
    const outcome = await restarted.service.replay(founderToken, {
      operationId: "op-revision-intent-stale",
      kind: "update",
      objectName: "SetList",
      recordId: seeded.setListId,
      patch: { Description: "Staged on the device before the restart" },
      baseRevision: held,
      selectedContexts: { Band: seeded.bandId },
    } satisfies AuthorityOperationIntent);

    // `SetList` declares no conflict strategy, so it takes the resolved default,
    // `manual`. What matters is that this is a conflict verdict at all rather
    // than `accepted`.
    expect(outcome).toMatchObject({
      status: "manualResolution",
      operationId: "op-revision-intent-stale",
      code: "ADL_SYNC_MANUAL_RESOLUTION",
      recovery: "manual",
    });

    // And the lost update did not happen: the other member's values stand, in
    // PostgreSQL, under the revision they were written with.
    const setList = await storedRecord("SetList", seeded.setListId);
    expect(setList?.values).toMatchObject({ Description: `After the restart ${WRITES}` });
    expect(setList?.meta.revision).toBe(current);

    const after = await projectionCounts();
    expect(after.records).toBe(before.records);
    // A refused write is not an audited one.
    expect(after.audit).toBe(before.audit);
  });

  /**
   * The batch path (`AuthorityService.applyBatch`, the per-write `baseRevision`
   * equality), which is a separate comparison in a separate method and had to
   * be proven separately.
   *
   * The stale update travels beside a perfectly valid child create, so the
   * assertion is doubled: the stale write is refused, and Phase 59's atomicity
   * means the write beside it does not land either. Accepted under the old
   * counter, this batch would have overwritten three edits *and* added a row.
   */
  it("refuses a stale update inside a batch whose revision a restarted authority could have reissued", async () => {
    const seeded = await seedBand("batch");
    const createdRevision = await revisionOf("SetList", seeded.setListId);

    let authority: AuthorityProcess | null = startAuthority();
    const beforeRestart = await advance(authority, seeded, labelled("Before the restart"));
    const held = beforeRestart[WRITES - 1] ?? "";

    authority = null;
    const restarted = startAuthority();

    const afterRestart = await advance(restarted, seeded, labelled("After the restart"));
    const current = afterRestart[WRITES - 1] ?? "";
    const everyRevision = [createdRevision, ...beforeRestart, ...afterRestart];
    expect(new Set(everyRevision).size).toBe(everyRevision.length);
    expect(current).not.toBe(held);

    const before = await projectionCounts();

    const writes: AuthorityBatchWrite[] = [
      {
        operation: "create",
        objectName: "SetListItem",
        recordId: "item-revision-batch",
        values: {
          Band: seeded.bandId,
          SetList: seeded.setListId,
          Song: seeded.songOneId,
          Position: 1,
        },
      },
      {
        operation: "update",
        objectName: "SetList",
        recordId: seeded.setListId,
        patch: { Description: "Staged on the device before the restart" },
        baseRevision: held,
      },
    ];
    const outcome = await restarted.service.replay(founderToken, {
      operationId: "op-revision-batch-stale",
      kind: "batch",
      writes,
      selectedContexts: { Band: seeded.bandId },
    } satisfies AuthorityOperationIntent);

    expect(outcome).toMatchObject({
      status: "manualResolution",
      operationId: "op-revision-batch-stale",
      code: "ADL_SYNC_MANUAL_RESOLUTION",
      recovery: "manual",
    });

    const setList = await storedRecord("SetList", seeded.setListId);
    expect(setList?.values).toMatchObject({ Description: `After the restart ${WRITES}` });
    expect(setList?.meta.revision).toBe(current);
    // The write beside the stale one goes down with it.
    expect(await storedRecord("SetListItem", "item-revision-batch")).toBeNull();

    const after = await projectionCounts();
    expect(after.records).toBe(before.records);
    expect(after.audit).toBe(before.audit);
  });

  /**
   * The control that makes both refusals above mean something.
   *
   * A test that only ever sees a conflict cannot tell "the stale revision was
   * refused" from "this replay path refuses everything after a restart". Here
   * the device replays against the revision the restarted authority actually
   * holds, on the same restarted service, and it is accepted — so the refusals
   * are about the staleness and nothing else.
   *
   * It also proves the useful half of the fix: a restart does not strand a
   * device that is up to date. A rule that made every post-restart write
   * conflict would satisfy the two tests above and be worthless.
   */
  it("accepts the same write when the device holds the revision the restarted authority holds", async () => {
    const seeded = await seedBand("control");

    let authority: AuthorityProcess | null = startAuthority();
    await advance(authority, seeded, labelled("Before the restart"));
    authority = null;

    const restarted = startAuthority();
    const afterRestart = await advance(restarted, seeded, labelled("After the restart"));
    // The device re-read the record after the restart, so it holds the current
    // revision rather than the one it took away.
    const current = afterRestart[WRITES - 1] ?? "";

    const outcome = await restarted.service.replay(founderToken, {
      operationId: "op-revision-fresh",
      kind: "update",
      objectName: "SetList",
      recordId: seeded.setListId,
      patch: { Description: "Staged on the device after re-reading" },
      baseRevision: current,
      selectedContexts: { Band: seeded.bandId },
    } satisfies AuthorityOperationIntent);

    expect(outcome).toMatchObject({ status: "accepted", operationId: "op-revision-fresh" });
    const setList = await storedRecord("SetList", seeded.setListId);
    expect(setList?.values).toMatchObject({ Description: "Staged on the device after re-reading" });
    // The accepted write moved the record on again, and onto a revision it has
    // never worn — including the one the replay was judged against.
    expect(setList?.meta.revision).not.toBe(current);
  });
});
