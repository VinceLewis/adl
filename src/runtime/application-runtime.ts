import { validateApplicationModel } from "../compiler/validate-model.js";
import type {
  JsonValue,
  ResolvedApplicationModel,
  StoredObjectRecord,
} from "../model/resolved-model.js";
import { AuditService } from "./audit-service.js";
import { HookRegistry } from "./hook-registry.js";
import type { RuntimeHook } from "./hook-registry.js";
import { LifecycleEngine } from "./lifecycle-engine.js";
import { RuntimeModelIndex } from "./model-helpers.js";
import { InMemoryObjectStorageBackend } from "./object-storage-backend.js";
import type { ObjectStorageBackend } from "./object-storage-backend.js";
import { ObjectStore } from "./object-store.js";
import { OperationLog } from "./operation-log.js";
import { PolicyEngine } from "./policy-engine.js";
import {
  ModelValidationError,
  RuntimeStartupError,
  noopRuntimeLogger,
  safeContextLog,
} from "./runtime-types.js";
import type {
  RuntimeContext,
  RuntimeLogger,
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
  readonly objectStore: ObjectStore;
  readonly lifecycleEngine: LifecycleEngine;

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
  }

  async whenReady(): Promise<void> {
    await this.startupPromise;
  }

  getStartupDiagnostics(): RuntimeStartupDiagnostic[] {
    return this.startupDiagnostics.map((diagnostic) => ({ ...diagnostic }));
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
