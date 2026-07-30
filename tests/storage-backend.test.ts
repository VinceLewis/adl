import { afterEach, describe, expect, it } from "vitest";
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";
import {
  ApplicationRuntime,
  IndexedDbObjectStorageBackend,
  IndexedDbSyncStateStorage,
  InMemoryObjectStorageBackend,
  StorageError,
  resolveApplicationModel,
} from "../src/index.js";
import type {
  PartialApplicationModel,
  ResolvedObject,
  RuntimeContext,
  StoredObjectRecord,
} from "../src/index.js";

const fixedNow = new Date("2026-07-07T08:00:00.000Z");
let restoreIndexedDb: (() => void) | undefined;
let nextDatabaseId = 1;

const adminContext: RuntimeContext = {
  userId: "admin-storage",
  roles: ["Admin"],
  channel: "api",
  now: fixedNow,
};

const storagePartialModel = {
  app: {
    name: "StorageDemo",
  },
  roles: [{ name: "Admin" }],
  objects: [
    {
      name: "Customer",
      schemaVersion: 7,
      businessKey: "Email",
      displayField: "Name",
      fields: [
        { name: "Name", type: "text", required: true },
        { name: "Email", type: "text", required: true },
      ],
    },
  ],
  policies: [
    {
      name: "CustomerPolicy",
      object: "Customer",
      rules: [
        {
          name: "allowAdminCustomerOps",
          effect: "allow",
          principal: { match: "specific", roles: ["Admin"] },
          action: "*",
        },
      ],
    },
  ],
} satisfies PartialApplicationModel;

