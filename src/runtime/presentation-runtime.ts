import type {
  JsonPrimitive,
  JsonValue,
  ResolvedCommand,
  PresentationDensity,
  PresentationFragmentStyle,
  PresentationLayout,
  ResolvedExpression,
  PresentationRowLayout,
  ResolvedApplicationModel,
  ResolvedPresentationControl,
  ResolvedPresentationEmptyState,
  ResolvedPresentationFormat,
  ResolvedPresentationIconMap,
  ResolvedPresentationIconRef,
  ResolvedPresentationList,
  ResolvedPresentationRowFragment,
  ResolvedPresentationSection,
  ResolvedPresentationState,
  ResolvedSort,
  ResolvedView,
  StoredObjectRecord,
} from "../model/resolved-model.js";
import { evaluateExpression, evaluateExpressionAsBoolean } from "./expression-evaluator.js";
import { RuntimeModelIndex } from "./model-helpers.js";
import { cloneJson, noopRuntimeLogger, safeContextLog } from "./runtime-types.js";
import type {
  RuntimeContext,
  RuntimeLogger,
  RuntimeReadModelResult,
  RuntimeReadModelRow,
  RuntimeSearchInput,
} from "./runtime-types.js";

export type RuntimePresentationDiagnosticSeverity = "warning" | "error";

export interface RuntimePresentationDiagnostic {
  severity: RuntimePresentationDiagnosticSeverity;
  code:
    | "ADL_PRESENTATION_VIEW_NOT_COMPOSED"
    | "ADL_PRESENTATION_STATE_UNKNOWN"
    | "ADL_PRESENTATION_STATE_TYPE_MISMATCH"
    | "ADL_PRESENTATION_LIST_BINDING_FAILED"
    | "ADL_PRESENTATION_FILTER_EVALUATION_FAILED"
    | "ADL_PRESENTATION_CONDITIONAL_EVALUATION_FAILED"
    | "ADL_PRESENTATION_FIELD_MISSING"
    | "ADL_PRESENTATION_ICON_MAP_MISSING"
    | "ADL_PRESENTATION_ICON_VALUE_MISSING"
    | "ADL_PRESENTATION_ACTION_INPUT_FAILED"
    | "ADL_PRESENTATION_ACTION_VISIBILITY_FAILED"
    | "ADL_PRESENTATION_FORMAT_UNSUPPORTED"
    | "ADL_PRESENTATION_FORMAT_INVALID_VALUE";
  message: string;
  path?: string;
  section?: string | undefined;
  list?: string | undefined;
  field?: string | undefined;
}

export interface RuntimePresentationView {
  object: string;
  view: string;
  layout: PresentationLayout;
  density: PresentationDensity;
  state: Record<string, JsonValue>;
  sections: RuntimePresentationSection[];
  diagnostics: RuntimePresentationDiagnostic[];
}

export interface RuntimePresentationSection {
  name: string;
  heading?: string;
  layout: ResolvedPresentationSection["layout"];
  density: ResolvedPresentationSection["density"];
  controls: RuntimePresentationControl[];
  lists: RuntimePresentationList[];
}

export type RuntimePresentationControl =
  | RuntimePresentationToggleControl
  | RuntimePresentationSelectControl
  | RuntimePresentationActionControl
  | RuntimePresentationContextSelectorControl;

export interface RuntimePresentationControlBase {
  name: string;
  kind: ResolvedPresentationControl["kind"];
  label?: string;
  icon?: RuntimePresentationIcon;
}

export interface RuntimePresentationToggleControl extends RuntimePresentationControlBase {
  kind: "toggle";
  state: string;
  value: boolean;
}

export interface RuntimePresentationSelectControl extends RuntimePresentationControlBase {
  kind: "select";
  state: string;
  value: JsonValue;
  options: RuntimePresentationSelectOption[];
}

export interface RuntimePresentationSelectOption {
  value: JsonPrimitive;
  label: string;
  icon?: RuntimePresentationIcon;
}

export interface RuntimePresentationActionControl extends RuntimePresentationControlBase {
  kind: "action";
  placement: Extract<ResolvedPresentationControl, { kind: "action" }>["placement"];
  visible: boolean;
  enabled: boolean;
  reasons: string[];
  input: Record<string, JsonValue>;
  command?: string;
  view?: string;
}

export interface RuntimePresentationContextSelectorControl extends RuntimePresentationControlBase {
  kind: "contextSelector";
  context?: string;
}

export interface RuntimePresentationIcon {
  name: string;
  source: RuntimePresentationIconSource;
}

export type RuntimePresentationIconSource =
  | { kind: "named" }
  | { kind: "map"; map: string; value: JsonPrimitive };

export interface RuntimePresentationList {
  name: string;
  sourceKind: ResolvedPresentationList["sourceKind"];
  source: string;
  renderAs: ResolvedPresentationList["renderAs"];
  density: ResolvedPresentationList["density"];
  rows: RuntimePresentationRow[];
  emptyState?: RuntimePresentationEmptyState;
}

