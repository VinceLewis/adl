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
import { createConformanceStorage } from "./storage-behaviours.js";
import type { ConformanceStorageBehaviour } from "./storage-behaviours.js";
export type { ConformanceStorageBehaviour } from "./storage-behaviours.js";
import { AuthorityService } from "../server/authority-service.js";
import { StaticSessionAdapter } from "../server/session-adapter.js";
import type { AuthorityOperationIntent, AuthorityOutcome } from "../server/authority-types.js";
import type {
  PolicyRequest,
  RuntimeContext,
  RuntimeReadModelQuery,
  RuntimeSearchInput,
} from "../runtime/runtime-types.js";

export interface ConformanceSuite {
  version: 1;
  models?: Record<string, PartialApplicationModel>;
  cases: ConformanceCase[];
}

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
  | AuthorityBootstrapConformanceCase;

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
  model?: PartialApplicationModel;
  modelRef?: string;
  input?: {
    select?: string[];
  };
}

export interface ModelValidationConformanceCase extends ConformanceCaseBase {
  operation: "validateModel";
  model?: PartialApplicationModel | ResolvedApplicationModel;
  modelRef?: string;
}

export interface InspectConformanceCase extends ConformanceCaseBase {
  operation: "inspectResolvedModel";
  model?: PartialApplicationModel;
  modelRef?: string;
  input?: {
    selectOrigins?: string[];
    includeText?: boolean;
  };
}

export interface StartupCompatibilityConformanceCase extends ConformanceCaseBase {
  operation: "startupCompatibility";
  model?: PartialApplicationModel;
  modelRef?: string;
  input?: {
    /**
     * The model that wrote the persisted state. The runner resolves it and
     * derives the persisted version and fingerprint from it, so a case can say
     * "state written by this model, opened by that one" without ever naming a
     * digest — which would pin the whole resolved-model shape and break on any
     * unrelated model addition.
     */
    persistedModel?: PartialApplicationModel | { modelRef: string };
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
    left: PartialApplicationModel | { modelRef: string };
    right: PartialApplicationModel | { modelRef: string };
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
  model?: PartialApplicationModel;
  modelRef?: string;
  input: {
    /** The model that wrote the state; see the startup-compatibility case. */
    persistedModel?: PartialApplicationModel | { modelRef: string };
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
  model?: PartialApplicationModel;
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
  model?: PartialApplicationModel;
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
    | "evaluateOfflineDataset"
    | "syncWrite"
    | "readPersistedRecords";
  model?: PartialApplicationModel;
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
  operation: "create" | "update" | "delete" | "transition";
  alias?: string;
  objectName: string;
  values?: Record<string, JsonValue>;
  id?: JsonValue;
  patch?: Record<string, JsonValue>;
  actionName?: string;
  context: JsonRuntimeContext;
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
  models: Record<string, PartialApplicationModel> = {},
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
  models: Record<string, PartialApplicationModel>,
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
  models: Record<string, PartialApplicationModel>,
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
  models: Record<string, PartialApplicationModel>,
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
  models: Record<string, PartialApplicationModel>,
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
  models: Record<string, PartialApplicationModel>,
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
  models: Record<string, PartialApplicationModel>,
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
        persistedModel?: PartialApplicationModel | { modelRef: string };
        applicationMetadata?: PersistedApplicationMetadata;
      }
    | undefined,
  models: Record<string, PartialApplicationModel>,
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
  source: PartialApplicationModel | { modelRef: string },
  models: Record<string, PartialApplicationModel>,
): PartialApplicationModel {
  return "modelRef" in source && typeof source.modelRef === "string"
    ? getPartialModel({ modelRef: source.modelRef }, models)
    : (source as PartialApplicationModel);
}

async function runMigratePersistedStateCase(
  conformanceCase: ModelMigrationConformanceCase,
  models: Record<string, PartialApplicationModel>,
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
}

/**
 * Builds the authority and its sessions, and applies every seeded intent through
 * the real replay path. Shared by the replay and bootstrap operations so a
 * bootstrap case reads state that was accepted exactly as any other client's
 * would be, rather than state written past the authority.
 */
async function seedAuthority(
  conformanceCase: AuthorityConformanceCase | AuthorityBootstrapConformanceCase,
  models: Record<string, PartialApplicationModel>,
  state: RunState,
): Promise<AuthorityFixture> {
  const model = resolveApplicationModel(getPartialModel(conformanceCase, models));
  const declaredSessions = Object.entries(
    conformanceCase.input.sessions ?? { primary: { userId: "user-1" } },
  );
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

  for (const [index, step] of (conformanceCase.input.setup ?? []).entries()) {
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
        `Authority setup step ${index} ('${step.intent.operationId}') was '${outcome.status}', expected '${expected}'.`,
      );
    }

