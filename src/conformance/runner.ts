import { explainPolicyRequest, explainResolvedModel, inspectResolvedModel } from "../inspect.js";
import type {
  JsonValue,
  PartialApplicationModel,
  PolicyAction,
  ResolvedApplicationModel,
  ResolvedExpression,
  RuntimeChannel,
  StoredObjectRecord,
} from "../model/resolved-model.js";
import { resolveApplicationModel } from "../compiler/resolve-model.js";
import { validateApplicationModel } from "../compiler/validate-model.js";
import { adlAstToPartialApplicationModel } from "../compiler/compile-adl.js";
import { parseAdl } from "../parser/parser.js";
import { evaluateExpression } from "../runtime/expression-evaluator.js";
import { ApplicationRuntime } from "../runtime/application-runtime.js";
import { InMemoryObjectStorageBackend } from "../runtime/object-storage-backend.js";
import type {
  ObjectStorageBackend,
  PersistedApplicationMetadata,
} from "../runtime/object-storage-backend.js";
import { runRuntimeStartupCompatibilityChecks } from "../runtime/startup-compatibility.js";
import { RuntimeStartupError, noopRuntimeLogger } from "../runtime/runtime-types.js";
import type { RuntimeStartupDiagnostic } from "../runtime/runtime-types.js";
import { SyncPolicyError } from "../runtime/sync-policy-service.js";
import type { SyncWriteDecision } from "../runtime/sync-policy-service.js";
import type { SyncQueueEntry } from "../runtime/sync-queue.js";
import type {
  RuntimeApplyStagedChildResult,
  RuntimeEditSection,
  RuntimeEditSurface,
  RuntimeRelationshipPickerResult,
  RuntimeRelationshipPickerSummary,
} from "../runtime/edit-surface-runtime.js";
import { createConformanceStorage } from "./storage-behaviours.js";
import type { ConformanceStorageBehaviour } from "./storage-behaviours.js";
export type { ConformanceStorageBehaviour } from "./storage-behaviours.js";
import { AuthorityService } from "../server/authority-service.js";
import { StaticSessionAdapter } from "../server/session-adapter.js";
import { AuthoritySyncClient } from "../server/sync-client.js";
import type { AuthorityTransport, SyncRecoveryChoice } from "../server/sync-client.js";
import type { AuthorityOperationIntent, AuthorityOutcome } from "../server/authority-types.js";
import type {
  PolicyRequest,
  RuntimeContext,
  RuntimeReadModelQuery,
  RuntimeSearchInput,
} from "../runtime/runtime-types.js";

export interface ConformanceSuite {
  version: 1;
  models?: Record<string, ConformanceModelInput>;
  cases: ConformanceCase[];
}

/**
 * A model authored in ADL source rather than in the resolved model's own shape.
 *
 * Every other model in the corpus is a partial resolved model, which states what
 * a runtime must *hold* and says nothing at all about the language that produced
 * it. `docs/spec/language.md` is one of the three specification layers, and until
 * this existed no case could pin a single line of it: a syntax could be added,
 * removed or silently changed in meaning and the whole suite would still pass.
 *
 * The source is a list of lines rather than one string because ADL is
 * line-oriented and JSON has no multi-line literal. Lines are joined with a
 * newline exactly as written, so indentation in the corpus is indentation in the
 * source.
 */
export interface ConformanceAdlSource {
  adl: string | string[];
}

export type ConformanceModelInput = PartialApplicationModel | ConformanceAdlSource;

export type ConformanceCase =
  | ExpressionConformanceCase
  | ModelResolutionConformanceCase
  | ModelValidationConformanceCase
  | InspectConformanceCase
  | RuntimeConformanceCase
  | StartupCompatibilityConformanceCase
  | ModelFingerprintConformanceCase
  | ModelMigrationConformanceCase
  | AuthorityConformanceCase
  | AuthorityBootstrapConformanceCase
  | SyncReconcileConformanceCase;

export interface ConformanceCaseBase {
  id: string;
  title: string;
  specRef: string;
  expected: ConformanceExpected;
}

export interface ExpressionConformanceCase extends ConformanceCaseBase {
  operation: "expression";
  input: {
    expression: ResolvedExpression;
    values?: Record<string, JsonValue>;
    context: JsonRuntimeContext;
  };
}

export interface ModelResolutionConformanceCase extends ConformanceCaseBase {
  operation: "resolveModel";
  model?: ConformanceModelInput;
  modelRef?: string;
  input?: {
    select?: string[];
  };
}

export interface ModelValidationConformanceCase extends ConformanceCaseBase {
  operation: "validateModel";
  model?: ConformanceModelInput | ResolvedApplicationModel;
  modelRef?: string;
}

export interface InspectConformanceCase extends ConformanceCaseBase {
  operation: "inspectResolvedModel";
  model?: ConformanceModelInput;
  modelRef?: string;
  input?: {
    selectOrigins?: string[];
    includeText?: boolean;
  };
}

export interface StartupCompatibilityConformanceCase extends ConformanceCaseBase {
  operation: "startupCompatibility";
  model?: ConformanceModelInput;
  modelRef?: string;
  input?: {
    /**
     * The model that wrote the persisted state. The runner resolves it and
     * derives the persisted version and fingerprint from it, so a case can say
     * "state written by this model, opened by that one" without ever naming a
     * digest — which would pin the whole resolved-model shape and break on any
     * unrelated model addition.
     */
    persistedModel?: ConformanceModelInput | { modelRef: string };
    /** Literal metadata; overrides anything `persistedModel` derived. */
    applicationMetadata?: PersistedApplicationMetadata;
    records?: Array<{ objectName: string; record: StoredObjectRecord }>;
  };
}

/**
 * Fingerprint equality between two models, rather than a literal digest.
 *
 * A case that pinned the hash text would pin the entire resolved-model shape
 * with it and break on every unrelated model addition, which would teach a
 * second runtime nothing. What is actually contractual is the *relation*: two
 * resolutions of the same content agree, and any content change disagrees.
 */
export interface ModelFingerprintConformanceCase extends ConformanceCaseBase {
  operation: "compareModelFingerprints";
  input: {
    left: ConformanceModelInput | { modelRef: string };
    right: ConformanceModelInput | { modelRef: string };
  };
}

/**
 * Persisted state carried across a model version change. The case seeds records
 * and metadata at an older version, runs the startup guard with migration
 * enabled, and asserts both the diagnostics and the resulting records — so a
 * conforming runtime is pinned on what a migration does, not only on whether it
 * was allowed.
 */
export interface ModelMigrationConformanceCase extends ConformanceCaseBase {
  operation: "migratePersistedState";
  model?: ConformanceModelInput;
  modelRef?: string;
  input: {
    /** The model that wrote the state; see the startup-compatibility case. */
    persistedModel?: ConformanceModelInput | { modelRef: string };
    /** Literal metadata; overrides anything `persistedModel` derived. */
    applicationMetadata?: PersistedApplicationMetadata;
    records?: Array<{ objectName: string; record: StoredObjectRecord }>;
    /** Off means plan only: the case asserts a refusal without rewriting state. */
    applyMigrations?: boolean;
    /**
     * The storage the migration runs against. The default backend always
     * supports transactions and never fails, so without this a case could only
     * ever state what a migration does when everything works — leaving the
     * fail-closed half of the guarantee unsayable.
     */
    storage?: ConformanceStorageBehaviour;
  };
}

/**
 * An authority replay outcome and its classification. This is the only layer
 * whose semantics live on the server rather than in the runtime, and it is where
 * record identity is decided: a create carries the id the client already holds,
 * a colliding id is refused rather than merged, and a malformed id never reaches
 * storage.
 */
export interface AuthorityConformanceCase extends ConformanceCaseBase {
  operation: "authorityReplay";
  model?: ConformanceModelInput;
  modelRef?: string;
  input: {
    /** Seeded through the same replay path, so nothing bypasses the authority. */
    setup?: AuthorityConformanceIntent[];
    intent: AuthorityOperationIntent;
    /** Which seeded session submits the intent; defaults to the first declared. */
    session?: string;
    sessions?: Record<string, { userId: string }>;
  };
}

/**
 * What a device gets back from the authority. Replay states what the authority
 * *accepts*; without this the other half of a sync mode's contract — whether an
 * accepted record ever returns to a device — was unsayable, and a mode could be
 * silently write-only without any case noticing.
 */
export interface AuthorityBootstrapConformanceCase extends ConformanceCaseBase {
  operation: "authorityBootstrap";
  model?: ConformanceModelInput;
  modelRef?: string;
  input: {
    /** Seeded through the replay path, so the bootstrap reads real accepted state. */
    setup?: AuthorityConformanceIntent[];
    /** Which seeded session pulls; defaults to the first declared. */
    session?: string;
    sessions?: Record<string, { userId: string }>;
    selectedContexts?: Record<string, string>;
  };
}

/**
 * A device's queue drained against a real authority.
 *
 * Every other operation observes one side of the sync boundary: `syncWrite` and
 * `syncCommand` state what a local write left in the queue, `authorityReplay`
 * and `authorityBootstrap` state what the server does with an intent a case
 * spells out by hand. Nothing joined the two, so what a *verdict* does to the
 * device that provoked it — which records it settles, which it refuses, and what
 * a resubmission clears — was unsayable, and a record's sync state is precisely
 * that.
 *
 * The runner therefore builds both halves and runs the real
 * `AuthoritySyncClient` between them over an in-process transport. Nothing here
 * is a stand-in: the device writes through `ApplicationRuntime`, the authority
 * answers through `AuthorityService.replay`, and the intents that cross between
 * them are the ones the client itself emits from the queue.
 *
 * The phases run in the order they are declared below. `resolve` is applied
 * after a bootstrap, which is the order the recovery primitives are defined in:
 * `keepServer` relies on the authority's state having already replaced the local
 * record, and `resubmitMine` rebases on the revision that bootstrap wrote.
 */