export interface RuntimePresentationEmptyState {
  text: string;
  icon?: RuntimePresentationIcon;
}

export interface RuntimePresentationRow {
  id: string;
  values: Record<string, JsonValue>;
  sources: RuntimePresentationRowSource[];
  layout: PresentationRowLayout;
  density: ResolvedPresentationList["density"];
  fragments: RuntimePresentationFragment[];
  actions: RuntimePresentationActionControl[];
}

export interface RuntimePresentationRowSource {
  objectName: string;
  recordId: string;
  source?: string | undefined;
}

export type RuntimePresentationFragment =
  | RuntimePresentationTextFragment
  | RuntimePresentationIconFragment;

export interface RuntimePresentationTextFragment {
  kind: "text";
  text: string;
  style: PresentationFragmentStyle;
}

export interface RuntimePresentationIconFragment {
  kind: "icon";
  icon: RuntimePresentationIcon;
  label?: string;
}

export interface RuntimePresentationEvaluationInput {
  objectName: string;
  viewName: string;
  context: RuntimeContext;
  state?: Record<string, JsonValue>;
  updates?: Record<string, JsonValue>;
}

export interface RuntimePresentationDataSource {
  search(
    objectName: string,
    query: RuntimeSearchInput,
    context: RuntimeContext,
  ): Promise<StoredObjectRecord[]>;
  executeReadModel(
    readModelName: string,
    context: RuntimeContext,
    query?: { sort?: ResolvedSort[] },
  ): Promise<RuntimeReadModelResult>;
}

export class PresentationRuntime {
  constructor(
    model: ResolvedApplicationModel,
    private readonly dataSource: RuntimePresentationDataSource,
    private readonly index = new RuntimeModelIndex(model),
    private readonly logger: RuntimeLogger = noopRuntimeLogger,
  ) {}

  initializeState(view: ResolvedView): Record<string, JsonValue> {
    return initializePresentationState(view);
  }

  applyStateUpdates(
    view: ResolvedView,
    currentState: Record<string, JsonValue>,
    updates: Record<string, JsonValue>,
  ): { state: Record<string, JsonValue>; diagnostics: RuntimePresentationDiagnostic[] } {
    return applyPresentationStateUpdates(view, currentState, updates);
  }

  async evaluate(input: RuntimePresentationEvaluationInput): Promise<RuntimePresentationView> {
    const object = this.index.getObject(input.objectName);
    const view = object.views.find((candidate) => candidate.name === input.viewName);
    if (view === undefined) {
      throw new Error(`View '${input.viewName}' does not exist on object '${input.objectName}'.`);
    }

    if (view.presentation === undefined) {
      return {
        object: object.name,
        view: view.name,
        layout: "stack",
        density: "comfortable",
        state: {},
        sections: [],
        diagnostics: [
          {
            severity: "error",
            code: "ADL_PRESENTATION_VIEW_NOT_COMPOSED",
            message: `View '${view.name}' does not declare composed presentation.`,
          },
        ],
      };
    }

    const diagnostics: RuntimePresentationDiagnostic[] = [];
    const providedState = applyPresentationStateUpdates(
      view,
      initializePresentationState(view),
      input.state ?? {},
    );
    const stateResult = applyPresentationStateUpdates(
      view,
      providedState.state,
      input.updates ?? {},
    );
    diagnostics.push(...providedState.diagnostics, ...stateResult.diagnostics);

    this.logger.debug("ENTER PresentationRuntime.evaluate", {
      objectName: object.name,
      viewName: view.name,
      context: safeContextLog(input.context),
    });

    const sections: RuntimePresentationSection[] = [];
    for (const [sectionIndex, section] of view.presentation.sections.entries()) {
      sections.push(
        await this.evaluateSection(
          section,
          view,
          stateResult.state,
          input.context,
          diagnostics,
          `presentation.sections[${sectionIndex}]`,
        ),
      );
    }

    this.logger.debug("EXIT PresentationRuntime.evaluate", {
      objectName: object.name,
      viewName: view.name,
      diagnostics: diagnostics.length,
    });

    return {
      object: object.name,
      view: view.name,
      layout: view.presentation.layout,
      density: view.presentation.density,
      state: stateResult.state,
      sections,
      diagnostics,
    };
  }

  private async evaluateSection(
    section: ResolvedPresentationSection,
    view: ResolvedView,
    state: Record<string, JsonValue>,
    context: RuntimeContext,
    diagnostics: RuntimePresentationDiagnostic[],
    path: string,
  ): Promise<RuntimePresentationSection> {
    const controls = section.controls.map((control, index) =>
      this.evaluateControl(
        control,
        view,
        state,
        context,
        diagnostics,
        `${path}.controls[${index}]`,
        section.name,
      ),
    );
    const lists: RuntimePresentationList[] = [];

    for (const [listIndex, list] of section.lists.entries()) {
      lists.push(
        await this.evaluateList(
          list,
          view,
          state,
          context,
          diagnostics,
          `${path}.lists[${listIndex}]`,
          section.name,
        ),
      );
    }

    return {
      name: section.name,
      ...(section.heading === undefined ? {} : { heading: section.heading }),
      layout: section.layout,
      density: section.density,
      controls,
      lists,
    };
  }

