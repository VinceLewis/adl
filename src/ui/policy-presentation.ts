import type { ApplicationRuntime } from "../runtime/application-runtime.js";
import type {
  JsonValue,
  ResolvedField,
  ResolvedLifecycleAction,
  ResolvedObject,
  StoredObjectRecord,
} from "../model/resolved-model.js";
import type { RuntimeContext } from "../runtime/runtime-types.js";
import type { ActionBarItem, FieldPresentation, UiMode } from "./types.js";
import { titleCaseIdentifier } from "./components/html.js";

interface FieldPresentationOptions {
  runtime: ApplicationRuntime;
  object: ResolvedObject;
  field: ResolvedField;
  context: RuntimeContext;
  mode: UiMode;
  record?: StoredObjectRecord;
}

export function resolveFieldPresentation({
  runtime,
  object,
  field,
  context,
  mode,
  record,
}: FieldPresentationOptions): FieldPresentation {
  const currentState = getRecordLifecycleState(object, record);
  const readDecision =
    mode === "edit"
      ? runtime.policyEngine.evaluate(
          {
            objectName: object.name,
            action: "read",
            field: field.name,
            ...(record === undefined ? {} : { record }),
            ...(currentState === undefined ? {} : { currentState }),
          },
          context,
        )
      : undefined;
  const writeDecision = runtime.policyEngine.evaluate(
    {
      objectName: object.name,
      action: mode === "create" ? "create" : "update",
      field: field.name,
      ...(mode === "create" ? createScopePatchProperty(object, context) : {}),
      ...(record === undefined ? {} : { record }),
      ...(currentState === undefined ? {} : { currentState }),
    },
    context,
  );
  const syncDecision = runtime.syncPolicy.evaluateLocalWrite(
    object.name,
    mode === "create" ? "create" : "update",
    context,
  );

  const hidden =
    field.hidden ||
    readDecision?.effect === "hidden" ||
    readDecision?.effect === "deny" ||
    writeDecision.effect === "hidden";
  const masked = !hidden && (readDecision?.effect === "mask" || writeDecision.effect === "mask");
  const lifecycleStateField = object.lifecycle?.stateField === field.name;
  const readonly =
    field.readonly ||
    lifecycleStateField ||
    masked ||
    writeDecision.effect !== "allow" ||
    !syncDecision.allowed ||
    readDecision?.effect === "readonly";

  return {
    field,
    effect: hidden ? "hidden" : masked ? "mask" : readonly ? "readonly" : "allow",
    hidden,
    masked,
    readonly,
    reasons: [
      ...(readDecision?.reasons.map((reason) => reason.message) ?? []),
      ...writeDecision.reasons.map((reason) => reason.message),
      ...(syncDecision.allowed ? [] : [syncDecision.reason]),
    ],
  };
}

export function getRecordLifecycleState(
  object: ResolvedObject,
  record: StoredObjectRecord | undefined,
): string | undefined {
  if (object.lifecycle === undefined) {
    return undefined;
  }

  if (record !== undefined) {
    const businessState = record.values[object.lifecycle.stateField];
    if (typeof businessState === "string") {
      return businessState;
    }

    return record.meta.state ?? getInitialLifecycleState(object);
  }

  return getInitialLifecycleState(object);
}

export function getInitialLifecycleState(object: ResolvedObject): string | undefined {
  return object.lifecycle?.initialState ?? object.lifecycle?.states[0]?.name;
}

export function getAvailableLifecycleActions(
  runtime: ApplicationRuntime,
  object: ResolvedObject,
  record: StoredObjectRecord | undefined,
  context: RuntimeContext,
): ActionBarItem[] {
  if (record === undefined || object.lifecycle === undefined) {
    return [];
  }

  const currentState = getRecordLifecycleState(object, record);
  if (currentState === undefined) {
    return [];
  }

  return object.lifecycle.actions
    .filter((action) => action.from.includes(currentState))
    .filter((action) =>
      canRunLifecycleAction(runtime, object, record, action, currentState, context),
    )
    .map((action) => ({
      name: action.name,
      label: action.label ?? titleCaseIdentifier(action.name),
      kind: "lifecycle",
      variant: "secondary",
      disabled: false,
    }));
}

export function canRunCommand(
  runtime: ApplicationRuntime,
  object: ResolvedObject,
  action: "create" | "update" | "delete",
  context: RuntimeContext,
  record?: StoredObjectRecord,
): boolean {
  const currentState = getRecordLifecycleState(object, record);
  const decision = runtime.policyEngine.evaluate(
    {
      objectName: object.name,
      action,
      ...(action === "create" ? createScopePatchProperty(object, context) : {}),
      ...(record === undefined ? {} : { record }),
      ...(currentState === undefined ? {} : { currentState }),
    },
    context,
  );
  const syncDecision = runtime.syncPolicy.evaluateLocalWrite(object.name, action, context);
  return decision.effect === "allow" && syncDecision.allowed;
}

function createScopePatchProperty(
  object: ResolvedObject,
  context: RuntimeContext,
): { patch: Record<string, JsonValue> } | {} {
  if (object.scope === undefined) {
    return {};
  }

  const selectedContextId = context.selectedContexts?.[object.scope.context];
  if (selectedContextId === undefined || selectedContextId.length === 0) {
    return {};
  }

  return {
    patch: {
      [object.scope.field]: selectedContextId,
    },
  };
}

function canRunLifecycleAction(
  runtime: ApplicationRuntime,
  object: ResolvedObject,
  record: StoredObjectRecord,
  action: ResolvedLifecycleAction,
  currentState: string,
  context: RuntimeContext,
): boolean {
  const decision = runtime.policyEngine.evaluate(
    {
      objectName: object.name,
      action: "transition",
      record,
      currentState,
      targetState: action.to,
      lifecycleAction: action.name,
    },
    context,
  );
  const syncDecision = runtime.syncPolicy.evaluateLocalWrite(object.name, "transition", context);
  return decision.effect === "allow" && syncDecision.allowed;
}
