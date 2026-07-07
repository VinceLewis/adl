import { afterEach, describe, expect, it } from "vitest";
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";
import {
  ApplicationRuntime,
  IndexedDbObjectStorageBackend,
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
});

function createStoredRecord(object: ResolvedObject): StoredObjectRecord {
  return {
    meta: {
      guid: "customer-1",
      object: object.name,
      schemaVersion: object.schemaVersion,
      revision: "rev-1",
      createdAt: fixedNow.toISOString(),
      createdBy: "admin-storage",
      updatedAt: fixedNow.toISOString(),
      updatedBy: "admin-storage",
      syncStatus: "local",
    },
    values: {
      Name: "Ada Lovelace",
      Email: "ada@example.com",
    },
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