  private evaluateControl(
    control: ResolvedPresentationControl,
    view: ResolvedView,
    state: Record<string, JsonValue>,
    context: RuntimeContext,
    diagnostics: RuntimePresentationDiagnostic[],
    path: string,
    section: string,
  ): RuntimePresentationControl {
    const icon = this.resolveIcon(control.icon, view, state, undefined, diagnostics, {
      path: `${path}.icon`,
      section,
    });
    const base = {
      name: control.name,
      kind: control.kind,
      ...(control.label === undefined ? {} : { label: control.label }),
      ...(icon === undefined ? {} : { icon }),
    };

    switch (control.kind) {
      case "toggle":
        return {
          ...base,
          kind: "toggle",
          state: control.state,
          value: state[control.state] === true,
        };
      case "select":
        return {
          ...base,
          kind: "select",
          state: control.state,
          value: state[control.state] ?? null,
          options: control.options.map((option, index) => {
            const optionIcon = this.resolveIcon(option.icon, view, state, undefined, diagnostics, {
              path: `${path}.options[${index}].icon`,
              section,
            });
            return {
              value: cloneJson(option.value),
              label: option.label,
              ...(optionIcon === undefined ? {} : { icon: optionIcon }),
            };
          }),
        };
      case "action":
        return this.evaluateActionControl(
          control,
          base,
          view,
          state,
          undefined,
          context,
          diagnostics,
          {
            path,
            section,
          },
        );
      case "contextSelector":
        return {
          ...base,
          kind: "contextSelector",
          ...(control.context === undefined ? {} : { context: control.context }),
        };
    }
  }

  private async evaluateList(
    list: ResolvedPresentationList,
    view: ResolvedView,
    state: Record<string, JsonValue>,
    context: RuntimeContext,
    diagnostics: RuntimePresentationDiagnostic[],
    path: string,
    section: string,
  ): Promise<RuntimePresentationList> {
    const boundRows = await this.bindListRows(list, context, diagnostics, path, section);
    const filteredRows = boundRows.filter((row) =>
      this.rowPassesFilter(list, row.values, state, context, diagnostics, path, section),
    );
    const sortedRows = sortPresentationRows(filteredRows, list.sort);
    const rows = sortedRows.map((row, index) =>
      this.evaluateRow(list, view, row, state, context, diagnostics, {
        path: `${path}.rows[${index}]`,
        section,
      }),
    );
    const emptyState =
      rows.length === 0
        ? this.evaluateEmptyState(list.emptyState, view, state, diagnostics, {
            path: `${path}.emptyState`,
            section,
            list: list.name,
          })
        : undefined;

    return {
      name: list.name,
      sourceKind: list.sourceKind,
      source: list.source,
      renderAs: list.renderAs,
      density: list.density,
      rows,
      ...(emptyState === undefined ? {} : { emptyState }),
    };
  }

