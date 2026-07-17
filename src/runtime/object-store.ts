import type {
  CommandStepAuthority,
  JsonValue,
  LocalOperationKind,
  ResolvedApplicationModel,
  ResolvedObject,
  StoredObjectRecord,
} from "../model/resolved-model.js";
import {
  recordMatchesObjectScope,
  requireObjectScopeForRecord,
  requireObjectScopeForSearch,
  requireObjectScopeForValues,
} from "./context-scope.js";
import { applyComputedFieldsToRecord } from "./computed-fields.js";
import { RuntimeModelIndex, getInitialLifecycleState, getRecordState } from "./model-helpers.js";
import type { AuditService } from "./audit-service.js";
import { InMemoryObjectStorageBackend } from "./object-storage-backend.js";
import type { ObjectStorageBackend } from "./object-storage-backend.js";
import type { OperationLog, OperationLogDetails } from "./operation-log.js";
import type { PolicyEngine } from "./policy-engine.js";
import {
  StorageError,
  RuntimeValidationError,
  cloneJson,
  getContextNowIso,
  noopRuntimeLogger,
  normaliseSearchQuery,
  safeContextLog,
} from "./runtime-types.js";
import type {
  RuntimeContext,
  RuntimeLogger,
  RuntimeSearchInput,
  RuntimeSearchQuery,
  RuntimeValidationIssue,
} from "./runtime-types.js";
import type { SyncPolicyService } from "./sync-policy-service.js";
import type { SyncQueue } from "./sync-queue.js";
import type { ValidationEngine } from "./validation-engine.js";

export type ObjectStoreWriteAuthority = CommandStepAuthority;

export type PlannedObjectWrite = PlannedCreateObjectWrite | PlannedUpdateObjectWrite;

export interface PlannedCreateObjectWrite {
  operation: "create";
  objectName: string;
  record: StoredObjectRecord;
  patch: Record<string, JsonValue>;
}

export interface PlannedUpdateObjectWrite {
  operation: "update";
  objectName: string;
  existing: StoredObjectRecord;
  record: StoredObjectRecord;
  patch: Record<string, JsonValue>;
}

export class ObjectStore {
  private nextRevisionId = 1;

  constructor(
    private readonly model: ResolvedApplicationModel,
    private readonly validationEngine: ValidationEngine,
    private readonly policyEngine: PolicyEngine,
    private readonly auditService: AuditService,
    private readonly operationLog: OperationLog,
    private readonly syncPolicy: SyncPolicyService,
    private readonly syncQueue: SyncQueue,
    private readonly index = new RuntimeModelIndex(model),
    private readonly storage: ObjectStorageBackend = new InMemoryObjectStorageBackend(),
    private readonly logger: RuntimeLogger = noopRuntimeLogger,
    private readonly startupGuard: () => Promise<void> = async () => undefined,
  ) {}

  async create(
    objectName: string,
    values: Record<string, JsonValue>,
    context: RuntimeContext,
  ): Promise<StoredObjectRecord> {
    this.logger.debug("ENTER ObjectStore.create", { objectName, context: safeContextLog(context) });
    const write = await this.planCreateForTransaction(objectName, values, context);
    const [created] = await this.commitPlannedTransaction([write], context);
    if (created === undefined) {
      throw new StorageError(`Create for object '${objectName}' did not produce a record.`, {
        objectName,
      });
    }
    this.logger.debug("EXIT ObjectStore.create", {
      objectName,
      recordId: created.meta.guid,
    });
    return created;
  }