export interface SyncReconcileConformanceCase extends ConformanceCaseBase {
  operation: "syncReconcile";
  model?: ConformanceModelInput;
  modelRef?: string;
  input: {
    sessions?: Record<string, { userId: string }>;
    /** Which seeded session the device holds; defaults to the first declared. */
    session?: string;
    /** State the authority already holds, seeded through the same replay path. */
    authoritySetup?: AuthorityConformanceIntent[];
    /**
     * Whether the device pulls the authority's state before it writes. A device
     * can only conflict over a record it already holds, and the honest way to
     * hold one is to have been given it.
     */
    deviceBootstrap?: boolean;
    /** What the device did locally, through the real runtime. */
    device: RuntimeConformanceStep[];
    /**
     * Intents another client lands after the device wrote and before the queue
     * drains. This is what moves the authority on underneath a queued operation,
     * and it is the only honest way to reach a conflict: seeding a stale
     * revision into the device's storage would prove the device was never told.
     */
    concurrent?: AuthorityConformanceIntent[];
    /** The context the device drains its queue under. */
    context: JsonRuntimeContext;
    /**
     * A resolution applied to every entry the reconcile left holding a verdict.
     * `keepServer` abandons the local operation; `resubmitMine` sends it again
     * for the authority to judge afresh. Neither invents a winner.
     */
    resolve?: SyncRecoveryChoice;
  };
}

export interface AuthorityConformanceIntent {
  session?: string;
  intent: AuthorityOperationIntent;
  /**
   * Names this step's outcome so a later intent can refer to what it produced —
   * `{"$ref": "seeded.records.0.meta.revision"}` rather than a literal revision.
   * Revisions are minted by the runtime, so a case that spelled one out would
   * pin a format no specification defines and fail a conforming runtime that
   * minted ULIDs instead.
   */
  alias?: string;
  /**
   * The status this seed must produce; `accepted` unless the case is
   * deliberately seeding a refusal. A seed whose outcome is never checked can
   * fail silently and leave a rejection-expecting case passing because the store
   * was empty rather than because the rule under test fired.
   */
  expect?: AuthorityOutcome["status"];
}

export interface RuntimeConformanceCase extends ConformanceCaseBase {
  operation:
    | "policyDecision"
    | "create"
    | "read"
    | "update"
    | "delete"
    | "search"
    | "transition"
    | "executeCommand"
    | "evaluateDecisionTable"
    | "executeReadModel"
    | "evaluatePresentationView"
    | "evaluateEditSurface"
    | "evaluateRelationshipPicker"
    | "applyStagedChildChanges"
    | "evaluateOfflineDataset"
    | "syncWrite"
    | "syncCommand"
    | "readPersistedRecords"
    | "readRecordRevisions";
  model?: ConformanceModelInput;
  modelRef?: string;
  /**
   * Storage-shaped preconditions, written straight into the backend before the
   * runtime opens it.
   *
   * This exists for states `setup` cannot reach: a `cacheReadonly` object, whose
   * every write path is refused by design, and records that predate a rule the
   * runtime now enforces. It is not a shortcut around the boundary under test —
   * anything the runtime can arrange must still be arranged through `setup`,
   * because a seed that bypasses validation, policy or sync gating proves those
   * layers were skipped rather than that they agreed.
   */
  records?: Array<{ objectName: string; record: StoredObjectRecord }>;
  setup?: RuntimeConformanceStep[];
  input: RuntimeConformanceInput;
}

export interface RuntimeConformanceStep {
  /**
   * Ends the runtime this case has been using and opens a new one over the same
   * persisted state before this step runs — an ordinary process restart, which
   * is the only way a case can observe state a runtime holds per process rather
   * than in storage.
   *
   * A record revision is the reason this exists. It has to name one version of
   * one record for the life of the *state*, not the life of the process that
   * minted it, and a corpus with no way to restart could not tell the two apart:
   * a runtime numbering revisions from a counter it reset on construction passed
   * every case while reissuing revisions the authority's conflict check compares
   * for equality.
   */
  restartRuntime?: boolean;
  operation:
    | "create"
    | "update"
    | "delete"
    | "transition"
    | "executeCommand"
    | "applyStagedChildChanges";
  alias?: string;
  /** Required by every operation except `executeCommand`, which names a command instead. */
  objectName?: string;
  values?: Record<string, JsonValue>;
  id?: JsonValue;
  patch?: Record<string, JsonValue>;
  actionName?: string;
  /**
   * `executeCommand` only. A command is the one write a device makes that covers
   * several records at once, so it is also the only one whose refusal is about
   * more than the record its queue entry is filed under — which is exactly what
   * a case about a refused command has to be able to say. Every record the
   * command creates is registered under `<step>` (or `<step>.<itemIndex>`) in
   * the alias table, so no case ever spells out an id the runtime minted.
   */
  commandName?: string;
  input?: Record<string, JsonValue>;
  /**
   * `applyStagedChildChanges` only: the parent view whose child collections the
   * staged operations belong to, the parent record they are applied to, and the
   * operations themselves. This is the second multi-record write a device can
   * make, and like a command it commits as one transaction and queues once — so
   * a case about the sync boundary has to be able to make one.
   *
   * Every record the batch writes is registered in the alias table under the
   * staged operation's own id, which the case authored, so no case names an id
   * the runtime minted.
   */
  viewName?: string;
  parentRecordId?: JsonValue;
  stagedChanges?: ConformanceStagedChildOperation[];
  context: JsonRuntimeContext;
}

/**
 * One staged child change, exactly as a caller holds it before the parent's form
 * is saved. `id` is the case's own name for the operation and is what the runner
 * aliases the resulting record under.
 */
export interface ConformanceStagedChildOperation {
  id: string;
  section: string;
  operation: "createChild" | "linkExisting" | "updateChild" | "unlink" | "remove" | "reorder";
  childObject: string;
  childId?: string;
  values?: Record<string, JsonValue>;
  position?: number;
}

export type RuntimeConformanceInput =
  | {
      objectName: string;
      values?: Record<string, JsonValue>;
      id?: JsonValue;
      patch?: Record<string, JsonValue>;
      actionName?: string;
      query?: RuntimeSearchInput;
      context: JsonRuntimeContext;
    }
  | {
      request: JsonPolicyRequest;
      context: JsonRuntimeContext;
    }
  // Shared by `executeCommand`, which reports the records a command wrote, and
  // `syncCommand`, which reports those records *and* the queue entry the command
  // left behind. The input a command takes is the same either way.
  | {
      commandName: string;
      input: Record<string, JsonValue>;
      context: JsonRuntimeContext;
    }
  | {
      tableName: string;
      values: Record<string, JsonValue>;
      context: JsonRuntimeContext;
    }
  | {
      readModelName: string;
      context: JsonRuntimeContext;
      query?: RuntimeReadModelQuery;
    }
  | {
      objectName: string;
      viewName: string;
      context: JsonRuntimeContext;
      state?: Record<string, JsonValue>;
      updates?: Record<string, JsonValue>;
    }
  | {
      objectName: string;
      write: "create" | "update" | "delete" | "transition";
      values?: Record<string, JsonValue>;
      id?: JsonValue;
      patch?: Record<string, JsonValue>;
      actionName?: string;
      context: JsonRuntimeContext;
    }
  // `evaluateEditSurface`: the edit composition a view declares, resolved against
  // a parent record and whatever the caller has staged but not yet saved.
  | {
      objectName: string;
      viewName: string;
      mode: "create" | "edit";
      recordId?: JsonValue;
      stagedChanges?: ConformanceStagedChildOperation[];
      context: JsonRuntimeContext;
    }
  // `evaluateRelationshipPicker`: what one child collection's picker offers, for
  // this parent, given whatever the caller has staged but not yet saved.
  | {
      objectName: string;
      viewName: string;
      sectionName: string;
      recordId?: JsonValue;
      stagedChanges?: ConformanceStagedChildOperation[];
      query?: { text?: string; limit?: number };
      context: JsonRuntimeContext;
    }
  // `applyStagedChildChanges`: a staged batch committed against an existing
  // parent, reported together with the queue and the storage it left behind.
  | {
      objectName: string;
      viewName: string;
      parentRecordId: JsonValue;
      stagedChanges: ConformanceStagedChildOperation[];
      context: JsonRuntimeContext;
    }
  | {
      context: JsonRuntimeContext;
    };

type SyncWriteOperationInput = {
  objectName: string;
  write: "create" | "update" | "delete" | "transition";
  values?: Record<string, JsonValue>;
  id?: JsonValue;
  patch?: Record<string, JsonValue>;
  actionName?: string;
  context: JsonRuntimeContext;
};

/**
 * A command executed locally, reported together with the queue it left behind.
 *
 * `syncWrite` performs only create, update, delete and transition, so the
 * central guarantee of command replay — that a locally executed command leaves
 * exactly **one** queue entry, of kind `command`, naming every record it wrote —
 * had no way into the corpus at all. It is stated the same way `syncWrite`
 * states a mode: by reporting what the runtime did *and* the queue that resulted,
 * because an implementation could report a command result faithfully and still
 * queue its steps one by one.
 */
type SyncCommandOperationInput = {
  commandName: string;
  input: Record<string, JsonValue>;
  context: JsonRuntimeContext;
};

/**
 * A staged batch of child changes, reported together with the queue *and* the
 * storage it left behind.
 *
 * Three observations rather than one, for the reason `syncReconcile` reports
 * three. The result says what the runtime claims it did; the queue says what the
 * authority will be told; storage says what the device is actually holding. Any
 * one alone is satisfiable by a runtime that applies the changes one at a time
 * and reports them as a batch — and a batch applied one at a time is the exact
 * defect this closes, because it can fail halfway and leave the parent's
 * children half-changed.
 */
type StagedChildOperationInput = {
  objectName: string;
  viewName: string;
  parentRecordId: JsonValue;
  stagedChanges: ConformanceStagedChildOperation[];
  context: JsonRuntimeContext;
};

type PresentationViewOperationInput = {
  objectName: string;
  viewName: string;
  context: JsonRuntimeContext;
  state?: Record<string, JsonValue>;
  updates?: Record<string, JsonValue>;
};

/**
 * An edit surface evaluated for a parent record, including whatever the caller
 * has staged and not yet saved. `mode` distinguishes a form for a parent that
 * exists from one for a parent that does not, which is the whole reason staged
 * changes exist.
 */
type EditSurfaceOperationInput = {
  objectName: string;
  viewName: string;
  mode: "create" | "edit";
  recordId?: JsonValue;
  stagedChanges?: ConformanceStagedChildOperation[];
  context: JsonRuntimeContext;
};

/**
 * One child collection's picker, evaluated for a parent record.
 *
 * Separate from `evaluateEditSurface` because the two answer different
 * questions. The surface reports the picker's *declaration*; only this reports
 * what it actually offers, and the offer is where the two picker modes diverge:
 * a linking picker's candidates are the child records themselves, while a
 * minting picker's are records of whatever its candidate field looks up. Without
 * it a runtime could report a `candidateField` faithfully and still offer the
 * wrong object's records.
 *
 * `stagedChanges` is part of the input because exclusion is about the editing
 * session and not only about storage: a candidate a staged create already names
 * must not be offered a second time before the parent is ever saved.
 */
