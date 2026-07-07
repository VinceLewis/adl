import type { JsonValue, ResolvedObject, StoredObjectRecord } from "../model/resolved-model.js";
import { StorageError, cloneJson } from "./runtime-types.js";

export interface ObjectStorageSearchRequest {
  object: ResolvedObject;
  fields: string[];
  text?: string;
  includeDeleted?: boolean;
}

export interface ObjectStorageBackend {
  create(objectName: string, record: StoredObjectRecord): Promise<void>;
  read(objectName: string, id: string): Promise<StoredObjectRecord | null>;
  update(objectName: string, record: StoredObjectRecord): Promise<void>;
  delete(objectName: string, tombstone: StoredObjectRecord): Promise<void>;
  search(request: ObjectStorageSearchRequest): Promise<StoredObjectRecord[]>;
}

export class InMemoryObjectStorageBackend implements ObjectStorageBackend {
  private readonly recordsByObject = new Map<string, Map<string, StoredObjectRecord>>();

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

  clear(): void {
    this.recordsByObject.clear();
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
