/**
 * Rows and everything inside one: list source binding, row filtering, row
 * templates and their fragments, action controls and their inputs, visibility
 * and command state, and empty states.
 *
 * One area of `presentation-runtime.ts`; see
 * `learnings/implementation/presentation-runtime-file-map.md` for the file map
 * and the rules that keep it working.
 */
import type {
  JsonValue,
  ResolvedCommand,
  ResolvedExpression,
  ResolvedPresentationControl,
  ResolvedPresentationEmptyState,
  ResolvedPresentationList,
  ResolvedPresentationRowFragment,
  ResolvedView,
} from "../../model/resolved-model.js";
import { evaluateExpression, evaluateExpressionAsBoolean } from "../expression-evaluator.js";
import { cloneJson } from "../runtime-types.js";
import type { RuntimeContext } from "../runtime-types.js";
import { formatPresentationValue, primitiveToText } from "./format.js";
import {
  dropTrailingWhitespaceOnlyFragment,
  objectRecordToPresentationRow,
  readModelRowToPresentationRow,
  rowActionValues,
} from "./row-binding.js";
import type {
  BoundPresentationRow,
  DiagnosticLocation,
  RuntimePresentationActionControl,
  RuntimePresentationControlBase,
  RuntimePresentationDiagnostic,
  RuntimePresentationEmptyState,
  RuntimePresentationFragment,
  RuntimePresentationRow,
} from "./types.js";
import { StatusRuntime } from "./status-runtime.js";

export class RowRuntime extends StatusRuntime {
  protected async bindListRows(
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

  protected rowPassesFilter(
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

  protected evaluateRow(
    list: ResolvedPresentationList,
    view: ResolvedView,
    row: BoundPresentationRow,
    state: Record<string, JsonValue>,
    context: RuntimeContext,
    diagnostics: RuntimePresentationDiagnostic[],
    location: DiagnosticLocation,
  ): RuntimePresentationRow {
    const status =
      list.status === undefined
        ? undefined
        : this.evaluateStatusBinding(list, view, row.values, state, diagnostics, {
            ...location,
            list: list.name,
            path: `${location.path}.status`,
          });

    return {
      id: row.id,
      values: cloneJson(row.values),
      sources: row.sources.map((source) => ({ ...source })),
      layout: list.row.layout,
      density: list.row.density,
      ...(status === undefined ? {} : { status }),
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
            rowActionValues(row),
            context,
            diagnostics,
            { ...location, path: `${location.path}.actions[${index}]`, list: list.name },
          );
        })
        .filter((action) => action.visible),
    };
  }

  protected evaluateActionControl(
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
      ...(control.create === undefined
        ? {}
        : {
            create: {
              ...(control.create.object === undefined ? {} : { object: control.create.object }),
              ...(control.create.view === undefined ? {} : { view: control.create.view }),
            },
          }),
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
        case "field": {
          const text = this.evaluateFieldText(fragment, values, diagnostics, {
            ...location,
            path: fragmentPath,
            field: fragment.field,
          });
          if (text === "") {
            // A field with no value and no declared fallback renders nothing —
            // and so should whatever literal separator immediately precedes it
            // in the row. Without this, an optional field (for example a gig's
            // start time, absent on a personal availability row) leaves its
            // neighbor's separator stranded: "Mon 3 Aug" + " " + "" + " - " is
            // a visible double space before the dash, not a graceful gap. Only
            // a *pure-whitespace* preceding literal is dropped — a separator
            // that also carries real characters (a dash, a bullet) is kept,
            // since that punctuation is still meaningful with the value gone.
            dropTrailingWhitespaceOnlyFragment(output);
            break;
          }
          output.push({ kind: "text", text, style: fragment.style });
          break;
        }
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
          } else {
            dropTrailingWhitespaceOnlyFragment(output);
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
    if (!Object.prototype.hasOwnProperty.call(values, fragment.field)) {
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
    if (value === null) {
      return fragment.fallback ?? "";
    }

    if (fragment.format !== undefined) {
      return formatPresentationValue(value, fragment.format, diagnostics, location);
    }

    return primitiveToText(value, diagnostics, location);
  }

  protected evaluateEmptyState(
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
}
