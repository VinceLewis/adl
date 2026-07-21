import type { LocalOperation } from "../model/resolved-model.js";
import { StorageError, cloneJson } from "./runtime-types.js";
import type { SyncQueueEntry } from "./sync-queue.js";

export interface PersistedSyncState {
  modelVersion: string;
  queue: SyncQueueEntry[];
  operations: LocalOperation[];
}

export interface SyncStateStorage {
  read(): Promise<PersistedSyncState | null>;
  write(state: PersistedSyncState): Promise<void>;
}

export class InMemorySyncStateStorage implements SyncStateStorage {
  private state: PersistedSyncState | null = null;
  async read(): Promise<PersistedSyncState | null> {
    return this.state === null ? null : cloneJson(this.state);
  }
  async write(state: PersistedSyncState): Promise<void> {
    this.state = cloneJson(state);
  }
}

export interface IndexedDbSyncStateStorageOptions {
  databaseName?: string;
  storeName?: string;
  version?: number;
}

const DEFAULT_DATABASE_NAME = "adl-runtime-sync-state";
const DEFAULT_STORE_NAME = "syncState";
const STATE_KEY = "__adl_sync_state";

/** Browser protocol state is intentionally separate from persisted object records. */
export class IndexedDbSyncStateStorage implements SyncStateStorage {
  private readonly databaseName: string;
  private readonly storeName: string;
  private readonly version: number;
  private dbPromise: Promise<IDBDatabase> | undefined;

  constructor(options: IndexedDbSyncStateStorageOptions = {}) {
    this.databaseName =
      options.databaseName === undefined
        ? DEFAULT_DATABASE_NAME
        : `${options.databaseName}-sync-state`;
    this.storeName = options.storeName ?? DEFAULT_STORE_NAME;
    this.version = options.version ?? 1;
  }

  async read(): Promise<PersistedSyncState | null> {
    const db = await this.open();
    const tx = db.transaction(this.storeName, "readonly");
    const value = await request<PersistedSyncState | undefined>(
      tx.objectStore(this.storeName).get(STATE_KEY),
    );
    await done(tx);
    return value === undefined ? null : cloneJson(value);
  }

  async write(state: PersistedSyncState): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(this.storeName, "readwrite");
    await request(tx.objectStore(this.storeName).put(cloneJson(state), STATE_KEY));
    await done(tx);
  }

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise !== undefined) return this.dbPromise;
    if (globalThis.indexedDB === undefined)
      throw new StorageError("IndexedDB is not available in this runtime.");
    this.dbPromise = new Promise((resolve, reject) => {
      const open = globalThis.indexedDB.open(this.databaseName, this.version);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains(this.storeName))
          open.result.createObjectStore(this.storeName);
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () =>
        reject(
          new StorageError("Failed to open IndexedDB sync state.", { cause: open.error?.message }),
        );
    });
    return this.dbPromise;
  }
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () =>
      reject(
        new StorageError("IndexedDB sync-state request failed.", { cause: value.error?.message }),
      );
  });
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(
        new StorageError("IndexedDB sync-state transaction failed.", { cause: tx.error?.message }),
      );
  });
}
