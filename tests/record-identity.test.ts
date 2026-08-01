import { describe, expect, it } from "vitest";
import {
  ApplicationRuntime,
  InMemoryObjectStorageBackend,
  MAX_RECORD_ID_LENGTH,
  createRecordGuid,
  createRecordRevision,
  isValidRecordId,
  recordRevisionSequence,
  resolveApplicationModel,
  validateApplicationModel,
} from "../src/index.js";
import type {
  ObjectStorageBackend,
  PartialApplicationModel,
  RuntimeContext,
} from "../src/index.js";

/**
 * Phase 48. A record id crosses a trust boundary: an offline create names its own
 * record so the accepted record converges with the local row instead of arriving
 * as a second one. The rules proven here are:
 *
 * - a caller may name a record, and nothing else about it;
 * - a supplied id is untrusted input and is shape-checked before storage;
 * - an id that already names a record — a tombstone included — is refused, never
 *   overwritten, merged with, or silently adopted;
 * - the refusal comes after authorisation, so it is not an existence oracle;
 * - every minted id satisfies the shape rules, because a client proposing its own
 *   minted id to the authority depends on that.
 */

const NUL = String.fromCodePoint(0);
const UNIT_SEPARATOR = String.fromCodePoint(0x1f);
const DELETE_CHARACTER = String.fromCodePoint(0x7f);

const partialModel: PartialApplicationModel = {
  app: { name: "RecordIdentityFixture" },
  roles: [{ name: "Admin" }, { name: "Member" }],
  objects: [
    {
      name: "Gig",
      businessKey: "Title",
      displayField: "Title",
      fields: [{ name: "Title", type: "text", required: true }],
      sync: { mode: "localFirst", conflict: "manual" },
    },
    /**
     * Declared only so the revision cases below can drive a *transition*, which
     * is a fourth way a record gains a new version and mints a revision through
     * a path of its own (`ObjectStore.commitTransition`). It is a separate
     * object rather than a lifecycle bolted onto `Gig` so the Phase 48 fixture
     * above keeps meaning exactly what it meant.
     */
    {
      name: "Booking",
      businessKey: "Reference",
      displayField: "Reference",
      fields: [
        { name: "Reference", type: "text", required: true },
        { name: "Status", type: "text" },
      ],
      sync: { mode: "localFirst", conflict: "manual" },
      lifecycle: {
        name: "BookingLifecycle",
        stateField: "Status",
        initialState: "Draft",
        states: [{ name: "Draft" }, { name: "Confirmed" }],
        actions: [
          { name: "confirm", from: "Draft", to: "Confirmed", policyRefs: ["BookingPolicy"] },
        ],
      },
    },
  ],
  policies: [
    {
      name: "GigPolicy",
      object: "Gig",
      rules: [
        {
          name: "adminAll",
          effect: "allow",
          principal: { match: "specific", roles: ["Admin"] },
          action: "*",
        },
        {
          name: "memberRead",
          effect: "allow",
          principal: { match: "specific", roles: ["Member"] },
          action: "read",
        },
      ],
    },
    {
      name: "BookingPolicy",
      object: "Booking",
      rules: [
        {
          name: "adminAllBookings",
          effect: "allow",
          principal: { match: "specific", roles: ["Admin"] },
          action: "*",
        },
      ],
    },
  ],
};

const model = resolveApplicationModel(partialModel);

const adminContext: RuntimeContext = { userId: "user-admin", roles: ["Admin"], channel: "ui" };
const memberContext: RuntimeContext = { userId: "user-member", roles: ["Member"], channel: "ui" };

function newRuntime(): ApplicationRuntime {
  return new ApplicationRuntime(model, { storage: new InMemoryObjectStorageBackend() });
}

/**
 * A second runtime over persisted state someone else's runtime wrote. This is
 * an ordinary process restart — the authority coming back up, a browser tab
 * reloading over its IndexedDB — expressed with the backend held still and the
 * runtime replaced, which is the only part of a restart that matters here.
 */
function runtimeOver(storage: ObjectStorageBackend): ApplicationRuntime {
  return new ApplicationRuntime(model, { storage });
}

