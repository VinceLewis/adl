import type { Diagnostic } from "../compiler/validate-model.js";
import type {
  JsonValue,
  PolicyAction,
  PolicyEffect,
  RuntimeChannel,
  StoredObjectRecord,
} from "../model/resolved-model.js";

export type RuntimeAction = Exclude<PolicyAction, "*">;

export interface RuntimeContext {
  userId: string;
  roles: string[];
  groups?: Record<string, string[]>;
  now?: Date;
  channel: RuntimeChannel;
  online?: boolean;
  requestId?: string;
}

export interface RuntimeLogger {
  debug(message: string, metadata?: Record<string, unknown>): void;
}

export const noopRuntimeLogger: RuntimeLogger = {
  debug: () => undefined,
};

export interface RuntimeSearchQuery {
  text?: string;
  fields?: string[];
  includeDeleted?: boolean;
  limit?: number;
}

export type RuntimeSearchInput = string | RuntimeSearchQuery | undefined;

export interface RuntimeValidationIssue {
  code: string;
  message: string;
  path?: string;
  field?: string;
}

export interface PolicyRequest {
  objectName: string;
  action: RuntimeAction;
  record?: StoredObjectRecord;
  field?: string;
  currentState?: string;
  targetState?: string;
  lifecycleAction?: string;
  patch?: Record<string, JsonValue>;
  channel?: RuntimeChannel;
}

export interface PolicyDecisionReason {
  policyName: string;
  ruleName?: string;
  message: string;
}

export interface PolicyDecision {
  effect: PolicyEffect;
  reasons: PolicyDecisionReason[];
}

export class RuntimeError extends Error {
  readonly code: string;
  readonly details: unknown | undefined;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class RuntimeModelError extends RuntimeError {
  constructor(message: string, details?: unknown) {
    super("ADL_RUNTIME_MODEL_ERROR", message, details);
  }
}

export class ModelValidationError extends RuntimeError {
  readonly diagnostics: Diagnostic[];

  constructor(diagnostics: Diagnostic[]) {
    super(
      "ADL_RUNTIME_MODEL_VALIDATION_FAILED",
      "Resolved application model failed validation before runtime startup.",
      { diagnostics },
    );
    this.diagnostics = diagnostics;
  }
}

export class PolicyDeniedError extends RuntimeError {
  readonly decision: PolicyDecision;

  constructor(message: string, decision: PolicyDecision) {
    super("ADL_POLICY_DENIED", message, { decision });
    this.decision = decision;
  }
}

export class RuntimeValidationError extends RuntimeError {
  readonly issues: RuntimeValidationIssue[];

  constructor(message: string, issues: RuntimeValidationIssue[]) {
    super("ADL_RUNTIME_VALIDATION_FAILED", message, { issues });
    this.issues = issues;
  }
}

export class LifecycleError extends RuntimeError {
  constructor(message: string, details?: unknown) {
    super("ADL_LIFECYCLE_ERROR", message, details);
  }
}

export class StorageError extends RuntimeError {
  constructor(message: string, details?: unknown) {
    super("ADL_STORAGE_ERROR", message, details);
  }
}

export class HookError extends RuntimeError {
  constructor(message: string, details?: unknown) {
    super("ADL_HOOK_ERROR", message, details);
  }
}

export function getContextNow(context: RuntimeContext): Date {
  return context.now ?? new Date();
}

export function getContextNowIso(context: RuntimeContext): string {
  return getContextNow(context).toISOString();
}

export function toOperationLogChannel(
  channel: RuntimeChannel,
): Extract<RuntimeChannel, "ui" | "api" | "sync"> {
  if (channel === "ui" || channel === "api" || channel === "sync") {
    return channel;
  }

  return "api";
}

export function normaliseSearchQuery(input: RuntimeSearchInput): RuntimeSearchQuery {
  if (typeof input === "string") {
    return input.length === 0 ? {} : { text: input };
  }

  return input ?? {};
}

export function cloneJson<T>(input: T): T {
  return JSON.parse(JSON.stringify(input)) as T;
}

export function safeContextLog(context: RuntimeContext): Record<string, unknown> {
  return {
    userId: context.userId,
    roles: [...context.roles],
    channel: context.channel,
    online: context.online ?? true,
    ...(context.requestId === undefined ? {} : { requestId: context.requestId }),
  };
}