type RelationshipPickerOperationInput = {
  objectName: string;
  viewName: string;
  sectionName: string;
  recordId?: JsonValue;
  stagedChanges?: ConformanceStagedChildOperation[];
  query?: { text?: string; limit?: number };
  context: JsonRuntimeContext;
};

type ObjectRuntimeOperationInput = {
  objectName: string;
  values?: Record<string, JsonValue>;
  id?: JsonValue;
  patch?: Record<string, JsonValue>;
  actionName?: string;
  query?: RuntimeSearchInput;
  context: JsonRuntimeContext;
};

export interface JsonPolicyRequest {
  objectName: string;
  action: PolicyAction;
  record?: JsonValue;
  field?: string;
  currentState?: string;
  targetState?: string;
  lifecycleAction?: string;
  patch?: Record<string, JsonValue>;
  channel?: RuntimeChannel;
}

export interface JsonRuntimeContext {
  userId: string;
  roles: string[];
  selectedContexts?: Record<string, string>;
  contextRoles?: RuntimeContext["contextRoles"];
  groups?: Record<string, string[]>;
  now?: string;
  channel: RuntimeChannel;
  online?: boolean;
  requestId?: string;
}

export type ConformanceExpected = { ok: true; result: JsonValue } | { ok: false; error: JsonValue };

export type ConformanceActual = { ok: true; result: JsonValue } | { ok: false; error: JsonValue };

export interface ConformanceRunResult {
  id: string;
  title: string;
  specRef: string;
  pass: boolean;
  actual: ConformanceActual;
  expected: ConformanceExpected;
}

interface RunState {
  aliases: Record<string, unknown>;
  recordAliases: Map<string, string>;
  /**
   * Every revision this case's steps have seen, per record, in the order they
   * were seen. Kept because a revision's guarantee is about the *history* of a
   * record and not about any one value: nothing in a single result can say that
   * a revision was never issued before.
   */
  revisions?: Map<string, string[]>;
}

export async function runConformanceSuite(
  suite: ConformanceSuite,
): Promise<ConformanceRunResult[]> {
  const results: ConformanceRunResult[] = [];
  for (const conformanceCase of suite.cases) {
    results.push(await runConformanceCase(conformanceCase, suite.models ?? {}));
  }
  return results;
}

export async function runConformanceCase(
  conformanceCase: ConformanceCase,
  models: Record<string, ConformanceModelInput> = {},
): Promise<ConformanceRunResult> {
  const state: RunState = { aliases: {}, recordAliases: new Map() };
  const actual = await runCaseActual(conformanceCase, models, state);
  const expected = resolveRefs(conformanceCase.expected, state) as ConformanceExpected;

  return {
    id: conformanceCase.id,
    title: conformanceCase.title,
    specRef: conformanceCase.specRef,
    pass: matchesExpected(actual, expected),
    actual,
    expected,
  };
}

async function runCaseActual(
  conformanceCase: ConformanceCase,
  models: Record<string, ConformanceModelInput>,
  state: RunState,
): Promise<ConformanceActual> {
  try {
    switch (conformanceCase.operation) {
      case "expression":
        return runExpressionCase(conformanceCase);
      case "resolveModel":
        return runResolveModelCase(conformanceCase, models);
      case "validateModel":
        return runValidateModelCase(conformanceCase, models);
      case "inspectResolvedModel":
        return runInspectCase(conformanceCase, models);
      case "startupCompatibility":
        return await runStartupCompatibilityCase(conformanceCase, models);
      case "compareModelFingerprints":
        return runCompareModelFingerprintsCase(conformanceCase, models);
      case "migratePersistedState":
        return await runMigratePersistedStateCase(conformanceCase, models);
      case "authorityReplay":
        return await runAuthorityReplayCase(conformanceCase, models, state);
      case "authorityBootstrap":
        return await runAuthorityBootstrapCase(conformanceCase, models, state);
      case "syncReconcile":
        return await runSyncReconcileCase(conformanceCase, models, state);
      default:
        return await runRuntimeCase(conformanceCase, models, state);
    }
  } catch (error) {
    return {
      ok: false,
      error: normaliseError(error),
    };
  }
}

function runExpressionCase(conformanceCase: ExpressionConformanceCase): ConformanceActual {
  const result = evaluateExpression(conformanceCase.input.expression, {
    values: conformanceCase.input.values ?? {},
    context: parseContext(conformanceCase.input.context),
  });

  if (!result.ok) {
    return { ok: false, error: { code: result.error.code, message: result.error.message } };
  }

  return {
    ok: true,
    result: {
      kind: result.value.kind,
      value: result.value.value,
    },
  };
}

function runResolveModelCase(
  conformanceCase: ModelResolutionConformanceCase,
  models: Record<string, ConformanceModelInput>,
): ConformanceActual {
  const source = getPartialModel(conformanceCase, models);
  const model = resolveApplicationModel(source);
  const result =
    conformanceCase.input?.select === undefined
      ? (model as unknown as JsonValue)
      : selectPaths(model, conformanceCase.input.select);

  return { ok: true, result };
}

function runValidateModelCase(
  conformanceCase: ModelValidationConformanceCase,
  models: Record<string, ConformanceModelInput>,
): ConformanceActual {
  const source = getPartialOrResolvedModel(conformanceCase, models);
  const model = isResolvedApplicationModel(source) ? source : resolveApplicationModel(source);
  const diagnostics = validateApplicationModel(model);
  return {
    ok: true,
    result: diagnostics.map((diagnostic) => ({
      severity: diagnostic.severity,
      code: diagnostic.code,
      message: diagnostic.message,
      ...(diagnostic.path === undefined ? {} : { path: diagnostic.path }),
    })),
  };
}

function runInspectCase(
  conformanceCase: InspectConformanceCase,
  models: Record<string, ConformanceModelInput>,
): ConformanceActual {
  const source = getPartialModel(conformanceCase, models);
  const model = resolveApplicationModel(source);
  const explanation = explainResolvedModel(model, source);
  const selectedOrigins =
    conformanceCase.input?.selectOrigins === undefined
      ? explanation.entries
      : explanation.entries.filter((entry) =>
          conformanceCase.input?.selectOrigins?.includes(entry.path),
        );

  return {
    ok: true,
    result: {
      origins: selectedOrigins.map((entry) => ({
        path: entry.path,
        value: entry.value,
        origin: entry.origin,
      })),
      ...(conformanceCase.input?.includeText === true
        ? { text: inspectResolvedModel(model, source) }
        : {}),
    },
  };
}

async function runStartupCompatibilityCase(
  conformanceCase: StartupCompatibilityConformanceCase,
  models: Record<string, ConformanceModelInput>,
): Promise<ConformanceActual> {
  const source = getPartialModel(conformanceCase, models);
  const model = resolveApplicationModel(source);
  const storage = new InMemoryObjectStorageBackend();
  const seeded = seedMetadata(conformanceCase.input, models);
  if (seeded !== undefined) {
    await storage.writeApplicationMetadata(seeded);
  }
  for (const item of conformanceCase.input?.records ?? []) {
    await storage.create(item.objectName, item.record);
  }

  const runtime = new ApplicationRuntime(model, { storage });
  try {
    await runtime.whenReady();
  } catch (error) {
    return {
      ok: false,
      error: normaliseError(error),
    };
  }

  return {
    ok: true,
    result: runtime.getStartupDiagnostics().map((diagnostic) => ({
      severity: diagnostic.severity,
      code: diagnostic.code,
      ...(diagnostic.objectName === undefined ? {} : { objectName: diagnostic.objectName }),
      ...(diagnostic.recordId === undefined ? {} : { recordId: diagnostic.recordId }),
      ...(diagnostic.expected === undefined ? {} : { expected: diagnostic.expected }),
      ...(diagnostic.actual === undefined ? {} : { actual: diagnostic.actual }),
    })),
  };
}

function runCompareModelFingerprintsCase(
  conformanceCase: ModelFingerprintConformanceCase,
  models: Record<string, ConformanceModelInput>,
): ConformanceActual {
  const left = resolveApplicationModel(selectModel(conformanceCase.input.left, models));
  const right = resolveApplicationModel(selectModel(conformanceCase.input.right, models));

  return {
    ok: true,
    result: {
      equal: left.modelFingerprint === right.modelFingerprint,
      // Both halves are asserted because "same fingerprint" only means what it
      // should when the versions it is compared under are also known.
      leftModelVersion: left.modelVersion,
      rightModelVersion: right.modelVersion,
    },
  };
}

/**
 * The metadata a case wants persisted state to carry, derived from the model
 * that wrote it and then overridden by anything the case stated literally.
 */
function seedMetadata(
  input:
    | {
        persistedModel?: ConformanceModelInput | { modelRef: string };
        applicationMetadata?: PersistedApplicationMetadata;
      }
    | undefined,
  models: Record<string, ConformanceModelInput>,
): PersistedApplicationMetadata | undefined {
  if (input === undefined) {
    return undefined;
  }

  const derived =
    input.persistedModel === undefined
      ? undefined
      : (() => {
          const model = resolveApplicationModel(selectModel(input.persistedModel!, models));
          return {
            modelVersion: model.modelVersion,
            modelFingerprint: model.modelFingerprint,
          };
        })();

  if (derived === undefined && input.applicationMetadata === undefined) {
    return undefined;
  }

  return { ...derived, ...input.applicationMetadata } as PersistedApplicationMetadata;
}

function selectModel(
  source: ConformanceModelInput | { modelRef: string },
  models: Record<string, ConformanceModelInput>,
): PartialApplicationModel {
  return "modelRef" in source && typeof source.modelRef === "string"
    ? getPartialModel({ modelRef: source.modelRef }, models)
    : toPartialModel(source as ConformanceModelInput);
}

