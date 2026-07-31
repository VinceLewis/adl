import type {
  JsonValue,
  ReadModelSourceScope,
  ResolvedApplicationModel,
  ResolvedObject,
  ResolvedReadModel,
  ResolvedReadModelField,
  ResolvedReadModelSource,
  ResolvedReadModelSourceJoin,
  ResolvedSort,
  StoredObjectRecord,
} from "../model/resolved-model.js";
import { RECORD_ID_JOIN_FIELD } from "../model/resolved-model.js";
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
    // Grants are re-resolved alongside roles for the same reason roles are:
    // dropping the selection also dropped everything derived from it. Omitting
    // them would make a context reachable only through a grant — a pending
    // invitation — invisible to precisely the cross-context view that exists to
    // surface it, while a context the caller has joined stayed visible.
    const contextGrants = await this.contextService.resolveContextGrants(contextName, baseContext);

    return {
      ...baseContext,
      contextRoles: [
        ...(baseContext.contextRoles ?? []).filter((role) => role.context !== contextName),
        ...contextRoles,
      ],
      contextGrants: [
        ...(baseContext.contextGrants ?? []).filter((grant) => grant.context !== contextName),
        ...contextGrants,
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
    if (readModel.strategy === "union") {
      return this.executeUnionRows(readModel, context);
    }

    const primarySource = readModel.sources[0];
    if (primarySource === undefined) {
      return [];
    }

    const primaryRecords = await this.searchAuthorisedSourceRecords(
      readModel,
      primarySource,
      context,
    );

    // Row production is a fold over the sources rather than a loop over primary
    // records, because a `many` join turns one partial row into several. Each
    // step takes the partial rows built so far and returns the partial rows that
    // survive this source, so "one row in, one row out" is no longer assumed
    // anywhere. Each surviving row owns its own source map, so fan-out branches
    // never share mutable state and `projectRow` still sees exactly the records
    // that produced that row.
    let partialRows: Map<string, StoredObjectRecord>[] = primaryRecords.map(
      (record) => new Map<string, StoredObjectRecord>([[primarySource.name, record]]),
    );

    for (const source of readModel.sources.slice(1)) {
      const join = source.join;
      partialRows =
        join === undefined
          ? await this.applyLookupJoinedSource(readModel, source, partialRows, context)
          : await this.applyDeclaredJoinedSource(readModel, source, join, partialRows, context);
    }

    return partialRows.map((sourceRecords) => this.projectRow(readModel, sourceRecords, context));
  }

  /**
   * The original implicit join: follow a lookup field toward this source's
   * object and read exactly one record by id. Unchanged in behaviour; a source
   * that declares no `join` still drops its row when nothing is found, when the
   * record is deleted, when it falls outside scope, or when the caller may not
   * read it.
   */
  private async applyLookupJoinedSource(
    readModel: ResolvedReadModel,
    source: ResolvedReadModelSource,
    partialRows: Map<string, StoredObjectRecord>[],
    context: RuntimeContext,
  ): Promise<Map<string, StoredObjectRecord>[]> {
    const nextRows: Map<string, StoredObjectRecord>[] = [];

    for (const sourceRecords of partialRows) {
      const joined = await this.resolveJoinedSource(readModel, source, sourceRecords, context);
      if (joined === undefined) {
        continue;
      }

      nextRows.push(new Map(sourceRecords).set(source.name, joined));
    }

    return nextRows;
  }

  /**
   * An explicitly declared equality join.
   *
   * The candidate set is loaded and indexed once per execution rather than per
   * upstream row, so a fan-out join costs one search plus a hash lookup per row
   * instead of a full scan per row.
   *
   * Loading it goes through {@link searchAuthorisedSourceRecords}, which is the
   * point of the design: a declared join matches records by field value, which
   * is a search however it is spelled, so it must clear the `search` action on
   * the joined object, the object-scope search check, the source scope check and
   * the per-record read policy before a single record can reach a row. A caller
   * who may not search the joined object is refused here, not quietly given
   * rows.
   */
  private async applyDeclaredJoinedSource(
    readModel: ResolvedReadModel,
    source: ResolvedReadModelSource,
    join: ResolvedReadModelSourceJoin,
    partialRows: Map<string, StoredObjectRecord>[],
    context: RuntimeContext,
  ): Promise<Map<string, StoredObjectRecord>[]> {
    const candidates = await this.searchAuthorisedSourceRecords(readModel, source, context);
    const candidatesByKey = new Map<string, StoredObjectRecord[]>();

    for (const candidate of candidates) {
      if (candidate.meta.deletedAt !== undefined) {
        continue;
      }

      const key = joinKeyForRecord(candidate, join.localField);
      if (key === undefined) {
        continue;
      }

      const bucket = candidatesByKey.get(key);
      if (bucket === undefined) {
        candidatesByKey.set(key, [candidate]);
      } else {
        bucket.push(candidate);
      }
    }

    const nextRows: Map<string, StoredObjectRecord>[] = [];

    for (const sourceRecords of partialRows) {
      // A join naming a source that is not resolved on this row is a model
      // defect; drop the row rather than guess which record was meant.
      const joinedRecord = sourceRecords.get(join.source);
      if (joinedRecord === undefined) {
        this.logger.debug("Read-model join references an unresolved source", {
          readModel: readModel.name,
          source: source.name,
          joinSource: join.source,
        });
        continue;
      }

      const key = joinKeyForRecord(joinedRecord, join.sourceField);
      if (key === undefined) {
        continue;
      }

      const matches = candidatesByKey.get(key) ?? [];
      if (join.cardinality === "one") {
        const match = matches[0];
        if (match !== undefined) {
          nextRows.push(new Map(sourceRecords).set(source.name, match));
        }

        continue;
      }

      for (const match of matches) {
        nextRows.push(new Map(sourceRecords).set(source.name, match));
      }
    }

    return nextRows;
  }

  private async executeUnionRows(
    readModel: ResolvedReadModel,
    context: RuntimeContext,
  ): Promise<RuntimeReadModelRow[]> {
    const rows: RuntimeReadModelRow[] = [];

    for (const source of readModel.sources) {
      const records = await this.searchAuthorisedSourceRecords(readModel, source, context);
      for (const record of records) {
        rows.push(this.projectRow(readModel, new Map([[source.name, record]]), context));
      }
    }

    return rows;
  }

  /**
   * Loads the authorised record set for a source: the primary source of a join
   * read model, every source of a union read model, and the candidate set of a
   * declared join. All three enumerate records by search, so all three clear the
   * same checks — `search` on the object, object scope, source scope, and the
   * per-record read policy — before any record can reach a row.
   */
  private async searchAuthorisedSourceRecords(
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

/**
 * The comparable key a record contributes to a declared join.
 *
 * {@link RECORD_ID_JOIN_FIELD} always means the record's own id, so a junction
 * object can be joined on identity without carrying a copy of its own id. The
 * key is type-tagged so a numeric `1` never matches the string `"1"`, and any
 * value that is absent, empty, null, or structured yields no key at all: an
 * unjoinable record must not collide with every other unjoinable record.
 */
function joinKeyForRecord(record: StoredObjectRecord, fieldName: string): string | undefined {
  if (fieldName === RECORD_ID_JOIN_FIELD) {
    return record.meta.guid.length === 0 ? undefined : `s:${record.meta.guid}`;
  }

  const value = record.values[fieldName];
  if (typeof value === "string") {
    return value.length === 0 ? undefined : `s:${value}`;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? `n:${value}` : undefined;
  }

  if (typeof value === "boolean") {
    return `b:${value}`;
  }

  return undefined;
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
