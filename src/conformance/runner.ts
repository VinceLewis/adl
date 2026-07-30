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
  | AuthorityConformanceCase;

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

export interface AuthorityConformanceIntent {
  session?: string;
  intent: AuthorityOperationIntent;
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
    | "evaluateOfflineDataset";
  model?: PartialApplicationModel;
  modelRef?: string;
  setup?: RuntimeConformanceStep[];
  input: RuntimeConformanceInput;
}

export interface RuntimeConformanceStep {
  operation: "create" | "update" | "transition";
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
        return await runAuthorityReplayCase(conformanceCase, models);
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
  const storage = new InMemoryObjectStorageBackend();
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

async function runAuthorityReplayCase(
  conformanceCase: AuthorityConformanceCase,
  models: Record<string, PartialApplicationModel>,
): Promise<ConformanceActual> {
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

  for (const step of conformanceCase.input.setup ?? []) {
    await authority.replay(tokensByName.get(step.session ?? firstSessionName), step.intent);
  }

  const outcome = await authority.replay(
    tokensByName.get(conformanceCase.input.session ?? firstSessionName),
    conformanceCase.input.intent,
  );

  return { ok: true, result: normaliseAuthorityOutcome(outcome) };
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
  const runtime = new ApplicationRuntime(resolveApplicationModel(source));

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
  const result = await runRuntimeOperation(runtime, conformanceCase.operation, input);
  return { ok: true, result: normaliseRuntimeResult(result, state) };
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
  operation: RuntimeConformanceCase["operation"],
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
      records: normaliseRecordIds(records, state),
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
