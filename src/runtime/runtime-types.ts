import type { Diagnostic } from "../compiler/validate-model.js";
import type { DiagnosticSeverity } from "../compiler/validate-model.js";
import type {
  JsonValue,
  PolicyAction,
  PolicyEffect,
  ReadModelSourceScope,
  ResolvedReadModel,
  ResolvedSort,
  RuntimeChannel,
  StoredObjectRecord,
  SyncMode,
  SyncScope,
} from "../model/resolved-model.js";

export type RuntimeAction = Exclude<PolicyAction, "*">;

export interface RuntimeContext {
  userId: string;
  roles: string[];
  selectedContexts?: Record<string, string>;
  contextRoles?: RuntimeContextRole[];
  groups?: Record<string, string[]>;
  now?: Date;
  channel: RuntimeChannel;
  online?: boolean;
  requestId?: string;
}

export interface RuntimeContextRole {
  context: string;
  contextId: string;
  role: string;
  membershipRecordId?: string;
}

export interface RuntimeAvailableContext {
  context: string;
  id: string;
  label: string;
  roles: string[];
  roleEntries: RuntimeContextRole[];
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

export interface RuntimeReadModelQuery {
  sort?: ResolvedSort[];
  limit?: number;
}

export interface RuntimeReadModelSourceReference {
  objectName: string;
  recordId: string;
}

export interface RuntimeReadModelRow {
  id: string;
  readModel: string;
  values: Record<string, JsonValue>;
  sources: Record<string, RuntimeReadModelSourceReference>;
}

export interface RuntimeReadModelResult {
  readModel: ResolvedReadModel;
  rows: RuntimeReadModelRow[];
}

export type RuntimeOfflineDatasetReason =
  | {
      kind: "objectSync";
      mode: SyncMode;
      scope: SyncScope;
    }
  | {
      kind: "readModelSource";
      readModel: string;
      source: string;
      sourceScope: ReadModelSourceScope;
      mode: SyncMode;
    };

export interface RuntimeOfflineDatasetRecord {
  objectName: string;
  recordId: string;
  reasons: RuntimeOfflineDatasetReason[];
}

export interface RuntimeOfflineDataset {
  records: RuntimeOfflineDatasetRecord[];
  contextRoles: RuntimeContextRole[];
}

export interface RuntimeValidationIssue {
  code: string;
  message: string;
  path?: string;
  field?: string;
}

export interface RuntimeStartupDiagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  path?: string;
  objectName?: string;
  recordId?: string;
  expected?: string | number;
  actual?: string | number | null;
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
  effect: PolicyEffect;
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

export class RuntimeStartupError extends RuntimeError {
  readonly diagnostics: RuntimeStartupDiagnostic[];

  constructor(diagnostics: RuntimeStartupDiagnostic[]) {
    super(
      "ADL_RUNTIME_STARTUP_COMPATIBILITY_FAILED",
      "Persisted runtime data is incompatible with the resolved application model.",
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

export class RuntimeContextError extends RuntimeError {
  constructor(message: string, details?: unknown) {
    super("ADL_RUNTIME_CONTEXT_ERROR", message, details);
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
    ...(context.selectedContexts === undefined
      ? {}
      : { selectedContexts: { ...context.selectedContexts } }),
    ...(context.contextRoles === undefined
      ? {}
      : {
          contextRoles: context.contextRoles.map((role) => ({
            context: role.context,
            contextId: role.contextId,
            role: role.role,
          })),
        }),
    channel: context.channel,
    online: context.online ?? true,
    ...(context.requestId === undefined ? {} : { requestId: context.requestId }),
  };
}