  async planCreateForTransaction(
    objectName: string,
    values: Record<string, JsonValue>,
    context: RuntimeContext,
    authority: ObjectStoreWriteAuthority = "caller",
  ): Promise<PlannedCreateObjectWrite> {
    await this.startupGuard();
    const object = this.index.getObject(objectName);
    const preparedValues = this.validationEngine.prepareCreateValues(objectName, values, context);
    const currentState = getInitialLifecycleState(object);

    requireObjectScopeForValues(this.index, objectName, preparedValues, context, "create");
    if (authority === "caller") {
      this.policyEngine.requireAllowed(
        {
          objectName,
          action: "create",
          patch: preparedValues,
          ...(currentState === undefined ? {} : { currentState }),
        },
        context,
      );
      this.requireFieldPolicy(
        "create",
        objectName,
        preparedValues,
        context,
        undefined,
        currentState,
      );
    }
    this.syncPolicy.requireLocalWriteAllowed(objectName, "create", context);

    const record = this.buildNewRecord(object, preparedValues, context, currentState);

    return {
      operation: "create",
      objectName,
      record,
      patch: preparedValues,
    };
  }

  async read(
    objectName: string,
    id: string,
    context: RuntimeContext,
  ): Promise<StoredObjectRecord | null> {
    await this.startupGuard();
    this.logger.debug("ENTER ObjectStore.read", {
      objectName,
      recordId: id,
      context: safeContextLog(context),
    });
    const record = await this.getActiveRecord(objectName, id);

    if (record === undefined) {
      this.logger.debug("EXIT ObjectStore.read", { objectName, recordId: id, found: false });
      return null;
    }

    const object = this.index.getObject(objectName);
    requireObjectScopeForRecord(this.index, objectName, record, context, "read");
    this.policyEngine.requireAllowed(
      {
        objectName,
        action: "read",
        record,
        ...stateProperty(this.getState(objectName, record)),
      },
      context,
    );
    this.auditService.record("read", objectName, record, context, record.values, record.values);
    this.logger.debug("EXIT ObjectStore.read", { objectName, recordId: id, found: true });

    return this.policyEngine.applyReadPolicy(
      objectName,
      applyComputedFieldsToRecord(object, record, context),
      context,
    );
  }

  async update(
    objectName: string,
    id: string,
    patch: Record<string, JsonValue>,
    context: RuntimeContext,
  ): Promise<StoredObjectRecord> {
    this.logger.debug("ENTER ObjectStore.update", {
      objectName,
      recordId: id,
      context: safeContextLog(context),
    });
    const write = await this.planUpdateForTransaction(objectName, id, patch, context);
    const [updated] = await this.commitPlannedTransaction([write], context);
    if (updated === undefined) {
      throw new StorageError(
        `Update for record '${id}' on object '${objectName}' did not produce a record.`,
        {
          objectName,
          id,
        },
      );
    }
    this.logger.debug("EXIT ObjectStore.update", { objectName, recordId: id });
    return updated;
  }

  async planUpdateForTransaction(
    objectName: string,
    id: string,
    patch: Record<string, JsonValue>,
    context: RuntimeContext,
    authority: ObjectStoreWriteAuthority = "caller",
  ): Promise<PlannedUpdateObjectWrite> {
    await this.startupGuard();
    const existing = await this.requireActiveRecord(objectName, id);
    requireObjectScopeForRecord(this.index, objectName, existing, context, "update");
    const currentState = this.getState(objectName, existing);
    const nextValues = this.validationEngine.prepareUpdateValues(
      objectName,
      existing,
      patch,
      context,
    );

    requireObjectScopeForValues(this.index, objectName, nextValues, context, "update");
    if (authority === "caller") {
      this.policyEngine.requireAllowed(
        {
          objectName,
          action: "update",
          record: existing,
          patch,
          ...(currentState === undefined ? {} : { currentState }),
        },
        context,
      );
      this.requireFieldPolicy("update", objectName, patch, context, existing, currentState);
    }
    this.syncPolicy.requireLocalWriteAllowed(objectName, "update", context);

    const updated = this.updatedRecord(existing, nextValues, context, currentState);

    return {
      operation: "update",
      objectName,
      existing,
      record: updated,
      patch,
    };
  }

