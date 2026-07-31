import type { StoredObjectRecord } from "../model/resolved-model.js";
import { InMemoryObjectStorageBackend } from "../runtime/object-storage-backend.js";
import type {
  ObjectStorageBackend,
  ObjectStorageSearchRequest,
  PersistedApplicationMetadata,
  PersistedObjectRecord,
} from "../runtime/object-storage-backend.js";

/**
 * The storage behaviours a conformance case can put a migration in front of.
 *
 * A migration's most important guarantee is the one it makes when it *cannot*
 * finish: nothing is rewritten, and the refusal says so. `InMemoryObjectStorageBackend`
 * always supports transactions and never throws, so a corpus that could only
 * name it could never state that guarantee — the fail-closed half of
 * `ADL_MIGRATION_FAILED` would have been proven by TypeScript tests alone and
 * left entirely unconstrained for a second runtime.
 */
export type ConformanceStorageBehaviour = "transactional" | "nonTransactional" | "failingCommit";

export const CONFORMANCE_STORAGE_BEHAVIOURS: ConformanceStorageBehaviour[] = [
  "transactional",
  "nonTransactional",
  "failingCommit",
];

/**
 * A backend whose commit always fails. The message deliberately carries detail a
 * real driver's error would — hosts, statements, record values — so a case can
 * assert that the diagnostic reduces a storage fault to its name instead of
 * disclosing it.
 */
export const CONFORMANCE_COMMIT_FAILURE_DETAIL =
  "connection to host db.internal failed while committing 3 rows";

class CommitFailingStorageBackend extends InMemoryObjectStorageBackend {
  override async commitTransaction(): Promise<void> {
    throw new Error(CONFORMANCE_COMMIT_FAILURE_DETAIL);
  }
}

/**
 * A backend that cannot commit atomically, like a store with no transaction
 * support at all. It deliberately exposes no `commitTransaction`, because
 * `supportsTransactions: false` alone would not stop a caller that only checked
 * for the method.
 */
class NonTransactionalStorageBackend implements ObjectStorageBackend {
  readonly supportsTransactions = false;

  constructor(private readonly inner: InMemoryObjectStorageBackend) {}

  create(objectName: string, record: StoredObjectRecord): Promise<void> {
    return this.inner.create(objectName, record);
  }

  read(objectName: string, id: string): Promise<StoredObjectRecord | null> {
    return this.inner.read(objectName, id);
  }

  update(objectName: string, record: StoredObjectRecord): Promise<void> {
    return this.inner.update(objectName, record);
  }

  delete(objectName: string, tombstone: StoredObjectRecord): Promise<void> {
    return this.inner.delete(objectName, tombstone);
  }

  search(request: ObjectStorageSearchRequest): Promise<StoredObjectRecord[]> {
    return this.inner.search(request);
  }

  listRecords(): Promise<PersistedObjectRecord[]> {
    return this.inner.listRecords();
  }

  readApplicationMetadata(): Promise<PersistedApplicationMetadata | null> {
    return this.inner.readApplicationMetadata();
  }

  writeApplicationMetadata(metadata: PersistedApplicationMetadata): Promise<void> {
    return this.inner.writeApplicationMetadata(metadata);
  }
}

export function createConformanceStorage(
  behaviour: ConformanceStorageBehaviour = "transactional",
): ObjectStorageBackend {
  switch (behaviour) {
    case "transactional":
      return new InMemoryObjectStorageBackend();
    case "failingCommit":
      return new CommitFailingStorageBackend();
    case "nonTransactional":
      return new NonTransactionalStorageBackend(new InMemoryObjectStorageBackend());
  }
}
