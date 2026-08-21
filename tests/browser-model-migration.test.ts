import { afterEach, describe, expect, it } from "vitest";
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";
import {
  ApplicationRuntime,
  IndexedDbObjectStorageBackend,
  IndexedDbSyncStateStorage,
  MODEL_MIGRATION_CODES,
  RUNTIME_STARTUP_COMPATIBILITY_CODES,
  RuntimeStartupError,
  resolveApplicationModel,
} from "../src/index.js";
import type {
  IndexedDbObjectStorageOptions,
  LocalOperation,
  ObjectStorageTransactionWrite,
  PartialApplicationModel,
  PartialPolicyModel,
  PersistedApplicationMetadata,
  PersistedObjectRecord,
  PersistedSyncState,
  ResolvedApplicationModel,
  RuntimeContext,
  StoredObjectRecord,
} from "../src/index.js";
import { IndexedDbSessionIdentityStorage } from "../src/ui/offline-session.js";
import { createGiggleBandExampleModel } from "../src/reference/band-app.js";

/**
 * Phase 51, browser half: a model version change must migrate persisted
 * IndexedDB records rather than destroying them, and must refuse rather than
 * guess when it cannot.
 *
 * These cases run against real IndexedDB semantics through `fake-indexeddb`,
 * not a stub, because the two properties under test are properties of the
 * store: that the application-metadata row commits in the *same* transaction as
 * the record rewrites, and that a refusal leaves every byte where it was.
 *
 * Three separate IndexedDB databases are in play and the separation is
 * load-bearing: records (`<name>`), sync state (`<name>-sync-state`) and the
 * cached session identity (`<name>-session-identity`). The last of these is the
 * Phase 51 constraint with the sharpest edge — it is what stops a signed-in user
 * losing their own data on an offline reload, it is not a record, and a
 * migration must never touch it.
 */

const fixedNow = new Date("2026-07-30T09:00:00.000Z");
const identityVerifiedAt = "2026-07-24T11:30:00.000Z";

let restoreIndexedDb: (() => void) | undefined;
let nextDatabaseId = 1;

const adminContext: RuntimeContext = {
  userId: "admin-migration",
  roles: ["Admin"],
  channel: "api",
  now: fixedNow,
};

/** The model that wrote the persisted state: `Email`, `LegacyPhone`, schema 1. */
const partialModelV1: PartialApplicationModel = {
  modelVersion: "1.0.0",
  app: { name: "MigrationDemo", offlineGraceDays: 30 },
  roles: [{ name: "Admin" }],
  objects: [
    {
      name: "Customer",
      schemaVersion: 1,
      businessKey: "Name",
      displayField: "Name",
      fields: [
        { name: "Name", type: "text", required: true },
        { name: "Email", type: "text", required: true },
        { name: "LegacyPhone", type: "text" },
      ],
    },
    {
      name: "Note",
      schemaVersion: 1,
      businessKey: "Title",
      displayField: "Title",
      fields: [{ name: "Title", type: "text", required: true }],
    },
  ],
  policies: [allowAdmin("Customer"), allowAdmin("Note")],
};

/**
 * The model the process is running: `Email` renamed, `Tier` added,
 * `LegacyPhone` dropped, `Customer` at schema 2 — with the hop declared.
 * `Note` is deliberately untouched by the migration, so an object no step
 * mentions can be shown to survive byte-identical.
 */
const partialModelV11: PartialApplicationModel = {
  modelVersion: "1.1.0",
  app: { name: "MigrationDemo", offlineGraceDays: 30 },
  roles: [{ name: "Admin" }],
  objects: [
    {
      name: "Customer",
      schemaVersion: 2,
      businessKey: "Name",
      displayField: "Name",
      fields: [
        { name: "Name", type: "text", required: true },
        { name: "EmailAddress", type: "text", required: true },
        { name: "Tier", type: "text" },
      ],
    },
    {
      name: "Note",
      schemaVersion: 1,
      businessKey: "Title",
      displayField: "Title",
      fields: [{ name: "Title", type: "text", required: true }],
    },
  ],
  policies: [allowAdmin("Customer"), allowAdmin("Note")],
  migrations: [
    {
      from: "1.0.0",
      to: "1.1.0",
      objects: [
        {
          object: "Customer",
          schemaVersion: 2,
          steps: [
            { kind: "renameField", from: "Email", to: "EmailAddress" },
            { kind: "addField", field: "Tier", defaultValue: "standard" },
            { kind: "dropField", field: "LegacyPhone" },
          ],
        },
      ],
    },
  ],
};

/** The same declared version as v1, with different content. Phase 50's example. */
const partialModelV1ShorterGrace: PartialApplicationModel = {
  ...partialModelV1,
  app: { name: "MigrationDemo", offlineGraceDays: 7 },
};

