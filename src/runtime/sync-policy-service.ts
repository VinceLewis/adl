import type {
  LocalOperationKind,
  ResolvedApplicationModel,
  ResolvedObject,
  SyncMode,
} from "../model/resolved-model.js";
import { RuntimeModelIndex } from "./model-helpers.js";
import { RuntimeError, noopRuntimeLogger, safeContextLog } from "./runtime-types.js";
import type { RuntimeContext, RuntimeLogger } from "./runtime-types.js";

/**
 * A write against one record. Neither a command nor a batch is ever one of
 * these: each is the transaction such writes commit in, and each is gated by the
 * modes of the objects its writes touch rather than by a mode of its own.
 */
export type LocalRecordWriteKind = Exclude<LocalOperationKind, "command" | "batch">;

export interface SyncWriteDecision {
  allowed: boolean;
  objectName: string;
  operation: LocalRecordWriteKind;
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

/**
 * Whether an accepted write of this mode is handed to the sync queue for
 * delivery to the authority. `localPrivate` never is, and `cacheReadonly` has no
 * accepted write to hand over; both remaining modes do, which is what gives an
 * `onlineRequired` write a delivery path rather than a local dead end.
 */
export function isQueueableSyncMode(mode: SyncMode): boolean {
  return mode === "localFirst" || mode === "onlineRequired";
}

/**
 * Whether a queued operation of this mode is expected to reach the authority
 * now rather than whenever the device next reconnects. A `localFirst` entry that
 * has not been delivered is holding, not failing; an `onlineRequired` entry was
 * only accepted because the authority was believed reachable, so a failure to
 * deliver it is a state the user has to be told about.
 */
export function requiresImmediateDelivery(mode: SyncMode): boolean {
  return mode === "onlineRequired";
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
    operation: LocalRecordWriteKind,
    context: RuntimeContext,
  ): SyncWriteDecision {
    const object = this.index.getObject(objectName);
    const online = isOnline(context);
    const mode = object.sync.mode;
    const readonly = isReadonly(mode, online, context.channel);
    const allowed = !readonly;
    const decision: SyncWriteDecision = {
      allowed,
      objectName,
      operation,
      mode,
      online,
      // A refused write is queue-neutral, so a mode that cannot be written here
      // is not queueable here either.
      queueable: !readonly && isQueueableSyncMode(mode),
      readonly,
      reason: getWriteReason(object, operation, mode, online, context.channel),
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
    operation: LocalRecordWriteKind,
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
    const readonly = isReadonly(mode, online, context.channel);

    return {
      objectName,
      mode,
      online,
      queueable: !readonly && isQueueableSyncMode(mode),
      readonly,
      label: getModeLabel(mode, online),
      detail: getModeDetail(mode, online),
    };
  }
}

function isOnline(context: RuntimeContext): boolean {
  return context.online ?? true;
}

/**
 * `localPrivate` is refused on the `sync` channel, which is the channel the
 * authority resolves its own context under. That is what makes the mode
 * symmetrical with `cacheReadonly` at the authority: a mode no client ever sends
 * is a mode the authority refuses to accept, so an accepted record can never
 * exist that no device will ever read back. Stating it here rather than in the
 * authority keeps one rule for one question, and covers a command intent whose
 * steps write several objects.
 */
function isReadonly(mode: SyncMode, online: boolean, channel: RuntimeContext["channel"]): boolean {
  if (mode === "cacheReadonly") return true;
  if (mode === "onlineRequired") return !online;
  if (mode === "localPrivate") return channel === "sync";
  return false;
}

function getWriteReason(
  object: ResolvedObject,
  operation: LocalRecordWriteKind,
  mode: SyncMode,
  online: boolean,
  channel: RuntimeContext["channel"],
): string {
  if (mode === "cacheReadonly") {
    return `Object '${object.name}' is cache-readonly and cannot be written locally.`;
  }

  if (mode === "onlineRequired" && !online) {
    return `Object '${object.name}' requires an online connection before ${operation} can run.`;
  }

  if (mode === "localPrivate" && channel === "sync") {
    return `Object '${object.name}' is local-private and is never written over the sync channel.`;
  }

  if (mode === "localPrivate") {
    return `Object '${object.name}' is local-private; ${operation} stays on this device.`;
  }

  if (mode === "onlineRequired") {
    return `Object '${object.name}' is online-required; ${operation} is queued and delivered to the server.`;
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
      return online
        ? "Writes are queued and delivered to the server."
        : "Online-required writes are blocked.";
    case "localPrivate":
      return "Local writes are not queued for sync.";
    case "localFirst":
      return online ? "Local writes are queued for sync." : "Local writes queue until online.";
  }
}