  async delete(
    objectName: string,
    id: string,
    context: RuntimeContext,
  ): Promise<StoredObjectRecord> {
    await this.startupGuard();
    this.logger.debug("ENTER ObjectStore.delete", {
      objectName,
      recordId: id,
      context: safeContextLog(context),
    });
    const existing = await this.requireActiveRecord(objectName, id);
    requireObjectScopeForRecord(this.index, objectName, existing, context, "delete");
    const currentState = this.getState(objectName, existing);

    this.policyEngine.requireAllowed(
      {
        objectName,
        action: "delete",
        record: existing,
        ...(currentState === undefined ? {} : { currentState }),
      },
      context,
    );
    this.syncPolicy.requireLocalWriteAllowed(objectName, "delete", context);

    const deleted = this.deletedRecord(existing, context);
    await this.storage.delete(objectName, deleted);
    this.auditService.record(
      "delete",
      objectName,
      deleted,
      context,
      existing.values,
      deleted.values,
    );
    this.recordOperation("delete", objectName, deleted, context, {
      baseRevision: existing.meta.revision,
    });
    this.logger.debug("EXIT ObjectStore.delete", { objectName, recordId: id });

    return this.applyComputedReadPolicy(objectName, deleted, context);
  }

  async search(
    objectName: string,
    query: RuntimeSearchInput,
    context: RuntimeContext,
    recordFilter: (record: StoredObjectRecord) => boolean = () => true,
  ): Promise<StoredObjectRecord[]> {
    await this.startupGuard();
    this.logger.debug("ENTER ObjectStore.search", { objectName, context: safeContextLog(context) });
    const object = this.index.getObject(objectName);
    const searchQuery = normaliseSearchQuery(query);
    const fields = searchQuery.fields ?? object.fields.map((field) => field.name);

    for (const fieldName of fields) {
      if (!this.index.hasBusinessField(object, fieldName) && !hasComputedField(object, fieldName)) {
        throw new StorageError(
          `Search field '${fieldName}' does not exist on object '${objectName}'.`,
          {
            objectName,
            fieldName,
          },
        );
      }
    }
    const storageFields = fields.filter((fieldName) =>
      this.index.hasBusinessField(object, fieldName),
    );

    requireObjectScopeForSearch(this.index, objectName, context);
    this.policyEngine.requireAllowed({ objectName, action: "search" }, context);

    const records = (
      await this.storage.search({
        object,
        fields: storageFields,
        ...(searchQuery.text === undefined ? {} : { text: searchQuery.text }),
        ...(searchQuery.includeDeleted === undefined
          ? {}
          : { includeDeleted: searchQuery.includeDeleted }),
      })
    )
      .filter(recordFilter)
      .filter((record) => this.canReadSearchResult(objectName, record, context));
    const scopedRecords = records.filter((record) =>
      recordMatchesObjectScope(this.index, objectName, record, context),
    );
    const sortedRecords = sortRecords(scopedRecords, searchQuery.sort);
    const limited =
      searchQuery.limit === undefined || searchQuery.limit < 0
        ? sortedRecords
        : sortedRecords.slice(0, searchQuery.limit);

    const shaped = limited.map((record) =>
      this.policyEngine.applyReadPolicy(
        objectName,
        applyComputedFieldsToRecord(object, record, context),
        context,
      ),
    );

    this.logger.debug("EXIT ObjectStore.search", { objectName, count: shaped.length });
    return shaped;
  }

