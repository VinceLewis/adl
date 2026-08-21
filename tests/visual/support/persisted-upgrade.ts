import type { Page } from "@playwright/test";

/**
 * Persisted-state upgrade test support.
 *
 * Extracted from Giggle Band's hand-authored "opens and migrates a
 * persisted pre-explicit-navigation installation" test (03c41b8) so
 * Jointly Care and the generic persistent browser demo can reuse the same
 * IndexedDB seeding and readback instead of re-deriving it. See
 * AGENTS.md's "Persisted-state upgrade testing" subsection for when a test
 * built on this helper is required, and
 * learnings/implementation/model-versions-and-migrations.md for the
 * mechanism these tests exercise end to end.
 *
 * The schema written and read here -- an "objectRecords" object store
 * keyed by "key", indexed by "object", with the application metadata row
 * keyed by "__adl_application_metadata" -- is not an approximation: it is
 * the same schema IndexedDbObjectStorageBackend
 * (src/runtime/indexeddb-object-storage.ts) creates and reads itself.
 *
 * Deliberately does not import any reference app's model factory
 * (`band-app.ts`, `jointly-app.ts`, `demo-fixture.ts`): those transitively
 * import `?raw` ADL/YAML sources through Vite's loader, which the
 * Playwright test runner's own module loader does not understand, and
 * spec files that tried it failed to even parse. Everything a test needs
 * -- the current model version, real seeded records -- is read out of the
 * real, already-mounted app in the page instead (see the three spec files
 * that use this helper for the pattern).
 */

const OBJECT_RECORDS_STORE_NAME = "objectRecords";
const APPLICATION_METADATA_KEY = "__adl_application_metadata";

export interface StalePersistedMetadata {
  modelVersion: string;
  modelFingerprint: string;
}

/**
 * One real persisted object record to seed alongside the stale metadata,
 * proving a migration preserves (or correctly rewrites) actual data rather
 * than only advancing a version number. `key` must be the storage
 * backend's own key shape (object name, a NUL byte, then the record's
 * guid), and `record` should be an actual StoredObjectRecord
 * (`{ meta, values }`), not a hand-typed approximation of one.
 */
export interface StaleSeedRecord {
  key: string;
  object: string;
  record: unknown;
}

export interface SeedStalePersistedInstallationOptions {
  dbName: string;
  staleMetadata: StalePersistedMetadata;
  seedRecords?: StaleSeedRecord[];
}

/**
 * Reproduces a real pre-upgrade browser installation from nothing: deletes
 * and recreates `dbName`, then writes the *previous* version's application
 * metadata and (optionally) real object records, using the same store/key
 * shape the app's own `IndexedDbObjectStorageBackend` writes.
 *
 * The caller must run this while the page is at an origin whose app has not
 * already opened `dbName` through its own runtime -- otherwise the app's
 * own startup races this seeding. Navigate to a URL that mounts a
 * different app (or no app) first, seed here, then load the actual app URL
 * that owns `dbName`.
 *
 * For an app that already has a real seeded dataset and only needs its
 * metadata rolled back, prefer `downgradePersistedApplicationMetadata`
 * instead: it proves every persisted record survives, not just the one or
 * two a test author remembered to hand-seed here.
 */
export async function seedStalePersistedInstallation(
  page: Page,
  options: SeedStalePersistedInstallationOptions,
): Promise<void> {
  const { dbName, staleMetadata, seedRecords = [] } = options;

  await page.evaluate(
    async (args) => {
      const { dbName, staleMetadata, seedRecords, storeName, metadataKey } = args;

      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(dbName);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error(`Database '${dbName}' deletion was blocked.`));
      });

      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = () => {
          const store = request.result.createObjectStore(storeName, { keyPath: "key" });
          store.createIndex("object", "object", { unique: false });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      const transaction = db.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      store.put({
        kind: "applicationMetadata",
        key: metadataKey,
        object: metadataKey,
        metadata: staleMetadata,
      });
      for (const seedRecord of seedRecords) {
        store.put({
          kind: "record",
          key: seedRecord.key,
          object: seedRecord.object,
          record: seedRecord.record,
        });
      }

      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      db.close();
    },
    {
      dbName,
      staleMetadata,
      seedRecords,
      storeName: OBJECT_RECORDS_STORE_NAME,
      metadataKey: APPLICATION_METADATA_KEY,
    },
  );
}

