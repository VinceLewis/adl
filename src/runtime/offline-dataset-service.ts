import type {
  JsonValue,
  ReadModelSourceScope,
  ResolvedApplicationModel,
  ResolvedObject,
  ResolvedReadModel,
  ResolvedReadModelSource,
  ResolvedSyncWindow,
  StoredObjectRecord,
} from "../model/resolved-model.js";
import { contextWithoutSelectedBusinessContext, getSelectedContextId } from "./context-scope.js";
import { evaluateExpressionAsBoolean } from "./expression-evaluator.js";
import type { RuntimeContextService } from "./context-service.js";
import { RuntimeModelIndex } from "./model-helpers.js";
import type { ObjectStorageBackend } from "./object-storage-backend.js";
import { cloneJson, getContextNow, noopRuntimeLogger, safeContextLog } from "./runtime-types.js";
import type {
  RuntimeContext,
  RuntimeContextRole,
  RuntimeLogger,
  RuntimeOfflineDataset,
  RuntimeOfflineDatasetReason,
  RuntimeOfflineDatasetRecord,
} from "./runtime-types.js";

interface DatasetEvaluationState {
  context: RuntimeContext;
  availableContextIds: Map<string, string[]>;
  availableContextRoles: RuntimeContextRole[];
  /**
   * Per object, the record ids that survive its declared `LIMIT`. A limit ranks
   * records against each other, so unlike every other part of a bound it cannot
   * be decided one record at a time; it is computed once per evaluation and
   * consulted per record.
   */
  windowLimitRecordIds: Map<string, Set<string>>;
}

interface ActivePersistedObjectRecord {
  objectName: string;
  record: StoredObjectRecord;
}

export class OfflineDatasetService {
  constructor(
    private readonly model: ResolvedApplicationModel,
    private readonly contextService: RuntimeContextService,
    private readonly index = new RuntimeModelIndex(model),
    private readonly storage: ObjectStorageBackend,
    private readonly logger: RuntimeLogger = noopRuntimeLogger,
    private readonly startupGuard: () => Promise<void> = async () => undefined,
  ) {}

  async evaluate(context: RuntimeContext): Promise<RuntimeOfflineDataset> {
    await this.startupGuard();
    this.logger.debug("ENTER OfflineDatasetService.evaluate", {
      context: safeContextLog(context),
    });

    const activeRecords = await this.getActiveRecords();
    const state = await this.createEvaluationState(context, activeRecords);
    const recordsByKey = new Map<string, RuntimeOfflineDatasetRecord>();

    for (const entry of activeRecords) {
      const object = this.index.getObject(entry.objectName);
      const reasons = this.getDatasetReasons(object, entry.record, state);

      if (reasons.length === 0) {
        continue;
      }

      recordsByKey.set(recordKey(entry.objectName, entry.record.meta.guid), {
        objectName: entry.objectName,
        recordId: entry.record.meta.guid,
        reasons,
      });
    }

    const dataset: RuntimeOfflineDataset = {
      records: [...recordsByKey.values()]
        .map((record) => cloneJson(record))
        .sort(compareDatasetRecords),
      contextRoles: uniqueContextRoleEntries(state.availableContextRoles),
    };

    this.logger.debug("EXIT OfflineDatasetService.evaluate", {
      count: dataset.records.length,
    });
    return dataset;
  }

  async isRecordInDataset(
    objectName: string,
    recordId: string,
    context: RuntimeContext,
  ): Promise<boolean> {
    const dataset = await this.evaluate(context);
    return dataset.records.some(
      (record) => record.objectName === objectName && record.recordId === recordId,
    );
  }

