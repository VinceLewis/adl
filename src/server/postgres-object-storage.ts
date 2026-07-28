import type { ResolvedApplicationModel, StoredObjectRecord } from "../model/resolved-model.js";
import {
  type ObjectStorageBackend,
  type ObjectStorageSearchRequest,
  type ObjectStorageTransactionWrite,
  recordMatchesSearch,
} from "../runtime/object-storage-backend.js";
import type {
  PersistedApplicationMetadata,
  PersistedObjectRecord,
} from "../runtime/object-storage-backend.js";
import { StorageError, cloneJson } from "../runtime/runtime-types.js";
import type { PostgresQueryable } from "./postgres-authority-store.js";

export interface PostgresObjectStorageOptions {
  /**
   * When true, this backend is already running inside an outer transaction
   * (an authority unit-of-work). `commitTransaction` then applies its writes on
   * the shared client without issuing its own `begin`/`commit`, so the caller
   * keeps a single atomic boundary. Requires the `database` to be a pinned
   * client, never an unpinned pool.
   */
  ambientTransaction?: boolean;
}

/** Pass a dedicated pg client when using transactions, not an unpinned pool. */
export class PostgresObjectStorageBackend implements ObjectStorageBackend {
  readonly supportsTransactions = true;
  private readonly ambientTransaction: boolean;
  constructor(
    private readonly database: PostgresQueryable,
    private readonly applicationId: string,
    private readonly model: ResolvedApplicationModel,
    options: PostgresObjectStorageOptions = {},
  ) {
    this.ambientTransaction = options.ambientTransaction === true;
  }
  async create(objectName: string, record: StoredObjectRecord): Promise<void> {
    await this.write("create", objectName, record);
  }
  async update(objectName: string, record: StoredObjectRecord): Promise<void> {
    await this.write("update", objectName, record);
  }
  async delete(objectName: string, record: StoredObjectRecord): Promise<void> {
    if (record.meta.deletedAt === undefined)
      throw new StorageError("A delete must persist a tombstone.");
    await this.write("delete", objectName, record);
  }
  async read(objectName: string, id: string): Promise<StoredObjectRecord | null> {
    const result = await this.database.query<{ record: StoredObjectRecord }>(
      "select record from adl_authority_records where application_id = $1 and object_name = $2 and record_id = $3",
      [this.applicationId, objectName, id],
    );
    return result.rows[0] === undefined ? null : cloneJson(result.rows[0].record);
  }
  async search(request: ObjectStorageSearchRequest): Promise<StoredObjectRecord[]> {
    const result = await this.database.query<{ record: StoredObjectRecord }>(
      "select record from adl_authority_records where application_id = $1 and object_name = $2",
      [this.applicationId, request.object.name],
    );
    return result.rows
      .map((row) => row.record)
      .filter((record) => request.includeDeleted || record.meta.deletedAt === undefined)
      .filter((record) => recordMatchesSearch(record, request.fields, request.text))
      .map(cloneJson);
  }
  async listRecords(): Promise<PersistedObjectRecord[]> {
    const result = await this.database.query<{ object_name: string; record: StoredObjectRecord }>(
      "select object_name, record from adl_authority_records where application_id = $1",
      [this.applicationId],
    );
    return result.rows.map((row) => ({
      objectName: row.object_name,
      record: cloneJson(row.record),
    }));
  }
  async readApplicationMetadata(): Promise<PersistedApplicationMetadata | null> {
    const result = await this.database.query<{ model_version: string }>(
      "select model_version from adl_authority_models where application_id = $1",
      [this.applicationId],
    );
    return result.rows[0] === undefined ? null : { modelVersion: result.rows[0].model_version };
  }
  async writeApplicationMetadata(metadata: PersistedApplicationMetadata): Promise<void> {
    await this.database.query(
      "insert into adl_authority_models (application_id, model_version, resolved_model) values ($1, $2, $3::jsonb) on conflict (application_id) do update set model_version = excluded.model_version, resolved_model = excluded.resolved_model, updated_at = now()",
      [this.applicationId, metadata.modelVersion, JSON.stringify(this.model)],
    );
  }
  async commitTransaction(writes: ObjectStorageTransactionWrite[]): Promise<void> {
    if (this.ambientTransaction) {
      // The outer authority unit-of-work owns begin/commit/rollback; applying a
      // nested begin here would prematurely commit the outer transaction.
      for (const write of writes) await this.write(write.operation, write.objectName, write.record);
      return;
    }
    await this.database.query("begin");
    try {
      for (const write of writes) await this.write(write.operation, write.objectName, write.record);
      await this.database.query("commit");
    } catch (error) {
      await this.database.query("rollback");
      throw error;
    }
  }
  private async write(
    operation: ObjectStorageTransactionWrite["operation"],
    objectName: string,
    record: StoredObjectRecord,
  ): Promise<void> {
    if (operation === "create") {
      await this.database.query(
        "insert into adl_authority_records (application_id, object_name, record_id, revision, deleted_at, record) values ($1, $2, $3, $4, $5, $6::jsonb)",
        [
          this.applicationId,
          objectName,
          record.meta.guid,
          record.meta.revision,
          record.meta.deletedAt ?? null,
          JSON.stringify(record),
        ],
      );
      return;
    }
    const result = await this.database.query<{ record_id: string }>(
      "update adl_authority_records set revision = $4, deleted_at = $5, record = $6::jsonb where application_id = $1 and object_name = $2 and record_id = $3 returning record_id",
      [
        this.applicationId,
        objectName,
        record.meta.guid,
        record.meta.revision,
        record.meta.deletedAt ?? null,
        JSON.stringify(record),
      ],
    );
    if (result.rows.length === 0)
      throw new StorageError(`Record '${record.meta.guid}' for object '${objectName}' is missing.`);
  }
}