/** v1.1 content with the hop removed: a version change nothing can reach. */
const partialModelV11WithoutMigration: PartialApplicationModel = {
  ...partialModelV11,
  migrations: [],
};

describe("browser model migration over IndexedDB", () => {
  afterEach(() => {
    restoreIndexedDb?.();
    restoreIndexedDb = undefined;
  });

  it("opens Giggle data persisted before explicit shell navigation without clearing it", async () => {
    installFakeIndexedDb();
    const databaseName = nextDatabaseName();
    const model = await createGiggleBandExampleModel();
    const band = model.objects.find((object) => object.name === "Band");
    if (band === undefined) {
      throw new Error("Giggle model is missing Band.");
    }

    const event = model.objects.find((object) => object.name === "Event");
    if (event === undefined) {
      throw new Error("Giggle model is missing Event.");
    }

    expect(model.modelVersion).toBe("1.12.0");
    expect(model.migrations).toContainEqual({
      from: "1.0.0",
      to: "1.1.0",
      objects: [],
    });
    expect(model.migrations).toContainEqual({
      from: "1.1.0",
      to: "1.2.0",
      objects: [],
    });
    expect(model.migrations).toContainEqual({
      from: "1.2.0",
      to: "1.3.0",
      objects: [],
    });
    expect(model.migrations).toContainEqual({
      from: "1.3.0",
      to: "1.4.0",
      objects: [
        {
          object: "Event",
          steps: [{ kind: "dropField", field: "SetList" }],
        },
      ],
    });
    expect(model.migrations).toContainEqual({
      from: "1.4.0",
      to: "1.5.0",
      objects: [
        {
          object: "Event",
          steps: [{ kind: "addField", field: "CreatedBy", defaultValue: null }],
        },
      ],
    });
    expect(model.migrations).toContainEqual({ from: "1.5.0", to: "1.6.0", objects: [] });
    // `1.6.0 -> 1.7.0` is an empty-object hop: `SetListForm`'s `Songs` child
    // collection gains `projectedFields`/`summary` (Phase 87), edit-section
    // content, not a stored field on any object.
    expect(model.migrations).toContainEqual({ from: "1.6.0", to: "1.7.0", objects: [] });
    // `1.7.0 -> 1.8.0` is an empty-object hop: read-model fields projected from
    // a `LOOKUP` field carry that lookup forward (Phase 91), which is resolved
    // content, not a stored field on any object.
    expect(model.migrations).toContainEqual({ from: "1.7.0", to: "1.8.0", objects: [] });
    // `1.8.0 -> 1.9.0` is an empty-object hop: the availability board's heading,
    // nav label and legend (Phase 92) are presentation and shell content, not
    // stored fields on any object.
    expect(model.migrations).toContainEqual({ from: "1.8.0", to: "1.9.0", objects: [] });
    // `1.9.0 -> 1.10.0` is an empty-object hop: `UserPolicy`'s narrowing to a
    // field-scoped read grant and `CurrentUserAvailability` dropping its `User`
    // source (Phase 101) are policy and read-model content, not stored fields
    // on any object.
    expect(model.migrations).toContainEqual({ from: "1.9.0", to: "1.10.0", objects: [] });
    // `1.10.0 -> 1.11.0` is an empty-object hop: the `APP` block declares
    // `REGISTRATION SELF_SERVICE` (Phase 99), which is resolved content and
    // moves the fingerprint, but is not a stored field on any object.
    expect(model.migrations).toContainEqual({ from: "1.10.0", to: "1.11.0", objects: [] });
    // `1.11.0 -> 1.12.0` is an empty-object hop: the shell gains the
    // `createFirstBand` `COMMAND_ACTION` control (Phase 99's onboarding
    // surface), which is shell content, not a stored field on any object.
    expect(model.migrations).toContainEqual({ from: "1.11.0", to: "1.12.0", objects: [] });

    const storage = new IndexedDbObjectStorageBackend({ databaseName });
    const persistedBand = storedRecord("Band", "band-before-explicit-nav", band.schemaVersion, {
      Name: "The Alphas",
    });
    await storage.create("Band", persistedBand);
    // An event persisted while `Event.SetList` still existed. The `1.3.0 ->
    // 1.4.0` hop has to drop that field, or the record keeps asserting a
    // lookup the model no longer declares.
    const persistedEvent = storedRecord(
      "Event",
      "event-before-set-list-link",
      event.schemaVersion,
      {
        Band: persistedBand.meta.guid,
        EventType: "Gig",
        Date: "2026-08-01",
        Title: "Canal Street headline",
        SetList: "setlist-before-1-4-0",
      },
    );
    await storage.create("Event", persistedEvent);
    await storage.writeApplicationMetadata({
      modelVersion: "1.0.0",
      // The precise old digest is immaterial once a declared migration moves
      // the version forward; its disagreement is what reproduced the blank
      // page before this migration existed.
      modelFingerprint: `sha256-${"0".repeat(64)}`,
    });

    const runtime = new ApplicationRuntime(model, { storage });
    await runtime.whenReady();

    expect(runtime.getStartupDiagnostics()).toContainEqual(
      expect.objectContaining({
        code: RUNTIME_STARTUP_COMPATIBILITY_CODES.MIGRATION_APPLIED,
        actual: "1.0.0",
        expected: "1.12.0",
      }),
    );
    expect(await storage.read("Band", persistedBand.meta.guid)).toEqual(persistedBand);
    const migratedEvent = await storage.read("Event", persistedEvent.meta.guid);
    expect(migratedEvent?.values).not.toHaveProperty("SetList");
    expect(migratedEvent?.values.Title).toBe("Canal Street headline");
    // The `1.4.0 -> 1.5.0` hop's own `ADD FIELD ... DEFAULT(null)`, applied in
    // the same chained migration as the `SetList` drop above.
    expect(migratedEvent?.values.CreatedBy).toBeNull();
    expect(migratedEvent?.meta.revision).toBe(persistedEvent.meta.revision);
    expect(await storage.readApplicationMetadata()).toEqual({
      modelVersion: "1.12.0",
      modelFingerprint: model.modelFingerprint,
    });
  });

  it("migrates persisted records on whenReady and loses none of them", async () => {
    installFakeIndexedDb();
    const databaseName = nextDatabaseName();
    const v1 = resolveApplicationModel(partialModelV1);
    const v11 = resolveApplicationModel(partialModelV11);
    await seedRecordStore(databaseName, v1, seedRecords());

    const before = await readStore(databaseName);
    expect(before.records).toHaveLength(4);

    const runtime = new ApplicationRuntime(v11, {
      storage: new IndexedDbObjectStorageBackend({ databaseName }),
    });
    await runtime.whenReady();

    expect(runtime.getStartupDiagnostics().map((diagnostic) => diagnostic.code)).toContain(
      RUNTIME_STARTUP_COMPATIBILITY_CODES.MIGRATION_APPLIED,
    );

    // Renamed, added, dropped — read back through the runtime, not the store.
    const migrated = await runtime.read("Customer", "customer-1", adminContext);
    expect(migrated?.values).toEqual({
      Name: "Ada Lovelace",
      EmailAddress: "ada@example.com",
      Tier: "standard",
    });
    expect(migrated?.meta.schemaVersion).toBe(2);
    // A migration is nobody's edit: revision and actors survive it untouched.
    expect(migrated?.meta.revision).toBe("rev-1");
    expect(migrated?.meta.updatedBy).toBe("admin-migration");

    // A record that already carried the added field keeps its own value.
    const withTier = await runtime.read("Customer", "customer-2", adminContext);
    expect(withTier?.values).toEqual({
      Name: "Grace Hopper",
      EmailAddress: "grace@example.com",
      Tier: "gold",
    });

    // A tombstone is persisted data too, and is migrated rather than dropped.
    const tombstones = await runtime.search(
      "Customer",
      { fields: ["Name"], includeDeleted: true },
      adminContext,
    );
    expect(tombstones).toHaveLength(3);
    const deleted = tombstones.find((record) => record.meta.guid === "customer-3");
    expect(deleted?.meta.deletedAt).toBe(fixedNow.toISOString());
    expect(deleted?.values).toEqual({
      Name: "Katherine Johnson",
      EmailAddress: "katherine@example.com",
      Tier: "standard",
    });
    expect(deleted?.meta.schemaVersion).toBe(2);

    // An object no step mentions is left exactly as it was found.
    const after = await readStore(databaseName);
    expect(after.records).toHaveLength(before.records.length);
    expect(findRecord(after.records, "Note", "note-1")).toEqual(
      findRecord(before.records, "Note", "note-1"),
    );
    expect(after.records.map((entry) => `${entry.objectName}/${entry.record.meta.guid}`)).toEqual(
      before.records.map((entry) => `${entry.objectName}/${entry.record.meta.guid}`),
    );
  });

  it("records the new version and fingerprint in the IndexedDB metadata entry", async () => {
    installFakeIndexedDb();
    const databaseName = nextDatabaseName();
    const v1 = resolveApplicationModel(partialModelV1);
    const v11 = resolveApplicationModel(partialModelV11);
    await seedRecordStore(databaseName, v1, seedRecords());

    await expect(readStore(databaseName).then((state) => state.metadata)).resolves.toEqual({
      modelVersion: "1.0.0",
      modelFingerprint: v1.modelFingerprint,
    });

    const runtime = new ApplicationRuntime(v11, {
      storage: new IndexedDbObjectStorageBackend({ databaseName }),
    });
    await runtime.whenReady();

    const after = await readStore(databaseName);
    expect(after.metadata).toEqual({
      modelVersion: "1.1.0",
      modelFingerprint: v11.modelFingerprint,
    });
    expect(after.metadata?.modelFingerprint).not.toBe(v1.modelFingerprint);
  });

  it("rolls the metadata entry back with the record writes when the migration transaction aborts", async () => {
    installFakeIndexedDb();
    const databaseName = nextDatabaseName();
    const v1 = resolveApplicationModel(partialModelV1);
    const v11 = resolveApplicationModel(partialModelV11);
    const seeded = seedRecords();
    await seedRecordStore(databaseName, v1, seeded);
    const before = await readStore(databaseName);

    // The fault is injected *after* the migration's own writes, which end with
    // the application-metadata row. So the metadata put has already been issued
    // into this transaction when the store aborts it. If that put lived in a
    // transaction of its own it would have committed and survived; asserting it
    // did not is what proves the two share one transaction.
    const storage = new AbortingMigrationStorage(
      { databaseName },
      findRecord(seeded, "Customer", "customer-1"),
    );
    const runtime = new ApplicationRuntime(v11, { storage });

    await expect(runtime.whenReady()).rejects.toBeInstanceOf(RuntimeStartupError);
    expect(runtime.getStartupDiagnostics().map((diagnostic) => diagnostic.code)).toContain(
      RUNTIME_STARTUP_COMPATIBILITY_CODES.MIGRATION_FAILED,
    );

    const after = await readStore(databaseName);
    expect(after.metadata).toEqual({
      modelVersion: "1.0.0",
      modelFingerprint: v1.modelFingerprint,
    });
    expect(after.records).toEqual(before.records);
    expect(after.records).toHaveLength(4);
  });

  it("refuses a version with no declared migration and deletes nothing", async () => {
    installFakeIndexedDb();
    const databaseName = nextDatabaseName();
    const v1 = resolveApplicationModel(partialModelV1);
    const unreachable = resolveApplicationModel(partialModelV11WithoutMigration);
    await seedRecordStore(databaseName, v1, seedRecords());
    const before = await readStore(databaseName);

    const runtime = new ApplicationRuntime(unreachable, {
      storage: new IndexedDbObjectStorageBackend({ databaseName }),
    });

    const error = await expectStartupRefusal(runtime);
    expect(error.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      MODEL_MIGRATION_CODES.VERSION_UNREACHABLE,
    );

    const after = await readStore(databaseName);
    // Nothing deleted: same count, same identities, same bytes, same metadata.
    expect(after.records).toHaveLength(4);
    expect(after.records).toHaveLength(before.records.length);
    expect(after.records).toEqual(before.records);
    expect(after.records.map((entry) => `${entry.objectName}/${entry.record.meta.guid}`)).toEqual([
      "Customer/customer-1",
      "Customer/customer-2",
      "Customer/customer-3",
      "Note/note-1",
    ]);
    expect(after.metadata).toEqual({
      modelVersion: "1.0.0",
      modelFingerprint: v1.modelFingerprint,
    });
    expect(after.storeKeys).toEqual(before.storeKeys);
  });

  it("refuses a stale fingerprint at an unchanged version and leaves the store untouched", async () => {
    installFakeIndexedDb();
    const databaseName = nextDatabaseName();
    const persistedBy = resolveApplicationModel(partialModelV1);
    const running = resolveApplicationModel(partialModelV1ShorterGrace);
    expect(running.modelVersion).toBe(persistedBy.modelVersion);
    expect(running.modelFingerprint).not.toBe(persistedBy.modelFingerprint);

    await seedRecordStore(databaseName, persistedBy, seedRecords());
    const before = await readStore(databaseName);

    const runtime = new ApplicationRuntime(running, {
      storage: new IndexedDbObjectStorageBackend({ databaseName }),
    });

    const error = await expectStartupRefusal(runtime);
    expect(error.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      RUNTIME_STARTUP_COMPATIBILITY_CODES.MODEL_FINGERPRINT_STALE,
    ]);

    const after = await readStore(databaseName);
    expect(after.records).toEqual(before.records);
    expect(after.metadata).toEqual({
      modelVersion: "1.0.0",
      modelFingerprint: persistedBy.modelFingerprint,
    });
    expect(after.storeKeys).toEqual(before.storeKeys);
  });

  it("leaves the cached session identity untouched by a successful and by a refused migration", async () => {
    installFakeIndexedDb();
    const v1 = resolveApplicationModel(partialModelV1);
    const v11 = resolveApplicationModel(partialModelV11);
    const unreachable = resolveApplicationModel(partialModelV11WithoutMigration);
    const identity = { userId: "user-casey", lastVerifiedAt: identityVerifiedAt };

    // A model version change is not a reason to sign anyone out. `{ userId,
    // lastVerifiedAt }` is what stops a signed-in user losing their own data on
    // an offline reload; clearing it during a persisted-state migration would
    // reintroduce the exact defect Phase 50 closed. It is not a record, it has
    // no schema, and it lives in its own database — so a migration has no
    // business reading or writing it in either direction.
    const migratedDatabase = nextDatabaseName();
    await seedRecordStore(migratedDatabase, v1, seedRecords());
    const migratedIdentityStore = new IndexedDbSessionIdentityStorage({
      databaseName: migratedDatabase,
    });
    await migratedIdentityStore.write(identity);

    const migrated = new ApplicationRuntime(v11, {
      storage: new IndexedDbObjectStorageBackend({ databaseName: migratedDatabase }),
    });
    await migrated.whenReady();

    await expect(migratedIdentityStore.read()).resolves.toEqual(identity);
    await expect(
      new IndexedDbSessionIdentityStorage({ databaseName: migratedDatabase }).read(),
    ).resolves.toEqual(identity);

    const refusedDatabase = nextDatabaseName();
    await seedRecordStore(refusedDatabase, v1, seedRecords());
    const refusedIdentityStore = new IndexedDbSessionIdentityStorage({
      databaseName: refusedDatabase,
    });
    await refusedIdentityStore.write(identity);

    const refused = new ApplicationRuntime(unreachable, {
      storage: new IndexedDbObjectStorageBackend({ databaseName: refusedDatabase }),
    });
    await expectStartupRefusal(refused);

    await expect(refusedIdentityStore.read()).resolves.toEqual(identity);
    await expect(
      new IndexedDbSessionIdentityStorage({ databaseName: refusedDatabase }).read(),
    ).resolves.toEqual(identity);
  });

  it("migrates pending sync-state patches without adding or removing operations or queue entries", async () => {
    installFakeIndexedDb();
    const databaseName = nextDatabaseName();
    const v1 = resolveApplicationModel(partialModelV1);
    const v11 = resolveApplicationModel(partialModelV11);
    await seedRecordStore(databaseName, v1, seedRecords());

    const patched = pendingUpdate();
    const unpatched = pendingDelete();
    const syncStateStorage = new IndexedDbSyncStateStorage({ databaseName });
    await syncStateStorage.write({
      modelVersion: "1.0.0",
      queue: [
        {
          queueId: `sync-${patched.opId}`,
          operation: patched,
          objectSync: requireObjectSync(v1, "Customer"),
        },
        {
          queueId: `sync-${unpatched.opId}`,
          operation: unpatched,
          objectSync: requireObjectSync(v1, "Customer"),
        },
      ],
      operations: [patched, unpatched],
    });

    const runtime = new ApplicationRuntime(v11, {
      storage: new IndexedDbObjectStorageBackend({ databaseName }),
      syncStateStorage: new IndexedDbSyncStateStorage({ databaseName }),
    });
    await runtime.whenReady();

    const operations = runtime.operationLog.getOperations();
    expect(operations).toHaveLength(2);
    expect(operations.map((operation) => operation.opId)).toEqual([patched.opId, unpatched.opId]);

    const migratedOperation = requireOperation(operations, patched.opId);
    expect(migratedOperation.patch).toEqual({
      Name: "Ada Lovelace",
      EmailAddress: "ada@new.example",
    });
    expect(migratedOperation.patch).not.toHaveProperty("Email");
    // `addField` is deliberately not backfilled into a patch: a patch is a set
    // of changes, and a default there would assert a change nobody made.
    expect(migratedOperation.patch).not.toHaveProperty("Tier");
    // Everything else about the operation is the user's intent, not the model's.
    expect({ ...migratedOperation, patch: undefined }).toEqual({ ...patched, patch: undefined });

    // An operation with no patch is returned unchanged, field for field.
    expect(requireOperation(operations, unpatched.opId)).toEqual(unpatched);

    const entries = runtime.syncQueue.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.queueId)).toEqual([
      `sync-${patched.opId}`,
      `sync-${unpatched.opId}`,
    ]);
    // The queue carries its own copy of the operation and the queue is what is
    // replayed, so a patch left at the old field names here would still reach
    // the authority naming a field the model no longer has.
    expect(entries[0]?.operation.patch).toEqual({
      Name: "Ada Lovelace",
      EmailAddress: "ada@new.example",
    });
    expect(entries[1]?.operation).toEqual(unpatched);

    const persisted = await syncStateStorage.read();
    expect(persisted?.modelVersion).toBe("1.1.0");
    expect(persisted?.operations).toHaveLength(2);
    expect(persisted?.queue).toHaveLength(2);
  });

  it("refuses persisted sync state at a version with no declared migration", async () => {
    installFakeIndexedDb();
    const databaseName = nextDatabaseName();
    const v1 = resolveApplicationModel(partialModelV1);
    const v11 = resolveApplicationModel(partialModelV11);

    // The record store is already current, so the only thing that can refuse
    // here is the sync state itself.
    await seedRecordStore(databaseName, v11, seedRecords(2));

    const stranded: PersistedSyncState = {
      modelVersion: "0.5.0",
      queue: [
        {
          queueId: "sync-op-9",
          operation: { ...pendingUpdate(), opId: "op-9" },
          objectSync: requireObjectSync(v1, "Customer"),
        },
      ],
      operations: [{ ...pendingUpdate(), opId: "op-9" }],
    };
    const syncStateStorage = new IndexedDbSyncStateStorage({ databaseName });
    await syncStateStorage.write(stranded);

    const runtime = new ApplicationRuntime(v11, {
      storage: new IndexedDbObjectStorageBackend({ databaseName }),
      syncStateStorage: new IndexedDbSyncStateStorage({ databaseName }),
    });

    const error = await expectStartupRefusal(runtime);
    expect(error.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "ADL_PERSISTED_SYNC_STATE_MODEL_VERSION_MISMATCH",
    ]);

    // Refusing must not consume the unsynced work it refused to migrate.
    await expect(syncStateStorage.read()).resolves.toEqual(stranded);
  });

  it("fabricates no audit event and no operation-log entry while migrating", async () => {
    installFakeIndexedDb();
    const databaseName = nextDatabaseName();
    const v1 = resolveApplicationModel(partialModelV1);
    const v11 = resolveApplicationModel(partialModelV11);
    await seedRecordStore(databaseName, v1, seedRecords());

    const patched = pendingUpdate();
    await new IndexedDbSyncStateStorage({ databaseName }).write({
      modelVersion: "1.0.0",
      queue: [
        {
          queueId: `sync-${patched.opId}`,
          operation: patched,
          objectSync: requireObjectSync(v1, "Customer"),
        },
      ],
      operations: [patched],
    });

    const runtime = new ApplicationRuntime(v11, {
      storage: new IndexedDbObjectStorageBackend({ databaseName }),
      syncStateStorage: new IndexedDbSyncStateStorage({ databaseName }),
    });
    await runtime.whenReady();

    // Three Customer records were rewritten by the migration. None of that is an
    // operation anyone performed, so none of it may appear as one.
    expect(runtime.auditService.getEvents()).toEqual([]);
    expect(runtime.operationLog.getOperations()).toHaveLength(1);
    expect(runtime.operationLog.getOperations()[0]?.opId).toBe(patched.opId);
    expect(runtime.syncQueue.getEntries()).toHaveLength(1);

    // And with no sync state at all, a migration produces neither from nothing.
    const bareDatabase = nextDatabaseName();
    await seedRecordStore(bareDatabase, v1, seedRecords());
    const bare = new ApplicationRuntime(v11, {
      storage: new IndexedDbObjectStorageBackend({ databaseName: bareDatabase }),
    });
    await bare.whenReady();

    expect(bare.auditService.getEvents()).toEqual([]);
    expect(bare.operationLog.getOperations()).toEqual([]);
    expect(bare.syncQueue.getEntries()).toEqual([]);
  });

  /**
   * Phase 61, browser half. A browser `ObjectStore` is constructed once per
   * session over records IndexedDB already holds, so the device is the place
   * where "a fresh runtime over persisted state" happens most often: every
   * reload is one. Until this phase the revision came from a counter seeded at
   * 1 in that constructor, so the second session over a record already at its
   * fourth version handed it a name that version had already worn — and the
   * `baseRevision` a queued write carries to the authority is whatever that
   * counter produced. The optimistic-concurrency check is equality, so a
   * reissued revision is a lost update nothing can detect afterwards.
   *
   * This case runs through the same real-IndexedDB store the migration cases
   * use, with the runtime replaced and the database name held still, because a
   * reload is exactly that and nothing less would prove it.
   */
  it("does not reissue a revision to a record an earlier session already wrote", async () => {
    installFakeIndexedDb();
    const databaseName = nextDatabaseName();
    const model = resolveApplicationModel(partialModelV1);

    const firstSession = new ApplicationRuntime(model, {
      storage: new IndexedDbObjectStorageBackend({ databaseName }),
    });
    const created = await firstSession.create(
      "Customer",
      { Name: "Ada Lovelace", Email: "ada@example.com" },
      adminContext,
    );
    const worn = [created.meta.revision];
    for (const email of ["ada@one.example", "ada@two.example", "ada@three.example"]) {
      const updated = await firstSession.update(
        "Customer",
        created.meta.guid,
        { Email: email },
        adminContext,
      );
      worn.push(updated.meta.revision);
    }
    // Four versions in the first session, four distinct names. The context
    // carries a frozen clock, so nothing here can be distinct by accident of
    // the wall time.
    expect(new Set(worn).size).toBe(worn.length);

    // The reload: a new runtime over a new connection to the same database,
    // holding nothing in memory from the session before it.
    const secondSession = new ApplicationRuntime(model, {
      storage: new IndexedDbObjectStorageBackend({ databaseName }),
    });
    await secondSession.whenReady();
    const afterReload = await secondSession.update(
      "Customer",
      created.meta.guid,
      { Email: "ada@four.example" },
      adminContext,
    );

    expect(worn).not.toContain(afterReload.meta.revision);
    expect(new Set([...worn, afterReload.meta.revision]).size).toBe(worn.length + 1);

    // What IndexedDB now holds is the new revision, and a third session reading
    // it back agrees — the value is persisted state, not a per-session artefact.
    const persisted = await readStore(databaseName);
    expect(findRecord(persisted.records, "Customer", created.meta.guid).record.meta.revision).toBe(
      afterReload.meta.revision,
    );
    const thirdSession = new ApplicationRuntime(model, {
      storage: new IndexedDbObjectStorageBackend({ databaseName }),
    });
    await expect(
      thirdSession.read("Customer", created.meta.guid, adminContext),
    ).resolves.toMatchObject({ meta: { revision: afterReload.meta.revision } });
  });
});