  contextForDatasetRead(
    objectName: string,
    context: RuntimeContext,
    dataset: RuntimeOfflineDataset,
  ): RuntimeContext {
    const object = this.index.getObject(objectName);
    const contextNames = this.getObjectContextNames(object);
    const hasDatasetRecords = dataset.records.some((record) => record.objectName === objectName);

    if (contextNames.length === 0 || !hasDatasetRecords) {
      return context;
    }

    let selectedContexts = { ...(context.selectedContexts ?? {}) };
    for (const contextName of contextNames) {
      selectedContexts = withoutKey(selectedContexts, contextName);
    }

    return {
      ...context,
      roles: [...context.roles],
      selectedContexts,
      contextRoles: uniqueContextRoleEntries([
        ...(context.contextRoles ?? []).filter((entry) => !contextNames.includes(entry.context)),
        ...dataset.contextRoles.filter((entry) => contextNames.includes(entry.context)),
      ]),
    };
  }

  private async getActiveRecords(): Promise<ActivePersistedObjectRecord[]> {
    return (await this.storage.listRecords())
      .filter((entry) => entry.record.meta.deletedAt === undefined)
      .map((entry) => ({
        objectName: entry.objectName,
        record: cloneJson(entry.record),
      }));
  }

  private async createEvaluationState(
    context: RuntimeContext,
    activeRecords: ActivePersistedObjectRecord[],
  ): Promise<DatasetEvaluationState> {
    const availableContextIds = new Map<string, string[]>();
    const availableContextRoles: RuntimeContextRole[] = [];

    for (const businessContext of this.model.contexts ?? []) {
      const allContext = contextWithoutSelectedBusinessContext(context, businessContext.name);
      const available = await this.contextService.listAvailableContexts(
        businessContext.name,
        allContext,
      );
      const ids = uniqueStrings([
        ...available.map((item) => item.id),
        ...(context.contextRoles ?? [])
          .filter((role) => role.context === businessContext.name)
          .map((role) => role.contextId),
      ]);
      availableContextIds.set(businessContext.name, ids);
      availableContextRoles.push(
        ...available.flatMap((item) => item.roleEntries),
        ...(context.contextRoles ?? []).filter((role) => role.context === businessContext.name),
      );
    }

    const state: DatasetEvaluationState = {
      context,
      availableContextIds,
      availableContextRoles: uniqueContextRoleEntries(availableContextRoles),
      windowLimitRecordIds: new Map(),
    };
    state.windowLimitRecordIds = this.computeWindowLimitRecordIds(activeRecords, state);

    return state;
  }

  /**
   * A `LIMIT` keeps the newest N of the records a device would otherwise hold,
   * so the set it ranks has to be the set the object's own scope selects. When a
   * limit could only accompany `recent` this was invisible: `recent` selects by
   * available contexts, which is what the candidate filter used. Once a limit can
   * accompany `currentUser`, using the available-context matcher regardless would
   * rank one user's records against every other user's and quietly evict records
   * their owner is entitled to hold. The candidates are therefore filtered by the
   * object's *declared* context scope, via the same matcher that decides its
   * `objectSync` reason.
   */
  private computeWindowLimitRecordIds(
    activeRecords: ActivePersistedObjectRecord[],
    state: DatasetEvaluationState,
  ): Map<string, Set<string>> {
    const idsByObject = new Map<string, Set<string>>();

    for (const object of this.model.objects) {
      const window = object.sync.window;
      if (object.sync.mode === "onlineRequired" || window?.limit === undefined) {
        continue;
      }

      const candidates = activeRecords
        .filter((entry) => entry.objectName === object.name)
        .filter(
          (entry) =>
            this.recordMatchesSyncScope(object, entry.record, state) &&
            this.recordMatchesWindowDays(object, entry.record, window, state),
        )
        .sort((left, right) => {
          const leftDate = getSyncWindowDate(object, left.record, window);
          const rightDate = getSyncWindowDate(object, right.record, window);
          return (rightDate?.getTime() ?? 0) - (leftDate?.getTime() ?? 0);
        })
        .slice(0, window.limit);

      idsByObject.set(object.name, new Set(candidates.map((entry) => entry.record.meta.guid)));
    }

    return idsByObject;
  }