  private async bindListRows(
    list: ResolvedPresentationList,
    context: RuntimeContext,
    diagnostics: RuntimePresentationDiagnostic[],
    path: string,
    section: string,
  ): Promise<BoundPresentationRow[]> {
    try {
      if (list.sourceKind === "readModel") {
        const result = await this.dataSource.executeReadModel(list.source, context);
        return result.rows.map(readModelRowToPresentationRow);
      }

      const records = await this.dataSource.search(list.source, undefined, context);
      return records.map(objectRecordToPresentationRow);
    } catch (error) {
      diagnostics.push({
        severity: "error",
        code: "ADL_PRESENTATION_LIST_BINDING_FAILED",
        message: `List '${list.name}' could not bind source '${list.source}'.`,
        path,
        section,
        list: list.name,
      });
      this.logger.debug("PresentationRuntime list binding failed", {
        list: list.name,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private rowPassesFilter(
    list: ResolvedPresentationList,
    values: Record<string, JsonValue>,
    state: Record<string, JsonValue>,
    context: RuntimeContext,
    diagnostics: RuntimePresentationDiagnostic[],
    path: string,
    section: string,
  ): boolean {
    if (list.filter === undefined) {
      return true;
    }

    const result = evaluateExpressionAsBoolean(list.filter, {
      values: { ...values, ...state },
      context,
    });
    if (result.ok) {
      return result.value.value === true;
    }

    diagnostics.push({
      severity: "error",
      code: "ADL_PRESENTATION_FILTER_EVALUATION_FAILED",
      message: result.error.message,
      path: `${path}.filter`,
      section,
      list: list.name,
    });
    return false;
  }

  private evaluateRow(
    list: ResolvedPresentationList,
    view: ResolvedView,
    row: BoundPresentationRow,
    state: Record<string, JsonValue>,
    context: RuntimeContext,
    diagnostics: RuntimePresentationDiagnostic[],
    location: DiagnosticLocation,
  ): RuntimePresentationRow {
    return {
      id: row.id,
      values: cloneJson(row.values),
      sources: row.sources.map((source) => ({ ...source })),
      layout: list.row.layout,
      density: list.row.density,
      fragments: this.evaluateFragments(
        list.row.fragments,
        view,
        row.values,
        state,
        context,
        diagnostics,
        { ...location, list: list.name },
      ),
      actions: list.actions
        .map((action, index) => {
          const actionIcon = this.resolveIcon(action.icon, view, state, row.values, diagnostics, {
            ...location,
            path: `${location.path}.actions[${index}].icon`,
            list: list.name,
          });
          return this.evaluateActionControl(
            action,
            {
              name: action.name,
              kind: "action",
              ...(action.label === undefined ? {} : { label: action.label }),
              ...(actionIcon === undefined ? {} : { icon: actionIcon }),
            },
            view,
            state,
            row.values,
            context,
            diagnostics,
            { ...location, path: `${location.path}.actions[${index}]`, list: list.name },
          );
        })
        .filter((action) => action.visible),
    };
  }

  private evaluateActionControl(
    control: Extract<ResolvedPresentationControl, { kind: "action" }>,
    base: RuntimePresentationControlBase,
    view: ResolvedView,
    state: Record<string, JsonValue>,
    values: Record<string, JsonValue> | undefined,
    context: RuntimeContext,
    diagnostics: RuntimePresentationDiagnostic[],
    location: DiagnosticLocation,
  ): RuntimePresentationActionControl {
    const actionInput = this.evaluateActionInput(
      control.input,
      values,
      state,
      context,
      diagnostics,
      {
        ...location,
        path: `${location.path}.input`,
      },
    );
    const reasons: string[] = [...actionInput.reasons];
    const visibility = this.evaluateActionVisibility(control, values, state, context, diagnostics, {
      ...location,
      path: `${location.path}.visibleWhen`,
    });
    const commandState =
      control.command === undefined
        ? { enabled: true, reasons: [] }
        : this.evaluateCommandActionState(control.command, actionInput.input, context);
    reasons.push(...commandState.reasons);

    return {
      ...base,
      kind: "action",
      placement: control.placement,
      visible: visibility.visible,
      enabled: actionInput.ok && visibility.enabled && commandState.enabled,
      reasons,
      input: actionInput.input,
      ...(control.command === undefined ? {} : { command: control.command }),
      ...(control.view === undefined ? {} : { view: control.view }),
    };
  }

  private evaluateActionInput(
    input: Record<string, ResolvedExpression>,
    values: Record<string, JsonValue> | undefined,
    state: Record<string, JsonValue>,
    context: RuntimeContext,
    diagnostics: RuntimePresentationDiagnostic[],
    location: DiagnosticLocation,
  ): { ok: boolean; input: Record<string, JsonValue>; reasons: string[] } {
    const output: Record<string, JsonValue> = {};
    const reasons: string[] = [];
    let ok = true;
    for (const [name, expression] of Object.entries(input)) {
      const result = evaluateExpression(expression, {
        values: { ...(values ?? {}), ...state },
        context,
      });
      if (!result.ok) {
        ok = false;
        reasons.push(result.error.message);
        diagnostics.push({
          severity: "error",
          code: "ADL_PRESENTATION_ACTION_INPUT_FAILED",
          message: result.error.message,
          path: `${location.path}.${name}`,
          section: location.section,
          list: location.list,
        });
        continue;
      }
      output[name] = cloneJson(result.value.value);
    }
    return { ok, input: output, reasons };
  }

  private evaluateActionVisibility(
    control: Extract<ResolvedPresentationControl, { kind: "action" }>,
    values: Record<string, JsonValue> | undefined,
    state: Record<string, JsonValue>,
    context: RuntimeContext,
    diagnostics: RuntimePresentationDiagnostic[],
    location: DiagnosticLocation,
  ): { visible: boolean; enabled: boolean } {
    if (control.visibleWhen === undefined) {
      return { visible: true, enabled: true };
    }

    const result = evaluateExpressionAsBoolean(control.visibleWhen, {
      values: { ...(values ?? {}), ...state },
      context,
    });
    if (result.ok) {
      return { visible: result.value.value === true, enabled: true };
    }

    diagnostics.push({
      severity: "error",
      code: "ADL_PRESENTATION_ACTION_VISIBILITY_FAILED",
      message: result.error.message,
      path: location.path,
      section: location.section,
      list: location.list,
    });
    return { visible: false, enabled: false };
  }

  private evaluateCommandActionState(
    commandName: string,
    input: Record<string, JsonValue>,
    context: RuntimeContext,
  ): { enabled: boolean; reasons: string[] } {
    let command: ResolvedCommand;
    try {
      command = this.index.getCommand(commandName);
    } catch {
      return { enabled: false, reasons: [`Command '${commandName}' is not available.`] };
    }

    const reasons: string[] = [];
    for (const commandInput of command.inputs) {
      if (
        commandInput.required &&
        (input[commandInput.name] === undefined ||
          input[commandInput.name] === null ||
          input[commandInput.name] === "")
      ) {
        reasons.push(`Command '${commandName}' requires input '${commandInput.name}'.`);
      }
    }

    for (const precondition of command.preconditions) {
      const result = evaluateExpressionAsBoolean(precondition.expression, {
        values: input,
        context,
      });
      if (!result.ok || result.value.value !== true) {
        reasons.push(precondition.message);
      }
    }

    return { enabled: reasons.length === 0, reasons };
  }

  private evaluateFragments(
    fragments: ResolvedPresentationRowFragment[],
    view: ResolvedView,
    values: Record<string, JsonValue>,
    state: Record<string, JsonValue>,
    context: RuntimeContext,
    diagnostics: RuntimePresentationDiagnostic[],
    location: DiagnosticLocation,
  ): RuntimePresentationFragment[] {
    const output: RuntimePresentationFragment[] = [];

    for (let index = 0; index < fragments.length; index += 1) {
      const fragment = fragments[index];
      if (fragment === undefined) {
        continue;
      }
      const fragmentPath = `${location.path}.fragments[${index}]`;

      switch (fragment.kind) {
        case "text":
          output.push({ kind: "text", text: fragment.text, style: fragment.style });
          break;
        case "field":
          output.push({
            kind: "text",
            text: this.evaluateFieldText(fragment, values, diagnostics, {
              ...location,
              path: fragmentPath,
              field: fragment.field,
            }),
            style: fragment.style,
          });
          break;
        case "icon": {
          const icon = this.resolveIcon(fragment.icon, view, state, values, diagnostics, {
            ...location,
            path: `${fragmentPath}.icon`,
          });
          if (icon !== undefined) {
            output.push({
              kind: "icon",
              icon,
              ...(fragment.label === undefined ? {} : { label: fragment.label }),
            });
          }
          break;
        }
        case "conditional": {
          const result = evaluateExpressionAsBoolean(fragment.when, {
            values: { ...values, ...state },
            context,
          });
          if (result.ok && result.value.value === true) {
            output.push(
              ...this.evaluateFragments(
                fragment.fragments,
                view,
                values,
                state,
                context,
                diagnostics,
                { ...location, path: fragmentPath },
              ),
            );
          } else if (!result.ok) {
            diagnostics.push({
              severity: "error",
              code: "ADL_PRESENTATION_CONDITIONAL_EVALUATION_FAILED",
              message: result.error.message,
              path: `${fragmentPath}.when`,
              section: location.section,
              list: location.list,
            });
          }
          break;
        }
      }
    }

    return output;
  }

  private evaluateFieldText(
    fragment: Extract<ResolvedPresentationRowFragment, { kind: "field" }>,
    values: Record<string, JsonValue>,
    diagnostics: RuntimePresentationDiagnostic[],
    location: DiagnosticLocation,
  ): string {
    if (
      !Object.prototype.hasOwnProperty.call(values, fragment.field) ||
      values[fragment.field] === null
    ) {
      diagnostics.push({
        severity: "warning",
        code: "ADL_PRESENTATION_FIELD_MISSING",
        message: `Field '${fragment.field}' is missing from presentation row data.`,
        path: location.path,
        section: location.section,
        list: location.list,
        field: fragment.field,
      });
      return fragment.fallback ?? "";
    }

    const value = values[fragment.field];
    if (fragment.format !== undefined) {
      return formatPresentationValue(value, fragment.format, diagnostics, location);
    }

    return primitiveToText(value, diagnostics, location);
  }

  private evaluateEmptyState(
    emptyState: ResolvedPresentationEmptyState,
    view: ResolvedView,
    state: Record<string, JsonValue>,
    diagnostics: RuntimePresentationDiagnostic[],
    location: DiagnosticLocation,
  ): RuntimePresentationEmptyState {
    const icon = this.resolveIcon(emptyState.icon, view, state, undefined, diagnostics, location);
    return {
      text: emptyState.text,
      ...(icon === undefined ? {} : { icon }),
    };
  }

  private resolveIcon(
    iconRef: ResolvedPresentationIconRef | undefined,
    view: ResolvedView,
    state: Record<string, JsonValue>,
    values: Record<string, JsonValue> | undefined,
    diagnostics: RuntimePresentationDiagnostic[],
    location: DiagnosticLocation,
  ): RuntimePresentationIcon | undefined {
    if (iconRef === undefined) {
      return undefined;
    }

    if (iconRef.kind === "named") {
      return { name: iconRef.name, source: { kind: "named" } };
    }

    const iconMap = view.presentation?.iconMaps.find((candidate) => candidate.name === iconRef.map);
    if (iconMap === undefined) {
      diagnostics.push({
        severity: "error",
        code: "ADL_PRESENTATION_ICON_MAP_MISSING",
        message: `Icon map '${iconRef.map}' does not exist on view '${view.name}'.`,
        path: location.path,
        section: location.section,
        list: location.list,
      });
      return undefined;
    }

    const rawValue = this.resolveIconMapValue(
      iconRef,
      iconMap,
      values,
      state,
      diagnostics,
      location,
    );
    if (!isJsonPrimitive(rawValue)) {
      return undefined;
    }

    const mapped = iconMap.values.find((candidate) => candidate.value === rawValue);
    const iconName = mapped?.icon ?? iconMap.defaultIcon;
    if (iconName === undefined) {
      diagnostics.push({
        severity: "warning",
        code: "ADL_PRESENTATION_ICON_VALUE_MISSING",
        message: `Icon map '${iconMap.name}' has no icon for value '${String(rawValue)}'.`,
        path: location.path,
        section: location.section,
        list: location.list,
      });
      return undefined;
    }

    return {
      name: iconName,
      source: {
        kind: "map",
        map: iconMap.name,
        value: cloneJson(rawValue),
      },
    };
  }

  private resolveIconMapValue(
    iconRef: Extract<ResolvedPresentationIconRef, { kind: "map" }>,
    iconMap: ResolvedPresentationIconMap,
    values: Record<string, JsonValue> | undefined,
    state: Record<string, JsonValue>,
    diagnostics: RuntimePresentationDiagnostic[],
    location: DiagnosticLocation,
  ): JsonValue | undefined {
    if (iconRef.value !== undefined) {
      return iconRef.value;
    }

    const field = iconRef.field ?? iconMap.field;
    const sourceValues = values ?? state;
    if (Object.prototype.hasOwnProperty.call(sourceValues, field)) {
      return sourceValues[field];
    }

    diagnostics.push({
      severity: "warning",
      code: "ADL_PRESENTATION_FIELD_MISSING",
      message: `Icon map field '${field}' is missing from presentation data.`,
      path: location.path,
      section: location.section,
      list: location.list,
      field,
    });
    return undefined;
  }
}

export function initializePresentationState(view: ResolvedView): Record<string, JsonValue> {
  if (view.presentation === undefined) {
    return {};
  }

  return Object.fromEntries(
    view.presentation.state.map((state) => [state.name, cloneJson(state.defaultValue)]),
  );
}

export function applyPresentationStateUpdates(
  view: ResolvedView,
  currentState: Record<string, JsonValue>,
  updates: Record<string, JsonValue>,
): { state: Record<string, JsonValue>; diagnostics: RuntimePresentationDiagnostic[] } {
  const diagnostics: RuntimePresentationDiagnostic[] = [];
  const stateDefinitions = new Map(
    (view.presentation?.state ?? []).map((definition) => [definition.name, definition]),
  );
  const next = cloneJson(currentState);

  for (const [name, value] of Object.entries(updates)) {
    const definition = stateDefinitions.get(name);
    if (definition === undefined) {
      diagnostics.push({
        severity: "warning",
        code: "ADL_PRESENTATION_STATE_UNKNOWN",
        message: `Presentation state '${name}' is not declared on view '${view.name}'.`,
        path: `presentation.state.${name}`,
      });
      continue;
    }

    if (!valueMatchesPresentationStateType(value, definition)) {
      diagnostics.push({
        severity: "warning",
        code: "ADL_PRESENTATION_STATE_TYPE_MISMATCH",
        message: `Presentation state '${name}' expected ${definition.type}.`,
        path: `presentation.state.${name}`,
      });
      continue;
    }

    next[name] = cloneJson(value);
  }

  return { state: next, diagnostics };
}

interface BoundPresentationRow {
  id: string;
  values: Record<string, JsonValue>;
  sources: RuntimePresentationRowSource[];
}

interface DiagnosticLocation {
  path: string;
  section?: string | undefined;
  list?: string | undefined;
  field?: string | undefined;
}

function readModelRowToPresentationRow(row: RuntimeReadModelRow): BoundPresentationRow {
  return {
    id: row.id,
    values: cloneJson(row.values),
    sources: Object.entries(row.sources).map(([source, reference]) => ({
      source,
      objectName: reference.objectName,
      recordId: reference.recordId,
    })),
  };
}

function objectRecordToPresentationRow(record: StoredObjectRecord): BoundPresentationRow {
  return {
    id: `${record.meta.object}:${record.meta.guid}`,
    values: cloneJson(record.values),
    sources: [
      {
        objectName: record.meta.object,
        recordId: record.meta.guid,
      },
    ],
  };
}

function sortPresentationRows(
  rows: BoundPresentationRow[],
  sort: ResolvedSort[],
): BoundPresentationRow[] {
  if (sort.length === 0) {
    return [...rows];
  }

  return [...rows].sort((left, right) => {
    for (const sortItem of sort) {
      const comparison = compareJsonValues(
        left.values[sortItem.field],
        right.values[sortItem.field],
      );
      if (comparison !== 0) {
        return sortItem.direction === "asc" ? comparison : -comparison;
      }
    }

    return left.id.localeCompare(right.id);
  });
}

function compareJsonValues(left: JsonValue | undefined, right: JsonValue | undefined): number {
  if (left === undefined && right === undefined) {
    return 0;
  }
  if (left === undefined || left === null) {
    return 1;
  }
  if (right === undefined || right === null) {
    return -1;
  }
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  if (typeof left === "boolean" && typeof right === "boolean") {
    return Number(left) - Number(right);
  }

  return String(left).localeCompare(String(right));
}

function valueMatchesPresentationStateType(
  value: JsonValue,
  definition: ResolvedPresentationState,
): boolean {
  if (value === null) {
    return (
      definition.type === "date" || definition.type === "datetime" || definition.type === "time"
    );
  }

  switch (definition.type) {
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "text":
    case "date":
    case "datetime":
    case "time":
      return typeof value === "string";
  }
}

function formatPresentationValue(
  value: JsonValue | undefined,
  format: ResolvedPresentationFormat,
  diagnostics: RuntimePresentationDiagnostic[],
  location: DiagnosticLocation,
): string {
  switch (format.kind) {
    case "text":
      return primitiveToText(value, diagnostics, location);
    case "number":
      return formatNumber(value, format, diagnostics, location);
    case "date":
      return formatDate(value, format, diagnostics, location);
    case "time":
      return formatTime(value, format, diagnostics, location);
    case "datetime":
      return formatDateTime(value, format, diagnostics, location);
  }
}

function primitiveToText(
  value: JsonValue | undefined,
  diagnostics: RuntimePresentationDiagnostic[],
  location: DiagnosticLocation,
): string {
  if (value === undefined || value === null) {
    diagnostics.push({
      severity: "warning",
      code: "ADL_PRESENTATION_FIELD_MISSING",
      message: "Presentation value is missing.",
      path: location.path,
      section: location.section,
      list: location.list,
      field: location.field,
    });
    return "";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  diagnostics.push({
    severity: "warning",
    code: "ADL_PRESENTATION_FORMAT_INVALID_VALUE",
    message: "Presentation value must be primitive to format as text.",
    path: location.path,
    section: location.section,
    list: location.list,
    field: location.field,
  });
  return "";
}

function formatNumber(
  value: JsonValue | undefined,
  format: ResolvedPresentationFormat,
  diagnostics: RuntimePresentationDiagnostic[],
  location: DiagnosticLocation,
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    diagnostics.push({
      severity: "warning",
      code: "ADL_PRESENTATION_FORMAT_INVALID_VALUE",
      message: "Number format requires a finite number value.",
      path: location.path,
      section: location.section,
      list: location.list,
      field: location.field,
    });
    return "";
  }

  if (format.pattern === undefined || format.pattern === "plain") {
    return String(value);
  }

  if (format.pattern === "integer") {
    return String(Math.round(value));
  }

  const fixedMatch = /^fixed:(\d+)$/.exec(format.pattern);
  const decimalPatternMatch = /^0(?:\.(0{1,4}))?$/.exec(format.pattern);
  const digits =
    fixedMatch?.[1] ??
    (decimalPatternMatch?.[1] === undefined ? undefined : String(decimalPatternMatch[1].length));
  if (digits !== undefined) {
    const precision = Number(digits);
    if (precision >= 0 && precision <= 4) {
      return value.toFixed(precision);
    }
  }

  diagnostics.push(unsupportedFormat(format, location));
  return String(value);
}

function formatDate(
  value: JsonValue | undefined,
  format: ResolvedPresentationFormat,
  diagnostics: RuntimePresentationDiagnostic[],
  location: DiagnosticLocation,
): string {
  if (typeof value !== "string") {
    diagnostics.push(invalidFormatValue("Date format requires a YYYY-MM-DD text value.", location));
    return "";
  }

  const parts = parseDateParts(value);
  if (parts === undefined) {
    diagnostics.push(
      invalidFormatValue("Date format requires a valid YYYY-MM-DD value.", location),
    );
    return value;
  }

  return applyDatePattern(parts, format, diagnostics, location) ?? value;
}

function formatTime(
  value: JsonValue | undefined,
  format: ResolvedPresentationFormat,
  diagnostics: RuntimePresentationDiagnostic[],
  location: DiagnosticLocation,
): string {
  if (typeof value !== "string") {
    diagnostics.push(invalidFormatValue("Time format requires an HH:mm text value.", location));
    return "";
  }

  const parts = parseTimeParts(value);
  if (parts === undefined) {
    diagnostics.push(
      invalidFormatValue("Time format requires a valid HH:mm or HH:mm:ss value.", location),
    );
    return value;
  }

  return applyTimePattern(parts, format, diagnostics, location) ?? value;
}

function formatDateTime(
  value: JsonValue | undefined,
  format: ResolvedPresentationFormat,
  diagnostics: RuntimePresentationDiagnostic[],
  location: DiagnosticLocation,
): string {
  if (typeof value !== "string") {
    diagnostics.push(
      invalidFormatValue("Datetime format requires an ISO datetime text value.", location),
    );
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    diagnostics.push(
      invalidFormatValue("Datetime format requires a valid ISO datetime value.", location),
    );
    return value;
  }

  const parts = {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    weekday: date.getUTCDay(),
  };
  const time = {
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  };
  const pattern = format.pattern ?? "yyyy-MM-dd HH:mm";
  const segments = pattern.split(/( +)/);
  const formatted: string[] = [];

  for (const segment of segments) {
    if (segment.trim().length === 0) {
      formatted.push(segment);
      continue;
    }

    const hasDateToken = containsDateToken(segment);
    const hasTimeToken = containsTimeToken(segment);
    if (hasDateToken && hasTimeToken) {
      diagnostics.push(unsupportedFormat(format, location));
      return value;
    }
    if (hasDateToken) {
      const dateText = applyDatePattern(
        parts,
        { ...format, pattern: segment },
        diagnostics,
        location,
      );
      if (dateText === undefined) {
        return value;
      }
      formatted.push(dateText);
      continue;
    }
    if (hasTimeToken) {
      const timeText = applyTimePattern(
        time,
        { ...format, pattern: segment },
        diagnostics,
        location,
      );
      if (timeText === undefined) {
        return value;
      }
      formatted.push(timeText);
      continue;
    }
    formatted.push(segment);
  }

  return formatted.join("");
}

interface DateParts {
  year: number;
  month: number;
  day: number;
  weekday: number;
}

interface TimeParts {
  hour: number;
  minute: number;
  second: number;
}

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parseDateParts(value: string): DateParts | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    return undefined;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }

  return { year, month, day, weekday: date.getUTCDay() };
}

function parseTimeParts(value: string): TimeParts | undefined {
  const match = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{3})?)?$/.exec(value);
  if (match === null) {
    return undefined;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? "0");
  if (hour > 23 || minute > 59 || second > 59) {
    return undefined;
  }

