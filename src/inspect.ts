import { toStorageName, toTableName } from "./model/defaults.js";
import type {
  JsonValue,
  PartialApplicationModel,
  PartialObjectModel,
  PartialPresentationListModel,
  PartialPresentationRowFragmentModel,
  PartialPresentationSectionModel,
  PartialPresentationStateModel,
  PartialViewModel,
  PolicyAction,
  ResolvedApplicationModel,
  ResolvedObject,
  ResolvedPresentationControl,
  ResolvedPresentationList,
  ResolvedPresentationRowFragment,
  ResolvedPresentationSection,
  ResolvedPresentationState,
  ResolvedView,
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
    ...object.views.flatMap((view, viewIndex) =>
      explainViewDefaults(
        view,
        `${objectPath}.views[${viewIndex}]`,
        source?.views?.find((item) => item.name === view.name),
      ),
    ),
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

function explainViewDefaults(
  view: ResolvedView,
  viewPath: string,
  source: PartialViewModel | undefined,
): ResolvedModelExplanationEntry[] {
  if (view.presentation === undefined) {
    return [];
  }

  const sourcePresentation = source?.presentation;
  const presentationPath = `${viewPath}.presentation`;
  return [
    {
      path: `${presentationPath}.layout`,
      value: view.presentation.layout,
      origin: sourcePresentation?.layout === undefined ? "platformDefault" : "source",
      note:
        sourcePresentation?.layout === undefined
          ? "Composed view presentation layout default was applied."
          : "Composed view presentation layout was supplied by the source model.",
    },
    {
      path: `${presentationPath}.density`,
      value: view.presentation.density,
      origin: sourcePresentation?.density === undefined ? "platformDefault" : "source",
      note:
        sourcePresentation?.density === undefined
          ? "Composed view presentation density default was applied."
          : "Composed view presentation density was supplied by the source model.",
    },
    ...view.presentation.state.flatMap((state, stateIndex) =>
      explainPresentationStateDefaults(
        state,
        `${presentationPath}.state[${stateIndex}]`,
        sourcePresentation?.state?.find((item) => item.name === state.name),
      ),
    ),
    ...view.presentation.iconMaps.map((iconMap, iconMapIndex) => ({
      path: `${presentationPath}.iconMaps[${iconMapIndex}].field`,
      value: iconMap.field,
      origin: "source" as const,
      note: `Icon map '${iconMap.name}' resolves values from presentation row field '${iconMap.field}'.`,
    })),
    ...view.presentation.sections.flatMap((section, sectionIndex) =>
      explainPresentationSectionDefaults(
        section,
        `${presentationPath}.sections[${sectionIndex}]`,
        sourcePresentation?.sections?.find((item) => item.name === section.name),
      ),
    ),
  ];
}

function explainPresentationStateDefaults(
  state: ResolvedPresentationState,
  statePath: string,
  source: PartialPresentationStateModel | undefined,
): ResolvedModelExplanationEntry[] {
  return [
    {
      path: `${statePath}.type`,
      value: state.type,
      origin: source?.type === undefined ? "platformDefault" : "source",
      note:
        source?.type === undefined
          ? "Presentation local state type defaulted to boolean."
          : "Presentation local state type was supplied by the source model.",
    },
    {
      path: `${statePath}.defaultValue`,
      value: state.defaultValue,
      origin: source?.defaultValue === undefined ? "platformDefault" : "source",
      note:
        source?.defaultValue === undefined
          ? "Presentation local state default value was derived from its type."
          : "Presentation local state default value was supplied by the source model.",
    },
    {
      path: `${statePath}.persistence`,
      value: state.persistence,
      origin: source?.persistence === undefined ? "platformDefault" : "source",
      note:
        source?.persistence === undefined
          ? "Presentation local state persistence defaulted to memory."
          : "Presentation local state persistence was supplied by the source model.",
    },
  ];
}

function explainPresentationSectionDefaults(
  section: ResolvedPresentationSection,
  sectionPath: string,
  source: PartialPresentationSectionModel | undefined,
): ResolvedModelExplanationEntry[] {
  return [
    {
      path: `${sectionPath}.layout`,
      value: section.layout,
      origin: source?.layout === undefined ? "platformDefault" : "source",
      note:
        source?.layout === undefined
          ? "Presentation section layout inherited the default stack layout."
          : "Presentation section layout was supplied by the source model.",
    },
    {
      path: `${sectionPath}.density`,
      value: section.density,
      origin: source?.density === undefined ? "platformDefault" : "source",
      note:
        source?.density === undefined
          ? "Presentation section density inherited the comfortable default."
          : "Presentation section density was supplied by the source model.",
    },
    ...section.controls.flatMap((control, controlIndex) =>
      explainPresentationControlReferences(control, `${sectionPath}.controls[${controlIndex}]`),
    ),
    ...section.lists.flatMap((list, listIndex) =>
      explainPresentationListDefaults(
        list,
        `${sectionPath}.lists[${listIndex}]`,
        source?.lists?.find((item) => item.name === list.name),
      ),
    ),
  ];
}

function explainPresentationControlReferences(
  control: ResolvedPresentationControl,
  controlPath: string,
): ResolvedModelExplanationEntry[] {
  const entries: ResolvedModelExplanationEntry[] = [];

  if (control.kind === "toggle" || control.kind === "select") {
    entries.push({
      path: `${controlPath}.state`,
      value: control.state,
      origin: "source",
      note: `Presentation control '${control.name}' resolves local state '${control.state}'.`,
    });
  }

  if (control.kind === "action" && control.command !== undefined) {
    entries.push({
      path: `${controlPath}.command`,
      value: control.command,
      origin: "source",
      note: `Presentation action '${control.name}' resolves command '${control.command}'.`,
    });
  }

  if (control.kind === "action" && control.view !== undefined) {
    entries.push({
      path: `${controlPath}.view`,
      value: control.view,
      origin: "source",
      note: `Presentation action '${control.name}' resolves view '${control.view}'.`,
    });
  }

  if (control.kind === "contextSelector" && control.context !== undefined) {
    entries.push({
      path: `${controlPath}.context`,
      value: control.context,
      origin: "source",
      note: `Presentation context selector '${control.name}' resolves context '${control.context}'.`,
    });
  }

  return entries;
}

function explainPresentationListDefaults(
  list: ResolvedPresentationList,
  listPath: string,
  source: PartialPresentationListModel | undefined,
): ResolvedModelExplanationEntry[] {
  return [
    {
      path: `${listPath}.source`,
      value: list.source,
      origin: "source",
      note: `Presentation list '${list.name}' resolves ${list.sourceKind} source '${list.source}'.`,
    },
    {
      path: `${listPath}.sourceKind`,
      value: list.sourceKind,
      origin: source?.sourceKind === undefined ? "platformDefault" : "source",
      note:
        source?.sourceKind === undefined
          ? "Presentation list source kind defaulted to readModel."
          : "Presentation list source kind was supplied by the source model.",
    },
    {
      path: `${listPath}.renderAs`,
      value: list.renderAs,
      origin: source?.renderAs === undefined ? "platformDefault" : "source",
      note:
        source?.renderAs === undefined
          ? "Presentation list render style defaulted to table."
          : "Presentation list render style was supplied by the source model.",
    },
    {
      path: `${listPath}.density`,
      value: list.density,
      origin: source?.density === undefined ? "platformDefault" : "source",
      note:
        source?.density === undefined
          ? "Presentation list density inherited the comfortable default."
          : "Presentation list density was supplied by the source model.",
    },
    {
      path: `${listPath}.emptyState.text`,
      value: list.emptyState.text,
      origin: source?.emptyState?.text === undefined ? "platformDefault" : "source",
      note:
        source?.emptyState?.text === undefined
          ? "Presentation list empty-state text defaulted to an empty string."
          : "Presentation list empty-state text was supplied by the source model.",
    },
    {
      path: `${listPath}.row.layout`,
      value: list.row.layout,
      origin: source?.row?.layout === undefined ? "platformDefault" : "source",
      note:
        source?.row?.layout === undefined
          ? "Presentation row layout defaulted to inline."
          : "Presentation row layout was supplied by the source model.",
    },
    {
      path: `${listPath}.row.density`,
      value: list.row.density,
      origin: source?.row?.density === undefined ? "platformDefault" : "source",
      note:
        source?.row?.density === undefined
          ? "Presentation row density inherited the comfortable default."
          : "Presentation row density was supplied by the source model.",
    },
    ...list.row.fragments.flatMap((fragment, fragmentIndex) =>
      explainPresentationFragmentDefaults(
        fragment,
        `${listPath}.row.fragments[${fragmentIndex}]`,
        source?.row?.fragments?.[fragmentIndex],
      ),
    ),
  ];
}

function explainPresentationFragmentDefaults(
  fragment: ResolvedPresentationRowFragment,
  fragmentPath: string,
  source: PartialPresentationRowFragmentModel | undefined,
): ResolvedModelExplanationEntry[] {
  if (fragment.kind === "field") {
    return [
      {
        path: `${fragmentPath}.field`,
        value: fragment.field,
        origin: "source",
        note: `Presentation row field fragment resolves row field '${fragment.field}'.`,
      },
      {
        path: `${fragmentPath}.style`,
        value: fragment.style,
        origin:
          source?.kind === "field" && source.style === undefined ? "platformDefault" : "source",
        note:
          source?.kind === "field" && source.style === undefined
            ? "Presentation row field fragment style defaulted to plain."
            : "Presentation row field fragment style was supplied by the source model.",
      },
    ];
  }

  if (fragment.kind === "text") {
    return [
      {
        path: `${fragmentPath}.style`,
        value: fragment.style,
        origin:
          source?.kind === "text" && source.style === undefined ? "platformDefault" : "source",
        note:
          source?.kind === "text" && source.style === undefined
            ? "Presentation row text fragment style defaulted to plain."
            : "Presentation row text fragment style was supplied by the source model.",
      },
    ];
  }

  if (fragment.kind === "icon" && fragment.icon.kind === "map") {
    return [
      {
        path: `${fragmentPath}.icon.map`,
        value: fragment.icon.map,
        origin: "source",
        note: `Presentation icon fragment resolves icon map '${fragment.icon.map}'.`,
      },
    ];
  }

  return [];
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
