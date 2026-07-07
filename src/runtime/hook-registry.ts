import type { JsonValue, StoredObjectRecord } from "../model/resolved-model.js";
import { HookError, noopRuntimeLogger } from "./runtime-types.js";
import type { RuntimeContext, RuntimeLogger } from "./runtime-types.js";

export interface RuntimeHookEvent {
  objectName: string;
  recordId: string;
  actionName: string;
  context: RuntimeContext;
  record: StoredObjectRecord;
  fromState?: string;
  toState?: string;
  metadata?: Record<string, JsonValue>;
}

export type RuntimeHook = (event: RuntimeHookEvent) => void | Promise<void>;

export class HookRegistry {
  private readonly hooks = new Map<string, RuntimeHook>();

  constructor(private readonly logger: RuntimeLogger = noopRuntimeLogger) {}

  registerHook(name: string, hook: RuntimeHook): void {
    this.hooks.set(name, hook);
  }

  unregisterHook(name: string): void {
    this.hooks.delete(name);
  }

  async run(hookNames: string[], event: RuntimeHookEvent): Promise<void> {
    this.logger.debug("ENTER HookRegistry.run", {
      hookCount: hookNames.length,
      objectName: event.objectName,
      recordId: event.recordId,
      actionName: event.actionName,
    });

    for (const hookName of hookNames) {
      const hook = this.hooks.get(hookName);
      if (hook === undefined) {
        continue;
      }

      try {
        await hook(event);
      } catch (error) {
        throw new HookError(`Hook '${hookName}' failed.`, {
          hookName,
          cause: error,
        });
      }
    }

    this.logger.debug("EXIT HookRegistry.run", {
      hookCount: hookNames.length,
      objectName: event.objectName,
      recordId: event.recordId,
      actionName: event.actionName,
    });
  }
}
