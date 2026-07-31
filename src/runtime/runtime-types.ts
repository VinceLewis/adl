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
  /**
   * Context instances this caller can reach without being a member of them,
   * from a declared `ResolvedContextGrant` or from a context a command just
   * created. They widen the object-scope gate and nothing else: role matching
   * never reads this, so a grant-holder meets only the rules written for a
   * non-member.
   */
  contextGrants?: RuntimeContextGrant[];
  /**
   * Co-members of the caller's reachable context instances, keyed by context
   * name, resolved from accepted membership records. Only populated when the
   * model declares a `contextMember` principal that needs it; absent means such
   * a principal cannot match, which is the fail-closed direction.
   */
  contextMembers?: Record<string, string[]>;
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

export interface RuntimeContextGrant {
  context: string;
  contextId: string;
  /** The declared grant that produced this, or `undefined` for one a command established. */
  grant?: string;
  grantRecordId?: string;
}

export interface RuntimeAvailableContext {
  context: string;
  id: string;
  label: string;
  roles: string[];
  roleEntries: RuntimeContextRole[];
  /**
   * Grants that made this instance reachable. A context available only through
   * a grant has empty `roles`, which is how a caller and a renderer can tell
   * "invited" apart from "joined".
   */
  grantEntries: RuntimeContextGrant[];
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
  sort?: ResolvedSort[];
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

export class DecisionTableError extends RuntimeError {
  constructor(message: string, details?: unknown) {
    super("ADL_DECISION_TABLE_ERROR", message, details);
  }
}

export class StorageError extends RuntimeError {
  constructor(message: string, details?: unknown) {
    super("ADL_STORAGE_ERROR", message, details);
  }
}

/**
 * A caller-supplied record id that could not be a usable storage key. It is
 * refused before it reaches storage, so a malformed id never becomes a real
 * PostgreSQL failure.
 */
export class RecordIdInvalidError extends RuntimeError {
  constructor(message: string, details?: unknown) {
    super("ADL_RUNTIME_RECORD_ID_INVALID", message, details);
  }
}

/**
 * A create under an id that already names a record — a tombstone included. Naming
 * a record is not authority over it, so this is a refusal rather than an
 * overwrite, a merge, or a silent adoption of the existing record.
 */
export class RecordIdUnavailableError extends RuntimeError {
  constructor(message: string, details?: unknown) {
    super("ADL_RUNTIME_RECORD_ID_TAKEN", message, details);
  }
}

/**
 * A supplied command record-id manifest that does not describe the writes the
 * command actually plans.
 *
 * The manifest names records by step and iteration item, so a divergence means
 * the caller's execution and this one disagree about what the command does.
 * Adopting the ids anyway would attach an id to a different record than the one
 * it names — a silent identity swap, which is strictly worse than refusing. The
 * refusal is a `RuntimeError`, so it settles as an ordinary durable rejection
 * rather than as a retryable transport fault.
 */
export class CommandRecordIdsMismatchError extends RuntimeError {
  constructor(message: string, details?: unknown) {
    super("ADL_RUNTIME_COMMAND_RECORD_IDS_MISMATCH", message, details);
  }
}

/**
 * A discard asked for on a record the device is not free to throw away.
 *
 * Discarding is permitted only for a record whose own create the authority
 * refused, because that is the only case in which no authority copy exists. A
 * record whose *update* was refused is still held by the authority, so removing
 * it locally would delete something the next bootstrap restores — a silent
 * no-op dressed up as a repair.
 */
export class RecordNotDiscardableError extends RuntimeError {
  constructor(message: string, details?: unknown) {
    super("ADL_RUNTIME_RECORD_NOT_DISCARDABLE", message, details);
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
    ...(context.contextGrants === undefined
      ? {}
      : {
          contextGrants: context.contextGrants.map((grant) => ({
            context: grant.context,
            contextId: grant.contextId,
            ...(grant.grant === undefined ? {} : { grant: grant.grant }),
          })),
        }),
    channel: context.channel,
    online: context.online ?? true,
    ...(context.requestId === undefined ? {} : { requestId: context.requestId }),
  };
}