  private getDatasetReasons(
    object: ResolvedObject,
    record: StoredObjectRecord,
    state: DatasetEvaluationState,
  ): RuntimeOfflineDatasetReason[] {
    if (object.sync.mode === "onlineRequired") {
      return [];
    }

    // The declared bound gates every route into the dataset, including a read
    // model's. A source scope says which *context* an object is held for, and a
    // cross-context dashboard input legitimately widens that — Phase 57 verified
    // it, and narrowing it would empty a shipped view offline. A window or a
    // predicate says something different: how much of the object a device keeps
    // at all. Nothing can declare that on a source, so nothing can widen it
    // deliberately, and before this check a source widened it by accident: a
    // record seven years outside a declared 90-day window stayed on the device
    // with no `objectSync` reason at all.
    if (!this.recordSatisfiesDeclaredBound(object, record, state)) {
      return [];
    }

    return uniqueReasons([
      ...this.getObjectSyncReasons(object, record, state),
      ...this.getReadModelSourceReasons(object, record, state),
    ]);
  }

  /**
   * The declared bound says *how much* of an object a device keeps, as opposed
   * to which context it keeps it for. A window and a predicate are independent
   * of the scope and of each other: either may accompany any scope, both may
   * accompany the same one, and when both are declared both must pass. So this
   * gates on what the model *declares*, not on the scope word — the scope word
   * only ever implied a bound because `recent` resolves a default window.
   */
  private recordSatisfiesDeclaredBound(
    object: ResolvedObject,
    record: StoredObjectRecord,
    state: DatasetEvaluationState,
  ): boolean {
    if (!this.recordSatisfiesRankableBound(object, record, state)) {
      return false;
    }

    return this.recordSatisfiesWindowLimit(object, record, state);
  }

  /**
   * Every part of the declared bound that can be decided from one record alone:
   * the day span and the predicate. A `LIMIT` is deliberately not here, because
   * it ranks records against each other and so cannot be evaluated until the
   * whole candidate set is known — and the candidate set is built from this.
   */
  private recordSatisfiesRankableBound(
    object: ResolvedObject,
    record: StoredObjectRecord,
    state: DatasetEvaluationState,
  ): boolean {
    const window = object.sync.window;
    if (window !== undefined && !this.recordMatchesWindowDays(object, record, window, state)) {
      return false;
    }

    if (object.sync.predicate !== undefined || object.sync.scope === "custom") {
      return this.recordMatchesCustomPredicate(object, record, state);
    }

    return true;
  }

  /**
   * A `LIMIT` keeps the newest N records of the object's *own* selection. A
   * record reaching the device by another route — a read-model source widening
   * the context — is not ranked against that selection and is not evicted by it.
   * Ranking it would make a limit narrow the context, which Phase 63 reserved to
   * nothing at all: a source may widen an object's context, and the bound it may
   * not widen is the day span and the predicate, both of which are decided per
   * record above and do gate every route.
   */
  private recordSatisfiesWindowLimit(
    object: ResolvedObject,
    record: StoredObjectRecord,
    state: DatasetEvaluationState,
  ): boolean {
    const limitedIds = state.windowLimitRecordIds.get(object.name);
    if (limitedIds === undefined || limitedIds.has(record.meta.guid)) {
      return true;
    }

    return !this.recordMatchesSyncScope(object, record, state);
  }

  private declaredBoundKind(
    object: ResolvedObject,
  ): "window" | "predicate" | "windowAndPredicate" | undefined {
    const hasWindow = object.sync.window !== undefined;
    // `custom` counts as declaring a predicate even when one is somehow absent:
    // the scope still bounds the object, by selecting nothing at all.
    const hasPredicate = object.sync.predicate !== undefined || object.sync.scope === "custom";

    if (hasWindow && hasPredicate) {
      return "windowAndPredicate";
    }

    if (hasWindow) {
      return "window";
    }

    return hasPredicate ? "predicate" : undefined;
  }