describe("isValidRecordId", () => {
  it("fixture model is valid", () => expect(validateApplicationModel(model)).toEqual([]));

  it("accepts an ordinary minted id and a bound-length id", () => {
    expect(isValidRecordId(createRecordGuid("Gig"))).toBe(true);
    expect(isValidRecordId("a")).toBe(true);
    expect(isValidRecordId("g".repeat(MAX_RECORD_ID_LENGTH))).toBe(true);
  });

  it("refuses an empty, over-long or non-string id", () => {
    expect(isValidRecordId("")).toBe(false);
    expect(isValidRecordId("g".repeat(MAX_RECORD_ID_LENGTH + 1))).toBe(false);
    expect(isValidRecordId(undefined)).toBe(false);
    expect(isValidRecordId(null)).toBe(false);
    expect(isValidRecordId(42)).toBe(false);
    expect(isValidRecordId({ toString: () => "gig-1" })).toBe(false);
  });

  /**
   * Real PostgreSQL refuses NUL in a text key — the Phase 44 `audit_id` defect —
   * and NUL is also the separator inside a bootstrap cursor key, so an id bearing
   * one could straddle two cursor positions.
   */
  it("refuses a control character anywhere in the id", () => {
    expect(isValidRecordId(`gig-${NUL}1`)).toBe(false);
    expect(isValidRecordId(`gig-1${NUL}`)).toBe(false);
    expect(isValidRecordId(`gig-${UNIT_SEPARATOR}1`)).toBe(false);
    expect(isValidRecordId(`gig-${DELETE_CHARACTER}1`)).toBe(false);
    expect(isValidRecordId("gig-\t1")).toBe(false);
    expect(isValidRecordId("gig-\n1")).toBe(false);
  });

  /**
   * Unlike an identity subject, a record id is never trimmed first: the accepted
   * record has to come back under the exact id the caller already holds, so a
   * padded id is refused rather than rewritten into a different id.
   */
  it("refuses surrounding whitespace instead of trimming it", () => {
    expect(isValidRecordId(" gig-1")).toBe(false);
    expect(isValidRecordId("gig-1 ")).toBe(false);
    expect(isValidRecordId("   ")).toBe(false);
    // Interior spaces are unusual but harmless as a storage key.
    expect(isValidRecordId("gig 1")).toBe(true);
  });

  it("mints only ids that satisfy its own shape rules", () => {
    for (const objectName of ["Gig", "AvailabilityWindow", "X"]) {
      const minted = createRecordGuid(objectName);
      expect(isValidRecordId(minted)).toBe(true);
      expect(minted.startsWith(`${objectName.toLowerCase()}-`)).toBe(true);
    }
    // Two mints never collide, which is what makes a client-proposed id workable.
    expect(createRecordGuid("Gig")).not.toBe(createRecordGuid("Gig"));
  });
});