async function runMigratePersistedStateCase(
  conformanceCase: ModelMigrationConformanceCase,
  models: Record<string, ConformanceModelInput>,
): Promise<ConformanceActual> {
  const model = resolveApplicationModel(getPartialModel(conformanceCase, models));
  const storage = createConformanceStorage(conformanceCase.input.storage);
  const seeded = seedMetadata(conformanceCase.input, models);
  if (seeded !== undefined) {
    await storage.writeApplicationMetadata(seeded);
  }
  for (const item of conformanceCase.input.records ?? []) {
    await storage.create(item.objectName, item.record);
  }

  const report = async (diagnostics: RuntimeStartupDiagnostic[]): Promise<JsonValue> => ({
    diagnostics: diagnostics.map((diagnostic) => ({
      severity: diagnostic.severity,
      code: diagnostic.code,
      ...(diagnostic.path === undefined ? {} : { path: diagnostic.path }),
      ...(diagnostic.expected === undefined ? {} : { expected: diagnostic.expected }),
      ...(diagnostic.actual === undefined ? {} : { actual: diagnostic.actual }),
    })),
    // Read back from storage rather than reported by the migration, so a case
    // proves what was persisted and not merely what was intended.
    metadata: (await storage.readApplicationMetadata()) as unknown as JsonValue,
    records: (await storage.listRecords())
      .slice()
      .sort((left, right) => left.record.meta.guid.localeCompare(right.record.meta.guid))
      .map((persisted) => ({
        objectName: persisted.objectName,
        schemaVersion: persisted.record.meta.schemaVersion,
        values: persisted.record.values,
      })) as unknown as JsonValue,
  });

  try {
    const diagnostics = await runRuntimeStartupCompatibilityChecks(
      model,
      storage,
      noopRuntimeLogger,
      { applyMigrations: conformanceCase.input.applyMigrations ?? true },
    );
    return { ok: true, result: await report(diagnostics) };
  } catch (error) {
    if (error instanceof RuntimeStartupError) {
      // A refusal is a legitimate expected outcome, and the state it left
      // behind is the substance of the fail-closed guarantee, so it is reported
      // in the same shape as a success rather than as an opaque error.
      return { ok: false, error: await report(error.diagnostics) };
    }
    throw error;
  }
}

interface AuthorityFixture {
  authority: AuthorityService;
  tokenFor(sessionName: string | undefined): string | undefined;
  /**
   * Applies further intents to the same authority through the same replay path.
   * A reconcile case needs this after the device has written, to move the
   * authority on underneath a queued operation the way a second client would.
   */
  apply(steps: AuthorityConformanceIntent[] | undefined, label: string): Promise<void>;
}

/** The parts of a case that describe an authority, whatever else the case does. */
interface AuthorityFixtureInput {
  sessions?: Record<string, { userId: string }>;
  setup?: AuthorityConformanceIntent[];
}

/**
 * Builds the authority and its sessions, and applies every seeded intent through
 * the real replay path. Shared by the replay, bootstrap and reconcile operations
 * so a case reads state that was accepted exactly as any other client's would
 * be, rather than state written past the authority.
 */
async function seedAuthority(
  model: ResolvedApplicationModel,
  input: AuthorityFixtureInput,
  state: RunState,
): Promise<AuthorityFixture> {
  const declaredSessions = Object.entries(input.sessions ?? { primary: { userId: "user-1" } });
  const tokensByName = new Map(
    declaredSessions.map(([name], index) => [name, `${name}-${"t".repeat(48)}${index}`]),
  );
  const sessions = new StaticSessionAdapter(
    new Map(
      declaredSessions.map(([name, session]) => [
        tokensByName.get(name) ?? name,
        { userId: session.userId },
      ]),
    ),
  );
  const firstSessionName = declaredSessions[0]?.[0] ?? "primary";
  const authority = new AuthorityService(model, new InMemoryObjectStorageBackend(), sessions);

  const apply = async (
    steps: AuthorityConformanceIntent[] | undefined,
    label: string,
  ): Promise<void> => {
    for (const [index, step] of (steps ?? []).entries()) {
      // Resolved one step at a time, so a seed can be expressed in terms of what
      // the seed before it produced.
      const intent = resolveRefs(step.intent, state) as AuthorityOperationIntent;
      const outcome = await authority.replay(
        tokensByName.get(step.session ?? firstSessionName),
        intent,
      );

      const expected = step.expect ?? "accepted";
      if (outcome.status !== expected) {
        // Left as a thrown error rather than a status in the result, because a
        // failed seed means the case never ran the scenario it describes — and a
        // rejection-expecting case would otherwise pass on an empty store.
        throw new Error(
          `Authority ${label} step ${index} ('${step.intent.operationId}') was '${outcome.status}', expected '${expected}'.`,
        );
      }

      if (step.alias !== undefined) {
        state.aliases[step.alias] = outcome;
      }
    }
  };

  await apply(input.setup, "setup");

  return {
    authority,
    tokenFor: (sessionName) => tokensByName.get(sessionName ?? firstSessionName),
    apply,
  };
}

async function runAuthorityReplayCase(
  conformanceCase: AuthorityConformanceCase,
  models: Record<string, ConformanceModelInput>,
  state: RunState,
): Promise<ConformanceActual> {
  const fixture = await seedAuthority(
    resolveApplicationModel(getPartialModel(conformanceCase, models)),
    conformanceCase.input,
    state,
  );
  const outcome = await fixture.authority.replay(
    fixture.tokenFor(conformanceCase.input.session),
    resolveRefs(conformanceCase.input.intent, state) as AuthorityOperationIntent,
  );

  return { ok: true, result: normaliseAuthorityOutcome(outcome) };
}

/**
 * What an authenticated device reads back. Every page is followed, because a
 * bootstrap that stopped at page one would let a case claim a record was
 * withheld when it was merely on the next page.
 */
async function runAuthorityBootstrapCase(
  conformanceCase: AuthorityBootstrapConformanceCase,
  models: Record<string, ConformanceModelInput>,
  state: RunState,
): Promise<ConformanceActual> {
  const fixture = await seedAuthority(
    resolveApplicationModel(getPartialModel(conformanceCase, models)),
    conformanceCase.input,
    state,
  );
  const token = fixture.tokenFor(conformanceCase.input.session);
  // Resolved like an intent's, so a case can name a context a setup step
  // created. Without this a `{"$ref": ...}` reached `withSelectedContext`
  // verbatim, which threw, which the authority's catch-all turned into an empty
  // page — so a disclosure case would have "passed" by returning nothing for
  // entirely the wrong reason.
  const selected =
    conformanceCase.input.selectedContexts === undefined
      ? {}
      : {
          selectedContexts: resolveRefs(conformanceCase.input.selectedContexts, state) as Record<
            string,
            string
          >,
        };
  const records: Array<{ objectName: string; record: StoredObjectRecord }> = [];
  const usedCursors = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const page = await fixture.authority.bootstrap(token, {
      ...selected,
      ...(cursor === undefined ? {} : { cursor }),
    });
    records.push(...page.records);
    const next = page.nextCursor;
    if (next === undefined || page.records.length === 0 || usedCursors.has(next)) break;
    usedCursors.add(next);
    cursor = next;
  }

  return {
    ok: true,
    result: {
      // Ordered by name, not by the order the authority happened to page them
      // in, which no specification defines.
      records: records
        .map((entry) => ({
          object: entry.objectName,
          recordId: entry.record.meta.guid,
          values: entry.record.values,
          deleted: entry.record.meta.deletedAt !== undefined,
        }))
        .sort((left, right) =>
          `${left.object}\0${left.recordId}`.localeCompare(`${right.object}\0${right.recordId}`),
        ),
    } as unknown as JsonValue,
  };
}

/**
 * Reduces an outcome to its classification. Revisions, timestamps and actor ids
 * are generated, so a case asserts the record ids and values an outcome carries
 * rather than the whole record, which would make every case a snapshot.
 */
function normaliseAuthorityOutcome(outcome: AuthorityOutcome): JsonValue {
  if (outcome.status === "accepted") {
    return {
      status: outcome.status,
      operationId: outcome.operationId,
      records: outcome.records.map((record) => ({
        object: record.meta.object,
        recordId: record.meta.guid,
        schemaVersion: record.meta.schemaVersion,
        values: record.values,
        deleted: record.meta.deletedAt !== undefined,
      })),
    } as unknown as JsonValue;
  }

  return {
    status: outcome.status,
    operationId: outcome.operationId,
    code: outcome.code,
    ...("recovery" in outcome ? { recovery: outcome.recovery } : {}),
  } as unknown as JsonValue;
}

/**
 * A device's queue drained against a real authority, and what the verdicts left
 * on the device.
 *
 * The result is deliberately three observations rather than one. The outcomes
 * say what the authority decided; the queue says which entries survived that
 * decision; the persisted records say what the device is now holding and in what
 * sync state. Any one of them alone is satisfiable by a runtime that reports the
 * verdict faithfully and records nothing against the rows it covered — which is
 * the exact defect this phase exists to close.
 */
async function runSyncReconcileCase(
  conformanceCase: SyncReconcileConformanceCase,
  models: Record<string, ConformanceModelInput>,
  state: RunState,
): Promise<ConformanceActual> {
  const model = resolveApplicationModel(getPartialModel(conformanceCase, models));
  const input = conformanceCase.input;
  const fixture = await seedAuthority(
    model,
    {
      ...(input.sessions === undefined ? {} : { sessions: input.sessions }),
      ...(input.authoritySetup === undefined ? {} : { setup: input.authoritySetup }),
    },
    state,
  );
  const token = fixture.tokenFor(input.session);

  // In-process rather than over a socket: what is under test is the client's
  // use of the authority's own interface, and a transport that pattern-matched
  // intents would be a second implementation of the server.
  const transport: AuthorityTransport = {
    replay: (sessionToken, intent) => fixture.authority.replay(sessionToken, intent),
    bootstrap: (sessionToken, request) => fixture.authority.bootstrap(sessionToken, request),
  };

  const storage = new InMemoryObjectStorageBackend();
  const device = new ApplicationRuntime(model, { storage });
  const client = new AuthoritySyncClient(device, transport);
  const context = parseContext(input.context);

  if (input.deviceBootstrap === true) {
    await client.bootstrap(token, context);
  }

  for (const step of input.device) {
    const value = await runRuntimeStep(
      device,
      resolveRefs(step, state) as RuntimeConformanceStep,
      state,
    );
    if (step.alias !== undefined) {
      state.aliases[step.alias] = value;
      registerRecordAlias(step.alias, value, state);
    }
  }

  await fixture.apply(input.concurrent, "concurrent");

  const outcomes = await client.reconcile(token, context);

  if (input.resolve !== undefined) {
    // Bootstrapped first, because that is the order both primitives are defined
    // in: `keepServer` leaves the authority's state standing, and `resubmitMine`
    // rebases on the revision the bootstrap wrote.
    await client.bootstrap(token, context);
    for (const entry of device.syncQueue.getAwaitingRecovery()) {
      const outcome = await client.resolveRecovery(token, context, entry.queueId, input.resolve);
      if (outcome !== null) outcomes.push(outcome);
    }
  }

  const persisted = (await reportPersistedRecords(device, storage, state)) as {
    records: JsonValue;
  };

  return {
    ok: true,
    result: {
      outcomes: outcomes.map((outcome) => normaliseReconcileOutcome(outcome)),
      queue: device.syncQueue.getEntries().map((entry) => normaliseSyncQueueEntry(entry, state)),
      records: persisted.records,
    } as unknown as JsonValue,
  };
}