  private getObjectSyncReasons(
    object: ResolvedObject,
    record: StoredObjectRecord,
    state: DatasetEvaluationState,
  ): RuntimeOfflineDatasetReason[] {
    if (!this.recordMatchesSyncScope(object, record, state)) {
      return [];
    }

    return [
      {
        kind: "objectSync",
        mode: object.sync.mode,
        scope: object.sync.scope,
      },
    ];
  }

  private getReadModelSourceReasons(
    object: ResolvedObject,
    record: StoredObjectRecord,
    state: DatasetEvaluationState,
  ): RuntimeOfflineDatasetReason[] {
    const boundedBy = this.declaredBoundKind(object);

    return (this.model.readModels ?? []).flatMap((readModel) =>
      readModel.sources
        .filter((source) => source.object === object.name)
        .filter((source) =>
          this.recordMatchesReadModelSource(readModel, source, object, record, state),
        )
        .map(
          (source): RuntimeOfflineDatasetReason => ({
            kind: "readModelSource",
            readModel: readModel.name,
            source: source.name,
            sourceScope: source.scope,
            mode: object.sync.mode,
            ...(boundedBy === undefined ? {} : { boundedBy }),
          }),
        ),
    );
  }

  private recordMatchesSyncScope(
    object: ResolvedObject,
    record: StoredObjectRecord,
    state: DatasetEvaluationState,
  ): boolean {
    switch (object.sync.scope) {
      case "all":
        return this.recordMatchesAvailableObjectContext(object, record, state);
      case "currentUser":
      case "assignedToUser":
      case "ownedByUser":
        return (
          this.recordMatchesCurrentUser(object, record, state.context) &&
          this.recordMatchesAvailableObjectContext(object, record, state)
        );
      case "currentContext":
        return this.recordMatchesCurrentObjectContext(object, record, state.context);
      case "allAvailableContexts":
        return this.recordMatchesAvailableObjectContext(object, record, state);
      // `recent` and `custom` are retained spellings for available contexts plus
      // a bound — a default 30-day window and a required predicate respectively.
      // The bound half of each is declared, not implied by the scope word, and
      // is checked once for every route in `recordSatisfiesDeclaredBound`, so
      // what is left here is the context half alone.
      case "recent":
      case "custom":
        return this.recordMatchesAvailableObjectContext(object, record, state);
    }
  }

  /**
   * A `custom` scope selects by its declared predicate and by nothing else.
   * Validation refuses the scope without one, so an undefined predicate here
   * means the model reached the runtime unvalidated; that selects nothing
   * rather than everything, because a dataset is what leaves the authority's
   * reach and over-inclusion is the worse failure.
   */
  private recordMatchesCustomPredicate(
    object: ResolvedObject,
    record: StoredObjectRecord,
    state: DatasetEvaluationState,
  ): boolean {
    const predicate = object.sync.predicate;
    if (predicate === undefined) {
      this.logger.debug("OfflineDatasetService custom sync scope has no predicate", {
        object: object.name,
      });
      return false;
    }

    const result = evaluateExpressionAsBoolean(predicate, {
      values: record.values,
      context: state.context,
    });

    if (!result.ok) {
      // An expression that cannot be evaluated against this record excludes it,
      // the same way an unparseable window date does. It is a record-level
      // outcome, not a model-level one, so it must not fail the whole dataset.
      this.logger.debug("OfflineDatasetService custom sync predicate did not evaluate", {
        object: object.name,
        recordId: record.meta.guid,
        code: result.error.code,
      });
      return false;
    }

    return result.value.value === true;
  }

  private recordMatchesReadModelSource(
    readModel: ResolvedReadModel,
    source: ResolvedReadModelSource,
    object: ResolvedObject,
    record: StoredObjectRecord,
    state: DatasetEvaluationState,
  ): boolean {
    if (
      source.scope === "currentUser" &&
      !this.recordMatchesCurrentUser(object, record, state.context)
    ) {
      return false;
    }

    return this.recordMatchesReadModelSourceContext(readModel, source.scope, object, record, state);
  }

