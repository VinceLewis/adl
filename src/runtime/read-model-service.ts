import type {
  JsonValue,
  ReadModelSourceScope,
  ResolvedApplicationModel,
  ResolvedObject,
  ResolvedReadModel,
  ResolvedReadModelField,
  ResolvedReadModelSource,
  ResolvedSort,
  StoredObjectRecord,
} from "../model/resolved-model.js";
import { applyComputedFieldsToRecord } from "./computed-fields.js";
import {
  contextWithoutSelectedBusinessContext,
  getAllowedContextIds,
  getSelectedContextId,
  recordMatchesObjectScope,
  requireObjectScopeForSearch,
} from "./context-scope.js";
import type { RuntimeContextService } from "./context-service.js";
import { RuntimeModelIndex, getRecordState } from "./model-helpers.js";
import type { ObjectStorageBackend } from "./object-storage-backend.js";
import type { PolicyEngine } from "./policy-engine.js";
import { evaluateExpression } from "./expression-evaluator.js";
import { cloneJson, noopRuntimeLogger, safeContextLog } from "./runtime-types.js";
import type {
  RuntimeContext,
  RuntimeLogger,
  RuntimeReadModelQuery,
  RuntimeReadModelResult,
  RuntimeReadModelRow,
} from "./runtime-types.js";

export class ReadModelService {
  constructor(
    private readonly model: ResolvedApplicationModel,
    private readonly policyEngine: PolicyEngine,
    private readonly contextService: RuntimeContextService,
    private readonly index = new RuntimeModelIndex(model),
    private readonly storage: ObjectStorageBackend,
    private readonly logger: RuntimeLogger = noopRuntimeLogger,
    private readonly startupGuard: () => Promise<void> = async () => undefined,
  ) {}

  async execute(
    readModelName: string,
    context: RuntimeContext,
    query: RuntimeReadModelQuery = {},
  ): Promise<RuntimeReadModelResult> {
    await this.startupGuard();
    const readModel = this.index.getReadModel(readModelName);
    this.logger.debug("ENTER ReadModelService.execute", {
      readModelName,
      context: safeContextLog(context),
    });

    const executionContext = await this.resolveExecutionContext(readModel, context);
    const rows =
      this.hasNoAvailableAllContext(readModel, executionContext) || readModel.sources.length === 0
        ? []
        : await this.executeRows(readModel, executionContext);
    const sorted = sortRows(rows, query.sort ?? readModel.sort);
    const limited =
      query.limit === undefined || query.limit < 0 ? sorted : sorted.slice(0, query.limit);

    this.logger.debug("EXIT ReadModelService.execute", {
      readModelName,
      count: limited.length,
    });
    return {
      readModel,
      rows: limited.map((row) => cloneJson(row)),
    };
  }

  private async resolveExecutionContext(
    readModel: ResolvedReadModel,
    context: RuntimeContext,
  ): Promise<RuntimeContext> {
    const readModelContext = readModel.context;
    if (readModelContext?.mode !== "all" || readModelContext.context === undefined) {
      return context;
    }

    const contextName = readModelContext.context;
    const baseContext = contextWithoutSelectedBusinessContext(context, contextName);
    const contextRoles = await this.contextService.resolveContextRoles(contextName, baseContext);

    return {
      ...baseContext,
      contextRoles: [
        ...(baseContext.contextRoles ?? []).filter((role) => role.context !== contextName),
        ...contextRoles,
      ],
    };
  }

  private hasNoAvailableAllContext(readModel: ResolvedReadModel, context: RuntimeContext): boolean {
    const contextName = readModel.context?.context;
    return (
      readModel.context?.mode === "all" &&
      contextName !== undefined &&
      getAllowedContextIds(context, contextName).length === 0
    );
  }

  private async executeRows(
    readModel: ResolvedReadModel,
    context: RuntimeContext,
  ): Promise<RuntimeReadModelRow[]> {
    const primarySource = readModel.sources[0];
    if (primarySource === undefined) {
      return [];
    }

    const primaryRecords = await this.searchPrimarySource(readModel, primarySource, context);
    const rows: RuntimeReadModelRow[] = [];

    for (const primaryRecord of primaryRecords) {
      const sourceRecords = new Map<string, StoredObjectRecord>([
        [primarySource.name, primaryRecord],
      ]);
      let rowComplete = true;

      for (const source of readModel.sources.slice(1)) {
        const joined = await this.resolveJoinedSource(readModel, source, sourceRecords, context);
        if (joined === undefined) {
          rowComplete = false;
          break;
        }

        sourceRecords.set(source.name, joined);
      }

      if (rowComplete) {
        rows.push(this.projectRow(readModel, sourceRecords, context));
      }
    }

    return rows;
  }

