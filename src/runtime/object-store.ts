import type {
  JsonValue,
  LocalOperationKind,
  ResolvedApplicationModel,
  ResolvedObject,
  StoredObjectRecord,
} from "../model/resolved-model.js";
import { RuntimeModelIndex, getInitialLifecycleState, getRecordState } from "./model-helpers.js";
import type { AuditService } from "./audit-service.js";
import type { OperationLog, OperationLogDetails } from "./operation-log.js";
import type { PolicyEngine } from "./policy-engine.js";
import {
  StorageError,
  cloneJson,
  getContextNowIso,
  noopRuntimeLogger,
  normaliseSearchQuery,
  safeContextLog,
} from "./runtime-types.js";
import type { RuntimeContext, RuntimeLogger, RuntimeSearchInput } from "./runtime-types.js";
import type { ValidationEngine } from "./validation-engine.js";

export class ObjectStore {
  private readonly recordsByObject = new Map<string, Map<string, StoredObjectRecord>>();
  private nextRecordId = 1;
  private nextRevisionId = 1;

  constructor(
    private readonly model: ResolvedApplicationModel,
    private readonly validationEngine: ValidationEngine,
    private readonly policyEngine: PolicyEngine,
    private readonly auditService: AuditService,
    private readonly operationLog: OperationLog,
    private readonly index = new RuntimeModelIndex(model),
    private readonly logger: RuntimeLogger = noopRuntimeLogger,
  ) {}

  async create(
    objectName: string,
    values: Record<string, JsonValue>,
    context: RuntimeContext,
  ): Promise<StoredObjectRecord> {
    this.logger.debug("ENTER ObjectStore.create", { objectName, context: safeContextLog(context) });
    const object = this.index.getObject(objectName);
    const preparedValues = this.validationEngine.prepareCreateValues(objectName, values);
    const currentState = getInitialLifecycleState(object);

    this.policyEngine.requireAllowed(
      {
        objectName,
        action: "create",
        patch: preparedValues,
        ...(currentState === undefined ? {} : { currentState }),
      },
      context,
    );
    this.requireFieldPolicy("create", objectName, preparedValues, context, undefined, currentState);

    const record = this.buildNewRecord(object, preparedValues, context, currentState);
    this.recordsForObject(objectName).set(record.meta.guid, cloneJson(record));
    this.auditService.record("create", objectName, record, context, undefined, record.values);
    this.recordOperation("create", objectName, record, context, { patch: record.values });
    this.logger.debug("EXIT ObjectStore.create", {
      objectName,
      recordId: record.meta.guid,
    });

    return this.policyEngine.applyReadPolicy(objectName, record, context);
  }

  async read(
    objectName: string,
    id: string,
    context: RuntimeContext,
  ): Promise<StoredObjectRecord | null> {
    this.logger.debug("ENTER ObjectStore.read", {
      objectName,
      recordId: id,
      context: safeContextLog(context),
    });
    const record = this.getActiveRecord(objectName, id);

    if (record === undefined) {
      this.logger.debug("EXIT ObjectStore.read", { objectName, recordId: id, found: false });
      return null;
    }

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

    return this.policyEngine.applyReadPolicy(objectName, record, context);
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
    const existing = this.requireActiveRecord(objectName, id);
    const currentState = this.getState(objectName, existing);
    const nextValues = this.validationEngine.prepareUpdateValues(objectName, existing, patch);

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

    const updated = this.updatedRecord(existing, nextValues, context, currentState);
    this.recordsForObject(objectName).set(id, cloneJson(updated));
    this.auditService.record(
      "update",
      objectName,
      updated,
      context,
      existing.values,
      updated.values,
    );
    this.recordOperation("update", objectName, updated, context, {
      baseRevision: existing.meta.revision,
      patch,
    });
    this.logger.debug("EXIT ObjectStore.update", { objectName, recordId: id });

    return this.policyEngine.applyReadPolicy(objectName, updated, context);
  }

  async delete(
    objectName: string,
    id: string,
    context: RuntimeContext,
  ): Promise<StoredObjectRecord> {
    this.logger.debug("ENTER ObjectStore.delete", {
      objectName,
      recordId: id,
      context: safeContextLog(context),
    });
    const existing = this.requireActiveRecord(objectName, id);
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

    const deleted = this.deletedRecord(existing, context);
    this.recordsForObject(objectName).set(id, cloneJson(deleted));
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

    return this.policyEngine.applyReadPolicy(objectName, deleted, context);
  }