/**
 * An IndexedDB backend whose migration commit aborts after every write the
 * migration itself issued. `store.add` of a key that already exists raises a
 * `ConstraintError`, which aborts the whole IndexedDB transaction rather than
 * failing one request — the same mechanism a real storage fault would use.
 */
class AbortingMigrationStorage extends IndexedDbObjectStorageBackend {
  constructor(
    options: IndexedDbObjectStorageOptions,
    private readonly existing: PersistedObjectRecord,
  ) {
    super(options);
  }

  override async commitTransaction(writes: ObjectStorageTransactionWrite[]): Promise<void> {
    await super.commitTransaction([
      ...writes,
      {
        operation: "create",
        objectName: this.existing.objectName,
        record: this.existing.record,
      },
    ]);
  }
}

function seedRecords(schemaVersion = 1): PersistedObjectRecord[] {
  const emailField = schemaVersion === 1 ? "Email" : "EmailAddress";
  return [
    {
      objectName: "Customer",
      record: storedRecord("Customer", "customer-1", schemaVersion, {
        Name: "Ada Lovelace",
        [emailField]: "ada@example.com",
        ...(schemaVersion === 1 ? { LegacyPhone: "555-0100" } : { Tier: "standard" }),
      }),
    },
    {
      objectName: "Customer",
      record: storedRecord("Customer", "customer-2", schemaVersion, {
        Name: "Grace Hopper",
        [emailField]: "grace@example.com",
        Tier: "gold",
      }),
    },
    {
      objectName: "Customer",
      record: {
        ...storedRecord("Customer", "customer-3", schemaVersion, {
          Name: "Katherine Johnson",
          [emailField]: "katherine@example.com",
          ...(schemaVersion === 1 ? { LegacyPhone: "555-0102" } : { Tier: "standard" }),
        }),
        meta: {
          ...storedRecord("Customer", "customer-3", schemaVersion, {}).meta,
          deletedAt: fixedNow.toISOString(),
          deletedBy: "admin-migration",
        },
      },
    },
    {
      objectName: "Note",
      record: storedRecord("Note", "note-1", 1, { Title: "Untouched by any step" }),
    },
  ];
}