/**
 * A verdict reduced to what the device acted on. The operation id is minted by
 * the client, the records an accepted outcome carries are already observable as
 * persisted state, and a revision or timestamp would make every case a snapshot.
 */
function normaliseReconcileOutcome(outcome: AuthorityOutcome): JsonValue {
  return {
    status: outcome.status,
    ...(outcome.status === "accepted" ? {} : { code: outcome.code }),
  };
}

async function runRuntimeCase(
  conformanceCase: RuntimeConformanceCase,
  models: Record<string, ConformanceModelInput>,
  state: RunState,
): Promise<ConformanceActual> {
  const source = getPartialModel(conformanceCase, models);
  const storage = new InMemoryObjectStorageBackend();
  for (const item of conformanceCase.records ?? []) {
    await storage.create(item.objectName, item.record);
  }

  const model = resolveApplicationModel(source);
  // Rebuilt, not reused, whenever a step declares `restartRuntime`. A runtime
  // holding per-process state that a restart would lose is exactly what such a
  // case is about, so the case has to be able to make the process end.
  let runtime = new ApplicationRuntime(model, { storage });

  for (const setup of conformanceCase.setup ?? []) {
    if (setup.restartRuntime === true) {
      runtime = new ApplicationRuntime(model, { storage });
    }
    const value = await runRuntimeStep(
      runtime,
      resolveRefs(setup, state) as RuntimeConformanceStep,
      state,
    );
    recordRevisionObservations(value, state);
    if (setup.alias !== undefined) {
      state.aliases[setup.alias] = value;
      registerRecordAlias(setup.alias, value, state);
    }
  }

  const input = resolveRefs(conformanceCase.input, state) as RuntimeConformanceInput;

  if (conformanceCase.operation === "syncWrite") {
    return {
      ok: true,
      result: await runSyncWrite(runtime, input as SyncWriteOperationInput, state),
    };
  }

  if (conformanceCase.operation === "syncCommand") {
    return {
      ok: true,
      result: await runSyncCommand(runtime, input as SyncCommandOperationInput, state),
    };
  }

  if (conformanceCase.operation === "applyStagedChildChanges") {
    return {
      ok: true,
      result: await runStagedChildChanges(
        runtime,
        storage,
        input as StagedChildOperationInput,
        state,
      ),
    };
  }

  if (conformanceCase.operation === "readPersistedRecords") {
    return { ok: true, result: await reportPersistedRecords(runtime, storage, state) };
  }

  if (conformanceCase.operation === "readRecordRevisions") {
    return {
      ok: true,
      result: await reportRecordRevisions(
        runtime,
        storage,
        input as ObjectRuntimeOperationInput,
        state,
      ),
    };
  }

  const result = await runRuntimeOperation(runtime, conformanceCase.operation, input);
  return { ok: true, result: normaliseRuntimeResult(result, state) };
}

/**
 * A local write, its sync decision, and the queue that write left behind.
 *
 * `localPrivate` and `localFirst` differ in exactly one observable way — both
 * allow the write, only one queues it for the authority — and a decision alone
 * cannot state that: a runtime could report `queueable: false` and queue the
 * operation anyway. Reporting the queue is what makes the two modes
 * distinguishable to the corpus rather than to one implementation's internals.
 */
async function runSyncWrite(
  runtime: ApplicationRuntime,
  input: SyncWriteOperationInput,
  state: RunState,
): Promise<JsonValue> {
  const context = parseContext(input.context);
  const write = input.write;
  const attempt = async (): Promise<{ status: string; recordId?: string; code?: string }> => {
    try {
      const record = await runRuntimeStep(
        runtime,
        {
          operation: write,
          objectName: input.objectName,
          context: input.context,
          ...(input.values === undefined ? {} : { values: input.values }),
          ...(input.id === undefined ? {} : { id: input.id }),
          ...(input.patch === undefined ? {} : { patch: input.patch }),
          ...(input.actionName === undefined ? {} : { actionName: input.actionName }),
        },
        state,
      );
      return {
        status: "written",
        ...(isRecord(record) ? { recordId: aliasForRecordId(record.meta.guid, state) } : {}),
      };
    } catch (error) {
      if (error instanceof SyncPolicyError) {
        // Reported rather than rethrown, so a refusal can assert the queue it
        // did *not* grow as well as the code it raised.
        return { status: "refused", code: error.code };
      }
      throw error;
    }
  };

  const outcome = await attempt();

  return {
    decision: normaliseSyncDecision(
      runtime.syncPolicy.evaluateLocalWrite(input.objectName, write, context),
    ),
    write: outcome,
    queue: runtime.syncQueue.getEntries().map((entry) => normaliseSyncQueueEntry(entry, state)),
  } as unknown as JsonValue;
}

function normaliseSyncDecision(decision: SyncWriteDecision): JsonValue {
  return {
    allowed: decision.allowed,
    objectName: decision.objectName,
    operation: decision.operation,
    mode: decision.mode,
    online: decision.online,
    queueable: decision.queueable,
    readonly: decision.readonly,
  };
}

/**
 * A locally executed command, the records it wrote, and the queue it left behind.
 *
 * Modelled on `runSyncWrite` for the same reason: a result alone cannot state
 * what was queued. A runtime could return a perfectly correct command result and
 * still enqueue one entry per step, which is precisely the shape that loses the
 * transaction across the sync boundary — an established context does not survive
 * being replayed as separate intents, and a batch replayed as N intents can land
 * partially. What is contractual is therefore the pair.
 *
 * Every record the command created is named after the step that created it
 * before the queue is read, so the entry can be asserted without any case
 * spelling out an id the runtime minted.
 */
async function runSyncCommand(
  runtime: ApplicationRuntime,
  input: SyncCommandOperationInput,
  state: RunState,
): Promise<JsonValue> {
  const execution = await (async (): Promise<JsonValue> => {
    try {
      const result = await runtime.executeCommand(
        input.commandName,
        input.input,
        parseContext(input.context),
      );
      for (const step of result.steps) {
        state.recordAliases.set(step.recordId, commandStepAlias(step.step, step.itemIndex));
      }
      return {
        status: "executed",
        steps: result.steps.map((step) => ({
          step: step.step,
          ...(step.itemIndex === undefined ? {} : { itemIndex: step.itemIndex }),
          operation: step.operation,
          objectName: step.objectName,
          recordId: aliasForRecordId(step.recordId, state),
        })),
      } as unknown as JsonValue;
    } catch (error) {
      if (isObject(error) && typeof error.code === "string") {
        // Reported rather than rethrown, so a refused command can assert the
        // queue it did *not* grow as well as the code it raised. A command
        // succeeds or fails as a whole, so "nothing was queued" is part of the
        // refusal rather than a separate observation.
        return { status: "refused", code: error.code } as unknown as JsonValue;
      }
      throw error;
    }
  })();

  return {
    command: input.commandName,
    execution,
    queue: runtime.syncQueue.getEntries().map((entry) => normaliseSyncQueueEntry(entry, state)),
  } as unknown as JsonValue;
}

/** An iterating step writes one record per item, so its name alone is ambiguous. */
function commandStepAlias(step: string, itemIndex: number | undefined): string {
  return itemIndex === undefined ? step : `${step}.${itemIndex}`;
}

/**
 * A staged batch applied against an existing parent: what it claims, what it
 * queued, and what storage now holds.
 *
 * A refusal is reported rather than rethrown, exactly as a refused command is,
 * because the substance of the all-or-nothing guarantee is what the refusal
 * *left behind*. A case that could only assert the error code would be unable to
 * say the one thing that matters — that no child was written and nothing was
 * queued — and a runtime applying the changes one at a time would raise the same
 * code from the second one while the first was already committed and enqueued.
 */
async function runStagedChildChanges(
  runtime: ApplicationRuntime,
  storage: InMemoryObjectStorageBackend,
  input: StagedChildOperationInput,
  state: RunState,
): Promise<JsonValue> {
  const apply = await (async (): Promise<JsonValue> => {
    try {
      const result = await applyStagedChildChanges(runtime, input, state);
      return {
        status: "applied",
        applied: result.applied.map((applied) => ({
          operationId: applied.operationId,
          operation: applied.operation,
          childObject: applied.childObject,
          ...(applied.recordId === undefined
            ? {}
            : { recordId: aliasForRecordId(applied.recordId, state) }),
        })),
      } as unknown as JsonValue;
    } catch (error) {
      if (isObject(error) && typeof error.code === "string") {
        return {
          status: "refused",
          code: error.code,
          // The issue codes, not their messages. Several distinct refusals share
          // the outer validation code — a constraint the batch broke and an
          // operation the collection never permitted are both
          // `ADL_RUNTIME_VALIDATION_FAILED` — so without these a case could not
          // say *which* rule refused, only that something did.
          ...(Array.isArray(error.issues)
            ? {
                issues: (error.issues as Array<{ code?: string }>).map((issue) => ({
                  code: issue.code,
                })),
              }
            : {}),
        } as unknown as JsonValue;
      }
      throw error;
    }
  })();

  const persisted = (await reportPersistedRecords(runtime, storage, state)) as {
    records: JsonValue;
  };

  return {
    apply,
    queue: runtime.syncQueue.getEntries().map((entry) => normaliseSyncQueueEntry(entry, state)),
    records: persisted.records,
  } as unknown as JsonValue;
}

/**
 * Applies a staged batch and names every record it wrote after the staged
 * operation that asked for it.
 *
 * The staged operation's id is the case's own text, so aliasing by it keeps the
 * corpus free of ids the runtime minted — the same reason a command's records
 * are aliased by step name.
 */