describe("object storage backends", () => {
  afterEach(() => {
    restoreIndexedDb?.();
    restoreIndexedDb = undefined;
  });

  it("stores independent in-memory records and retains tombstones", async () => {
    const model = resolveApplicationModel(storagePartialModel);
    const object = requireObject(model.objects[0]);
    const storage = new InMemoryObjectStorageBackend();
    const record = createStoredRecord(object);

    await storage.create("Customer", record);

    const read = await storage.read("Customer", record.meta.guid);
    expect(read).toEqual(record);
    expect(read?.meta.schemaVersion).toBe(7);

    if (read === null) {
      throw new Error("Expected in-memory storage to return the created record.");
    }
    read.values.Name = "Mutated read clone";
    await expect(storage.read("Customer", record.meta.guid)).resolves.toMatchObject({
      values: {
        Name: "Ada Lovelace",
      },
    });

    await expect(
      storage.search({
        object,
        fields: ["Email"],
        text: "lovelace",
      }),
    ).resolves.toHaveLength(0);
    await expect(
      storage.search({
        object,
        fields: ["Name"],
        text: "lovelace",
      }),
    ).resolves.toHaveLength(1);

    await expect(storage.delete("Customer", record)).rejects.toBeInstanceOf(StorageError);

    const tombstone = {
      ...record,
      meta: {
        ...record.meta,
        revision: "rev-2",
        deletedAt: fixedNow.toISOString(),
        deletedBy: "admin-storage",
      },
    };
    await storage.delete("Customer", tombstone);

    await expect(
      storage.search({
        object,
        fields: ["Name"],
        text: "lovelace",
      }),
    ).resolves.toHaveLength(0);
    await expect(
      storage.search({
        object,
        fields: ["Name"],
        text: "lovelace",
        includeDeleted: true,
      }),
    ).resolves.toEqual([tombstone]);
  });

  it("persists runtime records across IndexedDB-backed runtime instances", async () => {
    installFakeIndexedDb();
    const databaseName = nextDatabaseName();
    const model = resolveApplicationModel(storagePartialModel);
    const firstRuntime = new ApplicationRuntime(model, {
      storage: new IndexedDbObjectStorageBackend({ databaseName }),
    });

    const created = await firstRuntime.create(
      "Customer",
      {
        Name: "Grace Hopper",
        Email: "grace@example.com",
      },
      adminContext,
    );
    expect(created.meta.schemaVersion).toBe(7);
    await expect(
      new IndexedDbObjectStorageBackend({ databaseName }).readApplicationMetadata(),
    ).resolves.toEqual({
      modelVersion: model.modelVersion,
      modelFingerprint: model.modelFingerprint,
    });

    const reloadedRuntime = new ApplicationRuntime(model, {
      storage: new IndexedDbObjectStorageBackend({ databaseName }),
    });
    await expect(
      reloadedRuntime.read("Customer", created.meta.guid, adminContext),
    ).resolves.toMatchObject({
      values: {
        Name: "Grace Hopper",
        Email: "grace@example.com",
      },
      meta: {
        guid: created.meta.guid,
        schemaVersion: 7,
      },
    });

    await expect(
      reloadedRuntime.search("Customer", { text: "grace", fields: ["Email"] }, adminContext),
    ).resolves.toHaveLength(1);
    await expect(
      reloadedRuntime.search("Customer", { text: "Hopper", fields: ["Email"] }, adminContext),
    ).resolves.toHaveLength(0);

    const deleted = await reloadedRuntime.delete("Customer", created.meta.guid, adminContext);
    expect(deleted.meta.deletedAt).toBe(fixedNow.toISOString());

    const finalRuntime = new ApplicationRuntime(model, {
      storage: new IndexedDbObjectStorageBackend({ databaseName }),
    });
    await expect(
      finalRuntime.read("Customer", created.meta.guid, adminContext),
    ).resolves.toBeNull();
    await expect(
      finalRuntime.search("Customer", { fields: ["Name"], includeDeleted: true }, adminContext),
    ).resolves.toMatchObject([
      {
        meta: {
          guid: created.meta.guid,
          deletedAt: fixedNow.toISOString(),
          schemaVersion: 7,
        },
      },
    ]);
  });

  it("persists local-first queue and operation reconciliation state separately from records", async () => {
    installFakeIndexedDb();
    const databaseName = nextDatabaseName();
    const model = resolveApplicationModel(storagePartialModel);
    const syncState = new IndexedDbSyncStateStorage({ databaseName });
    const first = new ApplicationRuntime(model, {
      storage: new IndexedDbObjectStorageBackend({ databaseName }),
      syncStateStorage: syncState,
    });
    await first.create("Customer", { Name: "Queued", Email: "queued@example.com" }, adminContext);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await syncState.read())?.queue).toHaveLength(1);
    const second = new ApplicationRuntime(model, {
      storage: new IndexedDbObjectStorageBackend({ databaseName }),
      syncStateStorage: new IndexedDbSyncStateStorage({ databaseName }),
    });
    await second.whenReady();
    expect(second.syncQueue.getEntries()).toHaveLength(1);
    second.operationLog.setStatus("op-1", "accepted");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await syncState.read())?.operations[0]?.status).toBe("accepted");
  });

  it("commits IndexedDB transaction writes atomically", async () => {
    installFakeIndexedDb();
    const databaseName = nextDatabaseName();
    const model = resolveApplicationModel(storagePartialModel);
    const object = requireObject(model.objects[0]);
    const storage = new IndexedDbObjectStorageBackend({ databaseName });
    const first = createStoredRecord(object);
    const second = createStoredRecord(object, "customer-2", {
      Name: "Grace Hopper",
      Email: "grace@example.com",
    });

    await expect(
      storage.commitTransaction?.([
        { operation: "create", objectName: "Customer", record: first },
        { operation: "create", objectName: "Customer", record: second },
      ]),
    ).resolves.toBeUndefined();

    await expect(
      storage.search({
        object,
        fields: ["Name"],
      }),
    ).resolves.toHaveLength(2);

    const duplicate = createStoredRecord(object, "customer-3", {
      Name: "Duplicate",
      Email: "duplicate@example.com",
    });
    const updatedSecond = {
      ...second,
      meta: {
        ...second.meta,
        revision: "rev-2",
      },
      values: {
        ...second.values,
        Name: "Updated before duplicate",
      },
    };

    await expect(
      storage.commitTransaction?.([
        { operation: "update", objectName: "Customer", record: updatedSecond },
        { operation: "create", objectName: "Customer", record: duplicate },
        { operation: "create", objectName: "Customer", record: duplicate },
      ]),
    ).rejects.toBeInstanceOf(StorageError);

    await expect(storage.read("Customer", second.meta.guid)).resolves.toMatchObject({
      values: {
        Name: "Grace Hopper",
      },
    });
    await expect(storage.read("Customer", duplicate.meta.guid)).resolves.toBeNull();
  });

  /**
   * The test above fails through a duplicate `add`, which is a *request* error
   * and aborts the IndexedDB transaction on its own. A refusal the backend
   * raises itself — a missing update target, a delete without a tombstone — used
   * to throw straight out of `commitTransaction` with no `abort()`, leaving
   * IndexedDB free to auto-commit the writes already issued. The caller saw a
   * rejection over a partially applied batch, which is exactly the state a
   * migration's own diagnostic promises cannot happen.
   */
  it("rolls back earlier writes when it refuses a later one itself", async () => {
    installFakeIndexedDb();
    const databaseName = nextDatabaseName();
    const model = resolveApplicationModel(storagePartialModel);
    const object = requireObject(model.objects[0]);
    const storage = new IndexedDbObjectStorageBackend({ databaseName });
    const existing = createStoredRecord(object);
    await storage.create("Customer", existing);

    const rewritten = {
      ...existing,
      meta: { ...existing.meta, revision: "rev-2" },
      values: { ...existing.values, Name: "PARTIALLY COMMITTED" },
    };
    const absent = createStoredRecord(object, "customer-missing", {
      Name: "Never stored",
      Email: "missing@example.com",
    });

    await expect(
      storage.commitTransaction?.([
        { operation: "update", objectName: "Customer", record: rewritten },
        { operation: "update", objectName: "Customer", record: absent },
      ]),
    ).rejects.toBeInstanceOf(StorageError);

    await expect(storage.read("Customer", existing.meta.guid)).resolves.toMatchObject({
      values: { Name: "Ada Lovelace" },
    });
  });

  it("rolls back earlier writes when it refuses a delete carrying no tombstone", async () => {
    installFakeIndexedDb();
    const databaseName = nextDatabaseName();
    const model = resolveApplicationModel(storagePartialModel);
    const object = requireObject(model.objects[0]);
    const storage = new IndexedDbObjectStorageBackend({ databaseName });
    const existing = createStoredRecord(object);
    await storage.create("Customer", existing);

    const rewritten = {
      ...existing,
      meta: { ...existing.meta, revision: "rev-2" },
      values: { ...existing.values, Name: "PARTIALLY COMMITTED" },
    };

    await expect(
      storage.commitTransaction?.([
        { operation: "update", objectName: "Customer", record: rewritten },
        { operation: "delete", objectName: "Customer", record: existing },
      ]),
    ).rejects.toBeInstanceOf(StorageError);

    await expect(storage.read("Customer", existing.meta.guid)).resolves.toMatchObject({
      values: { Name: "Ada Lovelace" },
    });
  });
});

function createStoredRecord(
  object: ResolvedObject,
  guid = "customer-1",
  values: Record<string, string> = {
    Name: "Ada Lovelace",
    Email: "ada@example.com",
  },
): StoredObjectRecord {
  return {
    meta: {
      guid,
      object: object.name,
      schemaVersion: object.schemaVersion,
      revision: "rev-1",
      createdAt: fixedNow.toISOString(),
      createdBy: "admin-storage",
      updatedAt: fixedNow.toISOString(),
      updatedBy: "admin-storage",
      syncStatus: "local",
    },
    values,
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
  return `adl-storage-test-${nextDatabaseId++}`;
}

function requireObject(object: ResolvedObject | undefined): ResolvedObject {
  if (object === undefined) {
    throw new Error("Expected resolved storage model to contain a Customer object.");
  }

  return object;
}
