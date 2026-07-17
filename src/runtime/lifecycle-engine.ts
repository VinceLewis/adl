import type { ResolvedApplicationModel, StoredObjectRecord } from "../model/resolved-model.js";
import { requireObjectScopeForRecord } from "./context-scope.js";
import { RuntimeModelIndex, getRecordState } from "./model-helpers.js";
import type { HookRegistry } from "./hook-registry.js";
import type { ObjectStore } from "./object-store.js";
import type { PolicyEngine } from "./policy-engine.js";
import {
  LifecycleError,
  StorageError,
  noopRuntimeLogger,
  safeContextLog,
} from "./runtime-types.js";
import type { RuntimeContext, RuntimeLogger } from "./runtime-types.js";
import type { SyncPolicyService } from "./sync-policy-service.js";
import type { ValidationEngine } from "./validation-engine.js";

export class LifecycleEngine {
  constructor(
    private readonly model: ResolvedApplicationModel,
    private readonly objectStore: ObjectStore,
    private readonly validationEngine: ValidationEngine,
    private readonly policyEngine: PolicyEngine,
    private readonly syncPolicy: SyncPolicyService,
    private readonly hookRegistry: HookRegistry,
    private readonly index = new RuntimeModelIndex(model),
    private readonly logger: RuntimeLogger = noopRuntimeLogger,
  ) {}

  async transition(
    objectName: string,
    id: string,
    actionName: string,
    context: RuntimeContext,
  ): Promise<StoredObjectRecord> {
    this.logger.debug("ENTER LifecycleEngine.transition", {
      objectName,
      recordId: id,
      actionName,
      context: safeContextLog(context),
    });

    const object = this.index.getObject(objectName);
    const lifecycle = object.lifecycle;
    if (lifecycle === undefined) {
      throw new LifecycleError(`Object '${objectName}' has no lifecycle.`, { objectName });
    }

    const action = lifecycle.actions.find((candidate) => candidate.name === actionName);
    if (action === undefined) {
      throw new LifecycleError(
        `Lifecycle action '${actionName}' does not exist on '${objectName}'.`,
        {
          objectName,
          actionName,
        },
      );
    }

    const record = await this.objectStore.getRecordForRuntime(objectName, id);
    if (record === null) {
      throw new StorageError(`Record '${id}' for object '${objectName}' does not exist.`, {
        objectName,
        id,
      });
    }

    const currentState = getRecordState(object, record);
    if (currentState === undefined) {
      throw new LifecycleError(`Record '${id}' has no current lifecycle state.`, {
        objectName,
        id,
      });
    }

    if (!action.from.includes(currentState)) {
      throw new LifecycleError(
        `Lifecycle action '${actionName}' cannot run from state '${currentState}'.`,
        {
          objectName,
          id,
          actionName,
          currentState,
          allowedFrom: action.from,
        },
      );
    }

    requireObjectScopeForRecord(this.index, objectName, record, context, "transition");
    this.policyEngine.requireAllowed(
      {
        objectName,
        action: "transition",
        record,
        currentState,
        targetState: action.to,
        lifecycleAction: action.name,
      },
      context,
    );
    this.syncPolicy.requireLocalWriteAllowed(objectName, "transition", context);

    try {
      const nextValues = this.validationEngine.prepareTransitionValues(
        objectName,
        record,
        action.to,
        context,
      );

      await this.hookRegistry.run(action.hooks.before, {
        objectName,
        recordId: id,
        actionName: action.name,
        context,
        record,
        fromState: currentState,
        toState: action.to,
      });

      const updated = await this.objectStore.commitTransition(objectName, id, nextValues, context, {
        lifecycleAction: action.name,
        fromState: currentState,
        toState: action.to,
      });

      await this.hookRegistry.run(action.hooks.after, {
        objectName,
        recordId: id,
        actionName: action.name,
        context,
        record: updated,
        fromState: currentState,
        toState: action.to,
      });

      this.logger.debug("EXIT LifecycleEngine.transition", {
        objectName,
        recordId: id,
        actionName,
        toState: action.to,
      });

      return this.policyEngine.applyReadPolicy(objectName, updated, context);
    } catch (error) {
      await this.hookRegistry.run(action.hooks.onError, {
        objectName,
        recordId: id,
        actionName: action.name,
        context,
        record,
        fromState: currentState,
        toState: action.to,
      });
      throw error;
    }
  }
}
