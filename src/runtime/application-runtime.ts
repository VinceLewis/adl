import { validateApplicationModel } from "../compiler/validate-model.js";
import type {
  JsonValue,
  ResolvedApplicationModel,
  StoredObjectRecord,
  SyncStatus,
} from "../model/resolved-model.js";
import { AuditService } from "./audit-service.js";
import { CommandService } from "./command-service.js";
import type {
  CommandExecutionOptions,
  RuntimeCommandResult,
  RuntimeCommandStepResult,
} from "./command-service.js";
import { HookRegistry } from "./hook-registry.js";
import type { RuntimeHook } from "./hook-registry.js";
import type { ContextMembershipIndex } from "./context-membership-index.js";
import { RuntimeContextService } from "./context-service.js";
import { DecisionTableService } from "./decision-table-service.js";
import type { DecisionTableEvaluationResult } from "./decision-table-service.js";
import { EditSurfaceRuntime } from "./edit-surface-runtime.js";
import type {
  RuntimeApplyStagedChildInput,
  RuntimeApplyStagedChildResult,
  RuntimeEditSurface,
  RuntimeEditSurfaceEvaluationInput,
  RuntimeRelationshipPickerEvaluationInput,
  RuntimeRelationshipPickerResult,
} from "./edit-surface-runtime.js";
import { LifecycleEngine } from "./lifecycle-engine.js";
import { RuntimeModelIndex, getRecordState } from "./model-helpers.js";
import { OfflineDatasetService } from "./offline-dataset-service.js";
import { InMemoryObjectStorageBackend } from "./object-storage-backend.js";
import type { ObjectStorageBackend } from "./object-storage-backend.js";
import { ObjectStore } from "./object-store.js";
import type {
  ObjectStoreCreateOptions,
  RecordSyncStateSummary,
  RefusedLocalRecord,
} from "./object-store.js";
import { OperationLog } from "./operation-log.js";
import { PolicyEngine } from "./policy-engine.js";
import { PresentationRuntime } from "./presentation-runtime.js";
import type {
  RuntimePresentationMatrixCellCycleInput,
  RuntimePresentationMatrixEditResult,
  RuntimePresentationEvaluationInput,
  RuntimePresentationMatrixRangeEditInput,
  RuntimePresentationView,
} from "./presentation-runtime.js";
import { ReadModelService } from "./read-model-service.js";
import {
  ModelValidationError,
  RuntimeStartupError,
  noopRuntimeLogger,
  safeContextLog,
} from "./runtime-types.js";
import type {
  RuntimeContext,
  RuntimeAvailableContext,
  RuntimeLogger,
  RuntimeOfflineDataset,
  RuntimeReadModelQuery,
  RuntimeReadModelResult,
  RuntimeSearchInput,
  RuntimeStartupDiagnostic,
} from "./runtime-types.js";
import { migrateSyncState, planModelMigration } from "./model-migration.js";
import { runRuntimeStartupCompatibilityChecks } from "./startup-compatibility.js";
import { SyncPolicyService } from "./sync-policy-service.js";
import { SyncQueue } from "./sync-queue.js";
import type { SyncStateStorage } from "./sync-state-storage.js";
import { ValidationEngine } from "./validation-engine.js";

export interface ApplicationRuntimeOptions {
  logger?: RuntimeLogger;
  storage?: ObjectStorageBackend;
  syncStateStorage?: SyncStateStorage;
  /**
   * Optional scope-indexed read model over context membership records, used to
   * narrow membership resolution instead of scanning every stored record. The
   * authority supplies its PostgreSQL projection; a device supplies nothing and
   * keeps the scan. It never authorises — see `ContextMembershipIndex`.
   */
  membershipIndex?: ContextMembershipIndex;
}