describe("create under a supplied record id", () => {
  it("stores the record under the supplied id and derives every other meta field", async () => {
    const runtime = newRuntime();

    const created = await runtime.create("Gig", { Title: "Friday rehearsal" }, adminContext, {
      recordId: "gig-supplied-1",
    });

    expect(created.meta.guid).toBe("gig-supplied-1");
    // The caller named the record; it asserted nothing else about it.
    expect(created.meta.object).toBe("Gig");
    expect(created.meta.createdBy).toBe("user-admin");
    expect(created.meta.updatedBy).toBe("user-admin");
    // `pending`, not `local`: `Gig` is a queueable object, so this create was
    // queued by the same commit and the authority has not answered it yet.
    expect(created.meta.syncStatus).toBe("pending");
    // The record got a revision, and the caller did not choose it. What that
    // string *says* is not this case's business — a revision is opaque, and the
    // cases below own what makes one usable.
    expect(typeof created.meta.revision).toBe("string");
    expect(created.meta.revision).not.toBe("");
    await expect(
      runtime.objectStore.getRecordForRuntime("Gig", "gig-supplied-1"),
    ).resolves.toMatchObject({ values: { Title: "Friday rehearsal" } });
  });

  it("still mints an id when none is supplied", async () => {
    const runtime = newRuntime();
    const created = await runtime.create("Gig", { Title: "Minted" }, adminContext);
    expect(created.meta.guid.startsWith("gig-")).toBe(true);
    expect(isValidRecordId(created.meta.guid)).toBe(true);
  });

  it("refuses a malformed id before anything is written", async () => {
    const runtime = newRuntime();

    for (const badId of ["", " gig-1", `gig-${NUL}1`, "g".repeat(MAX_RECORD_ID_LENGTH + 1)]) {
      await expect(
        runtime.create("Gig", { Title: "Malformed" }, adminContext, { recordId: badId }),
      ).rejects.toMatchObject({ code: "ADL_RUNTIME_RECORD_ID_INVALID" });
    }
    // Nothing reached storage, and no local operation was queued for replay.
    await expect(runtime.objectStore.search("Gig", {}, adminContext)).resolves.toEqual([]);
    expect(runtime.syncQueue.getEntries()).toEqual([]);
  });

  it("refuses an id that already names a record and leaves that record untouched", async () => {
    const runtime = newRuntime();
    const first = await runtime.create("Gig", { Title: "The original" }, adminContext, {
      recordId: "gig-taken",
    });

    await expect(
      runtime.create("Gig", { Title: "The impostor" }, adminContext, { recordId: "gig-taken" }),
    ).rejects.toMatchObject({ code: "ADL_RUNTIME_RECORD_ID_TAKEN" });

    // Not an overwrite, not a merge, not a silent adoption: the record stands as
    // it was, at its original revision.
    await expect(
      runtime.objectStore.getRecordForRuntime("Gig", "gig-taken"),
    ).resolves.toMatchObject({
      meta: { revision: first.meta.revision },
      values: { Title: "The original" },
    });
    expect(await runtime.objectStore.search("Gig", {}, adminContext)).toHaveLength(1);
  });

  it("refuses an id held by a tombstone, so a create cannot resurrect a deleted record", async () => {
    const runtime = newRuntime();
    await runtime.create("Gig", { Title: "Cancelled" }, adminContext, { recordId: "gig-deleted" });
    await runtime.delete("Gig", "gig-deleted", adminContext);
    // The record is gone from every read path, which is exactly why an id-only
    // lookup here has to read through tombstones.
    await expect(runtime.objectStore.getRecordForRuntime("Gig", "gig-deleted")).resolves.toBeNull();

    await expect(
      runtime.create("Gig", { Title: "Resurrected" }, adminContext, { recordId: "gig-deleted" }),
    ).rejects.toMatchObject({ code: "ADL_RUNTIME_RECORD_ID_TAKEN" });

    const tombstone = await runtime.objectStore.getRecordForSync("Gig", "gig-deleted");
    expect(tombstone?.meta.deletedAt).toBeDefined();
    expect(tombstone?.values).toMatchObject({ Title: "Cancelled" });
  });

  /**
   * The collision check runs only after the create is otherwise authorised, so a
   * caller who may not create is denied rather than told whether an id exists.
   */
  it("denies an unauthorised caller without disclosing that the id is taken", async () => {
    const runtime = newRuntime();
    await runtime.create("Gig", { Title: "Existing" }, adminContext, { recordId: "gig-secret" });

    await expect(
      runtime.create("Gig", { Title: "Probe" }, memberContext, { recordId: "gig-secret" }),
    ).rejects.toMatchObject({ code: "ADL_POLICY_DENIED" });
    // The same caller probing an id that does not exist gets the same answer, so
    // the two cases are indistinguishable.
    await expect(
      runtime.create("Gig", { Title: "Probe" }, memberContext, { recordId: "gig-absent" }),
    ).rejects.toMatchObject({ code: "ADL_POLICY_DENIED" });
  });

  it("shape-checks the id before authorisation, since a malformed id discloses nothing", async () => {
    const runtime = newRuntime();
    await expect(
      runtime.create("Gig", { Title: "Probe" }, memberContext, { recordId: ` ${NUL}` }),
    ).rejects.toMatchObject({ code: "ADL_RUNTIME_RECORD_ID_INVALID" });
  });
});