function storedRecord(
  objectName: string,
  guid: string,
  schemaVersion: number,
  values: Record<string, string>,
): StoredObjectRecord {
  return {
    meta: {
      guid,
      object: objectName,
      schemaVersion,
      revision: "rev-1",
      createdAt: fixedNow.toISOString(),
      createdBy: "admin-migration",
      updatedAt: fixedNow.toISOString(),
      updatedBy: "admin-migration",
      syncStatus: "local",
    },
    values,
  };
}

function pendingUpdate(): LocalOperation {
  return {
    opId: "op-1",
    object: "Customer",
    recordId: "customer-1",
    baseRevision: "rev-1",
    operation: "update",
    patch: { Name: "Ada Lovelace", Email: "ada@new.example" },
    createdAt: fixedNow.toISOString(),
    createdBy: "admin-migration",
    contextSnapshot: { roles: ["Admin"], channel: "ui" },
    status: "pending",
  };
}

function pendingDelete(): LocalOperation {
  return {
    opId: "op-2",
    object: "Customer",
    recordId: "customer-3",
    baseRevision: "rev-1",
    operation: "delete",
    createdAt: fixedNow.toISOString(),
    createdBy: "admin-migration",
    contextSnapshot: { roles: ["Admin"], channel: "ui" },
    status: "pending",
  };
}

