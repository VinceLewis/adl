import type { JsonValue, ResolvedObject, StoredObjectRecord } from "../model/resolved-model.js";
import { StorageError, cloneJson } from "./runtime-types.js";

export interface PersistedApplicationMetadata {
  modelVersion: string;
}

export interface PersistedObjectRecord {
  objectName: string;
  record: StoredObjectRecord;
}

export interface ObjectStorageSearchRequest {
  object: ResolvedObject;
  fields: string[];
  text?: string;
  includeDeleted?: boolean;
}

export type ObjectStorageTransactionWrite =
  | {
      operation: "create";
      objectName: string;
      record: StoredObjectRecord;
    }
  | {
      operation: "update";
      objectName: string;
      record: StoredObjectRecord;
    }
  | {
      operation: "delete";
      objectName: string;
      record: StoredObjectRecord;
    };

export interface ObjectStorageBackend {
  readonly supportsTransactions?: boolean;
  create(objectName: string, record: StoredObjectRecord): Promise<void>;
  read(objectName: string, id: string): Promise<StoredObjectRecord | null>;
  update(objectName: string, record: StoredObjectRecord): Promise<void>;
  delete(objectName: string, tombstone: StoredObjectRecord): Promise<void>;
  commitTransaction?(writes: ObjectStorageTransactionWrite[]): Promise<void>;
  search(request: ObjectStorageSearchRequest): Promise<StoredObjectRecord[]>;
  listRecords(): Promise<PersistedObjectRecord[]>;
  readApplicationMetadata(): Promise<PersistedApplicationMetadata | null>;
  writeApplicationMetadata(metadata: PersistedApplicationMetadata): Promise<void>;
}

export class InMemoryObjectStorageBackend implements ObjectStorageBackend {
  readonly supportsTransactions = true;

  private readonly recordsByObject = new Map<string, Map<string, StoredObjectRecord>>();
  private applicationMetadata: PersistedApplicationMetadata | undefined;

  async create(objectName: string, record: StoredObjectRecord): Promise<void> {
    const records = this.recordsForObject(objectName);
    if (records.has(record.meta.guid)) {
      throw new StorageError(
        `Record '${record.meta.guid}' for object '${objectName}' already exists.`,
        {
          objectName,
          id: record.meta.guid,
        },
      );
    }

    records.set(record.meta.guid, cloneJson(record));
  }

  async read(objectName: string, id: string): Promise<StoredObjectRecord | null> {
    const record = this.recordsForObject(objectName).get(id);
    return record === undefined ? null : cloneJson(record);
  }

  async update(objectName: string, record: StoredObjectRecord): Promise<void> {
    const records = this.recordsForObject(objectName);
    if (!records.has(record.meta.guid)) {
      throw new StorageError(
        `Record '${record.meta.guid}' for object '${objectName}' is missing.`,
        {
          objectName,
          id: record.meta.guid,
        },
      );
    }

    records.set(record.meta.guid, cloneJson(record));
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
    const records = [...this.recordsForObject(request.object.name).values()];
    return records
      .filter((record) => request.includeDeleted === true || record.meta.deletedAt === undefined)
      .filter((record) => recordMatchesSearch(record, request.fields, request.text))
      .map((record) => cloneJson(record));
  }

  async commitTransaction(writes: ObjectStorageTransactionWrite[]): Promise<void> {
    const nextRecords = cloneRecordMaps(this.recordsByObject);

    for (const write of writes) {
      const records = recordsForObjectMap(nextRecords, write.objectName);
      if (write.operation === "create") {
        if (records.has(write.record.meta.guid)) {
          throw new StorageError(
            `Record '${write.record.meta.guid}' for object '${write.objectName}' already exists.`,
            {
              objectName: write.objectName,
              id: write.record.meta.guid,
            },
          );
        }

        records.set(write.record.meta.guid, cloneJson(write.record));
        continue;
      }

      if (!records.has(write.record.meta.guid)) {
        throw new StorageError(
          `Record '${write.record.meta.guid}' for object '${write.objectName}' is missing.`,
          {
            objectName: write.objectName,
            id: write.record.meta.guid,
          },
        );
      }

      if (write.operation === "delete" && write.record.meta.deletedAt === undefined) {
        throw new StorageError(
          `Delete for record '${write.record.meta.guid}' on object '${write.objectName}' must persist a tombstone.`,
          {
            objectName: write.objectName,
            id: write.record.meta.guid,
          },
        );
      }

      records.set(write.record.meta.guid, cloneJson(write.record));
    }

    this.recordsByObject.clear();
    for (const [objectName, records] of nextRecords.entries()) {
      this.recordsByObject.set(objectName, records);
    }
  }

  async listRecords(): Promise<PersistedObjectRecord[]> {
    return [...this.recordsByObject.entries()].flatMap(([objectName, records]) =>
      [...records.values()].map((record) => ({
        objectName,
        record: cloneJson(record),
      })),
    );
  }

  async readApplicationMetadata(): Promise<PersistedApplicationMetadata | null> {
    return this.applicationMetadata === undefined ? null : cloneJson(this.applicationMetadata);
  }

  async writeApplicationMetadata(metadata: PersistedApplicationMetadata): Promise<void> {
    this.applicationMetadata = cloneJson(metadata);
  }

  clear(): void {
    this.recordsByObject.clear();
    this.applicationMetadata = undefined;
  }

  private recordsForObject(objectName: string): Map<string, StoredObjectRecord> {
    let records = this.recordsByObject.get(objectName);
    if (records === undefined) {
      records = new Map<string, StoredObjectRecord>();
      this.recordsByObject.set(objectName, records);
    }

    return records;
  }
}

function cloneRecordMaps(
  recordsByObject: Map<string, Map<string, StoredObjectRecord>>,
): Map<string, Map<string, StoredObjectRecord>> {
  return new Map(
    [...recordsByObject.entries()].map(([objectName, records]) => [
      objectName,
      new Map([...records.entries()].map(([id, record]) => [id, cloneJson(record)])),
    ]),
  );
}

function recordsForObjectMap(
  recordsByObject: Map<string, Map<string, StoredObjectRecord>>,
  objectName: string,
): Map<string, StoredObjectRecord> {
  let records = recordsByObject.get(objectName);
  if (records === undefined) {
    records = new Map<string, StoredObjectRecord>();
    recordsByObject.set(objectName, records);
  }

  return records;
}

export function recordMatchesSearch(
  record: StoredObjectRecord,
  fields: string[],
  text: string | undefined,
): boolean {
  if (text === undefined || text.trim().length === 0) {
    return true;
  }

  const needle = text.toLowerCase();

  return fields.some((field) => valueContainsText(record.values[field], needle));
}

function valueContainsText(value: JsonValue | undefined, needle: string): boolean {
  if (value === undefined || value === null) {
    return false;
  }

  return String(value).toLowerCase().includes(needle);
}