  return { hour, minute, second };
}

function applyDatePattern(
  parts: DateParts,
  format: ResolvedPresentationFormat,
  diagnostics: RuntimePresentationDiagnostic[],
  location: DiagnosticLocation,
): string | undefined {
  const pattern = format.pattern ?? "yyyy-MM-dd";
  if (!/^(yyyy|yy|MMM|MM|M|dd|d|EEE|[-/ ,.])+$/.test(pattern)) {
    diagnostics.push(unsupportedFormat(format, location));
    return undefined;
  }

  return pattern.replace(/yyyy|yy|MMM|MM|M|dd|d|EEE/g, (token) => {
    switch (token) {
      case "yyyy":
        return String(parts.year);
      case "yy":
        return String(parts.year).slice(-2);
      case "MMM":
        return MONTH_SHORT[parts.month - 1] ?? "";
      case "MM":
        return String(parts.month).padStart(2, "0");
      case "M":
        return String(parts.month);
      case "dd":
        return String(parts.day).padStart(2, "0");
      case "d":
        return String(parts.day);
      case "EEE":
        return WEEKDAY_SHORT[parts.weekday] ?? "";
      default:
        return token;
    }
  });
}

function applyTimePattern(
  parts: TimeParts,
  format: ResolvedPresentationFormat,
  diagnostics: RuntimePresentationDiagnostic[],
  location: DiagnosticLocation,
): string | undefined {
  const pattern = format.pattern ?? "HH:mm";
  if (!/^(HH|H|hh|h|mm|ss|a|[: .])+$/.test(pattern)) {
    diagnostics.push(unsupportedFormat(format, location));
    return undefined;
  }

  return replaceTimeTokens(pattern, parts);
}