  async commitPlannedTransaction(
    writes: PlannedObjectWrite[],
    context: RuntimeContext,
  ): Promise<StoredObjectRecord[]> {
    await this.startupGuard();
    await this.requireConstraintsForWrites(writes);

    const committed: StoredObjectRecord[] = [];
    for (const write of writes) {
      if (write.operation === "create") {
        await this.storage.create(write.objectName, write.record);
        this.auditService.record(
          "create",
          write.objectName,
          write.record,
          context,
          undefined,
          write.record.values,
        );
        this.recordOperation("create", write.objectName, write.record, context, {
          patch: write.record.values,
        });
        committed.push(this.applyComputedReadPolicy(write.objectName, write.record, context));
        continue;
      }

      await this.storage.update(write.objectName, write.record);
      this.auditService.record(
        "update",
        write.objectName,
        write.record,
        context,
        write.existing.values,
        write.record.values,
      );
      this.recordOperation("update", write.objectName, write.record, context, {
        baseRevision: write.existing.meta.revision,
        patch: write.patch,
      });
      committed.push(this.applyComputedReadPolicy(write.objectName, write.record, context));
    }

    return committed;
  }

  async getRecordForRuntime(objectName: string, id: string): Promise<StoredObjectRecord | null> {
    await this.startupGuard();
    const record = await this.getActiveRecord(objectName, id);
    return record === undefined ? null : cloneJson(record);
  }

  async commitTransition(
    objectName: string,
    id: string,
    nextValues: Record<string, JsonValue>,
    context: RuntimeContext,
    details: Required<Pick<OperationLogDetails, "lifecycleAction" | "fromState" | "toState">>,
  ): Promise<StoredObjectRecord> {
    await this.startupGuard();
    this.logger.debug("ENTER ObjectStore.commitTransition", {
      objectName,
      recordId: id,
      lifecycleAction: details.lifecycleAction,
    });
    const existing = await this.requireActiveRecord(objectName, id);
    requireObjectScopeForRecord(this.index, objectName, existing, context, "transition");
    this.syncPolicy.requireLocalWriteAllowed(objectName, "transition", context);
    const updated = this.updatedRecord(existing, nextValues, context, details.toState);

    await this.storage.update(objectName, updated);
    this.auditService.record(
      "transition",
      objectName,
      updated,
      context,
      existing.values,
      updated.values,
      {
        lifecycleAction: details.lifecycleAction,
        fromState: details.fromState,
        toState: details.toState,
      },
    );
    this.recordOperation("transition", objectName, updated, context, {
      baseRevision: existing.meta.revision,
      lifecycleAction: details.lifecycleAction,
      fromState: details.fromState,
      toState: details.toState,
    });
    this.logger.debug("EXIT ObjectStore.commitTransition", {
      objectName,
      recordId: id,
      lifecycleAction: details.lifecycleAction,
    });

    return cloneJson(updated);
  }

  private applyComputedReadPolicy(
    objectName: string,
    record: StoredObjectRecord,
    context: RuntimeContext,
  ): StoredObjectRecord {
    const object = this.index.getObject(objectName);
    return this.policyEngine.applyReadPolicy(
      objectName,
      applyComputedFieldsToRecord(object, record, context),
      context,
    );
  }

  private buildNewRecord(
    object: ResolvedObject,
    values: Record<string, JsonValue>,
    context: RuntimeContext,
    currentState: string | undefined,
  ): StoredObjectRecord {
    const now = getContextNowIso(context);
    const guid = createRecordGuid(object);

    return {
      meta: {
        guid,
        object: object.name,
        schemaVersion: object.schemaVersion,
        revision: this.nextRevision(),
        ...(currentState === undefined ? {} : { state: currentState }),
        createdAt: now,
        createdBy: context.userId,
        updatedAt: now,
        updatedBy: context.userId,
        syncStatus: "local",
      },
      values: cloneJson(values),
    };
  }

  private updatedRecord(
    existing: StoredObjectRecord,
    values: Record<string, JsonValue>,
    context: RuntimeContext,
    state: string | undefined,
  ): StoredObjectRecord {
    return {
      meta: {
        ...existing.meta,
        revision: this.nextRevision(),
        ...(state === undefined ? {} : { state }),
        updatedAt: getContextNowIso(context),
        updatedBy: context.userId,
        syncStatus: "local",
      },
      values: cloneJson(values),
    };
  }