  async search(
    objectName: string,
    query: RuntimeSearchInput,
    context: RuntimeContext,
  ): Promise<StoredObjectRecord[]> {
    this.logger.debug("ENTER ObjectStore.search", { objectName, context: safeContextLog(context) });
    const object = this.index.getObject(objectName);
    const searchQuery = normaliseSearchQuery(query);
    const fields = searchQuery.fields ?? object.fields.map((field) => field.name);

    for (const fieldName of fields) {
      if (!this.index.hasBusinessField(object, fieldName)) {
        throw new StorageError(
          `Search field '${fieldName}' does not exist on object '${objectName}'.`,
          {
            objectName,
            fieldName,
          },
        );
      }
    }

    this.policyEngine.requireAllowed({ objectName, action: "search" }, context);

    const records = [...this.recordsForObject(objectName).values()]
      .filter(
        (record) => searchQuery.includeDeleted === true || record.meta.deletedAt === undefined,
      )
      .filter((record) => recordMatchesQuery(record, fields, searchQuery.text))
      .filter((record) => this.canReadSearchResult(objectName, record, context));
    const limited =
      searchQuery.limit === undefined || searchQuery.limit < 0
        ? records
        : records.slice(0, searchQuery.limit);

    const shaped = limited.map((record) =>
      this.policyEngine.applyReadPolicy(objectName, record, context),
    );

    this.logger.debug("EXIT ObjectStore.search", { objectName, count: shaped.length });
    return shaped;
  }

  getRecordForRuntime(objectName: string, id: string): StoredObjectRecord | null {
    const record = this.getActiveRecord(objectName, id);
    return record === undefined ? null : cloneJson(record);
  }

  async commitTransition(
    objectName: string,
    id: string,
    nextValues: Record<string, JsonValue>,
    context: RuntimeContext,
    details: Required<Pick<OperationLogDetails, "lifecycleAction" | "fromState" | "toState">>,
  ): Promise<StoredObjectRecord> {
    this.logger.debug("ENTER ObjectStore.commitTransition", {
      objectName,
      recordId: id,
      lifecycleAction: details.lifecycleAction,
    });
    const existing = this.requireActiveRecord(objectName, id);
    const updated = this.updatedRecord(existing, nextValues, context, details.toState);

    this.recordsForObject(objectName).set(id, cloneJson(updated));
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

  private buildNewRecord(
    object: ResolvedObject,
    values: Record<string, JsonValue>,
    context: RuntimeContext,
    currentState: string | undefined,
  ): StoredObjectRecord {
    const now = getContextNowIso(context);
    const guid = `${object.name.toLowerCase()}-${this.nextRecordId++}`;

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

  private getState(objectName: string, record: StoredObjectRecord): string | undefined {
    return getRecordState(this.index.getObject(objectName), record);
  }

  private requireActiveRecord(objectName: string, id: string): StoredObjectRecord {
    const record = this.getActiveRecord(objectName, id);

    if (record === undefined) {
      throw new StorageError(`Record '${id}' for object '${objectName}' does not exist.`, {
        objectName,
        id,
      });
    }

    return record;
  }

  private getActiveRecord(objectName: string, id: string): StoredObjectRecord | undefined {
    const record = this.recordsForObject(objectName).get(id);
    if (record === undefined || record.meta.deletedAt !== undefined) {
      return undefined;
    }

    return cloneJson(record);
  }

  private recordsForObject(objectName: string): Map<string, StoredObjectRecord> {
    this.index.getObject(objectName);

    let records = this.recordsByObject.get(objectName);
    if (records === undefined) {
      records = new Map<string, StoredObjectRecord>();
      this.recordsByObject.set(objectName, records);
    }

    return records;
  }

  private recordOperation(
    operation: LocalOperationKind,
    objectName: string,
    record: StoredObjectRecord,
    context: RuntimeContext,
    details: OperationLogDetails = {},
  ): void {
    this.operationLog.record(operation, objectName, record, context, details);
  }

  private nextRevision(): string {
    return `rev-${this.nextRevisionId++}`;
  }
}

function recordMatchesQuery(
  record: StoredObjectRecord,
  fields: string[],
  text: string | undefined,
): boolean {
  if (text === undefined || text.trim().length === 0) {
    return true;
  }

  const needle = text.toLowerCase();

  return fields.some((field) => {
    const value = record.values[field];

    if (value === undefined || value === null) {
      return false;
    }

    return String(value).toLowerCase().includes(needle);
  });
}

function stateProperty(currentState: string | undefined): { currentState: string } | {} {
  return currentState === undefined ? {} : { currentState };
}
