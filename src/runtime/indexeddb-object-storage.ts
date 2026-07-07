import type { StoredObjectRecord } from "../model/resolved-model.js";
import type { ObjectStorageBackend, ObjectStorageSearchRequest } from "./object-storage-backend.js";
import { recordMatchesSearch } from "./object-storage-backend.js";
import { StorageError, cloneJson } from "./runtime-types.js";

export interface IndexedDbObjectStorageOptions {
  databaseName?: string;
  storeName?: string;
  version?: number;
}

interface IndexedDbStoredRecord {
  key: string;
  object: string;
  guid: string;
  record: StoredObjectRecord;
}

const DEFAULT_DATABASE_NAME = "adl-runtime";
const DEFAULT_STORE_NAME = "objectRecords";

export class IndexedDbObjectStorageBackend implements ObjectStorageBackend {
  private readonly databaseName: string;
  private readonly storeName: string;
  private readonly version: number;
  private dbPromise: Promise<IDBDatabase> | undefined;

  constructor(options: IndexedDbObjectStorageOptions = {}) {
    this.databaseName = options.databaseName ?? DEFAULT_DATABASE_NAME;
    this.storeName = options.storeName ?? DEFAULT_STORE_NAME;
    this.version = options.version ?? 1;
  }

  async create(objectName: string, record: StoredObjectRecord): Promise<void> {
    await this.write(objectName, record, "create");
  }

  async read(objectName: string, id: string): Promise<StoredObjectRecord | null> {
    const db = await this.openDatabase();
    const transaction = db.transaction(this.storeName, "readonly");
    const store = transaction.objectStore(this.storeName);
    const stored = await requestToPromise<IndexedDbStoredRecord | undefined>(
      store.get(recordKey(objectName, id)),
      "read record",
    );
    await transactionDone(transaction, "read record");

    return stored === undefined ? null : cloneJson(stored.record);
  }

  async update(objectName: string, record: StoredObjectRecord): Promise<void> {
    await this.requireStoredRecord(objectName, record.meta.guid);
    await this.write(objectName, record, "update");
  }

  async delete(objectName: string, tombstone: StoredObjectRecord): Promise<void> {
    if (tombstone.meta.deletedAt === undefined) {
      throw new StorageError(
        `Delete for record '${tombstone.meta.guid}' on object '${objectName}' must persist a tombstone.`,
        {
          objectName,
          id: tombstone.meta.guid,
        },
      );
    }

    await this.update(objectName, tombstone);
  }

  async search(request: ObjectStorageSearchRequest): Promise<StoredObjectRecord[]> {
    const records = await this.readObjectRecords(request.object.name);
    return records
      .filter((record) => request.includeDeleted === true || record.meta.deletedAt === undefined)
      .filter((record) => recordMatchesSearch(record, request.fields, request.text))
      .map((record) => cloneJson(record));
  }

  private async write(
    objectName: string,
    record: StoredObjectRecord,
    operation: "create" | "update",
  ): Promise<void> {
    const db = await this.openDatabase();
    const transaction = db.transaction(this.storeName, "readwrite");
    const store = transaction.objectStore(this.storeName);
    const stored = toIndexedDbRecord(objectName, record);
    const request = operation === "create" ? store.add(stored) : store.put(stored);

    await requestToPromise(request, `${operation} record`);
    await transactionDone(transaction, `${operation} record`);
  }

  private async requireStoredRecord(objectName: string, id: string): Promise<void> {
    const record = await this.read(objectName, id);
    if (record === null) {
      throw new StorageError(`Record '${id}' for object '${objectName}' is missing.`, {
        objectName,
        id,
      });
    }
  }

  private async readObjectRecords(objectName: string): Promise<StoredObjectRecord[]> {
    const db = await this.openDatabase();
    const transaction = db.transaction(this.storeName, "readonly");
    const store = transaction.objectStore(this.storeName);
    const index = store.index("object");
    const stored = await requestToPromise<IndexedDbStoredRecord[]>(
      index.getAll(objectName),
      "search records",
    );
    await transactionDone(transaction, "search records");

    return stored.map((entry) => cloneJson(entry.record));
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (this.dbPromise !== undefined) {
      return this.dbPromise;
    }

    if (globalThis.indexedDB === undefined) {
      throw new StorageError("IndexedDB is not available in this runtime.");
    }

    this.dbPromise = new Promise((resolve, reject) => {
      const request = globalThis.indexedDB.open(this.databaseName, this.version);

      request.onupgradeneeded = () => {
        const db = request.result;
        const store = db.objectStoreNames.contains(this.storeName)
          ? request.transaction?.objectStore(this.storeName)
          : db.createObjectStore(this.storeName, { keyPath: "key" });

        if (store === undefined) {
          reject(new StorageError("IndexedDB upgrade did not provide an object store."));
          return;
        }

        if (!store.indexNames.contains("object")) {
          store.createIndex("object", "object", { unique: false });
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        this.dbPromise = undefined;
        reject(toStorageError("Failed to open IndexedDB database.", request.error));
      };

      request.onblocked = () => {
        reject(
          new StorageError("Opening IndexedDB was blocked by another connection.", {
            databaseName: this.databaseName,
          }),
        );
      };
    });

    return this.dbPromise;
  }
}

function toIndexedDbRecord(objectName: string, record: StoredObjectRecord): IndexedDbStoredRecord {
  return {
    key: recordKey(objectName, record.meta.guid),
    object: objectName,
    guid: record.meta.guid,
    record: cloneJson(record),
  };
}

function recordKey(objectName: string, id: string): string {
  return `${objectName}\u0000${id}`;
}

function requestToPromise<T>(request: IDBRequest<T>, action: string): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(toStorageError(`IndexedDB failed to ${action}.`, request.error));
    };
  });
}

function transactionDone(transaction: IDBTransaction, action: string): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => {
      resolve();
    };

    transaction.onabort = () => {
      reject(toStorageError(`IndexedDB aborted while attempting to ${action}.`, transaction.error));
    };

    transaction.onerror = () => {
      reject(toStorageError(`IndexedDB failed while attempting to ${action}.`, transaction.error));
    };
  });
}

function toStorageError(message: string, error: DOMException | null): StorageError {
  return new StorageError(message, {
    name: error?.name,
    message: error?.message,
  });
}