  private deletedRecord(existing: StoredObjectRecord, context: RuntimeContext): StoredObjectRecord {
    const now = getContextNowIso(context);

    return {
      meta: {
        ...existing.meta,
        revision: this.nextRevision(),
        updatedAt: now,
        updatedBy: context.userId,
        deletedAt: now,
        deletedBy: context.userId,
        syncStatus: "local",
      },
      values: cloneJson(existing.values),
    };
  }

  private requireFieldPolicy(
    action: "create" | "update",
    objectName: string,
    values: Record<string, JsonValue>,
    context: RuntimeContext,
    record: StoredObjectRecord | undefined,
    currentState: string | undefined,
  ): void {
    for (const field of Object.keys(values)) {
      this.policyEngine.requireAllowed(
        {
          objectName,
          action,
          field,
          patch: values,
          ...(record === undefined ? {} : { record }),
          ...(currentState === undefined ? {} : { currentState }),
        },
        context,
      );
    }
  }

  private canReadSearchResult(
    objectName: string,
    record: StoredObjectRecord,
    context: RuntimeContext,
  ): boolean {
    return (
      this.policyEngine.evaluate(
        {
          objectName,
          action: "read",
          record,
          ...stateProperty(this.getState(objectName, record)),
        },
        context,
      ).effect === "allow"
    );
  }

  private async requireConstraintsForWrites(writes: PlannedObjectWrite[]): Promise<void> {
    const issues: RuntimeValidationIssue[] = [];
    const affectedObjectNames = [...new Set(writes.map((write) => write.objectName))];

    for (const objectName of affectedObjectNames) {
      const object = this.index.getObject(objectName);
      const objectWrites = writes.filter((write) => write.objectName === objectName);
      if (object.constraints.length === 0 || objectWrites.length === 0) {
        continue;
      }

      const finalRecords = await this.getFinalConstraintRecords(object, objectWrites);
      for (const write of objectWrites) {
        for (const constraint of object.constraints) {
          if (constraint.kind === "unique") {
            const fields = [...constraint.scopeFields, ...constraint.fields];
            if (hasMissingConstraintValue(write.record, fields)) {
              continue;
            }
            const duplicate = finalRecords.find(
              (candidate) =>
                candidate.meta.guid !== write.record.meta.guid &&
                fields.every((field) =>
                  jsonValuesEqual(candidate.values[field], write.record.values[field]),
                ),
            );
            if (duplicate !== undefined) {
              const field = constraint.fields[0] ?? fields[0] ?? "constraint";
              issues.push({
                code: "ADL_RUNTIME_CONSTRAINT_UNIQUE",
                message: `Constraint '${constraint.name}' requires fields ${fields.join(", ")} to be unique on object '${object.name}'.`,
                path: `values.${field}`,
                field,
              });
            }
            continue;
          }

          const position = write.record.values[constraint.positionField];
          if (
            typeof position !== "number" ||
            !Number.isInteger(position) ||
            position < constraint.minPosition
          ) {
            issues.push({
              code: "ADL_RUNTIME_CONSTRAINT_ORDERED_POSITION",
              message: `Constraint '${constraint.name}' requires '${constraint.positionField}' to be an integer greater than or equal to ${constraint.minPosition}.`,
              path: `values.${constraint.positionField}`,
              field: constraint.positionField,
            });
            continue;
          }

          const scopeFields = [...constraint.scopeFields, constraint.parentField];
          if (hasMissingConstraintValue(write.record, scopeFields)) {
            continue;
          }

          const duplicate = finalRecords.find(
            (candidate) =>
              candidate.meta.guid !== write.record.meta.guid &&
              scopeFields.every((field) =>
                jsonValuesEqual(candidate.values[field], write.record.values[field]),
              ) &&
              jsonValuesEqual(candidate.values[constraint.positionField], position),
          );
          if (duplicate !== undefined) {
            issues.push({
              code: "ADL_RUNTIME_CONSTRAINT_ORDERED_DUPLICATE",
              message: `Constraint '${constraint.name}' requires '${constraint.positionField}' to be unique within '${constraint.parentField}'.`,
              path: `values.${constraint.positionField}`,
              field: constraint.positionField,
            });
          }
        }
      }
    }

    if (issues.length > 0) {
      throw new RuntimeValidationError("Object constraints failed.", issues);
    }
  }