    if (step.alias !== undefined) {
      state.aliases[step.alias] = outcome;
    }
  }

  return {
    authority,
    tokenFor: (sessionName) => tokensByName.get(sessionName ?? firstSessionName),
  };
}

async function runAuthorityReplayCase(
  conformanceCase: AuthorityConformanceCase,
  models: Record<string, PartialApplicationModel>,
  state: RunState,
): Promise<ConformanceActual> {
  const fixture = await seedAuthority(conformanceCase, models, state);
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
  models: Record<string, PartialApplicationModel>,
  state: RunState,
): Promise<ConformanceActual> {
  const fixture = await seedAuthority(conformanceCase, models, state);
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
          `${left.object} ${left.recordId}`.localeCompare(`${right.object} ${right.recordId}`),
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

async function runRuntimeCase(
  conformanceCase: RuntimeConformanceCase,
  models: Record<string, PartialApplicationModel>,
  state: RunState,
): Promise<ConformanceActual> {
  const source = getPartialModel(conformanceCase, models);
  const storage = new InMemoryObjectStorageBackend();
  for (const item of conformanceCase.records ?? []) {
    await storage.create(item.objectName, item.record);
  }

  const runtime = new ApplicationRuntime(resolveApplicationModel(source), { storage });

  for (const setup of conformanceCase.setup ?? []) {
    const value = await runRuntimeStep(
      runtime,
      resolveRefs(setup, state) as RuntimeConformanceStep,
    );
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

  if (conformanceCase.operation === "readPersistedRecords") {
    return { ok: true, result: await reportPersistedRecords(runtime, storage, state) };
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
      const record = await runRuntimeStep(runtime, {
        operation: write,
        objectName: input.objectName,
        context: input.context,
        ...(input.values === undefined ? {} : { values: input.values }),
        ...(input.id === undefined ? {} : { id: input.id }),
        ...(input.patch === undefined ? {} : { patch: input.patch }),
        ...(input.actionName === undefined ? {} : { actionName: input.actionName }),
      });
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

/** `queueId` and `opId` are generated, so an entry is named by what it carries. */
function normaliseSyncQueueEntry(entry: SyncQueueEntry, state: RunState): JsonValue {
  return {
    objectName: entry.operation.object,
    operation: entry.operation.operation,
    recordId: aliasForRecordId(entry.operation.recordId, state),
    mode: entry.objectSync.mode,
    status: entry.operation.status,
  };
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
        values: persisted.record.values,
      }))
      .sort(
        (left, right) =>
          left.objectName.localeCompare(right.objectName) ||
          left.recordId.localeCompare(right.recordId),
      ),
  } as unknown as JsonValue;
}

async function runRuntimeStep(
  runtime: ApplicationRuntime,
  step: RuntimeConformanceStep,
): Promise<unknown> {
  switch (step.operation) {
    case "create":
      return runtime.create(step.objectName, step.values ?? {}, parseContext(step.context));
    case "update":
      return runtime.update(
        step.objectName,
        requireText(step.id, "setup update id"),
        step.patch ?? {},
        parseContext(step.context),
      );
    case "delete":
      return runtime.delete(
        step.objectName,
        requireText(step.id, "setup delete id"),
        parseContext(step.context),
      );
    case "transition":
      return runtime.transition(
        step.objectName,
        requireText(step.id, "setup transition id"),
        step.actionName ?? "",
        parseContext(step.context),
      );
  }
}

async function runRuntimeOperation(
  runtime: ApplicationRuntime,
  operation: Exclude<RuntimeConformanceCase["operation"], "syncWrite" | "readPersistedRecords">,
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
      const typed = input as Extract<RuntimeConformanceInput, { viewName: string }>;
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
  conformanceCase: { model?: PartialApplicationModel; modelRef?: string },
  models: Record<string, PartialApplicationModel>,
): PartialApplicationModel {
  if (conformanceCase.model !== undefined) {
    return conformanceCase.model;
  }

  if (conformanceCase.modelRef !== undefined) {
    const model = models[conformanceCase.modelRef];
    if (model !== undefined) {
      return model;
    }
  }

  throw new Error(`Conformance case references unknown model '${conformanceCase.modelRef ?? ""}'.`);
}

function getPartialOrResolvedModel(
  conformanceCase: ModelValidationConformanceCase,
  models: Record<string, PartialApplicationModel>,
): PartialApplicationModel | ResolvedApplicationModel {
  if (conformanceCase.model !== undefined) {
    return conformanceCase.model;
  }

  return getPartialModel(conformanceCase, models);
}

function isResolvedApplicationModel(
  value: PartialApplicationModel | ResolvedApplicationModel,
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
