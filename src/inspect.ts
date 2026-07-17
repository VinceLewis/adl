import { toStorageName, toTableName } from "./model/defaults.js";
import type {
  JsonValue,
  PartialApplicationModel,
  PartialObjectModel,
  PolicyAction,
  ResolvedApplicationModel,
  ResolvedObject,
  RuntimeChannel,
  StoredObjectRecord,
} from "./model/resolved-model.js";
import type { PolicyDecision, PolicyRequest, RuntimeContext } from "./runtime/runtime-types.js";
import { PolicyEngine } from "./runtime/policy-engine.js";

export type ResolvedModelOriginKind =
  | "source"
  | "sourceOrEquivalent"
  | "platformDefault"
  | "derivedDefault";

export interface ResolvedModelExplanationEntry {
  path: string;
  value: JsonValue;
  origin: ResolvedModelOriginKind;
  note: string;
}

export interface ResolvedModelExplanation {
  model: ResolvedApplicationModel;
  entries: ResolvedModelExplanationEntry[];
}

export interface PolicyDecisionExplanation {
  request: {
    objectName: string;
    action: PolicyAction;
    field?: string;
    currentState?: string;
    lifecycleAction?: string;
    channel: RuntimeChannel;
  };
  context: {
    userId: string;
    roles: string[];
    selectedContexts?: Record<string, string>;
    contextRoles?: RuntimeContext["contextRoles"];
  };
  decision: PolicyDecision;
  precedence: "explicitDeny" | "presentationRestriction" | "allow" | "defaultDeny";
}

export function explainResolvedModel(
  model: ResolvedApplicationModel,
  source?: PartialApplicationModel,
): ResolvedModelExplanation {
  return {
    model,
    entries: [
      ...explainTopLevelDefaults(model, source),
      ...model.objects.flatMap((object, index) =>
        explainObjectDefaults(
          object,
          index,
          source?.objects.find((item) => item.name === object.name),
        ),
      ),
    ],
  };
}

export function inspectResolvedModel(
  model: ResolvedApplicationModel,
  source?: PartialApplicationModel,
): string {
  const explanation = explainResolvedModel(model, source);
  const lines = [
    `ADL Resolved Model: ${model.app.name}`,
    `modelVersion: ${model.modelVersion}`,
    `startView: ${model.app.startView}`,
    `theme: ${model.app.theme}`,
    "",
    "Default Origins:",
    ...explanation.entries.map(
      (entry) => `- ${entry.path} = ${JSON.stringify(entry.value)} (${entry.origin}) ${entry.note}`,
    ),
    "",
    "Resolved Model:",
    JSON.stringify(model, null, 2),
  ];

  return lines.join("\n");
}

export function explainPolicyDecision(
  decision: PolicyDecision,
  request: PolicyRequest,
  context: RuntimeContext,
): PolicyDecisionExplanation {
  return {
    request: {
      objectName: request.objectName,
      action: request.action,
      ...(request.field === undefined ? {} : { field: request.field }),
      ...(request.currentState === undefined ? {} : { currentState: request.currentState }),
      ...(request.lifecycleAction === undefined
        ? {}
        : { lifecycleAction: request.lifecycleAction }),
      channel: request.channel ?? context.channel,
    },
    context: {
      userId: context.userId,
      roles: [...context.roles],
      ...(context.selectedContexts === undefined
        ? {}
        : { selectedContexts: { ...context.selectedContexts } }),
      ...(context.contextRoles === undefined
        ? {}
        : {
            contextRoles: context.contextRoles.map((role) => ({ ...role })),
          }),
    },
    decision,
    precedence: explainPolicyPrecedence(decision),
  };
}

export function explainPolicyRequest(
  model: ResolvedApplicationModel,
  request: PolicyRequest,
  context: RuntimeContext,
): PolicyDecisionExplanation {
  const engine = new PolicyEngine(model);
  const decision = engine.evaluate(request, context);
  return explainPolicyDecision(decision, request, context);
}

function explainTopLevelDefaults(
  model: ResolvedApplicationModel,
  source: PartialApplicationModel | undefined,
): ResolvedModelExplanationEntry[] {
  return [
    {
      path: "app.theme",
      value: model.app.theme,
      origin: source?.app.theme === undefined ? "platformDefault" : "source",
      note:
        source?.app.theme === undefined
          ? "Default application theme was applied."
          : "Application theme was supplied by the source model.",
    },
    {
      path: "app.startView",
      value: model.app.startView,
      origin: source?.app.startView === undefined ? "derivedDefault" : "source",
      note:
        source?.app.startView === undefined
          ? "Start view was derived from the first resolved object view."
          : "Start view was supplied by the source model.",
    },
    {
      path: "defaults",
      value: model.defaults as unknown as JsonValue,
      origin: "platformDefault",
      note: "Resolved model defaults are platform-defined and inspectable.",
    },
  ];
}