  private async searchPrimarySource(
    readModel: ResolvedReadModel,
    source: ResolvedReadModelSource,
    context: RuntimeContext,
  ): Promise<StoredObjectRecord[]> {
    const object = this.index.getObject(source.object);
    this.policyEngine.requireAllowed({ objectName: object.name, action: "search" }, context);

    if (!this.sourceCanSearchScopedObject(source, object, context)) {
      return [];
    }

    requireObjectScopeForSearch(this.index, object.name, context);

    const records = await this.storage.search({
      object,
      fields: object.fields.map((field) => field.name),
    });

    return records.filter(
      (record) =>
        this.sourceAllowsRecord(readModel, source, object, record, context) &&
        this.canReadSourceRecord(object, record, context),
    );
  }

  private sourceCanSearchScopedObject(
    source: ResolvedReadModelSource,
    object: ResolvedObject,
    context: RuntimeContext,
  ): boolean {
    if (object.scope === undefined) {
      return true;
    }

    const allowedContextIds = getAllowedContextIds(context, object.scope.context);
    if (allowedContextIds.length > 0) {
      return true;
    }

    return source.scope === "allAvailableContexts";
  }

  private async resolveJoinedSource(
    readModel: ResolvedReadModel,
    source: ResolvedReadModelSource,
    sourceRecords: Map<string, StoredObjectRecord>,
    context: RuntimeContext,
  ): Promise<StoredObjectRecord | undefined> {
    const object = this.index.getObject(source.object);
    const recordId =
      this.getCurrentUserSourceRecordId(source, object, context) ??
      this.findRelatedRecordId(object, sourceRecords);

    if (recordId === undefined) {
      return undefined;
    }

    const record = await this.storage.read(object.name, recordId);
    if (record === null || record.meta.deletedAt !== undefined) {
      return undefined;
    }

    if (!this.sourceAllowsRecord(readModel, source, object, record, context)) {
      return undefined;
    }

    return this.canReadSourceRecord(object, record, context) ? record : undefined;
  }

  private getCurrentUserSourceRecordId(
    source: ResolvedReadModelSource,
    object: ResolvedObject,
    context: RuntimeContext,
  ): string | undefined {
    if (source.scope !== "currentUser" || context.userId.length === 0) {
      return undefined;
    }

    const userContext = this.model.contexts?.find(
      (candidate) => candidate.name === "User" || candidate.object === object.name,
    );
    return userContext?.object === object.name || object.name === "User"
      ? context.userId
      : undefined;
  }

  private findRelatedRecordId(
    targetObject: ResolvedObject,
    sourceRecords: Map<string, StoredObjectRecord>,
  ): string | undefined {
    for (const record of sourceRecords.values()) {
      const sourceObject = this.index.getObject(record.meta.object);
      for (const field of sourceObject.fields) {
        if (field.lookup?.targetObject !== targetObject.name) {
          continue;
        }

        const value = record.values[field.name];
        if (typeof value === "string" && value.length > 0) {
          return value;
        }
      }
    }

    return undefined;
  }

  private sourceAllowsRecord(
    readModel: ResolvedReadModel,
    source: ResolvedReadModelSource,
    object: ResolvedObject,
    record: StoredObjectRecord,
    context: RuntimeContext,
  ): boolean {
    if (source.scope === "currentUser" && !this.recordMatchesCurrentUser(object, record, context)) {
      return false;
    }

    if (!this.recordMatchesContextScope(readModel, source.scope, object, record, context)) {
      return false;
    }

    return recordMatchesObjectScope(this.index, object.name, record, context);
  }

  private recordMatchesCurrentUser(
    object: ResolvedObject,
    record: StoredObjectRecord,
    context: RuntimeContext,
  ): boolean {
    if (context.userId.length === 0) {
      return false;
    }

    if (record.meta.guid === context.userId || record.meta.createdBy === context.userId) {
      return true;
    }

    const userContext = this.model.contexts?.find(
      (candidate) => candidate.name === "User" || candidate.object === "User",
    );
    const userObjectName = userContext?.object ?? "User";

    return object.fields.some(
      (field) =>
        field.lookup?.targetObject === userObjectName &&
        record.values[field.name] === context.userId,
    );
  }

