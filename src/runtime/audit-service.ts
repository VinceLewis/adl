import type {
  AuditEvent,
  AuditOperation,
  JsonValue,
  ResolvedApplicationModel,
  StoredObjectRecord,
} from "../model/resolved-model.js";
import { RuntimeModelIndex } from "./model-helpers.js";
import { cloneJson, getContextNowIso, noopRuntimeLogger } from "./runtime-types.js";
import type { RuntimeContext, RuntimeLogger } from "./runtime-types.js";

export interface AuditEventDetails {
  commandName?: string;
  commandLabel?: string;
  commandStep?: string;
  commandTransactionId?: string;
  lifecycleAction?: string;
  fromState?: string;
  toState?: string;
}

export class AuditService {
  private readonly events: AuditEvent[] = [];
  private nextAuditId = 1;

  constructor(
    private readonly model: ResolvedApplicationModel,
    private readonly index = new RuntimeModelIndex(model),
    private readonly logger: RuntimeLogger = noopRuntimeLogger,
  ) {}

  record(
    operation: AuditOperation,
    objectName: string,
    record: StoredObjectRecord,
    context: RuntimeContext,
    before?: Record<string, JsonValue>,
    after?: Record<string, JsonValue>,
    details: AuditEventDetails = {},
  ): AuditEvent | undefined {
    this.logger.debug("ENTER AuditService.record", {
      objectName,
      recordId: record.meta.guid,
      operation,
    });

    const object = this.index.getObject(objectName);
    if (
      !this.model.audit.enabled ||
      !object.audit.enabled ||
      !this.model.audit.operations.includes(operation) ||
      !object.audit.operations.includes(operation)
    ) {
      this.logger.debug("EXIT AuditService.record", { recorded: false });
      return undefined;
    }

    const event: AuditEvent = {
      auditId: `audit-${this.nextAuditId++}`,
      object: objectName,
      recordId: record.meta.guid,
      operation,
      ...(details.commandName === undefined ? {} : { commandName: details.commandName }),
      ...(details.commandLabel === undefined ? {} : { commandLabel: details.commandLabel }),
      ...(details.commandStep === undefined ? {} : { commandStep: details.commandStep }),
      ...(details.commandTransactionId === undefined
        ? {}
        : { commandTransactionId: details.commandTransactionId }),
      ...(details.lifecycleAction === undefined
        ? {}
        : { lifecycleAction: details.lifecycleAction }),
      ...(details.fromState === undefined ? {} : { fromState: details.fromState }),
      ...(details.toState === undefined ? {} : { toState: details.toState }),
      actorId: context.userId,
      occurredAt: getContextNowIso(context),
      ...(before === undefined ? {} : { before: cloneJson(before) }),
      ...(after === undefined ? {} : { after: cloneJson(after) }),
      metadata: cloneJson(record.meta),
    };

    this.events.push(event);
    this.logger.debug("EXIT AuditService.record", { recorded: true, auditId: event.auditId });
    return cloneJson(event);
  }

  getEvents(): AuditEvent[] {
    return cloneJson(this.events);
  }

  clear(): void {
    this.events.length = 0;
  }
}