export class ApplicationRuntime {
  readonly index: RuntimeModelIndex;
  readonly validationEngine: ValidationEngine;
  readonly policyEngine: PolicyEngine;
  readonly auditService: AuditService;
  readonly operationLog: OperationLog;
  readonly syncPolicy: SyncPolicyService;
  readonly syncQueue: SyncQueue;
  readonly hookRegistry: HookRegistry;
  readonly contextService: RuntimeContextService;
  readonly decisionTableService: DecisionTableService;
  readonly offlineDatasetService: OfflineDatasetService;
  readonly readModelService: ReadModelService;
  readonly presentationRuntime: PresentationRuntime;
  readonly editSurfaceRuntime: EditSurfaceRuntime;
  readonly objectStore: ObjectStore;
  readonly lifecycleEngine: LifecycleEngine;
  readonly commandService: CommandService;

  private readonly logger: RuntimeLogger;
  private readonly startupPromise: Promise<void>;
  private startupDiagnostics: RuntimeStartupDiagnostic[] = [];
  /**
   * The business contexts some policy rule matches members of, computed once
   * because the model cannot change for the lifetime of a runtime.
   *
   * Empty for every model that declares no `contextMember` principal, which is
   * the overwhelmingly common case, and the emptiness is what keeps membership
   * resolution off the hot path: {@link withContextMembers} returns the caller's
   * own context untouched without reading storage at all.
   */
  private readonly contextMemberPrincipalContexts: string[];

  constructor(
    readonly model: ResolvedApplicationModel,
    options: ApplicationRuntimeOptions = {},
  ) {
    const diagnostics = validateApplicationModel(model);
    if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      throw new ModelValidationError(diagnostics);
    }