  private recordMatchesReadModelSourceContext(
    readModel: ResolvedReadModel,
    sourceScope: ReadModelSourceScope,
    object: ResolvedObject,
    record: StoredObjectRecord,
    state: DatasetEvaluationState,
  ): boolean {
    if (sourceScope === "currentContext") {
      return this.recordMatchesCurrentObjectContextForReadModel(readModel, object, record, state);
    }

    if (sourceScope === "allAvailableContexts" || sourceScope === "currentUser") {
      return this.recordMatchesAvailableObjectContextForReadModel(readModel, object, record, state);
    }

    return this.recordMatchesAvailableObjectContext(object, record, state);
  }

  private recordMatchesCurrentObjectContextForReadModel(
    readModel: ResolvedReadModel,
    object: ResolvedObject,
    record: StoredObjectRecord,
    state: DatasetEvaluationState,
  ): boolean {
    const contextName = this.contextNameForReadModelSource(readModel, object);
    if (contextName === undefined) {
      return true;
    }

    return this.recordMatchesContextId(object, record, contextName, [
      getSelectedContextId(state.context, contextName),
    ]);
  }

  private recordMatchesAvailableObjectContextForReadModel(
    readModel: ResolvedReadModel,
    object: ResolvedObject,
    record: StoredObjectRecord,
    state: DatasetEvaluationState,
  ): boolean {
    const contextName = this.contextNameForReadModelSource(readModel, object);
    if (contextName === undefined) {
      return true;
    }

    return this.recordMatchesContextId(
      object,
      record,
      contextName,
      this.getAvailableContextIds(state, contextName),
    );
  }

  private contextNameForReadModelSource(
    readModel: ResolvedReadModel,
    object: ResolvedObject,
  ): string | undefined {
    if (readModel.context?.context !== undefined) {
      return readModel.context.context;
    }

    return object.scope?.context ?? this.index.getBusinessContextsForObject(object.name)[0]?.name;
  }

  private recordMatchesCurrentObjectContext(
    object: ResolvedObject,
    record: StoredObjectRecord,
    context: RuntimeContext,
  ): boolean {
    const contextNames = this.getObjectContextNames(object);
    if (contextNames.length === 0) {
      return true;
    }

    return contextNames.some((contextName) =>
      this.recordMatchesContextId(object, record, contextName, [
        getSelectedContextId(context, contextName),
      ]),
    );
  }

  private recordMatchesAvailableObjectContext(
    object: ResolvedObject,
    record: StoredObjectRecord,
    state: DatasetEvaluationState,
  ): boolean {
    const contextNames = this.getObjectContextNames(object);
    if (contextNames.length === 0) {
      return true;
    }

    return contextNames.some((contextName) =>
      this.recordMatchesContextId(
        object,
        record,
        contextName,
        this.getAvailableContextIds(state, contextName),
      ),
    );
  }

  private recordMatchesContextId(
    object: ResolvedObject,
    record: StoredObjectRecord,
    contextName: string,
    contextIds: (string | undefined)[],
  ): boolean {
    const matchingContextObjects = this.index
      .getBusinessContextsForObject(object.name)
      .filter((businessContext) => businessContext.name === contextName)
      .map((businessContext) => businessContext.name);

    if (object.scope === undefined && matchingContextObjects.length === 0) {
      return true;
    }

    const availableIds = contextIds.filter(
      (contextId): contextId is string => contextId !== undefined && contextId.length > 0,
    );

    if (availableIds.length === 0) {
      return false;
    }

    if (object.scope !== undefined) {
      const contextId = getStringValue(record.values[object.scope.field]);
      return contextId !== undefined && availableIds.includes(contextId);
    }

    return availableIds.includes(record.meta.guid);
  }

  private getObjectContextNames(object: ResolvedObject): string[] {
    return uniqueStrings([
      ...(object.scope === undefined ? [] : [object.scope.context]),
      ...this.index.getBusinessContextsForObject(object.name).map((context) => context.name),
    ]);
  }