function replaceTimeTokens(pattern: string, parts: TimeParts): string {
  const hour12 = parts.hour % 12 === 0 ? 12 : parts.hour % 12;
  return pattern.replace(/HH|H|hh|h|mm|ss|a/g, (token) => {
    switch (token) {
      case "HH":
        return String(parts.hour).padStart(2, "0");
      case "H":
        return String(parts.hour);
      case "hh":
        return String(hour12).padStart(2, "0");
      case "h":
        return String(hour12);
      case "mm":
        return String(parts.minute).padStart(2, "0");
      case "ss":
        return String(parts.second).padStart(2, "0");
      case "a":
        return parts.hour < 12 ? "AM" : "PM";
      default:
        return token;
    }
  });
}

function containsDateToken(pattern: string): boolean {
  return /yyyy|yy|MMM|MM|M|dd|d|EEE/.test(pattern);
}

function containsTimeToken(pattern: string): boolean {
  return /HH|H|hh|h|mm|ss|a/.test(pattern);
}

function unsupportedFormat(
  format: ResolvedPresentationFormat,
  location: DiagnosticLocation,
): RuntimePresentationDiagnostic {
  return {
    severity: "warning",
    code: "ADL_PRESENTATION_FORMAT_UNSUPPORTED",
    message: `Presentation format '${format.pattern ?? format.kind}' is not supported by the deterministic runtime formatter.`,
    path: location.path,
    section: location.section,
    list: location.list,
    field: location.field,
  };
}

function invalidFormatValue(
  message: string,
  location: DiagnosticLocation,
): RuntimePresentationDiagnostic {
  return {
    severity: "warning",
    code: "ADL_PRESENTATION_FORMAT_INVALID_VALUE",
    message,
    path: location.path,
    section: location.section,
    list: location.list,
    field: location.field,
  };
}

function isJsonPrimitive(value: JsonValue | undefined): value is JsonPrimitive {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  );
}