    this.logger = options.logger ?? noopRuntimeLogger;
    this.index = new RuntimeModelIndex(model);
    this.validationEngine = new ValidationEngine(model, this.index, this.logger);
    this.policyEngine = new PolicyEngine(model, this.index, this.logger);
    this.auditService = new AuditService(model, this.index, this.logger);
    this.operationLog = new OperationLog(model, this.logger);
    this.syncPolicy = new SyncPolicyService(model, this.index, this.logger);
    this.syncQueue = new SyncQueue(model, this.index, this.logger);
    this.hookRegistry = new HookRegistry(this.logger);
    const storage = options.storage ?? new InMemoryObjectStorageBackend();
    this.startupPromise = this.runStartupCompatibilityChecks(storage, options.syncStateStorage);
    void this.startupPromise.catch(() => undefined);
    this.contextService = new RuntimeContextService(
      model,
      this.index,
      storage,
      this.logger,
      () => this.whenReady(),
      options.membershipIndex,
    );
    this.decisionTableService = new DecisionTableService(model, this.index, this.logger);
    this.offlineDatasetService = new OfflineDatasetService(
      model,
      this.contextService,
      this.index,
      storage,
      this.logger,
      () => this.whenReady(),
    );
    this.readModelService = new ReadModelService(
      model,
      this.policyEngine,
      this.contextService,
      this.index,
      storage,
      this.logger,
      () => this.whenReady(),
    );
    this.presentationRuntime = new PresentationRuntime(
      model,
      {
        search: (objectName, query, context) => this.search(objectName, query, context),
        executeReadModel: (readModelName, context, query) =>
          this.executeReadModel(readModelName, context, query),
        create: (objectName, values, context) => this.create(objectName, values, context),
        update: (objectName, id, patch, context) => this.update(objectName, id, patch, context),
        delete: (objectName, id, context) => this.delete(objectName, id, context),
        getRecordForRuntime: (objectName, id) =>
          this.objectStore.getRecordForRuntime(objectName, id),
        evaluatePolicy: (objectName, action, context, options = {}) => {
          const object = this.index.getObject(objectName);
          const currentState =
            options.record === undefined ? undefined : getRecordState(object, options.record);
          return this.policyEngine.evaluate(
            {
              objectName,
              action,
              ...(options.record === undefined ? {} : { record: options.record }),
              ...(options.patch === undefined ? {} : { patch: options.patch }),
              ...(currentState === undefined ? {} : { currentState }),
            },
            context,
          );
        },
        canWrite: (objectName, operation, context) =>
          this.syncPolicy.evaluateLocalWrite(objectName, operation, context),
      },
      this.index,
      this.logger,
    );
    this.editSurfaceRuntime = new EditSurfaceRuntime(
      model,
      {
        read: (objectName, id, context) => this.read(objectName, id, context),
        search: (objectName, context) => this.search(objectName, {}, context),
        searchWithQuery: (objectName, query, context) => this.search(objectName, query, context),
        executeReadModel: (readModelName, context, query) =>
          this.executeReadModel(readModelName, context, query),
        create: (objectName, values, context) => this.create(objectName, values, context),
        update: (objectName, id, patch, context) => this.update(objectName, id, patch, context),
        delete: (objectName, id, context) => this.delete(objectName, id, context),
        evaluatePolicy: (objectName, action, context, options = {}) => {
          const object = this.index.getObject(objectName);
          const currentState =
            options.record === undefined ? undefined : getRecordState(object, options.record);
          return this.policyEngine.evaluate(
            {
              objectName,
              action,
              ...(options.record === undefined ? {} : { record: options.record }),
              ...(options.patch === undefined ? {} : { patch: options.patch }),
              ...(currentState === undefined ? {} : { currentState }),
            },
            context,
          );
        },
        canWrite: (objectName, operation, context) =>
          this.syncPolicy.evaluateLocalWrite(objectName, operation, context),
      },
      this.index,
      this.logger,
    );
    this.objectStore = new ObjectStore(
      model,
      this.validationEngine,
      this.policyEngine,
      this.auditService,
      this.operationLog,
      this.syncPolicy,
      this.syncQueue,
      this.index,
      storage,
      this.logger,
      () => this.whenReady(),
    );
    this.lifecycleEngine = new LifecycleEngine(
      model,
      this.objectStore,
      this.validationEngine,
      this.policyEngine,
      this.syncPolicy,
      this.hookRegistry,
      this.index,
      this.logger,
    );
    this.commandService = new CommandService(model, this.objectStore, this.index, this.logger, () =>
      this.whenReady(),
    );
    this.contextMemberPrincipalContexts = collectContextMemberPrincipalContexts(model);
  }

  /**
   * Attaches the co-member rosters the `contextMember` policy principal reads,
   * for the contexts this model's policies actually name.
   *
   * The principal is synchronous by design, so the roster has to be on the
   * context before any service evaluates policy with it. Every entry point that
   * hands a context to `ObjectStore`, `PolicyEngine` or `ReadModelService` goes
   * through here first, including the ones the authority server replays intents
   * through, so a server-side re-check sees the same roster the device did.
   *
   * A roster the caller already supplied is never overwritten: the authority
   * resolves it once for a bootstrap and passes it down, and re-resolving would
   * both cost a storage scan and let this method silently disagree with the
   * decision its caller already made. Resolution result is recorded even when it
   * is empty, so a nested call through the presentation or edit-surface runtime
   * does not repeat the scan.
   *
   * Nothing is cached across calls. Membership is revocable, and a roster held
   * past the transaction that revoked it would keep admitting a former member.
   *
   * Public because a few callers evaluate policy through `runtime.policyEngine`
   * directly rather than through an entry point here — the authority's invite
   * acceptance check and its reporting export/administration re-checks. Those
   * contexts carry no roster today, so a `contextMember` rule covering them
   * denies rather than admits, but they can pass their context through this
   * first to get the same decision the entry points make.
   */
  async withContextMembers(context: RuntimeContext): Promise<RuntimeContext> {
    if (this.contextMemberPrincipalContexts.length === 0) {
      return context;
    }

    const members: Record<string, string[]> = { ...(context.contextMembers ?? {}) };
    let resolved = false;
    for (const contextName of this.contextMemberPrincipalContexts) {
      if (Object.prototype.hasOwnProperty.call(members, contextName)) {
        continue;
      }
      members[contextName] = await this.contextService.resolveContextMembers(contextName, context);
      resolved = true;
    }

    return resolved ? { ...context, contextMembers: members } : context;
  }

  async whenReady(): Promise<void> {
    await this.startupPromise;
  }

  getStartupDiagnostics(): RuntimeStartupDiagnostic[] {
    return this.startupDiagnostics.map((diagnostic) => ({ ...diagnostic }));
  }

  async listAvailableContexts(
    contextName: string,
    context: RuntimeContext,
  ): Promise<RuntimeAvailableContext[]> {
    await this.whenReady();
    return this.contextService.listAvailableContexts(contextName, context);
  }

  async withSelectedContext(
    contextName: string,
    contextId: string,
    context: RuntimeContext,
  ): Promise<RuntimeContext> {
    await this.whenReady();
    return this.contextService.withSelectedContext(contextName, contextId, context);
  }

  async create(
    objectName: string,
    values: Record<string, JsonValue>,
    context: RuntimeContext,
    options: ObjectStoreCreateOptions = {},
  ): Promise<StoredObjectRecord> {
    await this.whenReady();
    this.logger.debug("ENTER ApplicationRuntime.create", {
      objectName,
      context: safeContextLog(context),
    });
    const result = await this.objectStore.create(
      objectName,
      values,
      await this.withContextMembers(context),
      options,
    );
    this.logger.debug("EXIT ApplicationRuntime.create", {
      objectName,
      recordId: result.meta.guid,
    });
    return result;
  }

  async read(
    objectName: string,
    id: string,
    context: RuntimeContext,
  ): Promise<StoredObjectRecord | null> {
    await this.whenReady();
    this.logger.debug("ENTER ApplicationRuntime.read", {
      objectName,
      recordId: id,
      context: safeContextLog(context),
    });
    const result = await this.objectStore.read(
      objectName,
      id,
      await this.withContextMembers(context),
    );
    this.logger.debug("EXIT ApplicationRuntime.read", {
      objectName,
      recordId: id,
      found: result !== null,
    });
    return result;
  }

  async reconcileRemoteRecord(objectName: string, record: StoredObjectRecord): Promise<void> {
    await this.whenReady();
    await this.objectStore.reconcileRemoteRecord(objectName, record);
  }

  /**
   * Records the authority's answer about one record on the record itself. Called
   * by the sync client once the authority has spoken, and by nothing else: it is
   * how a verdict outlives the queue entry that carried it.
   */
  async setRecordSyncState(
    objectName: string,
    recordId: string,
    status: SyncStatus,
    options: { rejectedCreate?: boolean } = {},
  ): Promise<void> {
    await this.whenReady();
    await this.objectStore.setRecordSyncState(objectName, recordId, status, options);
  }

  /** Every refused record still on this device, as metadata only. */
  async listRefusedRecords(): Promise<RefusedLocalRecord[]> {
    await this.whenReady();
    return this.objectStore.listRefusedRecords();
  }

  /** How many live records are in each sync state. */
  async summariseRecordSyncState(): Promise<RecordSyncStateSummary> {
    await this.whenReady();
    return this.objectStore.summariseRecordSyncState();
  }

  /**
   * Throws away a record whose own create the authority refused. A local action
   * the user asks for, not a recovery primitive: nothing is sent, nothing is
   * settled, and no other record may be discarded this way.
   */
  async discardRefusedRecord(
    objectName: string,
    recordId: string,
    context: RuntimeContext,
  ): Promise<void> {
    await this.whenReady();
    await this.objectStore.discardRefusedRecord(objectName, recordId, context);
  }

  async update(
    objectName: string,
    id: string,
    patch: Record<string, JsonValue>,
    context: RuntimeContext,
  ): Promise<StoredObjectRecord> {
    await this.whenReady();
    this.logger.debug("ENTER ApplicationRuntime.update", {
      objectName,
      recordId: id,
      context: safeContextLog(context),
    });
    const result = await this.objectStore.update(
      objectName,
      id,
      patch,
      await this.withContextMembers(context),
    );
    this.logger.debug("EXIT ApplicationRuntime.update", {
      objectName,
      recordId: result.meta.guid,
    });
    return result;
  }

  async delete(
    objectName: string,
    id: string,
    context: RuntimeContext,
  ): Promise<StoredObjectRecord> {
    await this.whenReady();
    this.logger.debug("ENTER ApplicationRuntime.delete", {
      objectName,
      recordId: id,
      context: safeContextLog(context),
    });
    const result = await this.objectStore.delete(
      objectName,
      id,
      await this.withContextMembers(context),
    );
    this.logger.debug("EXIT ApplicationRuntime.delete", {
      objectName,
      recordId: result.meta.guid,
    });
    return result;
  }

  async search(
    objectName: string,
    query: RuntimeSearchInput,
    context: RuntimeContext,
  ): Promise<StoredObjectRecord[]> {
    await this.whenReady();
    this.logger.debug("ENTER ApplicationRuntime.search", {
      objectName,
      context: safeContextLog(context),
    });
    const result = await this.objectStore.search(
      objectName,
      query,
      await this.withContextMembers(context),
    );
    this.logger.debug("EXIT ApplicationRuntime.search", {
      objectName,
      count: result.length,
    });
    return result;
  }

  async evaluateOfflineDataset(context: RuntimeContext): Promise<RuntimeOfflineDataset> {
    await this.whenReady();
    this.logger.debug("ENTER ApplicationRuntime.evaluateOfflineDataset", {
      context: safeContextLog(context),
    });
    const result = await this.offlineDatasetService.evaluate(context);
    this.logger.debug("EXIT ApplicationRuntime.evaluateOfflineDataset", {
      count: result.records.length,
    });
    return result;
  }

  async isRecordInOfflineDataset(
    objectName: string,
    recordId: string,
    context: RuntimeContext,
  ): Promise<boolean> {
    await this.whenReady();
    return this.offlineDatasetService.isRecordInDataset(objectName, recordId, context);
  }

  async searchLocalDataset(
    objectName: string,
    query: RuntimeSearchInput,
    context: RuntimeContext,
  ): Promise<StoredObjectRecord[]> {
    await this.whenReady();
    this.logger.debug("ENTER ApplicationRuntime.searchLocalDataset", {
      objectName,
      context: safeContextLog(context),
    });
    const dataset = await this.offlineDatasetService.evaluate(context);
    const includedRecordIds = new Set(
      dataset.records
        .filter((record) => record.objectName === objectName)
        .map((record) => record.recordId),
    );

    if (includedRecordIds.size === 0) {
      this.logger.debug("EXIT ApplicationRuntime.searchLocalDataset", {
        objectName,
        count: 0,
      });
      return [];
    }

    const datasetContext = this.offlineDatasetService.contextForDatasetRead(
      objectName,
      await this.withContextMembers(context),
      dataset,
    );
    const result = await this.objectStore.search(objectName, query, datasetContext, (record) =>
      includedRecordIds.has(record.meta.guid),
    );
    this.logger.debug("EXIT ApplicationRuntime.searchLocalDataset", {
      objectName,
      count: result.length,
    });
    return result;
  }

  async executeReadModel(
    readModelName: string,
    context: RuntimeContext,
    query: RuntimeReadModelQuery = {},
  ): Promise<RuntimeReadModelResult> {
    await this.whenReady();
    this.logger.debug("ENTER ApplicationRuntime.executeReadModel", {
      readModelName,
      context: safeContextLog(context),
    });
    const result = await this.readModelService.execute(
      readModelName,
      await this.withContextMembers(context),
      query,
    );
    this.logger.debug("EXIT ApplicationRuntime.executeReadModel", {
      readModelName,
      count: result.rows.length,
    });
    return result;
  }

  async evaluatePresentationView(
    objectName: string,
    viewName: string,
    context: RuntimeContext,
    options: Omit<RuntimePresentationEvaluationInput, "objectName" | "viewName" | "context"> = {},
  ): Promise<RuntimePresentationView> {
    await this.whenReady();
    this.logger.debug("ENTER ApplicationRuntime.evaluatePresentationView", {
      objectName,
      viewName,
      context: safeContextLog(context),
    });
    const result = await this.presentationRuntime.evaluate({
      objectName,
      viewName,
      context: await this.withContextMembers(context),
      ...options,
    });
    this.logger.debug("EXIT ApplicationRuntime.evaluatePresentationView", {
      objectName,
      viewName,
      sections: result.sections.length,
    });
    return result;
  }

  async cyclePresentationMatrixCell(
    input: RuntimePresentationMatrixCellCycleInput,
  ): Promise<RuntimePresentationMatrixEditResult> {
    await this.whenReady();
    return this.presentationRuntime.cycleMatrixCell({
      ...input,
      context: await this.withContextMembers(input.context),
    });
  }

  async applyPresentationMatrixRangeEdit(
    input: RuntimePresentationMatrixRangeEditInput,
  ): Promise<RuntimePresentationMatrixEditResult> {
    await this.whenReady();
    return this.presentationRuntime.applyMatrixRangeEdit({
      ...input,
      context: await this.withContextMembers(input.context),
    });
  }

  async evaluateEditSurface(
    objectName: string,
    viewName: string,
    context: RuntimeContext,
    options: Omit<RuntimeEditSurfaceEvaluationInput, "objectName" | "viewName" | "context">,
  ): Promise<RuntimeEditSurface> {
    await this.whenReady();
    this.logger.debug("ENTER ApplicationRuntime.evaluateEditSurface", {
      objectName,
      viewName,
      context: safeContextLog(context),
    });
    const result = await this.editSurfaceRuntime.evaluate({
      objectName,
      viewName,
      context: await this.withContextMembers(context),
      ...options,
    });
    this.logger.debug("EXIT ApplicationRuntime.evaluateEditSurface", {
      objectName,
      viewName,
      sections: result.sections.length,
    });
    return result;
  }

  async applyStagedChildChanges(
    input: RuntimeApplyStagedChildInput,
  ): Promise<RuntimeApplyStagedChildResult> {
    await this.whenReady();
    this.logger.debug("ENTER ApplicationRuntime.applyStagedChildChanges", {
      objectName: input.objectName,
      viewName: input.viewName,
      parentRecordId: input.parentRecordId,
      count: input.stagedChanges.length,
      context: safeContextLog(input.context),
    });
    const result = await this.editSurfaceRuntime.applyStagedChanges({
      ...input,
      context: await this.withContextMembers(input.context),
    });
    this.logger.debug("EXIT ApplicationRuntime.applyStagedChildChanges", {
      objectName: input.objectName,
      viewName: input.viewName,
      count: result.applied.length,
    });
    return result;
  }

  async evaluateRelationshipPicker(
    input: RuntimeRelationshipPickerEvaluationInput,
  ): Promise<RuntimeRelationshipPickerResult> {
    await this.whenReady();
    this.logger.debug("ENTER ApplicationRuntime.evaluateRelationshipPicker", {
      objectName: input.objectName,
      viewName: input.viewName,
      sectionName: input.sectionName,
      context: safeContextLog(input.context),
    });
    const result = await this.editSurfaceRuntime.evaluateRelationshipPicker({
      ...input,
      context: await this.withContextMembers(input.context),
    });
    this.logger.debug("EXIT ApplicationRuntime.evaluateRelationshipPicker", {
      objectName: input.objectName,
      viewName: input.viewName,
      sectionName: input.sectionName,
      count: result.candidates.length,
    });
    return result;
  }

  async evaluateDecisionTable(
    tableName: string,
    values: Record<string, JsonValue>,
    context: RuntimeContext,
  ): Promise<DecisionTableEvaluationResult> {
    await this.whenReady();
    this.logger.debug("ENTER ApplicationRuntime.evaluateDecisionTable", {
      tableName,
      context: safeContextLog(context),
    });
    const result = this.decisionTableService.evaluate(tableName, values, context);
    this.logger.debug("EXIT ApplicationRuntime.evaluateDecisionTable", {
      tableName,
      rowName: result.rowName,
    });
    return result;
  }

  async transition(
    objectName: string,
    id: string,
    actionName: string,
    context: RuntimeContext,
  ): Promise<StoredObjectRecord> {
    await this.whenReady();
    this.logger.debug("ENTER ApplicationRuntime.transition", {
      objectName,
      recordId: id,
      actionName,
      context: safeContextLog(context),
    });
    const result = await this.lifecycleEngine.transition(
      objectName,
      id,
      actionName,
      await this.withContextMembers(context),
    );
    this.logger.debug("EXIT ApplicationRuntime.transition", {
      objectName,
      recordId: result.meta.guid,
      actionName,
    });
    return result;
  }

  async executeCommand(
    commandName: string,
    input: Record<string, JsonValue>,
    context: RuntimeContext,
    options: CommandExecutionOptions = {},
  ): Promise<RuntimeCommandResult> {
    await this.whenReady();
    this.logger.debug("ENTER ApplicationRuntime.executeCommand", {
      commandName,
      context: safeContextLog(context),
    });
    const result = await this.commandService.execute(
      commandName,
      input,
      await this.withContextMembers(context),
      options,
    );
    const steps = await this.reshapeCommandRecords(result.steps, context);
    this.logger.debug("EXIT ApplicationRuntime.executeCommand", {
      commandName,
      count: steps.length,
    });
    return { ...result, steps };
  }

  /**
   * Re-reads a command's own records when the command changed who the caller is.
   *
   * Read shaping happens as each write commits, against the context the command
   * started with — and a command that creates a membership record makes that
   * context out of date before it finishes. A caller who founds a context and
   * its first membership in one command was handed the membership record back
   * with every field stripped: readable, but empty, because at the moment it was
   * shaped they were not yet a member of a context that did not yet exist.
   *
   * Only a command that wrote a membership record pays for this, so the ordinary
   * case costs nothing. `AuthorityService.shapingContext` does the same thing for
   * the same reason on the server side; the two layers agreeing is the point.
   */
  private async reshapeCommandRecords(
    steps: RuntimeCommandStepResult[],
    context: RuntimeContext,
  ): Promise<RuntimeCommandStepResult[]> {
    const membershipObjects = new Set(
      (this.model.contexts ?? [])
        .map((declared) => declared.membership?.object)
        .filter((object): object is string => object !== undefined),
    );
    if (!steps.some((step) => membershipObjects.has(step.objectName))) {
      return steps;
    }

    const reshaped: RuntimeCommandStepResult[] = [];
    for (const step of steps) {
      // Through `read`, so the re-shaping is the ordinary policy path rather
      // than a second implementation of it. A record the caller still may not
      // read keeps what the command already returned.
      const visible = await this.read(step.objectName, step.recordId, context).catch(() => null);
      reshaped.push(visible === null ? step : { ...step, record: visible });
    }
    return reshaped;
  }

  registerHook(name: string, hook: RuntimeHook): void {
    this.logger.debug("ENTER ApplicationRuntime.registerHook", { name });
    this.hookRegistry.registerHook(name, hook);
    this.logger.debug("EXIT ApplicationRuntime.registerHook", { name });
  }

  private async runStartupCompatibilityChecks(
    storage: ObjectStorageBackend,
    syncStateStorage?: SyncStateStorage,
  ): Promise<void> {
    try {
      this.startupDiagnostics = await runRuntimeStartupCompatibilityChecks(
        this.model,
        storage,
        this.logger,
        // A runtime owns its persisted records, so it is the caller entitled to
        // migrate them. Refusing instead would leave a user unable to open an
        // app whose model moved on, with data they cannot reach.
        { applyMigrations: true },
      );
      if (syncStateStorage !== undefined) {
        const persisted = await syncStateStorage.read();
        let state = persisted;

        if (persisted !== null && persisted.modelVersion !== this.model.modelVersion) {
          // Sync state is protocol state, not records, but the pending patches
          // inside it name fields, so the same declared migration has to reach
          // them. Without a declared path this stays a refusal: a queued write
          // the authority would reject is not something to guess at.
          const planned = planModelMigration(this.model, persisted.modelVersion);
          if (planned.status !== "migrate") {
            throw new RuntimeStartupError([
              {
                severity: "error",
                code: "ADL_PERSISTED_SYNC_STATE_MODEL_VERSION_MISMATCH",
                message: `Persisted sync state model version '${persisted.modelVersion}' is incompatible with current model version '${this.model.modelVersion}'.`,
                path: "syncState.modelVersion",
                expected: this.model.modelVersion,
                actual: persisted.modelVersion,
              },
            ]);
          }
          state = migrateSyncState(persisted, planned.plan);
        }

        if (state !== null) {
          this.operationLog.restore(state.operations);
          this.syncQueue.restore(state.queue);
        }
        this.installSyncStatePersistence(syncStateStorage);
        await this.persistSyncState(syncStateStorage);
      }
    } catch (error) {
      if (error instanceof RuntimeStartupError) {
        this.startupDiagnostics = error.diagnostics;
      }

      throw error;
    }
  }

  private installSyncStatePersistence(storage: SyncStateStorage): void {
    const persist = () => void this.persistSyncState(storage);
    for (const method of [
      "enqueue",
      "remove",
      "clear",
      "restore",
      "setRecovery",
      "beginRetry",
    ] as const) {
      const original = this.syncQueue[method].bind(this.syncQueue);
      (this.syncQueue as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
        const result = (original as (...inner: unknown[]) => unknown)(...args);
        persist();
        return result;
      };
    }
    for (const method of ["record", "setStatus", "clear", "restore"] as const) {
      const original = this.operationLog[method].bind(this.operationLog);
      (this.operationLog as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
        const result = (original as (...inner: unknown[]) => unknown)(...args);
        persist();
        return result;
      };
    }
  }

  private async persistSyncState(storage: SyncStateStorage): Promise<void> {
    await storage.write({
      modelVersion: this.model.modelVersion,
      queue: this.syncQueue.getEntries(),
      operations: this.operationLog.getOperations(),
    });
  }
}

/**
 * The declared business contexts whose members some policy rule matches.
 *
 * A principal naming a context this model does not declare is skipped rather
 * than thrown from: an unresolvable roster is an unmatchable principal, which
 * is the fail-closed direction, and refusing here would take down every
 * unrelated operation instead of the one rule at fault. Model validation is
 * where a name like that should be reported.
 */
function collectContextMemberPrincipalContexts(model: ResolvedApplicationModel): string[] {
  const declared = new Set((model.contexts ?? []).map((context) => context.name));
  const names = new Set<string>();

  for (const policy of model.policies) {
    for (const rule of policy.rules) {
      if (rule.principal.match !== "contextMember") {
        continue;
      }
      const contextName = rule.principal.contextMember?.context;
      if (contextName !== undefined && declared.has(contextName)) {
        names.add(contextName);
      }
    }
  }

  return [...names].sort();
}
