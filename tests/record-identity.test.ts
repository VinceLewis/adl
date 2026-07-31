import { describe, expect, it } from "vitest";
import {
  ApplicationRuntime,
  InMemoryObjectStorageBackend,
  MAX_RECORD_ID_LENGTH,
  createRecordGuid,
  isValidRecordId,
  resolveApplicationModel,
  validateApplicationModel,
} from "../src/index.js";
import type { PartialApplicationModel, RuntimeContext } from "../src/index.js";

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
  ],
};

const model = resolveApplicationModel(partialModel);

const adminContext: RuntimeContext = { userId: "user-admin", roles: ["Admin"], channel: "ui" };
const memberContext: RuntimeContext = { userId: "user-member", roles: ["Member"], channel: "ui" };

function newRuntime(): ApplicationRuntime {
  return new ApplicationRuntime(model, { storage: new InMemoryObjectStorageBackend() });
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
    expect(created.meta.revision).toBe("rev-1");
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