/**
 * Phase 61. A record id names a record; a revision names one *version* of one
 * record. The optimistic-concurrency check the entire sync loop rests on is a
 * plain equality comparison against that value — `AuthorityService` refuses a
 * write whose `baseRevision` does not equal the stored revision, and nothing
 * anywhere orders revisions or parses them.
 *
 * That makes reissuing a revision a silent lost update rather than a curiosity.
 * A device holds record X at some revision; the process that mints revisions
 * restarts; other writers advance X until it wears that same name again — a
 * different version, indistinguishable from the one the device saw. The stale
 * write now passes the equality check and overwrites edits it never saw, with
 * no conflict, no `manualResolution`, and nothing left afterwards that could
 * detect it.
 *
 * Until this phase the value came from `private nextRevisionId = 1` on
 * `ObjectStore`, seeded in every constructor and never rehydrated, so a record
 * driven to `rev-4` through one runtime came back as `rev-1` through the next
 * runtime over the same persisted state. The rules proven here are:
 *
 * - a revision is unique for the life of the persisted state it describes, not
 *   for the life of the process that minted it;
 * - a record's revisions never move backwards, including across a restart;
 * - every path that produces a new version — create, update, delete and
 *   transition alike — mints a fresh one;
 * - and the derivation reads the record's *own* prior revision, so a value it
 *   does not recognise starts a sequence instead of failing.
 */
