/**
 * The concrete `PresentationRuntime`: the public entry points, section and
 * control evaluation that dispatches into every area below, and the re-export
 * of this module's exact public surface for the `presentation-runtime.ts`
 * barrel.
 *
 * One area of `presentation-runtime.ts`; see
 * `learnings/implementation/presentation-runtime-file-map.md` for the file map
 * and the rules that keep it working.
 */
import type {
  JsonValue,
  ResolvedPresentationControl,
  ResolvedPresentationList,
  ResolvedPresentationSection,
  ResolvedView,
} from "../../model/resolved-model.js";
import { cloneJson, safeContextLog } from "../runtime-types.js";
import type { RuntimeContext } from "../runtime-types.js";
import { buildDateColumns } from "./matrix-edit.js";
import { sortPresentationRows } from "./row-binding.js";
import { applyPresentationStateUpdates, initializePresentationState } from "./state.js";
import type {
  RuntimePresentationCalendar,
  RuntimePresentationControl,
  RuntimePresentationDiagnostic,
  RuntimePresentationEvaluationInput,
  RuntimePresentationList,
  RuntimePresentationMatrix,
  RuntimePresentationMatrixCellCycleInput,
  RuntimePresentationMatrixEditResult,
  RuntimePresentationMatrixEditedCell,
  RuntimePresentationMatrixRangeEditInput,
  RuntimePresentationSection,
  RuntimePresentationView,
} from "./types.js";
import { MatrixRuntime } from "./matrix-runtime.js";

export class PresentationRuntime extends MatrixRuntime {
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
        legends: [],
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
      legends: this.evaluateLegends(view, sections, diagnostics),
      sections,
      diagnostics,
    };
  }

  async cycleMatrixCell(
    input: RuntimePresentationMatrixCellCycleInput,
  ): Promise<RuntimePresentationMatrixEditResult> {
    const operation = await this.planMatrixCellWrite({
      objectName: input.objectName,
      viewName: input.viewName,
      matrixName: input.matrixName,
      rowKey: input.rowKey,
      columnKey: input.columnKey,
      value: undefined,
      useNextCycleValue: true,
      context: input.context,
    });
    const applied = await this.applyMatrixCellWrite(operation, input.context);
    return { matrix: input.matrixName, applied: [applied] };
  }

  async applyMatrixRangeEdit(
    input: RuntimePresentationMatrixRangeEditInput,
  ): Promise<RuntimePresentationMatrixEditResult> {
    const { view, matrix } = this.requireMatrix(input.objectName, input.viewName, input.matrixName);
    const edit = matrix.edit;
    if (edit === undefined) {
      throw new Error(`Presentation matrix '${matrix.name}' does not declare edit behavior.`);
    }

    const columns = buildDateColumns(matrix, []);
    const startIndex = columns.findIndex((column) => column.key === input.startColumnKey);
    const endIndex = columns.findIndex((column) => column.key === input.endColumnKey);
    if (startIndex < 0 || endIndex < 0) {
      throw new Error(`Presentation matrix '${matrix.name}' range references an unknown column.`);
    }

    const [first, last] = startIndex <= endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
    const applied: RuntimePresentationMatrixEditedCell[] = [];
    for (const rowKey of input.rowKeys) {
      for (const column of columns.slice(first, last + 1)) {
        const operation = await this.planMatrixCellWriteFor(view, matrix, edit, {
          rowKey,
          columnKey: column.key,
          value: input.value,
          useNextCycleValue: false,
          context: input.context,
        });
        applied.push(await this.applyMatrixCellWrite(operation, input.context));
      }
    }

    return { matrix: input.matrixName, applied };
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
    const matrices: RuntimePresentationMatrix[] = [];
    const calendars: RuntimePresentationCalendar[] = [];

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

    for (const [matrixIndex, matrix] of section.matrices.entries()) {
      matrices.push(
        await this.evaluateMatrix(
          matrix,
          view,
          state,
          context,
          diagnostics,
          `${path}.matrices[${matrixIndex}]`,
          section.name,
        ),
      );
    }

    for (const [calendarIndex, calendar] of section.calendars.entries()) {
      calendars.push(
        await this.evaluateCalendar(
          calendar,
          view,
          state,
          context,
          diagnostics,
          `${path}.calendars[${calendarIndex}]`,
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
      matrices,
      calendars,
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
}

export type {
  DiagnosticLocation,
  RuntimePresentationActionControl,
  RuntimePresentationCalendar,
  RuntimePresentationCalendarCell,
  RuntimePresentationCalendarItem,
  RuntimePresentationCalendarMonth,
  RuntimePresentationCalendarWeekday,
  RuntimePresentationContextSelectorControl,
  RuntimePresentationControl,
  RuntimePresentationControlBase,
  RuntimePresentationDataSource,
  RuntimePresentationDiagnostic,
  RuntimePresentationDiagnosticSeverity,
  RuntimePresentationEmptyState,
  RuntimePresentationEvaluationInput,
  RuntimePresentationFragment,
  RuntimePresentationIcon,
  RuntimePresentationIconFragment,
  RuntimePresentationIconSource,
  RuntimePresentationLegend,
  RuntimePresentationLegendItem,
  RuntimePresentationList,
  RuntimePresentationMatrix,
  RuntimePresentationMatrixCell,
  RuntimePresentationMatrixCellCycleInput,
  RuntimePresentationMatrixCellEdit,
  RuntimePresentationMatrixColumn,
  RuntimePresentationMatrixEditMetadata,
  RuntimePresentationMatrixEditResult,
  RuntimePresentationMatrixEditedCell,
  RuntimePresentationMatrixRangeEditInput,
  RuntimePresentationMatrixRow,
  RuntimePresentationRow,
  RuntimePresentationRowSource,
  RuntimePresentationSection,
  RuntimePresentationSelectControl,
  RuntimePresentationSelectOption,
  RuntimePresentationStatus,
  RuntimePresentationStatusSource,
  RuntimePresentationTextFragment,
  RuntimePresentationToggleControl,
  RuntimePresentationView,
} from "./types.js";
export { formatPresentationValue } from "./format.js";
export { applyPresentationStateUpdates, initializePresentationState } from "./state.js";