async function seedRecordStore(
  databaseName: string,
  model: ResolvedApplicationModel,
  records: PersistedObjectRecord[],
): Promise<void> {
  const storage = new IndexedDbObjectStorageBackend({ databaseName });
  for (const persisted of records) {
    await storage.create(persisted.objectName, persisted.record);
  }
  await storage.writeApplicationMetadata({
    modelVersion: model.modelVersion,
    modelFingerprint: model.modelFingerprint,
  });
}

interface StoreState {
  records: PersistedObjectRecord[];
  metadata: PersistedApplicationMetadata | null;
  storeKeys: string[];
}

/** Everything the record database holds, read through a fresh connection. */
async function readStore(databaseName: string): Promise<StoreState> {
  const storage = new IndexedDbObjectStorageBackend({ databaseName });
  const [records, metadata] = await Promise.all([
    storage.listRecords(),
    storage.readApplicationMetadata(),
  ]);

  return {
    records: [...records].sort((left, right) =>
      recordKey(left) < recordKey(right) ? -1 : recordKey(left) > recordKey(right) ? 1 : 0,
    ),
    metadata,
    storeKeys: await readRawKeys(databaseName),
  };
}

/**
 * The raw IndexedDB keys, including the application-metadata row, so a case can
 * assert that a refusal deleted no entry of any kind rather than only no record.
 */