async function applyStagedChildChanges(
  runtime: ApplicationRuntime,
  input: StagedChildOperationInput,
  state: RunState,
): Promise<RuntimeApplyStagedChildResult> {
  const result = await runtime.applyStagedChildChanges({
    objectName: input.objectName,
    viewName: input.viewName,
    parentRecordId: requireText(input.parentRecordId, "staged change parentRecordId"),
    stagedChanges: input.stagedChanges.map((staged) => ({ ...staged })),
    context: parseContext(input.context),
  });

  for (const applied of result.applied) {
    if (applied.recordId !== undefined && applied.recordId !== "") {
      state.recordAliases.set(applied.recordId, applied.operationId);
    }
  }

  return result;
}

/**
 * `queueId` and `opId` are generated, so an entry is named by what it carries.
 *
 * A `command` entry carries the whole transaction rather than one row, so it
 * additionally reports the command's name, the input that will be re-executed,
 * the record-id manifest, and every record the command wrote — all ids passed
 * through the alias table, because a case that named one would be pinning a
 * value the runtime minted. Without this an entry of kind `command` was
 * indistinguishable from an ordinary create on the same object, so no case could
 * state that a command queues once and names all of its records.
 *
 * A `batch` entry carries a whole ad-hoc transaction the same way, and reports
 * its writes: a batch has no declaration to re-execute, so the writes *are* what
 * crosses the wire. Without this an entry of kind `batch` would be
 * indistinguishable from an ordinary create on the first record it touched, and
 * no case could state that a staged batch queues once for all of its children.
 *
 * `selectedContexts` is reported because it is captured when the operation
 * executes, not when the queue drains: an entry that carried no selection would
 * be replayed against whatever was selected later.
 */
function normaliseSyncQueueEntry(entry: SyncQueueEntry, state: RunState): JsonValue {
  const operation = entry.operation;
  const command = operation.command;
  const batch = operation.batch;
  return {
    objectName: operation.object,
    operation: operation.operation,
    recordId: aliasForRecordId(operation.recordId, state),
    mode: entry.objectSync.mode,
    status: operation.status,
    // Present only once the authority has answered. The message and the moment
    // it was recorded are deliberately omitted: one is prose and the other is a
    // clock, and neither is contractual. That an entry *survives* its verdict,
    // carrying which verdict it was, is.
    ...(entry.recovery === undefined
      ? {}
      : {
          recovery: {
            status: entry.recovery.status,
            code: entry.recovery.code,
            ...(entry.recovery.strategy === undefined ? {} : { strategy: entry.recovery.strategy }),
          },
        }),
    ...(operation.selectedContexts === undefined
      ? {}
      : { selectedContexts: normaliseRecordIds(operation.selectedContexts, state) }),
    ...(command === undefined
      ? {}
      : {
          command: {
            name: command.name,
            ...(command.label === undefined ? {} : { label: command.label }),
            input: command.input,
            recordIds: command.recordIds.map((supplied) => ({
              step: supplied.step,
              ...(supplied.itemIndex === undefined ? {} : { itemIndex: supplied.itemIndex }),
              objectName: supplied.objectName,
              recordId: aliasForRecordId(supplied.recordId, state),
            })),
            records: command.records.map((named) => ({
              objectName: named.objectName,
              recordId: aliasForRecordId(named.recordId, state),
            })),
          },
        }),
    ...(batch === undefined
      ? {}
      : {
          batch: {
            ...(batch.label === undefined ? {} : { label: batch.label }),
            // `baseRevision` is deliberately not reported. It is minted by the
            // runtime, so a case asserting one would pin a format no
            // specification defines — the same rule that keeps revisions out of
            // every other expectation. That an update carries the revision it
            // was planned against is stated where it is observable instead: a
            // batch whose base revision has moved on is answered with a
            // conflict.
            writes: batch.writes.map((write) => ({
              operation: write.operation,
              objectName: write.objectName,
              recordId: aliasForRecordId(write.recordId, state),
              ...(write.values === undefined
                ? {}
                : { values: normaliseRecordIds(write.values, state) }),
              ...(write.patch === undefined
                ? {}
                : { patch: normaliseRecordIds(write.patch, state) }),
            })),
            // Every record the transaction wrote, derived writes included, which
            // is a strictly larger list than the writes above whenever an
            // ordered-collection shift moved a sibling. Reported separately for
            // the same reason it is stored separately: the wire payload and the
            // set of records one verdict answers for are different questions,
            // and a case that could only see the payload could not state that a
            // shifted sibling is settled too.
            records: batch.records.map((named) => ({
              objectName: named.objectName,
              recordId: aliasForRecordId(named.recordId, state),
            })),
          },
        }),
  } as unknown as JsonValue;
}

/**
 * What storage actually holds, rather than what a read returns.
 *
 * Every runtime read is shaped — computed fields are added, hidden and
 * policy-denied fields are dropped — so no case reading through the runtime can
 * distinguish "this value is derived on read" from "this value was written and
 * happens to agree". Persistence claims need to be observed at the layer that
 * makes them.
 *
 * This does not weaken the disclosure boundary, and must not be used as though
 * it did. Disclosure is about what a *read* hands a caller; a case may state
 * that a hidden field is in storage and, in the same breath, that a read omits
 * it. What no case may do is treat what it sees here as a payload the runtime
 * was entitled to return.
 */
async function reportPersistedRecords(
  runtime: ApplicationRuntime,
  storage: InMemoryObjectStorageBackend,
  state: RunState,
): Promise<JsonValue> {
  await runtime.whenReady();
  return {
    records: (await storage.listRecords())
      .map((persisted) => ({
        objectName: persisted.objectName,
        // Ordered by the alias, not the generated guid, so a case's expected
        // array does not depend on how a runtime happens to mint ids.
        recordId: aliasForRecordId(persisted.record.meta.guid, state),
        schemaVersion: persisted.record.meta.schemaVersion,
        deleted: persisted.record.meta.deletedAt !== undefined,
        // Device-local state, and reported here because storage is where it
        // lives: it survives a reload precisely because it is on the record
        // rather than derived from a queue entry the user can dismiss.
        syncStatus: persisted.record.meta.syncStatus,
        // Reported only when set, so a case can assert with `$absent` that a
        // refusal which was *not* about a record's own create left no licence to
        // discard it. Stating the licence without being able to state its
        // absence would make the rule unfalsifiable.
        ...(persisted.record.meta.syncRejectedCreate === true ? { syncRejectedCreate: true } : {}),
        // Lookup values go through the alias table like every other id. Without
        // it a case could see *that* a child was written but never *what it
        // names*, and what a child names is the whole of a minting picker's
        // guarantee — a runtime that stored the chosen candidate's id in the
        // wrong field, or stored the child's own, would be indistinguishable.
        values: normaliseRecordIds(persisted.record.values, state),
      }))
      .sort(
        (left, right) =>
          left.objectName.localeCompare(right.objectName) ||
          left.recordId.localeCompare(right.recordId),
      ),
  } as unknown as JsonValue;
}

/**
 * Keys a record's revision history by object and id.
 *
 * The separator is written as the escape `\u0000` rather than typed as a byte,
 * which is the repository's rule for a composite key: a raw NUL in a source file
 * makes `grep` treat it as binary and silently report nothing from it, and this
 * file already carries one such line.
 */
function revisionKey(objectName: string, recordId: string): string {
  return `${objectName}\u0000${recordId}`;
}

/**
 * Files every revision a step produced under the record it belongs to.
 *
 * The walk is structural rather than per operation because a step's result is a
 * record for an ordinary write, an array of them for a staged batch, and a
 * command result carrying its steps' records — and a command's revisions are as
 * much part of a record's history as any other write's.
 */
function recordRevisionObservations(value: unknown, state: RunState): void {
  if (Array.isArray(value)) {
    for (const item of value) recordRevisionObservations(item, state);
    return;
  }

  if (!isObject(value)) return;

  if (isRecord(value) && typeof value.meta.revision === "string") {
    const key = revisionKey(value.meta.object, value.meta.guid);
    const revisions = (state.revisions ??= new Map());
    revisions.set(key, [...(revisions.get(key) ?? []), value.meta.revision]);
    return;
  }

  for (const item of Object.values(value)) recordRevisionObservations(item, state);
}

/**
 * What a record's revisions did, stated as behaviour rather than as text.
 *
 * No case may name a revision — `tests/conformance-suite.test.ts` refuses one
 * that does, because no specification defines a format and a runtime minting
 * ULIDs is as correct as this one. That left the actual guarantee unsayable: a
 * revision identifies **one** version of one record, so a write must change it
 * and no write may ever hand back a revision this record already wore. Reported
 * as counts and predicates, both of those are assertable by any runtime.
 *
 * Deliberately absent: anything about *order*. A revision is opaque and
 * equality-compared, so a corpus that asserted revisions increase would be
 * asserting one implementation's convention as the contract.
 */
async function reportRecordRevisions(
  runtime: ApplicationRuntime,
  storage: InMemoryObjectStorageBackend,
  input: ObjectRuntimeOperationInput,
  state: RunState,
): Promise<JsonValue> {
  await runtime.whenReady();
  const objectName = input.objectName;
  const recordId = requireText(input.id, "readRecordRevisions id");
  const observed = state.revisions?.get(revisionKey(objectName, recordId)) ?? [];
  const persisted = await storage.read(objectName, recordId);
  const current = persisted?.meta.revision;
  /*
   * The persisted revision joins the history only when it is not already the
   * last one a write reported.
   *
   * A record whose last write is the one storage is holding reports that
   * revision twice — once from the write, once from storage — and appending it
   * unconditionally made `everyWriteChangedTheRevision` permanently false and
   * `revisionReissued` permanently true. Both predicates would then have been
   * constants: the two statements that carry the whole guarantee would have
   * constrained nothing, and a case asserting them would have been asserting the
   * runner rather than the runtime. Including it when it *differs* is still
   * worth doing — that is a version storage holds which no write reported.
   */
  const history =
    current === undefined || current === observed[observed.length - 1]
      ? observed
      : [...observed, current];

  return {
    writes: observed.length,
    distinctRevisions: new Set(history).size,
    // Consecutive pairs, so a write that returned the revision it was planned
    // against is caught even when every other write differed.
    everyWriteChangedTheRevision: history.every(
      (revision, index) => index === 0 || revision !== history[index - 1],
    ),
    // The whole history, not only neighbours: a reissued revision is a lost
    // update whether or not the reissue happened to follow its twin.
    revisionReissued: new Set(history).size !== history.length,
    currentRevisionIsTheLastWritten:
      current !== undefined && observed.length > 0 && current === observed[observed.length - 1],
  } as unknown as JsonValue;
}

