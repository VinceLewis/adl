import type {
  LocalOperationKind,
  ResolvedApplicationModel,
  ResolvedObject,
  SyncMode,
} from "../model/resolved-model.js";
import { RuntimeModelIndex } from "./model-helpers.js";
import { RuntimeError, noopRuntimeLogger, safeContextLog } from "./runtime-types.js";
import type { RuntimeContext, RuntimeLogger } from "./runtime-types.js";

export interface SyncWriteDecision {
  allowed: boolean;
  objectName: string;
  operation: LocalOperationKind;
  mode: SyncMode;
  online: boolean;
  queueable: boolean;
  readonly: boolean;
  reason: string;
}

export interface SyncObjectState {
  objectName: string;
  mode: SyncMode;
  online: boolean;
  queueable: boolean;
  readonly: boolean;
  label: string;
  detail: string;
}

export class SyncPolicyError extends RuntimeError {
  readonly decision: SyncWriteDecision;

  constructor(message: string, decision: SyncWriteDecision) {
    super("ADL_SYNC_POLICY_DENIED", message, { decision });
    this.decision = decision;
  }
}

export class SyncPolicyService {
  constructor(
    private readonly model: ResolvedApplicationModel,
    private readonly index = new RuntimeModelIndex(model),
    private readonly logger: RuntimeLogger = noopRuntimeLogger,
  ) {}

  evaluateLocalWrite(
    objectName: string,
    operation: LocalOperationKind,
    context: RuntimeContext,
  ): SyncWriteDecision {
    const object = this.index.getObject(objectName);
    const online = isOnline(context);
    const mode = object.sync.mode;
    const readonly = mode === "cacheReadonly" || (mode === "onlineRequired" && !online);
    const allowed = !readonly;
    const decision: SyncWriteDecision = {
      allowed,
      objectName,
      operation,
      mode,
      online,
      queueable: mode === "localFirst",
      readonly,
      reason: getWriteReason(object, operation, mode, online),
    };

    this.logger.debug("SyncPolicyService.evaluateLocalWrite", {
      objectName,
      operation,
      mode,
      allowed,
      context: safeContextLog(context),
    });

    return decision;
  }

  requireLocalWriteAllowed(
    objectName: string,
    operation: LocalOperationKind,
    context: RuntimeContext,
  ): SyncWriteDecision {
    const decision = this.evaluateLocalWrite(objectName, operation, context);

    if (!decision.allowed) {
      throw new SyncPolicyError(decision.reason, decision);
    }

    return decision;
  }

  getObjectState(objectName: string, context: RuntimeContext): SyncObjectState {
    const object = this.index.getObject(objectName);
    const online = isOnline(context);
    const mode = object.sync.mode;
    const readonly = mode === "cacheReadonly" || (mode === "onlineRequired" && !online);

    return {
      objectName,
      mode,
      online,
      queueable: mode === "localFirst",
      readonly,
      label: getModeLabel(mode, online),
      detail: getModeDetail(mode, online),
    };
  }
}

function isOnline(context: RuntimeContext): boolean {
  return context.online ?? true;
}

function getWriteReason(
  object: ResolvedObject,
  operation: LocalOperationKind,
  mode: SyncMode,
  online: boolean,
): string {
  if (mode === "cacheReadonly") {
    return `Object '${object.name}' is cache-readonly and cannot be written locally.`;
  }

  if (mode === "onlineRequired" && !online) {
    return `Object '${object.name}' requires an online connection before ${operation} can run.`;
  }

  if (mode === "localPrivate") {
    return `Object '${object.name}' is local-private; ${operation} stays on this device.`;
  }

  if (mode === "onlineRequired") {
    return `Object '${object.name}' is online-required and may be written while online.`;
  }

  return `Object '${object.name}' is local-first; ${operation} can be recorded locally.`;
}

function getModeLabel(mode: SyncMode, online: boolean): string {
  switch (mode) {
    case "cacheReadonly":
      return "Read-only cache";
    case "onlineRequired":
      return online ? "Online required" : "Offline";
    case "localPrivate":
      return "Local private";
    case "localFirst":
      return online ? "Local first" : "Offline";
  }
}

function getModeDetail(mode: SyncMode, online: boolean): string {
  switch (mode) {
    case "cacheReadonly":
      return "Local writes are blocked.";
    case "onlineRequired":
      return online ? "Writes require an online context." : "Online-required writes are blocked.";
    case "localPrivate":
      return "Local writes are not queued for sync.";
    case "localFirst":
      return online ? "Local writes are queued for sync." : "Local writes queue until online.";
  }
}