  private recordMatchesContextScope(
    readModel: ResolvedReadModel,
    sourceScope: ReadModelSourceScope,
    object: ResolvedObject,
    record: StoredObjectRecord,
    context: RuntimeContext,
  ): boolean {
    if (sourceScope === "all") {
      return true;
    }

    const contextName = this.contextNameForSource(readModel, object);
    if (contextName === undefined) {
      return true;
    }

    if (object.scope !== undefined) {
      const recordContextId = record.values[object.scope.field];
      if (typeof recordContextId !== "string" || recordContextId.length === 0) {
        return false;
      }

      if (sourceScope === "currentContext") {
        return getSelectedContextId(context, object.scope.context) === recordContextId;
      }

      return getAllowedContextIds(context, object.scope.context).includes(recordContextId);
    }

    if (
      !this.index
        .getBusinessContextsForObject(object.name)
        .some((item) => item.name === contextName)
    ) {
      return true;
    }

    if (sourceScope === "currentContext") {
      return getSelectedContextId(context, contextName) === record.meta.guid;
    }

    return getAllowedContextIds(context, contextName).includes(record.meta.guid);
  }

  private contextNameForSource(
    readModel: ResolvedReadModel,
    object: ResolvedObject,
  ): string | undefined {
    if (readModel.context?.context !== undefined) {
      return readModel.context.context;
    }

    return object.scope?.context ?? this.index.getBusinessContextsForObject(object.name)[0]?.name;
  }

  private canReadSourceRecord(
    object: ResolvedObject,
    record: StoredObjectRecord,
    context: RuntimeContext,
  ): boolean {
    const currentState = getRecordState(object, record);
    return (
      this.policyEngine.evaluate(
        {
          objectName: object.name,
          action: "read",
          record,
          ...(currentState === undefined ? {} : { currentState }),
        },
        context,
      ).effect === "allow"
    );
  }

  private projectRow(
    readModel: ResolvedReadModel,
    sourceRecords: Map<string, StoredObjectRecord>,
    context: RuntimeContext,
  ): RuntimeReadModelRow {
    const shapedRecords = new Map(
      [...sourceRecords].map(([sourceName, record]) => [
        sourceName,
        this.policyEngine.applyReadPolicy(
          record.meta.object,
          applyComputedFieldsToRecord(this.index.getObject(record.meta.object), record, context),
          context,
        ),
      ]),
    );
    const values: Record<string, JsonValue> = {};

    for (const field of readModel.fields) {
      if (field.expression !== undefined) {
        const value = evaluateReadModelExpressionField(field, values, context);
        if (value !== undefined) {
          values[field.name] = value;
        }
        continue;
      }

      if (field.source === undefined || field.field === undefined) {
        continue;
      }

      const shapedRecord = shapedRecords.get(field.source);
      if (
        shapedRecord !== undefined &&
        Object.prototype.hasOwnProperty.call(shapedRecord.values, field.field)
      ) {
        const projectedValue = shapedRecord.values[field.field];
        if (projectedValue !== undefined) {
          values[field.name] = cloneJson(projectedValue);
        }
      }
    }

    return {
      id: `${readModel.name}:${[...sourceRecords].map(([source, record]) => `${source}:${record.meta.guid}`).join("|")}`,
      readModel: readModel.name,
      values,
      sources: Object.fromEntries(
        [...sourceRecords].map(([source, record]) => [
          source,
          {
            objectName: record.meta.object,
            recordId: record.meta.guid,
          },
        ]),
      ),
    };
  }
}

function evaluateReadModelExpressionField(
  field: ResolvedReadModelField,
  values: Record<string, JsonValue>,
  context: RuntimeContext,
): JsonValue | undefined {
  if (field.expression === undefined) {
    return undefined;
  }

  const result = evaluateExpression(field.expression, { values, context });
  return result.ok ? result.value.value : null;
}

function sortRows(rows: RuntimeReadModelRow[], sort: ResolvedSort[]): RuntimeReadModelRow[] {
  if (sort.length === 0) {
    return [...rows];
  }

  return [...rows].sort((left, right) => {
    for (const sortItem of sort) {
      const comparison = compareValues(left.values[sortItem.field], right.values[sortItem.field]);
      if (comparison !== 0) {
        return sortItem.direction === "asc" ? comparison : -comparison;
      }
    }

    return left.id.localeCompare(right.id);
  });
}

function compareValues(left: JsonValue | undefined, right: JsonValue | undefined): number {
  if (left === undefined && right === undefined) {
    return 0;
  }

  if (left === undefined) {
    return 1;
  }

  if (right === undefined) {
    return -1;
  }

  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  if (typeof left === "boolean" && typeof right === "boolean") {
    return Number(left) - Number(right);
  }

  return String(left).localeCompare(String(right));
}