function readRawKeys(databaseName: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const open = globalThis.indexedDB.open(databaseName);
    open.onerror = () => reject(new Error("Failed to open the record database."));
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction("objectRecords", "readonly");
      const keys = transaction.objectStore("objectRecords").getAllKeys();
      keys.onerror = () => reject(new Error("Failed to read record keys."));
      keys.onsuccess = () => {
        resolve([...(keys.result as IDBValidKey[])].map(String).sort());
      };
    };
  });
}

function recordKey(persisted: PersistedObjectRecord): string {
  return `${persisted.objectName}/${persisted.record.meta.guid}`;
}

function findRecord(
  records: PersistedObjectRecord[],
  objectName: string,
  guid: string,
): PersistedObjectRecord {
  const found = records.find(
    (entry) => entry.objectName === objectName && entry.record.meta.guid === guid,
  );
  if (found === undefined) {
    throw new Error(`Expected the store to hold '${objectName}/${guid}'.`);
  }

  return found;
}

function requireOperation(operations: LocalOperation[], opId: string): LocalOperation {
  const found = operations.find((operation) => operation.opId === opId);
  if (found === undefined) {
    throw new Error(`Expected the operation log to hold '${opId}'.`);
  }

  return found;
}

function requireObjectSync(
  model: ResolvedApplicationModel,
  objectName: string,
): ResolvedApplicationModel["objects"][number]["sync"] {
  const object = model.objects.find((candidate) => candidate.name === objectName);
  if (object === undefined) {
    throw new Error(`Expected the model to declare '${objectName}'.`);
  }

  return object.sync;
}

async function expectStartupRefusal(runtime: ApplicationRuntime): Promise<RuntimeStartupError> {
  try {
    await runtime.whenReady();
  } catch (error) {
    if (error instanceof RuntimeStartupError) {
      return error;
    }

    throw error;
  }

  throw new Error("Expected startup to refuse persisted state.");
}

function allowAdmin(objectName: string): PartialPolicyModel {
  return {
    name: `${objectName}Policy`,
    object: objectName,
    rules: [
      {
        name: `allowAdmin${objectName}Ops`,
        effect: "allow",
        principal: { match: "specific", roles: ["Admin"] },
        action: "*",
      },
    ],
  };
}

function installFakeIndexedDb(): void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: fakeIndexedDB,
  });
  restoreIndexedDb = () => {
    if (descriptor === undefined) {
      Reflect.deleteProperty(globalThis, "indexedDB");
      return;
    }

    Object.defineProperty(globalThis, "indexedDB", descriptor);
  };
}

function nextDatabaseName(): string {
  return `adl-browser-migration-test-${nextDatabaseId++}`;
}