  private getAvailableContextIds(state: DatasetEvaluationState, contextName: string): string[] {
    return uniqueStrings([
      ...(state.availableContextIds.get(contextName) ?? []),
      ...(state.context.contextRoles ?? [])
        .filter((entry) => entry.context === contextName)
        .map((entry) => entry.contextId),
    ]);
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

    const userObjectName =
      this.model.contexts?.find(
        (candidate) => candidate.name === "User" || candidate.object === "User",
      )?.object ?? "User";

    return object.fields.some(
      (field) =>
        field.lookup?.targetObject === userObjectName &&
        record.values[field.name] === context.userId,
    );
  }

  private recordMatchesWindowDays(
    object: ResolvedObject,
    record: StoredObjectRecord,
    window: ResolvedSyncWindow,
    state: DatasetEvaluationState,
  ): boolean {
    const date = getSyncWindowDate(object, record, window);
    if (date === undefined) {
      return false;
    }

    const days = window.days ?? 30;
    const maxAgeMs = days * 24 * 60 * 60 * 1000;
    return getContextNow(state.context).getTime() - date.getTime() <= maxAgeMs;
  }
}

function getSyncWindowDate(
  object: ResolvedObject,
  record: StoredObjectRecord,
  window: ResolvedSyncWindow | undefined,
): Date | undefined {
  if (window === undefined) {
    return undefined;
  }

  const value = getSyncWindowValue(object, record, window.field);
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function getSyncWindowValue(
  object: ResolvedObject,
  record: StoredObjectRecord,
  field: string,
): JsonValue | undefined {
  switch (field) {
    case "_guid":
      return record.meta.guid;
    case "_object":
      return record.meta.object;
    case "_schemaVersion":
      return record.meta.schemaVersion;
    case "_revision":
      return record.meta.revision;
    case "_state":
      return record.meta.state;
    case "_createdAt":
      return record.meta.createdAt;
    case "_createdBy":
      return record.meta.createdBy;
    case "_updatedAt":
      return record.meta.updatedAt;
    case "_updatedBy":
      return record.meta.updatedBy;
    case "_deletedAt":
      return record.meta.deletedAt;
    case "_deletedBy":
      return record.meta.deletedBy;
    case "_syncStatus":
      return record.meta.syncStatus;
  }

  if (object.fields.some((candidate) => candidate.name === field)) {
    return record.values[field];
  }

  return undefined;
}

function compareDatasetRecords(
  left: RuntimeOfflineDatasetRecord,
  right: RuntimeOfflineDatasetRecord,
): number {
  return (
    left.objectName.localeCompare(right.objectName) || left.recordId.localeCompare(right.recordId)
  );
}

function recordKey(objectName: string, recordId: string): string {
  return `${objectName}\0${recordId}`;
}

function getStringValue(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function uniqueContextRoleEntries(entries: RuntimeContextRole[]): RuntimeContextRole[] {
  const unique = new Map<string, RuntimeContextRole>();

  for (const entry of entries) {
    unique.set(
      `${entry.context}\0${entry.contextId}\0${entry.role}\0${entry.membershipRecordId ?? ""}`,
      entry,
    );
  }

  return [...unique.values()].map((entry) => ({ ...entry }));
}

function uniqueReasons(reasons: RuntimeOfflineDatasetReason[]): RuntimeOfflineDatasetReason[] {
  const unique = new Map<string, RuntimeOfflineDatasetReason>();

  for (const reason of reasons) {
    unique.set(reasonKey(reason), reason);
  }

  return [...unique.values()].map((reason) => cloneJson(reason));
}

function reasonKey(reason: RuntimeOfflineDatasetReason): string {
  if (reason.kind === "objectSync") {
    return `${reason.kind}\0${reason.mode}\0${reason.scope}`;
  }

  return `${reason.kind}\0${reason.readModel}\0${reason.source}\0${reason.sourceScope}`;
}

function withoutKey(record: Record<string, string>, key: string): Record<string, string> {
  const next = { ...record };
  delete next[key];
  return next;
}