describe("record revision", () => {
  /**
   * The restart case, and the one that fails outright if the process-local
   * counter ever comes back: with the backend held still and the runtime
   * replaced, the record must not be handed a revision it has already worn.
   */
  it("never reissues a revision a record already had, across a runtime restart", async () => {
    const storage = new InMemoryObjectStorageBackend();
    const first = runtimeOver(storage);

    const worn = [
      (await first.create("Gig", { Title: "Take 1" }, adminContext, { recordId: "gig-restart" }))
        .meta.revision,
      (await first.update("Gig", "gig-restart", { Title: "Take 2" }, adminContext)).meta.revision,
      (await first.update("Gig", "gig-restart", { Title: "Take 3" }, adminContext)).meta.revision,
      (await first.update("Gig", "gig-restart", { Title: "Take 4" }, adminContext)).meta.revision,
    ];
    // Four versions, four distinct names, before anything restarts.
    expect(new Set(worn).size).toBe(worn.length);

    const second = runtimeOver(storage);
    await second.whenReady();
    const afterRestart = (
      await second.update("Gig", "gig-restart", { Title: "Take 5" }, adminContext)
    ).meta.revision;

    // The whole point: the fresh runtime knows nothing of the four revisions
    // above except what the record itself carries, and must not reuse one.
    expect(worn).not.toContain(afterRestart);
    expect(new Set([...worn, afterRestart]).size).toBe(worn.length + 1);
    // And it is the persisted record that wears it, not just the returned copy.
    await expect(
      second.objectStore.getRecordForRuntime("Gig", "gig-restart"),
    ).resolves.toMatchObject({ meta: { revision: afterRestart } });
  });

  /**
   * Uniqueness alone would be satisfied by a value that jumps about. The
   * sequence exists so a record's versions stay legible in an audit trail and
   * an operation log, which only holds if a restart cannot wind it back.
   * `recordRevisionSequence` is exported for the minting side and for this
   * assertion; it is not a licence for a consumer to order revisions.
   */
  it("does not let a record's revision sequence go backwards across a restart", async () => {
    const storage = new InMemoryObjectStorageBackend();
    const first = runtimeOver(storage);

    await first.create("Gig", { Title: "Take 1" }, adminContext, { recordId: "gig-sequence" });
    await first.update("Gig", "gig-sequence", { Title: "Take 2" }, adminContext);
    const beforeRestart = (
      await first.update("Gig", "gig-sequence", { Title: "Take 3" }, adminContext)
    ).meta.revision;

    const second = runtimeOver(storage);
    await second.whenReady();
    const afterRestart = (
      await second.update("Gig", "gig-sequence", { Title: "Take 4" }, adminContext)
    ).meta.revision;

    expect(recordRevisionSequence(afterRestart)).toBeGreaterThan(
      recordRevisionSequence(beforeRestart),
    );
    // A third runtime keeps counting from where the second left off, so this is
    // a property of the record rather than of one lucky restart.
    const third = runtimeOver(storage);
    await third.whenReady();
    const afterSecondRestart = (
      await third.update("Gig", "gig-sequence", { Title: "Take 5" }, adminContext)
    ).meta.revision;
    expect(recordRevisionSequence(afterSecondRestart)).toBeGreaterThan(
      recordRevisionSequence(afterRestart),
    );
  });

  /**
   * A revision is minted on every path that produces a new version of a record,
   * not only on `update`. A delete writes a tombstone other devices reconcile
   * against, and a transition is a write with a state change attached; either
   * one reusing the prior revision would leave a stale `baseRevision` matching a
   * version that no longer exists.
   */
  it("mints a distinct revision for a delete and for a lifecycle transition", async () => {
    const runtime = newRuntime();

    const created = await runtime.create("Gig", { Title: "Doomed" }, adminContext, {
      recordId: "gig-tombstone",
    });
    const deleted = await runtime.delete("Gig", "gig-tombstone", adminContext);
    expect(deleted.meta.revision).not.toBe(created.meta.revision);
    expect(recordRevisionSequence(deleted.meta.revision)).toBeGreaterThan(
      recordRevisionSequence(created.meta.revision),
    );

    const booking = await runtime.create("Booking", { Reference: "B-1" }, adminContext, {
      recordId: "booking-1",
    });
    const confirmed = await runtime.transition("Booking", "booking-1", "confirm", adminContext);
    expect(confirmed.meta.state).toBe("Confirmed");
    expect(confirmed.meta.revision).not.toBe(booking.meta.revision);
    expect(recordRevisionSequence(confirmed.meta.revision)).toBeGreaterThan(
      recordRevisionSequence(booking.meta.revision),
    );
  });

  describe("createRecordRevision", () => {
    it("mints a fresh revision when there is no prior one", () => {
      const minted = createRecordRevision();
      expect(typeof minted).toBe("string");
      expect(minted).not.toBe("");
      expect(recordRevisionSequence(minted)).toBe(1);
    });

    it("counts on from the record's own prior revision", () => {
      const first = createRecordRevision();
      const second = createRecordRevision(first);
      const third = createRecordRevision(second);

      expect(recordRevisionSequence(second)).toBe(recordRevisionSequence(first) + 1);
      expect(recordRevisionSequence(third)).toBe(recordRevisionSequence(second) + 1);
      expect(new Set([first, second, third]).size).toBe(3);
    });

    /**
     * Records persisted before this phase carry the bare `rev-<n>` shape. Their
     * sequence is still read, so an existing record counts on from where it
     * stood rather than restarting — which is what stops the *first* write after
     * an upgrade colliding with a revision that record already had.
     */
    it("reads the sequence out of a pre-phase revision", () => {
      expect(recordRevisionSequence("rev-4")).toBe(4);
      expect(recordRevisionSequence(createRecordRevision("rev-4"))).toBe(5);
    });

    /**
     * A prior revision is derived from, never trusted. A fixture literal, a
     * seeded value, or a revision some other runtime's format produced must
     * still yield a usable unique revision — the random token is what makes
     * starting a fresh sequence safe there.
     */
    it("starts a new sequence for a prior revision it does not recognise, instead of failing", () => {
      for (const unrecognised of ["rev-seeded-a", "", "seeded", "rev-", "rev-x1"]) {
        const minted = createRecordRevision(unrecognised);
        expect(recordRevisionSequence(unrecognised)).toBe(0);
        expect(minted).not.toBe(unrecognised);
        expect(recordRevisionSequence(minted)).toBe(1);
        expect(minted).not.toBe(createRecordRevision(unrecognised));
      }
    });

    /**
     * Two runtimes over one backend, or a device and the authority minting
     * offline, both derive from the same prior revision. Uniqueness therefore
     * cannot come from the sequence, and does not.
     */
    it("never mints the same value twice from the same prior revision", () => {
      const previous = createRecordRevision();
      const minted = new Set(Array.from({ length: 64 }, () => createRecordRevision(previous)));
      expect(minted.size).toBe(64);
      expect(minted.has(previous)).toBe(false);
    });

    it("mints only revisions that survive storage as a text key", () => {
      // A revision is persisted in a text column and in an IndexedDB record, and
      // travels in an operation-log entry, so the id shape rules bind it too.
      expect(isValidRecordId(createRecordRevision())).toBe(true);
      expect(isValidRecordId(createRecordRevision("rev-9"))).toBe(true);
    });
  });
});
