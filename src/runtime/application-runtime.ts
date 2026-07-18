import { validateApplicationModel } from "../compiler/validate-model.js";
import type {
  JsonValue,
  ResolvedApplicationModel,
  StoredObjectRecord,
} from "../model/resolved-model.js";
import { AuditService } from "./audit-service.js";
import { CommandService } from "./command-service.js";
import type { RuntimeCommandResult } from "./command-service.js";
import { HookRegistry } from "./hook-registry.js";
import type { RuntimeHook } from "./hook-registry.js";
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
import { runRuntimeStartupCompatibilityChecks } from "./startup-compatibility.js";
import { SyncPolicyService } from "./sync-policy-service.js";
import { SyncQueue } from "./sync-queue.js";
import { ValidationEngine } from "./validation-engine.js";

export interface ApplicationRuntimeOptions {
  logger?: RuntimeLogger;
  storage?: ObjectStorageBackend;
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
    this.startupPromise = this.runStartupCompatibilityChecks(storage);
    void this.startupPromise.catch(() => undefined);
    this.contextService = new RuntimeContextService(model, this.index, storage, this.logger, () =>
      this.whenReady(),
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
  ): Promise<StoredObjectRecord> {
    await this.whenReady();
    this.logger.debug("ENTER ApplicationRuntime.create", {
      objectName,
      context: safeContextLog(context),
    });
    const result = await this.objectStore.create(objectName, values, context);
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
    const result = await this.objectStore.read(objectName, id, context);
    this.logger.debug("EXIT ApplicationRuntime.read", {
      objectName,
      recordId: id,
      found: result !== null,
    });
    return result;
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
    const result = await this.objectStore.update(objectName, id, patch, context);
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
    const result = await this.objectStore.delete(objectName, id, context);
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
    const result = await this.objectStore.search(objectName, query, context);
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
      context,
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
    const result = await this.readModelService.execute(readModelName, context, query);
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
      context,
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
    return this.presentationRuntime.cycleMatrixCell(input);
  }

  async applyPresentationMatrixRangeEdit(
    input: RuntimePresentationMatrixRangeEditInput,
  ): Promise<RuntimePresentationMatrixEditResult> {
    await this.whenReady();
    return this.presentationRuntime.applyMatrixRangeEdit(input);
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
      context,
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
    const result = await this.editSurfaceRuntime.applyStagedChanges(input);
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
    const result = await this.editSurfaceRuntime.evaluateRelationshipPicker(input);
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
    const result = await this.lifecycleEngine.transition(objectName, id, actionName, context);
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
  ): Promise<RuntimeCommandResult> {
    await this.whenReady();
    this.logger.debug("ENTER ApplicationRuntime.executeCommand", {
      commandName,
      context: safeContextLog(context),
    });
    const result = await this.commandService.execute(commandName, input, context);
    this.logger.debug("EXIT ApplicationRuntime.executeCommand", {
      commandName,
      count: result.steps.length,
    });
    return result;
  }

  registerHook(name: string, hook: RuntimeHook): void {
    this.logger.debug("ENTER ApplicationRuntime.registerHook", { name });
    this.hookRegistry.registerHook(name, hook);
    this.logger.debug("EXIT ApplicationRuntime.registerHook", { name });
  }

  private async runStartupCompatibilityChecks(storage: ObjectStorageBackend): Promise<void> {
    try {
      this.startupDiagnostics = await runRuntimeStartupCompatibilityChecks(
        this.model,
        storage,
        this.logger,
      );
    } catch (error) {
      if (error instanceof RuntimeStartupError) {
        this.startupDiagnostics = error.diagnostics;
      }

      throw error;
    }
  }
}