async function runRuntimeStep(
  runtime: ApplicationRuntime,
  step: RuntimeConformanceStep,
  state: RunState,
): Promise<unknown> {
  const objectName = (): string => requireText(step.objectName, "step objectName");
  switch (step.operation) {
    case "create":
      return runtime.create(objectName(), step.values ?? {}, parseContext(step.context));
    case "update":
      return runtime.update(
        objectName(),
        requireText(step.id, "setup update id"),
        step.patch ?? {},
        parseContext(step.context),
      );
    case "delete":
      return runtime.delete(
        objectName(),
        requireText(step.id, "setup delete id"),
        parseContext(step.context),
      );
    case "transition":
      return runtime.transition(
        objectName(),
        requireText(step.id, "setup transition id"),
        step.actionName ?? "",
        parseContext(step.context),
      );
    case "executeCommand": {
      const result = await runtime.executeCommand(
        requireText(step.commandName, "step commandName"),
        step.input ?? {},
        parseContext(step.context),
      );
      // Named exactly as `runSyncCommand` names them, so a command's records are
      // referable by the step that wrote them however the command was executed.
      for (const written of result.steps) {
        state.recordAliases.set(
          written.recordId,
          commandStepAlias(written.step, written.itemIndex),
        );
      }
      return result;
    }
    case "applyStagedChildChanges":
      return applyStagedChildChanges(
        runtime,
        {
          objectName: requireText(step.objectName, "step objectName"),
          viewName: requireText(step.viewName, "step viewName"),
          parentRecordId: requireText(step.parentRecordId, "step parentRecordId"),
          stagedChanges: step.stagedChanges ?? [],
          context: step.context,
        },
        state,
      );
  }
}

async function runRuntimeOperation(
  runtime: ApplicationRuntime,
  operation: Exclude<
    RuntimeConformanceCase["operation"],
    | "syncWrite"
    | "syncCommand"
    | "readPersistedRecords"
    | "readRecordRevisions"
    | "applyStagedChildChanges"
  >,
  input: RuntimeConformanceInput,
): Promise<unknown> {
  switch (operation) {
    case "policyDecision": {
      const typed = input as Extract<RuntimeConformanceInput, { request: JsonPolicyRequest }>;
      const context = parseContext(typed.context);
      const request = typed.request as unknown as PolicyRequest;
      return explainPolicyRequest(runtime.model, request, context);
    }
    case "create": {
      const typed = input as ObjectRuntimeOperationInput;
      return runtime.create(typed.objectName, typed.values ?? {}, parseContext(typed.context));
    }
    case "read": {
      const typed = input as ObjectRuntimeOperationInput;
      return runtime.read(
        typed.objectName,
        requireText(typed.id, "read id"),
        parseContext(typed.context),
      );
    }
    case "update": {
      const typed = input as ObjectRuntimeOperationInput;
      return runtime.update(
        typed.objectName,
        requireText(typed.id, "update id"),
        typed.patch ?? {},
        parseContext(typed.context),
      );
    }
    case "delete": {
      const typed = input as ObjectRuntimeOperationInput;
      return runtime.delete(
        typed.objectName,
        requireText(typed.id, "delete id"),
        parseContext(typed.context),
      );
    }
    case "search": {
      const typed = input as ObjectRuntimeOperationInput;
      return runtime.search(typed.objectName, typed.query, parseContext(typed.context));
    }
    case "transition": {
      const typed = input as ObjectRuntimeOperationInput;
      return runtime.transition(
        typed.objectName,
        requireText(typed.id, "transition id"),
        typed.actionName ?? "",
        parseContext(typed.context),
      );
    }
    case "executeCommand": {
      const typed = input as Extract<RuntimeConformanceInput, { commandName: string }>;
      return runtime.executeCommand(typed.commandName, typed.input, parseContext(typed.context));
    }
    case "evaluateDecisionTable": {
      const typed = input as Extract<RuntimeConformanceInput, { tableName: string }>;
      return runtime.evaluateDecisionTable(
        typed.tableName,
        typed.values,
        parseContext(typed.context),
      );
    }
    case "executeReadModel": {
      const typed = input as Extract<RuntimeConformanceInput, { readModelName: string }>;
      return runtime.executeReadModel(
        typed.readModelName,
        parseContext(typed.context),
        typed.query ?? {},
      );
    }
    case "evaluatePresentationView": {
      const typed = input as PresentationViewOperationInput;
      return runtime.evaluatePresentationView(
        typed.objectName,
        typed.viewName,
        parseContext(typed.context),
        {
          ...(typed.state === undefined ? {} : { state: typed.state }),
          ...(typed.updates === undefined ? {} : { updates: typed.updates }),
        },
      );
    }
    case "evaluateEditSurface": {
      const typed = input as EditSurfaceOperationInput;
      return runtime.evaluateEditSurface(
        typed.objectName,
        typed.viewName,
        parseContext(typed.context),
        {
          mode: typed.mode,
          ...(typed.recordId === undefined
            ? {}
            : { recordId: requireText(typed.recordId, "edit surface recordId") }),
          ...(typed.stagedChanges === undefined
            ? {}
            : { stagedChanges: typed.stagedChanges.map((staged) => ({ ...staged })) }),
        },
      );
    }
    case "evaluateRelationshipPicker": {
      const typed = input as RelationshipPickerOperationInput;
      return runtime.evaluateRelationshipPicker({
        objectName: typed.objectName,
        viewName: typed.viewName,
        sectionName: typed.sectionName,
        context: parseContext(typed.context),
        ...(typed.recordId === undefined
          ? {}
          : { recordId: requireText(typed.recordId, "relationship picker recordId") }),
        ...(typed.stagedChanges === undefined
          ? {}
          : { stagedChanges: typed.stagedChanges.map((staged) => ({ ...staged })) }),
        ...(typed.query === undefined ? {} : { query: { ...typed.query } }),
      });
    }
    case "evaluateOfflineDataset": {
      const typed = input as Extract<RuntimeConformanceInput, { context: JsonRuntimeContext }>;
      return runtime.evaluateOfflineDataset(parseContext(typed.context));
    }
  }
}

function parseContext(context: JsonRuntimeContext): RuntimeContext {
  return {
    userId: context.userId,
    roles: [...context.roles],
    channel: context.channel,
    ...(context.selectedContexts === undefined
      ? {}
      : { selectedContexts: { ...context.selectedContexts } }),
    ...(context.contextRoles === undefined
      ? {}
      : { contextRoles: context.contextRoles.map((role) => ({ ...role })) }),
    ...(context.groups === undefined ? {} : { groups: { ...context.groups } }),
    ...(context.now === undefined ? {} : { now: new Date(context.now) }),
    ...(context.online === undefined ? {} : { online: context.online }),
    ...(context.requestId === undefined ? {} : { requestId: context.requestId }),
  };
}

function getPartialModel(
  conformanceCase: { model?: ConformanceModelInput; modelRef?: string },
  models: Record<string, ConformanceModelInput>,
): PartialApplicationModel {
  if (conformanceCase.model !== undefined) {
    return toPartialModel(conformanceCase.model);
  }

  if (conformanceCase.modelRef !== undefined) {
    const model = models[conformanceCase.modelRef];
    if (model !== undefined) {
      return toPartialModel(model);
    }
  }

  throw new Error(`Conformance case references unknown model '${conformanceCase.modelRef ?? ""}'.`);
}

/**
 * Compiles a model authored in ADL, and passes any other model through.
 *
 * Only the parse and the AST-to-partial conversion are run here. Resolution and
 * validation are deliberately left to whichever operation the case declares, so
 * an ADL-authored model reaches exactly the same code path a JSON-authored one
 * does — a source that resolves differently from the partial model it produces
 * would otherwise be indistinguishable from one that does not.
 */
function toPartialModel(input: ConformanceModelInput): PartialApplicationModel {
  if (!isAdlSource(input)) {
    return input;
  }

  return adlAstToPartialApplicationModel(
    parseAdl(typeof input.adl === "string" ? input.adl : input.adl.join("\n")),
  );
}

function isAdlSource(value: ConformanceModelInput): value is ConformanceAdlSource {
  const adl = (value as ConformanceAdlSource).adl;
  return typeof adl === "string" || Array.isArray(adl);
}

function getPartialOrResolvedModel(
  conformanceCase: ModelValidationConformanceCase,
  models: Record<string, ConformanceModelInput>,
): PartialApplicationModel | ResolvedApplicationModel {
  const model = conformanceCase.model;
  if (model !== undefined && isResolvedApplicationModel(model)) {
    return model;
  }

  return getPartialModel(
    {
      ...(model === undefined ? {} : { model }),
      ...(conformanceCase.modelRef === undefined ? {} : { modelRef: conformanceCase.modelRef }),
    },
    models,
  );
}

function isResolvedApplicationModel(
  value: ConformanceModelInput | ResolvedApplicationModel,
): value is ResolvedApplicationModel {
  return "modelVersion" in value && "defaults" in value;
}

function selectPaths(value: unknown, paths: string[]): Record<string, JsonValue> {
  return Object.fromEntries(paths.map((path) => [path, getPath(value, path) as JsonValue]));
}

function resolveRefs(value: unknown, state: RunState): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => resolveRefs(item, state));
  }

  if (isObject(value)) {
    if (typeof value.$ref === "string") {
      return getPath(state.aliases, value.$ref);
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveRefs(item, state)]),
    );
  }

  return value;
}

function getPath(value: unknown, path: string): unknown {
  return path.split(".").reduce((current: unknown, segment) => {
    if (current === undefined || current === null) {
      return undefined;
    }

    if (/^\d+$/.test(segment) && Array.isArray(current)) {
      return current[Number(segment)];
    }

    if (typeof current === "object") {
      return (current as Record<string, unknown>)[segment];
    }

    return undefined;
  }, value);
}