function explainObjectDefaults(
  object: ResolvedObject,
  objectIndex: number,
  source: PartialObjectModel | undefined,
): ResolvedModelExplanationEntry[] {
  const objectPath = `objects[${objectIndex}]`;
  return [
    {
      path: `${objectPath}.tableName`,
      value: object.tableName,
      origin: originForOptionalSourceValue(
        source?.tableName,
        object.tableName,
        toTableName(object.name),
      ),
      note:
        source?.tableName === undefined
          ? "Table name was derived by deterministic snake-case normalisation."
          : "Table name was supplied by the source model.",
    },
    {
      path: `${objectPath}.schemaVersion`,
      value: object.schemaVersion,
      origin:
        source?.schemaVersion === undefined ? ("platformDefault" as const) : ("source" as const),
      note:
        source?.schemaVersion === undefined
          ? "Object schema version default was applied."
          : "Object schema version was supplied by the source model.",
    },
    {
      path: `${objectPath}.systemIdField`,
      value: object.systemIdField,
      origin:
        source?.systemIdField === undefined ? ("platformDefault" as const) : ("source" as const),
      note:
        source?.systemIdField === undefined
          ? "Platform record id field default was applied."
          : "System id field was supplied by the source model.",
    },
    {
      path: `${objectPath}.metadataFields`,
      value: object.metadataFields.map((field) => field.name),
      origin: "platformDefault" as const,
      note: "Metadata fields are added by the platform and stay outside business fields.",
    },
    {
      path: `${objectPath}.sync.mode`,
      value: object.sync.mode,
      origin: source?.sync?.mode === undefined ? ("platformDefault" as const) : ("source" as const),
      note:
        source?.sync?.mode === undefined
          ? "Object sync mode default was applied."
          : "Object sync mode was supplied by the source model.",
    },
    {
      path: `${objectPath}.sync.scope`,
      value: object.sync.scope,
      origin:
        source?.sync?.scope === undefined ? ("platformDefault" as const) : ("source" as const),
      note:
        source?.sync?.scope === undefined
          ? "Object sync scope default was applied."
          : "Object sync scope was supplied by the source model.",
    },
    {
      path: `${objectPath}.sync.conflict`,
      value: object.sync.conflict,
      origin:
        source?.sync?.conflict === undefined ? ("platformDefault" as const) : ("source" as const),
      note:
        source?.sync?.conflict === undefined
          ? "Object conflict strategy default was applied."
          : "Object conflict strategy was supplied by the source model.",
    },
    ...(object.sync.window === undefined
      ? []
      : [
          {
            path: `${objectPath}.sync.window`,
            value: object.sync.window as unknown as JsonValue,
            origin:
              source?.sync?.window === undefined && object.sync.scope === "recent"
                ? ("derivedDefault" as const)
                : ("source" as const),
            note:
              source?.sync?.window === undefined && object.sync.scope === "recent"
                ? "Recent sync scope defaulted to a 30-day _updatedAt window."
                : "Sync window was supplied by the source model.",
          },
        ]),
    ...object.fields.flatMap((field, fieldIndex) => {
      const sourceField = source?.fields?.find((item) => item.name === field.name);
      const fieldPath = `${objectPath}.fields[${fieldIndex}]`;
      return [
        {
          path: `${fieldPath}.storageName`,
          value: field.storageName,
          origin: originForOptionalSourceValue(
            sourceField?.storageName,
            field.storageName,
            toStorageName(field.name),
          ),
          note:
            sourceField?.storageName === undefined
              ? "Field storage name was derived by deterministic snake-case normalisation."
              : "Field storage name was supplied by the source model.",
        },
        {
          path: `${fieldPath}.type`,
          value: field.type,
          origin:
            sourceField?.type === undefined ? ("platformDefault" as const) : ("source" as const),
          note:
            sourceField?.type === undefined
              ? "Field type defaulted to text."
              : "Field type was supplied by the source model.",
        },
        {
          path: `${fieldPath}.required`,
          value: field.required,
          origin:
            sourceField?.required === undefined
              ? ("platformDefault" as const)
              : ("source" as const),
          note:
            sourceField?.required === undefined
              ? "Field required flag defaulted to false."
              : "Field required flag was supplied by the source model.",
        },
      ];
    }),
    {
      path: `${objectPath}.views`,
      value: object.views.map((view) => view.name),
      origin:
        source?.views === undefined || source.views.length === 0
          ? ("derivedDefault" as const)
          : ("source" as const),
      note:
        source?.views === undefined || source.views.length === 0
          ? "List and form views were derived from object fields."
          : "Object views were supplied by the source model.",
    },
    {
      path: `${objectPath}.audit`,
      value: object.audit as unknown as JsonValue,
      origin: source?.audit === undefined ? ("platformDefault" as const) : ("source" as const),
      note:
        source?.audit === undefined
          ? "Object audit policy default was applied."
          : "Object audit policy was supplied by the source model.",
    },
  ];
}

function originForOptionalSourceValue(
  sourceValue: JsonValue | undefined,
  resolvedValue: JsonValue,
  defaultValue: JsonValue,
): ResolvedModelOriginKind {
  if (sourceValue !== undefined) {
    return "source";
  }

  return JSON.stringify(resolvedValue) === JSON.stringify(defaultValue)
    ? "derivedDefault"
    : "sourceOrEquivalent";
}

function explainPolicyPrecedence(
  decision: PolicyDecision,
): PolicyDecisionExplanation["precedence"] {
  if (
    decision.effect === "deny" &&
    decision.reasons.some((reason) => reason.message.includes("default deny"))
  ) {
    return "defaultDeny";
  }

  if (decision.effect === "deny") {
    return "explicitDeny";
  }

  if (decision.effect === "allow") {
    return "allow";
  }

  return "presentationRestriction";
}