  private async getFinalConstraintRecords(
    object: ResolvedObject,
    writes: PlannedObjectWrite[],
  ): Promise<StoredObjectRecord[]> {
    const recordsById = new Map(
      (
        await this.storage.search({
          object,
          fields: [],
        })
      ).map((record) => [record.meta.guid, record]),
    );

    for (const write of writes) {
      recordsById.set(write.record.meta.guid, cloneJson(write.record));
    }

    return [...recordsById.values()];
  }

  private getState(objectName: string, record: StoredObjectRecord): string | undefined {
    return getRecordState(this.index.getObject(objectName), record);
  }

  private async requireActiveRecord(objectName: string, id: string): Promise<StoredObjectRecord> {
    const record = await this.getActiveRecord(objectName, id);

    if (record === undefined) {
      throw new StorageError(`Record '${id}' for object '${objectName}' does not exist.`, {
        objectName,
        id,
      });
    }

    return record;
  }

  private async getActiveRecord(
    objectName: string,
    id: string,
  ): Promise<StoredObjectRecord | undefined> {
    this.index.getObject(objectName);
    const record = await this.storage.read(objectName, id);
    if (record === null || record.meta.deletedAt !== undefined) {
      return undefined;
    }

    return cloneJson(record);
  }

  private recordOperation(
    operation: LocalOperationKind,
    objectName: string,
    record: StoredObjectRecord,
    context: RuntimeContext,
    details: OperationLogDetails = {},
  ): void {
    const localOperation = this.operationLog.record(
      operation,
      objectName,
      record,
      context,
      details,
    );
    this.syncQueue.enqueue(localOperation);
  }

  private nextRevision(): string {
    return `rev-${this.nextRevisionId++}`;
  }
}

function createRecordGuid(object: ResolvedObject): string {
  return `${object.name.toLowerCase()}-${randomId()}`;
}

function randomId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid !== undefined) {
    return randomUuid;
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function stateProperty(currentState: string | undefined): { currentState: string } | {} {
  return currentState === undefined ? {} : { currentState };
}

function hasComputedField(object: ResolvedObject, fieldName: string): boolean {
  return object.computedFields.some((field) => field.name === fieldName);
}

function sortRecords(
  records: StoredObjectRecord[],
  sort: RuntimeSearchQuery["sort"],
): StoredObjectRecord[] {
  if (sort === undefined || sort.length === 0) {
    return records;
  }

  return [...records].sort((left, right) => {
    for (const sortItem of sort) {
      const comparison = compareValues(left.values[sortItem.field], right.values[sortItem.field]);
      if (comparison !== 0) {
        return sortItem.direction === "asc" ? comparison : -comparison;
      }
    }

    return 0;
  });
}

function compareValues(left: JsonValue | undefined, right: JsonValue | undefined): number {
  if (left === right) {
    return 0;
  }

  if (left === undefined || left === null) {
    return 1;
  }

  if (right === undefined || right === null) {
    return -1;
  }

  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  return String(left).localeCompare(String(right));
}

function hasMissingConstraintValue(record: StoredObjectRecord, fields: string[]): boolean {
  return fields.some((field) => {
    const value = record.values[field];
    return value === undefined || value === null || value === "";
  });
}

function jsonValuesEqual(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  if (left === undefined || right === undefined) {
    return false;
  }

  return JSON.stringify(left) === JSON.stringify(right);
}