function normaliseRuntimeResult(value: unknown, state: RunState): JsonValue {
  if (isRecord(value)) {
    return normaliseRecord(value, state);
  }

  if (isEditSurface(value)) {
    return normaliseEditSurface(value, state);
  }

  if (isRelationshipPickerResult(value)) {
    return normaliseRelationshipPickerResult(value, state);
  }

  if (Array.isArray(value) && value.every(isRecord)) {
    return value.map((record) => normaliseRecord(record, state));
  }

  if (isObject(value) && "rows" in value) {
    const rows = value.rows as Array<{ values: Record<string, JsonValue>; sources?: JsonValue }>;
    return {
      rows: rows.map((row) => ({
        values: row.values,
        ...(row.sources === undefined ? {} : { sources: normaliseRecordIds(row.sources, state) }),
      })),
    };
  }

  if (isObject(value) && "records" in value) {
    const records = value.records as JsonValue[];
    return {
      // Re-ordered by the alias, not by the generated id the runtime sorted on.
      // An offline dataset orders records by `(objectName, recordId)`, and no
      // specification defines a record id's shape — so two records of the same
      // object came back in an order that varied between runs and would vary
      // between runtimes, making the array unassertable at all.
      records: sortNormalisedRecords(normaliseRecordIds(records, state)),
      ...(Array.isArray(value.contextRoles)
        ? { contextRoles: value.contextRoles as JsonValue }
        : {}),
    };
  }

  if (isObject(value) && "steps" in value) {
    const steps = value.steps as Array<{
      step: string;
      objectName: string;
      recordId: string;
      record: StoredObjectRecord;
    }>;
    return {
      steps: steps.map((step) => ({
        step: step.step,
        objectName: step.objectName,
        recordId: aliasForRecordId(step.recordId, state),
        values: step.record.values,
      })),
    };
  }

  if (isObject(value) && "decision" in value && "precedence" in value) {
    return value as JsonValue;
  }

  if (isObject(value) && "rowName" in value && "outputs" in value) {
    return {
      rowName: value.rowName as JsonValue,
      outputs: value.outputs as JsonValue,
      inputValues: value.inputValues as JsonValue,
    };
  }

  return normaliseRecordIds(value, state);
}

/**
 * Canonical order for a set of `{objectName, recordId}` references, applied
 * after ids have been replaced by their aliases. Left untouched unless every
 * entry carries both keys, so nothing else that happens to be called `records`
 * is reordered.
 */
function sortNormalisedRecords(value: JsonValue): JsonValue {
  if (
    !Array.isArray(value) ||
    !value.every(
      (item) =>
        isObject(item) && typeof item.objectName === "string" && typeof item.recordId === "string",
    )
  ) {
    return value;
  }

  return [...value].sort((left, right) => {
    const a = left as { objectName: string; recordId: string };
    const b = right as { objectName: string; recordId: string };
    return a.objectName.localeCompare(b.objectName) || a.recordId.localeCompare(b.recordId);
  }) as JsonValue;
}

function isEditSurface(value: unknown): value is RuntimeEditSurface {
  return (
    isObject(value) &&
    typeof value.object === "string" &&
    typeof value.view === "string" &&
    typeof value.mode === "string" &&
    Array.isArray(value.sections) &&
    Array.isArray(value.stagedChanges)
  );
}

/**
 * An evaluated edit surface, reduced to the composition it resolved to.
 *
 * A section's `fields` are full resolved fields, so reporting them whole would
 * make every case a snapshot of the field contract and fail on any unrelated
 * field addition. What an edit surface case is about is which fields a section
 * groups, which children it embeds, what may be done to them, and what a picker
 * offers — so the fields are reduced to their names and the rest is reported as
 * declared.
 *
 * Child row ids go through the alias table, because they are records the case
 * seeded and never ids a case should spell out.
 */
function normaliseEditSurface(surface: RuntimeEditSurface, state: RunState): JsonValue {
  return {
    object: surface.object,
    view: surface.view,
    mode: surface.mode,
    sections: surface.sections.map((section) => normaliseEditSection(section, state)),
    diagnostics: surface.diagnostics.map((diagnostic) => ({
      severity: diagnostic.severity,
      code: diagnostic.code,
      ...(diagnostic.section === undefined ? {} : { section: diagnostic.section }),
    })),
  } as unknown as JsonValue;
}

function normaliseEditSection(section: RuntimeEditSection, state: RunState): JsonValue {
  const base = {
    name: section.name,
    kind: section.kind,
    ...(section.heading === undefined ? {} : { heading: section.heading }),
    fields: section.fields.map((field) => field.name),
  };

  if (section.kind === "fields") {
    return base as unknown as JsonValue;
  }

  return {
    ...base,
    childObject: section.childObject,
    parentField: section.parentField,
    ...(section.childView === undefined ? {} : { childView: section.childView }),
    operations: [...section.operations],
    staged: section.staged,
    ...(section.orderField === undefined ? {} : { orderField: section.orderField }),
    emptyState: section.emptyState,
    ...(section.picker === undefined ? {} : { picker: normalisePickerSummary(section.picker) }),
    rows: section.rows.map((row) => ({
      id: aliasForRecordId(row.id, state),
      source: row.source,
      values: normaliseRecordIds(row.values, state),
      actions: row.actions.map((action) => ({
        operation: action.operation,
        visible: action.visible,
        enabled: action.enabled,
      })),
    })),
    actions: section.actions.map((action) => ({
      operation: action.operation,
      visible: action.visible,
      enabled: action.enabled,
    })),
  } as unknown as JsonValue;
}

/**
 * A picker as declared, reported identically wherever it appears.
 *
 * `candidateField` is present only on a minting picker, and its presence is the
 * whole of the difference a renderer sees: it is what decides whether choosing a
 * candidate stages `createChild` or `linkExisting`. Omitting it here would leave
 * the two modes indistinguishable in every evaluated result, so a runtime could
 * resolve the field correctly and then hand renderers a summary that lost it.
 */
function normalisePickerSummary(picker: RuntimeRelationshipPickerSummary): JsonValue {
  return {
    name: picker.name,
    sourceKind: picker.sourceKind,
    source: picker.source,
    ...(picker.candidateField === undefined ? {} : { candidateField: picker.candidateField }),
    selection: picker.selection,
    displayFields: [...picker.displayFields],
    searchFields: [...picker.searchFields],
    sort: picker.sort.map((sort) => ({ ...sort })),
    excludeAlreadyLinked: picker.excludeAlreadyLinked,
    emptyState: picker.emptyState,
  } as unknown as JsonValue;
}

function isRelationshipPickerResult(value: unknown): value is RuntimeRelationshipPickerResult {
  return (
    isObject(value) &&
    typeof value.object === "string" &&
    typeof value.view === "string" &&
    typeof value.section === "string" &&
    isObject(value.picker) &&
    Array.isArray(value.candidates)
  );
}

/**
 * What a picker offered, reduced to the choice a person is being given.
 *
 * A candidate's id goes through the alias table because it is a record the case
 * seeded — for a minting picker, deliberately a record of a *different* object
 * from the collection's children, which is exactly what the alias makes
 * assertable. Diagnostic messages are dropped for the reason
 * `normaliseEditSurface` drops them: an empty picker's message is the model's
 * own `EMPTY_TEXT`, so asserting it would pin one case's prose rather than the
 * rule that produced it.
 */
function normaliseRelationshipPickerResult(
  result: RuntimeRelationshipPickerResult,
  state: RunState,
): JsonValue {
  return {
    object: result.object,
    view: result.view,
    section: result.section,
    picker: normalisePickerSummary(result.picker),
    candidates: result.candidates.map((candidate) => ({
      id: aliasForRecordId(candidate.id, state),
      label: candidate.label,
      values: normaliseRecordIds(candidate.values, state),
      source: normaliseRecordIds(candidate.source, state),
      alreadyLinked: candidate.alreadyLinked,
    })),
    diagnostics: result.diagnostics.map((diagnostic) => ({
      severity: diagnostic.severity,
      code: diagnostic.code,
      ...(diagnostic.section === undefined ? {} : { section: diagnostic.section }),
    })),
  } as unknown as JsonValue;
}

function normaliseRecord(record: StoredObjectRecord, state: RunState): JsonValue {
  return {
    objectName: record.meta.object,
    recordId: aliasForRecordId(record.meta.guid, state),
    state: record.meta.state ?? record.values.Status ?? null,
    values: record.values,
  };
}

function registerRecordAlias(alias: string, value: unknown, state: RunState): void {
  if (isRecord(value)) {
    state.recordAliases.set(value.meta.guid, alias);
  }
}

function aliasForRecordId(id: string, state: RunState): string {
  const alias = state.recordAliases.get(id);
  return alias === undefined ? id : `$${alias}`;
}

function normaliseRecordIds(value: unknown, state: RunState): JsonValue {
  if (typeof value === "string") {
    return state.recordAliases.has(value) ? aliasForRecordId(value, state) : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normaliseRecordIds(item, state));
  }

  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normaliseRecordIds(item, state)]),
    );
  }

  return value as JsonValue;
}

function normaliseError(error: unknown): JsonValue {
  if (isObject(error)) {
    return {
      name: typeof error.name === "string" ? error.name : "Error",
      message: typeof error.message === "string" ? error.message : String(error),
      ...(typeof error.code === "string" ? { code: error.code } : {}),
      ...(Array.isArray(error.issues) ? { issues: error.issues as JsonValue } : {}),
      ...(Array.isArray(error.diagnostics) ? { diagnostics: error.diagnostics as JsonValue } : {}),
      ...(isObject(error.decision) ? { decision: error.decision as JsonValue } : {}),
      ...(isObject(error.details) ? { details: error.details as JsonValue } : {}),
    };
  }

  return { name: "Error", message: String(error) };
}

function matchesExpected(actual: ConformanceActual, expected: ConformanceExpected): boolean {
  return partialDeepMatch(expected, actual);
}

/**
 * Asserts that a key is **absent** from the actual result.
 *
 * Expected objects match partially, which walks only the keys a case names — so
 * without this a case could prove that a masked field carries a sentinel, but
 * never that a hidden or policy-denied field was *dropped*. That omission is the
 * actual disclosure guarantee, and a runtime that returned every hidden field
 * verbatim would have passed the entire suite. Absence has to be sayable.
 */
export const CONFORMANCE_ABSENT = "$absent";

function partialDeepMatch(expected: unknown, actual: unknown): boolean {
  if (expected === CONFORMANCE_ABSENT) {
    return actual === undefined;
  }

  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      expected.length === actual.length &&
      expected.every((item, index) => partialDeepMatch(item, actual[index]))
    );
  }

  if (isObject(expected)) {
    if (!isObject(actual)) {
      return false;
    }

    return Object.entries(expected).every(([key, value]) =>
      partialDeepMatch(value, (actual as Record<string, unknown>)[key]),
    );
  }

  return Object.is(expected, actual);
}

function requireText(value: JsonValue | undefined, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}

function isRecord(value: unknown): value is StoredObjectRecord {
  return (
    isObject(value) &&
    isObject(value.meta) &&
    typeof value.meta.guid === "string" &&
    typeof value.meta.object === "string" &&
    isObject(value.values)
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