/**
 * Rolls back only the application metadata row of an *existing* database,
 * leaving every already-persisted record untouched -- reproducing a real
 * installation that was seeded under an old version and never migrated,
 * without a test having to hand-construct any record itself.
 *
 * Run this against a database the real app already populated (load the
 * app normally first, let it seed), then reload the app: the startup
 * compatibility guard sees the rolled-back metadata, applies the real
 * declared migration, and every record the app seeded is available to
 * prove byte-identical survival with `readAllPersistedRecords`.
 */
export async function downgradePersistedApplicationMetadata(
  page: Page,
  dbName: string,
  staleMetadata: StalePersistedMetadata,
): Promise<void> {
  await page.evaluate(
    async (args) => {
      const { dbName, staleMetadata, storeName, metadataKey } = args;

      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      const transaction = db.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).put({
        kind: "applicationMetadata",
        key: metadataKey,
        object: metadataKey,
        metadata: staleMetadata,
      });

      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      db.close();
    },
    {
      dbName,
      staleMetadata,
      storeName: OBJECT_RECORDS_STORE_NAME,
      metadataKey: APPLICATION_METADATA_KEY,
    },
  );
}

/** Reads back the application metadata row a real app run left behind. */
export async function readPersistedApplicationMetadata(
  page: Page,
  dbName: string,
): Promise<{ modelVersion?: string; modelFingerprint?: string } | undefined> {
  return page.evaluate(
    async (args) => {
      const { dbName, storeName, metadataKey } = args;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const transaction = db.transaction(storeName, "readonly");
      const request = transaction.objectStore(storeName).get(metadataKey);
      const entry = await new Promise<{ metadata?: { modelVersion?: string } } | undefined>(
        (resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        },
      );
      db.close();
      return entry?.metadata;
    },
    { dbName, storeName: OBJECT_RECORDS_STORE_NAME, metadataKey: APPLICATION_METADATA_KEY },
  );
}

export interface PersistedRecordEntry {
  key: string;
  object: string;
  record: unknown;
}

/**
 * Reads back every persisted object record (excluding the application
 * metadata row), ordered by storage key for a stable comparison. Two calls
 * bracketing a migration -- one right after seeding, one after the app has
 * reloaded and migrated -- should produce deep-equal results for any
 * no-op (empty-object) migration: the whole real seeded dataset surviving
 * byte-identical, not just one hand-picked record.
 */
export async function readAllPersistedRecords(
  page: Page,
  dbName: string,
): Promise<PersistedRecordEntry[]> {
  return page.evaluate(
    async (args) => {
      const { dbName, storeName, metadataKey } = args;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const transaction = db.transaction(storeName, "readonly");
      const entries = await new Promise<Array<{ key: string; object: string; record?: unknown }>>(
        (resolve, reject) => {
          const request = transaction.objectStore(storeName).getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        },
      );
      db.close();
      return entries
        .filter((entry) => entry.key !== metadataKey && entry.record !== undefined)
        .map((entry) => ({ key: entry.key, object: entry.object, record: entry.record }))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    },
    { dbName, storeName: OBJECT_RECORDS_STORE_NAME, metadataKey: APPLICATION_METADATA_KEY },
  );
}

/**
 * The version a real installation of the *previous* release would carry: the
 * `from` of the newest declared migration hop, read off the mounted model.
 *
 * Read rather than written down for the same reason `readMountedModelVersion`
 * exists — a reference app's `modelVersion` moves for reasons unrelated to any
 * one test, and a hard-coded "previous" version goes stale exactly as fast as a
 * hard-coded current one. This keeps the seeded state one real hop behind
 * whatever the app currently declares.
 */
export async function readMountedPreviousModelVersion(page: Page): Promise<string> {
  return page.evaluate(() => {
    const app = document.querySelector("adl-app") as unknown as {
      model: { migrations: Array<{ from: string; to: string }>; modelVersion: string };
    } | null;
    if (app === null) {
      throw new Error("Expected a mounted <adl-app> element.");
    }

    const newest = app.model.migrations.find(
      (migration) => migration.to === app.model.modelVersion,
    );
    if (newest === undefined) {
      throw new Error(
        `No declared migration lands on '${app.model.modelVersion}', so there is no previous version to seed.`,
      );
    }
    return newest.from;
  });
}

/** Reads the `modelVersion` of the model a real mounted `<adl-app>` is running. */
export async function readMountedModelVersion(page: Page): Promise<string> {
  return page.evaluate(() => {
    const app = document.querySelector("adl-app") as unknown as {
      model: { modelVersion: string };
    } | null;
    if (app === null) {
      throw new Error("Expected a mounted <adl-app> element.");
    }
    return app.model.modelVersion;
  });
}
