import type {
  JsonPrimitive,
  JsonValue,
  LocalOperationKind,
  ResolvedCommand,
  PresentationDensity,
  PresentationFragmentStyle,
  PresentationLayout,
  ResolvedExpression,
  PresentationRowLayout,
  ResolvedApplicationModel,
  ResolvedPresentationCalendar,
  ResolvedPresentationControl,
  ResolvedPresentationEmptyState,
  ResolvedPresentationFormat,
  ResolvedPresentationIconMap,
  ResolvedPresentationIconRef,
  ResolvedPresentationLegend,
  ResolvedPresentationList,
  ResolvedPresentationMatrix,
  ResolvedPresentationMatrixEdit,
  ResolvedPresentationRowFragment,
  ResolvedPresentationSection,
  ResolvedPresentationStatus,
  ResolvedPresentationStatusCandidate,
  ResolvedPresentationStatusMap,
  ResolvedPresentationState,
  PresentationCalendarWeekStart,
  ResolvedSort,
  ResolvedView,
  StoredObjectRecord,
} from "../model/resolved-model.js";
import { RECORD_ID_JOIN_FIELD } from "../model/resolved-model.js";
import { evaluateExpression, evaluateExpressionAsBoolean } from "./expression-evaluator.js";
import { RuntimeModelIndex } from "./model-helpers.js";
import { cloneJson, noopRuntimeLogger, safeContextLog } from "./runtime-types.js";
import type {
  PolicyDecision,
  RuntimeContext,
  RuntimeLogger,
  RuntimeReadModelResult,
  RuntimeReadModelRow,
  RuntimeSearchInput,
} from "./runtime-types.js";
import type { SyncWriteDecision } from "./sync-policy-service.js";

export type RuntimePresentationDiagnosticSeverity = "warning" | "error";

export interface RuntimePresentationDiagnostic {
  severity: RuntimePresentationDiagnosticSeverity;
  code:
    | "ADL_PRESENTATION_VIEW_NOT_COMPOSED"
    | "ADL_PRESENTATION_STATE_UNKNOWN"
    | "ADL_PRESENTATION_STATE_TYPE_MISMATCH"
    | "ADL_PRESENTATION_LIST_BINDING_FAILED"
    | "ADL_PRESENTATION_CALENDAR_BINDING_FAILED"
    | "ADL_PRESENTATION_CALENDAR_CONFLICT_OVERLAY_BINDING_FAILED"
    | "ADL_PRESENTATION_CALENDAR_DATE_INVALID"
    | "ADL_PRESENTATION_MATRIX_BINDING_FAILED"
    | "ADL_PRESENTATION_MATRIX_COLUMN_INVALID"
    | "ADL_PRESENTATION_MATRIX_EDIT_UNAVAILABLE"
    | "ADL_PRESENTATION_FILTER_EVALUATION_FAILED"
    | "ADL_PRESENTATION_CONDITIONAL_EVALUATION_FAILED"
    | "ADL_PRESENTATION_FIELD_MISSING"
    | "ADL_PRESENTATION_ICON_MAP_MISSING"
    | "ADL_PRESENTATION_ICON_VALUE_MISSING"
    | "ADL_PRESENTATION_STATUS_MAP_MISSING"
    | "ADL_PRESENTATION_STATUS_VALUE_MISSING"
    | "ADL_PRESENTATION_STATUS_MISSING"
    | "ADL_PRESENTATION_STATUS_FIELD_MISSING"
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
  legends: RuntimePresentationLegend[];
  sections: RuntimePresentationSection[];
  diagnostics: RuntimePresentationDiagnostic[];
}

export interface RuntimePresentationLegend {
  name: string;
  title?: string;
  include: ResolvedPresentationLegend["include"];
  items: RuntimePresentationLegendItem[];
}

export interface RuntimePresentationLegendItem {
  status: RuntimePresentationStatus;
}

export interface RuntimePresentationSection {
  name: string;
  heading?: string;
  layout: ResolvedPresentationSection["layout"];
  density: ResolvedPresentationSection["density"];
  controls: RuntimePresentationControl[];
  lists: RuntimePresentationList[];
  matrices: RuntimePresentationMatrix[];
  calendars: RuntimePresentationCalendar[];
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
  create?: {
    object?: string;
    view?: string;
  };
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

export interface RuntimePresentationMatrix {
  name: string;
  density: ResolvedPresentationMatrix["density"];
  columns: RuntimePresentationMatrixColumn[];
  rows: RuntimePresentationMatrixRow[];
  edit?: RuntimePresentationMatrixEditMetadata;
}

export interface RuntimePresentationMatrixColumn {
  key: string;
  value: string;
  label: string;
}

export interface RuntimePresentationMatrixRow {
  key: string;
  label: string;
  values: Record<string, JsonValue>;
  sources: RuntimePresentationRowSource[];
  cells: RuntimePresentationMatrixCell[];
}

export interface RuntimePresentationMatrixCell {
  rowKey: string;
  columnKey: string;
  values: Record<string, JsonValue>;
  sources: RuntimePresentationRowSource[];
  status?: RuntimePresentationStatus;
  accessibleLabel: string;
  edit?: RuntimePresentationMatrixCellEdit;
}

export interface RuntimePresentationMatrixCellEdit {
  enabled: boolean;
  reasons: string[];
  nextValue: JsonPrimitive | null;
  operation: "create" | "update" | "delete";
  syncMode: SyncWriteDecision["mode"];
  bulkBehavior: ResolvedPresentationMatrixEdit["bulkBehavior"];
}

export interface RuntimePresentationMatrixEditMetadata {
  object: string;
  valueField: string;
  cycle: JsonPrimitive[];
  unsetValue?: JsonPrimitive | null;
  unsetAsAbsence: boolean;
  bulkBehavior: ResolvedPresentationMatrixEdit["bulkBehavior"];
}

export interface RuntimePresentationCalendar {
  name: string;
  density: ResolvedPresentationCalendar["density"];
  sourceKind: ResolvedPresentationCalendar["sourceKind"];
  source: string;
  month: RuntimePresentationCalendarMonth;
  weekdays: RuntimePresentationCalendarWeekday[];
  cells: RuntimePresentationCalendarCell[];
  emptyState?: RuntimePresentationEmptyState;
}

export interface RuntimePresentationCalendarMonth {
  value: string;
  label: string;
  state?: string;
  previous?: string;
  next?: string;
  canNavigatePrevious: boolean;
  canNavigateNext: boolean;
}

export interface RuntimePresentationCalendarWeekday {
  key: PresentationCalendarWeekStart;
  label: string;
}

export interface RuntimePresentationCalendarCell {
  date: string;
  day: number;
  inMonth: boolean;
  withinRange: boolean;
  isToday: boolean;
  values: Record<string, JsonValue>;
  status?: RuntimePresentationStatus;
  statusCounts: Record<string, number>;
  eventCount: number;
  hasConflict: boolean;
  accessibleLabel: string;
  items: RuntimePresentationCalendarItem[];
  actions: RuntimePresentationActionControl[];
}

export interface RuntimePresentationCalendarItem {
  id: string;
  title: string;
  summary: string;
  values: Record<string, JsonValue>;
  sources: RuntimePresentationRowSource[];
  status?: RuntimePresentationStatus;
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
  status?: RuntimePresentationStatus;
  fragments: RuntimePresentationFragment[];
  actions: RuntimePresentationActionControl[];
}

export interface RuntimePresentationStatus {
  name: string;
  label: string;
  accessibleLabel: string;
  themeToken: ResolvedPresentationStatus["themeToken"];
  precedence: number;
  icon?: RuntimePresentationIcon;
  source?: RuntimePresentationStatusSource;
}

export type RuntimePresentationStatusSource =
  | { kind: "direct" }
  | { kind: "map"; map: string; value: JsonPrimitive };

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

export interface RuntimePresentationMatrixCellCycleInput {
  objectName: string;
  viewName: string;
  matrixName: string;
  rowKey: string;
  columnKey: string;
  context: RuntimeContext;
}

export interface RuntimePresentationMatrixRangeEditInput {
  objectName: string;
  viewName: string;
  matrixName: string;
  rowKeys: string[];
  startColumnKey: string;
  endColumnKey: string;
  value: JsonPrimitive | null;
  context: RuntimeContext;
}

export interface RuntimePresentationMatrixEditResult {
  matrix: string;
  applied: RuntimePresentationMatrixEditedCell[];
}

export interface RuntimePresentationMatrixEditedCell {
  rowKey: string;
  columnKey: string;
  operation: "create" | "update" | "delete" | "noop";
  recordId?: string;
  record?: StoredObjectRecord;
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
  create(
    objectName: string,
    values: Record<string, JsonValue>,
    context: RuntimeContext,
  ): Promise<StoredObjectRecord>;
  update(
    objectName: string,
    id: string,
    patch: Record<string, JsonValue>,
    context: RuntimeContext,
  ): Promise<StoredObjectRecord>;
  delete(objectName: string, id: string, context: RuntimeContext): Promise<StoredObjectRecord>;
  getRecordForRuntime(objectName: string, id: string): Promise<StoredObjectRecord | null>;
  evaluatePolicy(
    objectName: string,
    action: "create" | "update" | "delete",
    context: RuntimeContext,
    options?: { record?: StoredObjectRecord; patch?: Record<string, JsonValue> },
  ): PolicyDecision;
  canWrite(
    objectName: string,
    operation: Extract<LocalOperationKind, "create" | "update" | "delete">,
    context: RuntimeContext,
  ): SyncWriteDecision;
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

  private async evaluateCalendar(
    calendar: ResolvedPresentationCalendar,
    view: ResolvedView,
    state: Record<string, JsonValue>,
    context: RuntimeContext,
    diagnostics: RuntimePresentationDiagnostic[],
    path: string,
    section: string,
  ): Promise<RuntimePresentationCalendar> {
    const boundRows = sortPresentationRows(
      await this.bindCalendarRows(calendar, context, diagnostics, path, section),
      calendar.sort,
    );
    const month = resolveCalendarMonth(calendar, state, context, diagnostics, path, section);
    const cells = buildCalendarCells(calendar, month.value, context, diagnostics, path, section);
    const rowsByDate = groupCalendarRowsByDate(calendar, boundRows, diagnostics, path, section);
    const conflictOverlay = await this.resolveConflictOverlay(
      calendar,
      view,
      state,
      context,
      diagnostics,
      path,
      section,
    );

    const evaluatedCells = cells.map((cell, index) =>
      this.evaluateCalendarCell(
        calendar,
        view,
        cell,
        rowsByDate.get(cell.date) ?? [],
        state,
        context,
        diagnostics,
        {
          path: `${path}.cells[${index}]`,
          section,
        },
        conflictOverlay,
      ),
    );
    const hasEvents = evaluatedCells.some((cell) => cell.eventCount > 0);
    const emptyState =
      hasEvents || calendar.emptyState.text.length === 0
        ? undefined
        : this.evaluateEmptyState(calendar.emptyState, view, state, diagnostics, {
            path: `${path}.emptyState`,
            section,
          });

    return {
      name: calendar.name,
      density: calendar.density,
      sourceKind: calendar.sourceKind,
      source: calendar.source,
      month,
      weekdays: calendarWeekdays(calendar.month.weekStart),
      cells: evaluatedCells,
      ...(emptyState === undefined ? {} : { emptyState }),
    };
  }

  /**
   * Executes a calendar's declared `conflictOverlay` read model, independently
   * of `calendar.source`, and reduces it to the set of dates whose overlay
   * rows carry `flagField: true` plus the (already-resolved) status those
   * dates should contribute. See
   * `ResolvedPresentationCalendarConflictOverlay`'s own doc comment for why
   * this has to be a second read model rather than a field on `source`'s own
   * rows.
   */
  private async resolveConflictOverlay(
    calendar: ResolvedPresentationCalendar,
    view: ResolvedView,
    state: Record<string, JsonValue>,
    context: RuntimeContext,
    diagnostics: RuntimePresentationDiagnostic[],
    path: string,
    section: string,
  ): Promise<CalendarConflictOverlay | undefined> {
    const overlay = calendar.conflictOverlay;
    if (overlay === undefined) {
      return undefined;
    }

    const overlayPath = `${path}.conflictOverlay`;
    const status = this.resolveStatus(
      overlay.status,
      view,
      state,
      diagnostics,
      {
        path: overlayPath,
        section,
      },
      { kind: "direct" },
    );
    if (status === undefined) {
      return undefined;
    }

    try {
      const result = await this.dataSource.executeReadModel(overlay.readModel, context);
      const dates = new Set<string>();
      for (const row of result.rows) {
        if (row.values[overlay.flagField] !== true) {
          continue;
        }
        const dateValue = row.values[overlay.dateField];
        if (typeof dateValue === "string") {
          dates.add(dateValue);
        }
      }
      return { dates, status };
    } catch (error) {
      diagnostics.push({
        severity: "error",
        code: "ADL_PRESENTATION_CALENDAR_CONFLICT_OVERLAY_BINDING_FAILED",
        message: `Calendar '${calendar.name}' could not bind conflict overlay read model '${overlay.readModel}'.`,
        path: overlayPath,
        section,
      });
      this.logger.debug("PresentationRuntime calendar conflict overlay binding failed", {
        calendar: calendar.name,
        readModel: overlay.readModel,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  private async bindCalendarRows(
    calendar: ResolvedPresentationCalendar,
    context: RuntimeContext,
    diagnostics: RuntimePresentationDiagnostic[],
    path: string,
    section: string,
  ): Promise<BoundPresentationRow[]> {
    try {
      if (calendar.sourceKind === "readModel") {
        const result = await this.dataSource.executeReadModel(calendar.source, context, {
          sort: calendar.sort,
        });
        return result.rows.map(readModelRowToPresentationRow);
      }

      const records = await this.dataSource.search(
        calendar.source,
        { sort: calendar.sort },
        context,
      );
      return records.map(objectRecordToPresentationRow);
    } catch (error) {
      diagnostics.push({
        severity: "error",
        code: "ADL_PRESENTATION_CALENDAR_BINDING_FAILED",
        message: `Calendar '${calendar.name}' could not bind source '${calendar.source}'.`,
        path,
        section,
      });
      this.logger.debug("PresentationRuntime calendar binding failed", {
        calendar: calendar.name,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private evaluateCalendarCell(
    calendar: ResolvedPresentationCalendar,
    view: ResolvedView,
    cell: CalendarGridCell,
    rows: BoundPresentationRow[],
    state: Record<string, JsonValue>,
    context: RuntimeContext,
    diagnostics: RuntimePresentationDiagnostic[],
    location: DiagnosticLocation,
    conflictOverlay?: CalendarConflictOverlay,
  ): RuntimePresentationCalendarCell {
    const items = rows.map((row, index) =>
      this.evaluateCalendarItem(calendar, view, row, state, diagnostics, {
        ...location,
        path: `${location.path}.items[${index}]`,
      }),
    );
    if (conflictOverlay !== undefined && conflictOverlay.dates.has(cell.date)) {
      // A synthetic item, not backed by any one record: the overlay read
      // model proves the correlated *fact* (a gig and a separate
      // unavailability on this date), not a single row either source
      // already produced. It participates in status/count aggregation
      // exactly like a real item so the existing max-precedence cell logic
      // (and `HasConflict`) need no special-casing.
      items.push({
        id: `${calendar.name}:conflict:${cell.date}`,
        title: conflictOverlay.status.label,
        summary: conflictOverlay.status.accessibleLabel,
        values: { Date: cell.date },
        sources: [],
        status: conflictOverlay.status,
      });
    }
    const statusCounts = countCalendarStatuses(items);
    const hasConflict = items.some((item) => item.status?.name === "conflict");
    const cellStatus =
      items.length === 0
        ? undefined
        : chooseEffectiveStatus(
            items
              .map((item) => item.status)
              .filter((status): status is RuntimePresentationStatus => status !== undefined),
            view,
          );
    const values: Record<string, JsonValue> = {
      Date: cell.date,
      EventCount: items.length,
      HasEvents: items.length > 0,
      HasConflict: hasConflict,
    };
    const actions = cell.withinRange
      ? calendar.actions
          .map((action, index) => {
            const actionIcon = this.resolveIcon(action.icon, view, state, values, diagnostics, {
              ...location,
              path: `${location.path}.actions[${index}].icon`,
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
              values,
              context,
              diagnostics,
              {
                ...location,
                path: `${location.path}.actions[${index}]`,
              },
            );
          })
          .filter((action) => action.visible)
      : [];
    const accessibleLabel =
      items.length === 0
        ? `${cell.date}: no events`
        : `${cell.date}: ${items.length} event${items.length === 1 ? "" : "s"}${
            hasConflict ? ", conflict" : ""
          }`;

    return {
      date: cell.date,
      day: cell.day,
      inMonth: cell.inMonth,
      withinRange: cell.withinRange,
      isToday: cell.isToday,
      values,
      ...(cellStatus === undefined ? {} : { status: cellStatus }),
      statusCounts,
      eventCount: items.length,
      hasConflict,
      accessibleLabel,
      items,
      actions,
    };
  }

  private evaluateCalendarItem(
    calendar: ResolvedPresentationCalendar,
    view: ResolvedView,
    row: BoundPresentationRow,
    state: Record<string, JsonValue>,
    diagnostics: RuntimePresentationDiagnostic[],
    location: DiagnosticLocation,
  ): RuntimePresentationCalendarItem {
    const status =
      calendar.status === undefined
        ? undefined
        : this.evaluateStatusCandidates(
            calendar.name,
            calendar.status.candidates,
            view,
            row.values,
            state,
            diagnostics,
            location,
          );
    const titleValue =
      calendar.titleField === undefined ? row.id : (row.values[calendar.titleField] ?? row.id);
    const title = primitiveToText(titleValue, diagnostics, {
      ...location,
      field: calendar.titleField,
    });
    const summary = calendar.summaryFields
      .map((field) => row.values[field])
      .filter((value) => value !== undefined && value !== null && value !== "")
      .map((value) => primitiveToText(value, diagnostics, location))
      .join(" ");

    return {
      id: row.id,
      title,
      summary,
      values: cloneJson(row.values),
      sources: row.sources.map((source) => ({ ...source })),
      ...(status === undefined ? {} : { status }),
    };
  }

  private async evaluateMatrix(
    matrix: ResolvedPresentationMatrix,
    view: ResolvedView,
    state: Record<string, JsonValue>,
    context: RuntimeContext,
    diagnostics: RuntimePresentationDiagnostic[],
    path: string,
    section: string,
  ): Promise<RuntimePresentationMatrix> {
    const rows = sortPresentationRows(
      await this.bindMatrixSourceRows(
        matrix.name,
        matrix.rowSource.sourceKind,
        matrix.rowSource.source,
        matrix.rowSource.sort,
        context,
        diagnostics,
        `${path}.rowSource`,
        section,
      ),
      matrix.rowSource.sort,
    );
    const cells = await this.bindMatrixSourceRows(
      matrix.name,
      matrix.cellSource.sourceKind,
      matrix.cellSource.source,
      [],
      context,
      diagnostics,
      `${path}.cellSource`,
      section,
    );
    const columns = buildDateColumns(matrix, diagnostics, path, section);
    const cellByCoordinate = new Map<string, BoundPresentationRow>();
    for (const cell of cells) {
      const rowKey = primitiveKey(cell.values[matrix.cellSource.rowField]);
      const columnKey = primitiveKey(cell.values[matrix.cellSource.columnField]);
      if (rowKey !== undefined && columnKey !== undefined) {
        cellByCoordinate.set(matrixCellKey(rowKey, columnKey), cell);
      }
    }

    return {
      name: matrix.name,
      density: matrix.density,
      columns,
      rows: rows.map((row, rowIndex) => {
        const rowKey = this.resolveMatrixRowKey(matrix, row);
        const label = primitiveToText(
          row.values[matrix.rowSource.labelField] ?? rowKey,
          diagnostics,
          {
            path: `${path}.rows[${rowIndex}].label`,
            section,
          },
        );
        return {
          key: rowKey,
          label,
          values: cloneJson(row.values),
          sources: row.sources.map((source) => ({ ...source })),
          cells: columns.map((column, columnIndex) =>
            this.evaluateMatrixCell(
              matrix,
              view,
              row,
              rowKey,
              column,
              cellByCoordinate.get(matrixCellKey(rowKey, column.key)),
              state,
              context,
              diagnostics,
              {
                path: `${path}.rows[${rowIndex}].cells[${columnIndex}]`,
                section,
              },
            ),
          ),
        };
      }),
      ...(matrix.edit === undefined
        ? {}
        : {
            edit: {
              object: matrix.edit.object,
              valueField: matrix.edit.valueField,
              cycle: matrix.edit.cycle.map((value) => cloneJson(value)),
              ...(matrix.edit.unsetValue === undefined
                ? {}
                : { unsetValue: cloneJson(matrix.edit.unsetValue) }),
              unsetAsAbsence: matrix.edit.unsetAsAbsence,
              bulkBehavior: matrix.edit.bulkBehavior,
            },
          }),
    };
  }

  private async bindMatrixSourceRows(
    matrixName: string,
    sourceKind: ResolvedPresentationMatrix["rowSource"]["sourceKind"],
    source: string,
    sort: ResolvedSort[],
    context: RuntimeContext,
    diagnostics: RuntimePresentationDiagnostic[],
    path: string,
    section: string,
  ): Promise<BoundPresentationRow[]> {
    try {
      if (sourceKind === "readModel") {
        const result = await this.dataSource.executeReadModel(source, context, { sort });
        return result.rows.map(readModelRowToPresentationRow);
      }

      const records = await this.dataSource.search(source, { sort }, context);
      return records.map(objectRecordToPresentationRow);
    } catch (error) {
      diagnostics.push({
        severity: "error",
        code: "ADL_PRESENTATION_MATRIX_BINDING_FAILED",
        message: `Matrix '${matrixName}' could not bind source '${source}'.`,
        path,
        section,
      });
      this.logger.debug("PresentationRuntime matrix binding failed", {
        matrix: matrixName,
        source,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private resolveMatrixRowKey(
    matrix: ResolvedPresentationMatrix,
    row: BoundPresentationRow,
  ): string {
    const keyField = matrix.rowSource.keyField;
    if (keyField === undefined) {
      return row.id;
    }
    return primitiveKey(row.values[keyField]) ?? row.id;
  }

  private evaluateMatrixCell(
    matrix: ResolvedPresentationMatrix,
    view: ResolvedView,
    row: BoundPresentationRow,
    rowKey: string,
    column: RuntimePresentationMatrixColumn,
    cell: BoundPresentationRow | undefined,
    state: Record<string, JsonValue>,
    context: RuntimeContext,
    diagnostics: RuntimePresentationDiagnostic[],
    location: DiagnosticLocation,
  ): RuntimePresentationMatrixCell {
    const values = cloneJson(cell?.values ?? {});
    const statusBinding = matrix.cell.status ?? matrix.cellSource.status;
    const status =
      cell === undefined && matrix.cell.unsetStatus !== undefined
        ? this.resolveStatus(matrix.cell.unsetStatus, view, state, diagnostics, location, {
            kind: "direct",
          })
        : statusBinding === undefined
          ? undefined
          : this.evaluateStatusCandidates(
              matrix.name,
              statusBinding.candidates,
              view,
              values,
              state,
              diagnostics,
              location,
            );
    const edit =
      matrix.edit === undefined
        ? undefined
        : this.evaluateMatrixCellEdit(matrix, row, rowKey, column.key, cell, context);
    const accessibleLabel =
      matrix.cell.accessibleLabel ??
      `${row.values[matrix.rowSource.labelField] ?? rowKey}, ${column.label}: ${
        status?.accessibleLabel ?? "Unset"
      }`;

    return {
      rowKey,
      columnKey: column.key,
      values,
      sources: cell?.sources.map((source) => ({ ...source })) ?? [],
      ...(status === undefined ? {} : { status }),
      accessibleLabel,
      ...(edit === undefined ? {} : { edit }),
    };
  }

  private evaluateMatrixCellEdit(
    matrix: ResolvedPresentationMatrix,
    row: BoundPresentationRow,
    rowKey: string,
    columnKey: string,
    cell: BoundPresentationRow | undefined,
    context: RuntimeContext,
  ): RuntimePresentationMatrixCellEdit {
    const edit = matrix.edit;
    if (edit === undefined) {
      throw new Error(`Presentation matrix '${matrix.name}' does not declare edit behavior.`);
    }
    const currentValue = cell?.values[edit.valueField];
    const nextValue = nextMatrixCycleValue(edit, currentValue);
    const operation = matrixEditOperation(edit, cell, nextValue);
    const patch = matrixEditPatch(edit, rowKey, columnKey, nextValue);
    const sync = this.dataSource.canWrite(edit.object, operation, context);
    const reasons: string[] = [];
    let policy: PolicyDecision;

    try {
      const record = cell === undefined ? undefined : this.matrixCellRecord(edit.object, cell);
      policy = this.dataSource.evaluatePolicy(
        edit.object,
        operation,
        context,
        record === undefined ? { patch } : { record, patch },
      );
    } catch (error) {
      policy = {
        effect: "deny",
        reasons: [
          {
            policyName: `PresentationMatrix:${matrix.name}`,
            effect: "deny",
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }

    if (policy.effect !== "allow") {
      reasons.push(...policy.reasons.map((reason) => reason.message));
    }
    if (!sync.allowed) {
      reasons.push(sync.reason);
    }

    return {
      enabled: policy.effect === "allow" && sync.allowed,
      reasons,
      nextValue,
      operation,
      syncMode: sync.mode,
      bulkBehavior: edit.bulkBehavior,
    };
  }

  private matrixCellRecord(
    objectName: string,
    cell: BoundPresentationRow,
  ): StoredObjectRecord | undefined {
    const source = cell.sources.find((candidate) => candidate.objectName === objectName);
    if (source === undefined) {
      return undefined;
    }
    return {
      meta: {
        guid: source.recordId,
        object: objectName,
        schemaVersion: 1,
        revision: "",
        createdAt: "",
        createdBy: "",
        updatedAt: "",
        updatedBy: "",
        syncStatus: "local",
      },
      values: cloneJson(cell.values),
    };
  }

  private requireMatrix(
    objectName: string,
    viewName: string,
    matrixName: string,
  ): { view: ResolvedView; matrix: ResolvedPresentationMatrix } {
    const object = this.index.getObject(objectName);
    const view = object.views.find((candidate) => candidate.name === viewName);
    const matrix = view?.presentation?.sections
      .flatMap((section) => section.matrices)
      .find((candidate) => candidate.name === matrixName);
    if (view === undefined || matrix === undefined) {
      throw new Error(`Presentation matrix '${matrixName}' does not exist on view '${viewName}'.`);
    }
    return { view, matrix };
  }

  private async planMatrixCellWrite(input: {
    objectName: string;
    viewName: string;
    matrixName: string;
    rowKey: string;
    columnKey: string;
    value: JsonPrimitive | null | undefined;
    useNextCycleValue: boolean;
    context: RuntimeContext;
  }): Promise<PlannedMatrixCellWrite> {
    const { view, matrix } = this.requireMatrix(input.objectName, input.viewName, input.matrixName);
    const edit = matrix.edit;
    if (edit === undefined) {
      throw new Error(`Presentation matrix '${matrix.name}' does not declare edit behavior.`);
    }
    return this.planMatrixCellWriteFor(view, matrix, edit, input);
  }

  private async planMatrixCellWriteFor(
    view: ResolvedView,
    matrix: ResolvedPresentationMatrix,
    edit: ResolvedPresentationMatrixEdit,
    input: {
      rowKey: string;
      columnKey: string;
      value: JsonPrimitive | null | undefined;
      useNextCycleValue: boolean;
      context: RuntimeContext;
    },
  ): Promise<PlannedMatrixCellWrite> {
    void view;
    const existing = await this.findMatrixEditRecord(
      edit,
      input.rowKey,
      input.columnKey,
      input.context,
    );
    const currentValue = existing?.values[edit.valueField];
    const value = input.useNextCycleValue ? nextMatrixCycleValue(edit, currentValue) : input.value;
    const operation = matrixEditOperationForRecord(edit, existing, value);
    const patch = matrixEditPatch(edit, input.rowKey, input.columnKey, value);
    const sync = this.dataSource.canWrite(edit.object, operation, input.context);
    const policy = this.dataSource.evaluatePolicy(edit.object, operation, input.context, {
      ...(existing === null ? {} : { record: existing }),
      patch,
    });
    if (policy.effect !== "allow" || !sync.allowed) {
      throw new Error(
        `Presentation matrix '${matrix.name}' edit is not permitted for row '${input.rowKey}' and column '${input.columnKey}'.`,
      );
    }
    return {
      edit,
      rowKey: input.rowKey,
      columnKey: input.columnKey,
      value: value ?? null,
      operation,
      existing,
      patch,
    };
  }

  private async findMatrixEditRecord(
    edit: ResolvedPresentationMatrixEdit,
    rowKey: string,
    columnKey: string,
    context: RuntimeContext,
  ): Promise<StoredObjectRecord | null> {
    const records = await this.dataSource.search(edit.object, {}, context);
    const match = records.find(
      (record) =>
        record.values[edit.rowField] === rowKey && record.values[edit.columnField] === columnKey,
    );
    if (match === undefined) {
      return null;
    }
    return this.dataSource.getRecordForRuntime(edit.object, match.meta.guid);
  }

  private async applyMatrixCellWrite(
    planned: PlannedMatrixCellWrite,
    context: RuntimeContext,
  ): Promise<RuntimePresentationMatrixEditedCell> {
    if (planned.operation === "delete") {
      if (planned.existing === null) {
        return {
          rowKey: planned.rowKey,
          columnKey: planned.columnKey,
          operation: "noop",
        };
      }
      const record = await this.dataSource.delete(
        planned.edit.object,
        planned.existing.meta.guid,
        context,
      );
      return {
        rowKey: planned.rowKey,
        columnKey: planned.columnKey,
        operation: "delete",
        recordId: record.meta.guid,
        record,
      };
    }

    if (planned.existing === null || planned.operation === "create") {
      const record = await this.dataSource.create(planned.edit.object, planned.patch, context);
      return {
        rowKey: planned.rowKey,
        columnKey: planned.columnKey,
        operation: "create",
        recordId: record.meta.guid,
        record,
      };
    }

    const record = await this.dataSource.update(
      planned.edit.object,
      planned.existing.meta.guid,
      { [planned.edit.valueField]: planned.value },
      context,
    );
    return {
      rowKey: planned.rowKey,
      columnKey: planned.columnKey,
      operation: "update",
      recordId: record.meta.guid,
      record,
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

  private evaluateStatusBinding(
    list: ResolvedPresentationList,
    view: ResolvedView,
    values: Record<string, JsonValue>,
    state: Record<string, JsonValue>,
    diagnostics: RuntimePresentationDiagnostic[],
    location: DiagnosticLocation,
  ): RuntimePresentationStatus | undefined {
    return this.evaluateStatusCandidates(
      list.name,
      list.status?.candidates ?? [],
      view,
      values,
      state,
      diagnostics,
      location,
    );
  }

  private evaluateStatusCandidates(
    ownerName: string,
    statusCandidates: ResolvedPresentationStatusCandidate[],
    view: ResolvedView,
    values: Record<string, JsonValue>,
    state: Record<string, JsonValue>,
    diagnostics: RuntimePresentationDiagnostic[],
    location: DiagnosticLocation,
  ): RuntimePresentationStatus | undefined {
    const candidates = statusCandidates
      .map((candidate, index) =>
        this.evaluateStatusCandidate(candidate, view, values, state, diagnostics, {
          ...location,
          path: `${location.path}.candidates[${index}]`,
          list: location.list ?? ownerName,
        }),
      )
      .filter((status): status is RuntimePresentationStatus => status !== undefined);

    if (candidates.length === 0) {
      return undefined;
    }

    const statusOrder = new Map(
      (view.presentation?.statuses ?? []).map((status, index) => [status.name, index]),
    );
    return [...candidates].sort((left, right) => {
      if (left.precedence !== right.precedence) {
        return right.precedence - left.precedence;
      }
      return (statusOrder.get(left.name) ?? 0) - (statusOrder.get(right.name) ?? 0);
    })[0];
  }

  private evaluateStatusCandidate(
    candidate: ResolvedPresentationStatusCandidate,
    view: ResolvedView,
    values: Record<string, JsonValue>,
    state: Record<string, JsonValue>,
    diagnostics: RuntimePresentationDiagnostic[],
    location: DiagnosticLocation,
  ): RuntimePresentationStatus | undefined {
    if (candidate.kind === "status") {
      return this.resolveStatus(candidate.status, view, state, diagnostics, location, {
        kind: "direct",
      });
    }

    const statusMap = view.presentation?.statusMaps.find((map) => map.name === candidate.map);
    if (statusMap === undefined) {
      diagnostics.push({
        severity: "error",
        code: "ADL_PRESENTATION_STATUS_MAP_MISSING",
        message: `Status map '${candidate.map}' does not exist on view '${view.name}'.`,
        path: location.path,
        section: location.section,
        list: location.list,
      });
      return undefined;
    }

    const rawValue = this.resolveStatusMapValue(
      candidate,
      statusMap,
      values,
      diagnostics,
      location,
    );
    if (!isJsonPrimitive(rawValue)) {
      return undefined;
    }

    const mapped = statusMap.values.find((value) => value.value === rawValue);
    const statusName = mapped?.status ?? statusMap.defaultStatus;
    if (statusName === undefined) {
      diagnostics.push({
        severity: "warning",
        code: "ADL_PRESENTATION_STATUS_VALUE_MISSING",
        message: `Status map '${statusMap.name}' has no status for value '${String(rawValue)}'.`,
        path: location.path,
        section: location.section,
        list: location.list,
      });
      return undefined;
    }

    return this.resolveStatus(statusName, view, state, diagnostics, location, {
      kind: "map",
      map: statusMap.name,
      value: cloneJson(rawValue),
    });
  }

  private resolveStatusMapValue(
    candidate: Extract<ResolvedPresentationStatusCandidate, { kind: "map" }>,
    statusMap: ResolvedPresentationStatusMap,
    values: Record<string, JsonValue>,
    diagnostics: RuntimePresentationDiagnostic[],
    location: DiagnosticLocation,
  ): JsonValue | undefined {
    if (candidate.value !== undefined) {
      return candidate.value;
    }

    const field = candidate.field ?? statusMap.field;
    if (Object.prototype.hasOwnProperty.call(values, field)) {
      return values[field];
    }

    diagnostics.push({
      severity: "warning",
      code: "ADL_PRESENTATION_STATUS_FIELD_MISSING",
      message: `Status map field '${field}' is missing from presentation data.`,
      path: location.path,
      section: location.section,
      list: location.list,
      field,
    });
    return undefined;
  }

  private resolveStatus(
    statusName: string,
    view: ResolvedView,
    state: Record<string, JsonValue>,
    diagnostics: RuntimePresentationDiagnostic[],
    location: DiagnosticLocation,
    source: RuntimePresentationStatusSource,
  ): RuntimePresentationStatus | undefined {
    const status = view.presentation?.statuses.find((candidate) => candidate.name === statusName);
    if (status === undefined) {
      diagnostics.push({
        severity: "error",
        code: "ADL_PRESENTATION_STATUS_MISSING",
        message: `Status '${statusName}' does not exist on view '${view.name}'.`,
        path: location.path,
        section: location.section,
        list: location.list,
      });
      return undefined;
    }

    const icon = this.resolveIcon(status.icon, view, state, undefined, diagnostics, {
      ...location,
      path: `${location.path}.icon`,
    });

    return {
      name: status.name,
      label: status.label,
      accessibleLabel: status.accessibleLabel,
      themeToken: status.themeToken,
      precedence: status.precedence,
      ...(icon === undefined ? {} : { icon }),
      source,
    };
  }

  private evaluateLegends(
    view: ResolvedView,
    sections: RuntimePresentationSection[],
    diagnostics: RuntimePresentationDiagnostic[],
  ): RuntimePresentationLegend[] {
    const presentation = view.presentation;
    if (presentation === undefined || presentation.legends.length === 0) {
      return [];
    }

    const presentStatuses = new Set<string>();
    for (const section of sections) {
      for (const list of section.lists) {
        for (const row of list.rows) {
          if (row.status !== undefined) {
            presentStatuses.add(row.status.name);
          }
        }
      }
      for (const matrix of section.matrices) {
        for (const row of matrix.rows) {
          for (const cell of row.cells) {
            if (cell.status !== undefined) {
              presentStatuses.add(cell.status.name);
            }
          }
        }
      }
      for (const calendar of section.calendars) {
        for (const cell of calendar.cells) {
          if (cell.status !== undefined) {
            presentStatuses.add(cell.status.name);
          }
          for (const item of cell.items) {
            if (item.status !== undefined) {
              presentStatuses.add(item.status.name);
            }
          }
        }
      }
    }

    return presentation.legends
      .map((legend, legendIndex) =>
        this.evaluateLegend(legend, view, presentStatuses, diagnostics, {
          path: `presentation.legends[${legendIndex}]`,
        }),
      )
      .filter((legend) => legend.items.length > 0 || legend.include === "all");
  }

  private evaluateLegend(
    legend: ResolvedPresentationLegend,
    view: ResolvedView,
    presentStatuses: Set<string>,
    diagnostics: RuntimePresentationDiagnostic[],
    location: DiagnosticLocation,
  ): RuntimePresentationLegend {
    const statusNames =
      legend.statuses.length === 0
        ? (view.presentation?.statuses ?? []).map((status) => status.name)
        : legend.statuses;
    const items = statusNames
      .filter((statusName) => legend.include === "all" || presentStatuses.has(statusName))
      .map((statusName, index) =>
        this.resolveStatus(
          statusName,
          view,
          {},
          diagnostics,
          {
            ...location,
            path: `${location.path}.statuses[${index}]`,
          },
          { kind: "direct" },
        ),
      )
      .filter((status): status is RuntimePresentationStatus => status !== undefined)
      .map((status) => ({ status }));

    return {
      name: legend.name,
      ...(legend.title === undefined ? {} : { title: legend.title }),
      include: legend.include,
      items,
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

/** Resolved, ready-to-apply form of a calendar's `conflictOverlay`. */
interface CalendarConflictOverlay {
  dates: Set<string>;
  status: RuntimePresentationStatus;
}

interface PlannedMatrixCellWrite {
  edit: ResolvedPresentationMatrixEdit;
  rowKey: string;
  columnKey: string;
  value: JsonPrimitive | null;
  operation: "create" | "update" | "delete";
  existing: StoredObjectRecord | null;
  patch: Record<string, JsonValue>;
}

export interface DiagnosticLocation {
  path: string;
  section?: string | undefined;
  list?: string | undefined;
  field?: string | undefined;
}

interface CalendarGridCell {
  date: string;
  day: number;
  inMonth: boolean;
  withinRange: boolean;
  isToday: boolean;
}

const CALENDAR_WEEKDAYS: PresentationCalendarWeekStart[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const CALENDAR_MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function resolveCalendarMonth(
  calendar: ResolvedPresentationCalendar,
  state: Record<string, JsonValue>,
  context: RuntimeContext,
  diagnostics: RuntimePresentationDiagnostic[],
  path: string,
  section?: string,
): RuntimePresentationCalendarMonth {
  const stateValue = calendar.month.state === undefined ? undefined : state[calendar.month.state];
  const rawMonth =
    typeof stateValue === "string" && stateValue.trim().length > 0
      ? stateValue
      : calendar.month.value;
  const month = normaliseCalendarMonth(rawMonth) ?? "1970-01";
  if (rawMonth !== undefined && normaliseCalendarMonth(rawMonth) === undefined) {
    diagnostics.push({
      severity: "warning",
      code: "ADL_PRESENTATION_CALENDAR_DATE_INVALID",
      message: `Calendar '${calendar.name}' month value '${rawMonth}' is not an ISO month or date.`,
      path: `${path}.month`,
      section,
    });
  }

  const previous = shiftIsoMonth(month, -1);
  const next = shiftIsoMonth(month, 1);
  const minMonth = normaliseCalendarMonth(calendar.month.minDate);
  const maxMonth = normaliseCalendarMonth(calendar.month.maxDate);
  const labelDate = `${month}-01`;

  return {
    value: month,
    label:
      calendar.month.labelFormat === undefined
        ? defaultMonthLabel(month)
        : formatPresentationValue(labelDate, calendar.month.labelFormat, diagnostics, {
            path: `${path}.month.labelFormat`,
            section,
          }),
    ...(calendar.month.state === undefined ? {} : { state: calendar.month.state }),
    previous,
    next,
    canNavigatePrevious: minMonth === undefined || previous >= minMonth,
    canNavigateNext: maxMonth === undefined || next <= maxMonth,
  };
}

function buildCalendarCells(
  calendar: ResolvedPresentationCalendar,
  month: string,
  context: RuntimeContext,
  diagnostics: RuntimePresentationDiagnostic[],
  path: string,
  section?: string,
): CalendarGridCell[] {
  const firstOfMonth = parseIsoDate(`${month}-01`);
  if (firstOfMonth === undefined) {
    diagnostics.push({
      severity: "error",
      code: "ADL_PRESENTATION_CALENDAR_DATE_INVALID",
      message: `Calendar '${calendar.name}' has an invalid month '${month}'.`,
      path: `${path}.month`,
      section,
    });
    return [];
  }

  const weekStartIndex = CALENDAR_WEEKDAYS.indexOf(calendar.month.weekStart);
  const offset = (firstOfMonth.getUTCDay() - weekStartIndex + 7) % 7;
  const gridStart = addUtcDays(firstOfMonth, -offset);
  const minDate = normaliseCalendarDate(calendar.month.minDate);
  const maxDate = normaliseCalendarDate(calendar.month.maxDate);
  const today =
    context.now === undefined || Number.isNaN(context.now.getTime())
      ? undefined
      : context.now.toISOString().slice(0, 10);

  return Array.from({ length: 42 }, (_, index) => {
    const date = addUtcDays(gridStart, index).toISOString().slice(0, 10);
    return {
      date,
      day: Number(date.slice(8, 10)),
      inMonth: date.startsWith(`${month}-`),
      withinRange:
        (minDate === undefined || date >= minDate) && (maxDate === undefined || date <= maxDate),
      isToday: today === date,
    };
  });
}

function groupCalendarRowsByDate(
  calendar: ResolvedPresentationCalendar,
  rows: BoundPresentationRow[],
  diagnostics: RuntimePresentationDiagnostic[],
  path: string,
  section?: string,
): Map<string, BoundPresentationRow[]> {
  const rowsByDate = new Map<string, BoundPresentationRow[]>();
  for (const row of rows) {
    const date = normaliseCalendarDate(row.values[calendar.dateField]);
    if (date === undefined) {
      diagnostics.push({
        severity: "warning",
        code: "ADL_PRESENTATION_CALENDAR_DATE_INVALID",
        message: `Calendar '${calendar.name}' row has invalid date field '${calendar.dateField}'.`,
        path: `${path}.dateField`,
        section,
        field: calendar.dateField,
      });
      continue;
    }
    rowsByDate.set(date, [...(rowsByDate.get(date) ?? []), row]);
  }
  return rowsByDate;
}

function calendarWeekdays(
  weekStart: PresentationCalendarWeekStart,
): RuntimePresentationCalendarWeekday[] {
  const start = CALENDAR_WEEKDAYS.indexOf(weekStart);
  return Array.from({ length: 7 }, (_, index) => {
    const key = CALENDAR_WEEKDAYS[(start + index) % 7] ?? "monday";
    return {
      key,
      label: titleCaseWord(key).slice(0, 3),
    };
  });
}

function countCalendarStatuses(items: RuntimePresentationCalendarItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    if (item.status !== undefined) {
      counts[item.status.name] = (counts[item.status.name] ?? 0) + 1;
    }
  }
  return counts;
}

function chooseEffectiveStatus(
  statuses: RuntimePresentationStatus[],
  view: ResolvedView,
): RuntimePresentationStatus | undefined {
  if (statuses.length === 0) {
    return undefined;
  }
  const statusOrder = new Map(
    (view.presentation?.statuses ?? []).map((status, index) => [status.name, index]),
  );
  return [...statuses].sort((left, right) => {
    if (left.precedence !== right.precedence) {
      return right.precedence - left.precedence;
    }
    return (statusOrder.get(left.name) ?? 0) - (statusOrder.get(right.name) ?? 0);
  })[0];
}

function normaliseCalendarMonth(value: JsonValue | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  if (/^\d{4}-\d{2}$/.test(value) && parseIsoDate(`${value}-01`) !== undefined) {
    return value;
  }
  const date = normaliseCalendarDate(value);
  return date?.slice(0, 7);
}

function normaliseCalendarDate(value: JsonValue | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const date = /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : value.slice(0, 10);
  return parseIsoDate(date) === undefined ? undefined : date;
}

function shiftIsoMonth(month: string, delta: number): string {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1 + delta;
  const shifted = new Date(Date.UTC(year, monthIndex, 1));
  return shifted.toISOString().slice(0, 7);
}

function defaultMonthLabel(month: string): string {
  const monthIndex = Number(month.slice(5, 7)) - 1;
  return `${CALENDAR_MONTH_NAMES[monthIndex] ?? month.slice(5, 7)} ${month.slice(0, 4)}`;
}

function titleCaseWord(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function buildDateColumns(
  matrix: ResolvedPresentationMatrix,
  diagnostics: RuntimePresentationDiagnostic[] = [],
  path = "presentation.matrix.columnAxis",
  section?: string,
): RuntimePresentationMatrixColumn[] {
  const start = parseIsoDate(matrix.columnAxis.start);
  const end = parseIsoDate(matrix.columnAxis.end);
  if (start === undefined || end === undefined || start.getTime() > end.getTime()) {
    diagnostics.push({
      severity: "error",
      code: "ADL_PRESENTATION_MATRIX_COLUMN_INVALID",
      message: `Matrix '${matrix.name}' has an invalid date column range.`,
      path,
      section,
    });
    return [];
  }

  const columns: RuntimePresentationMatrixColumn[] = [];
  for (
    let current = start;
    current.getTime() <= end.getTime();
    current = addUtcDays(current, matrix.columnAxis.stepDays)
  ) {
    const value = current.toISOString().slice(0, 10);
    columns.push({
      key: value,
      value,
      label:
        matrix.columnAxis.labelFormat === undefined
          ? value
          : formatPresentationValue(value, matrix.columnAxis.labelFormat, diagnostics, {
              path: `${path}.labelFormat`,
              section,
            }),
    });
  }
  return columns;
}

function parseIsoDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return undefined;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value
    ? undefined
    : date;
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function matrixCellKey(rowKey: string, columnKey: string): string {
  return `${rowKey}\u0000${columnKey}`;
}

function primitiveKey(value: JsonValue | undefined): string | undefined {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function nextMatrixCycleValue(
  edit: ResolvedPresentationMatrixEdit,
  currentValue: JsonValue | undefined,
): JsonPrimitive | null {
  const currentIndex = edit.cycle.findIndex((value) => value === currentValue);
  if (currentIndex < 0) {
    return edit.cycle[0] ?? edit.unsetValue ?? null;
  }
  const next = edit.cycle[currentIndex + 1];
  if (next !== undefined) {
    return next;
  }
  return edit.unsetAsAbsence ? null : (edit.unsetValue ?? edit.cycle[0] ?? null);
}

function matrixEditOperation(
  edit: ResolvedPresentationMatrixEdit,
  cell: BoundPresentationRow | undefined,
  value: JsonPrimitive | null,
): "create" | "update" | "delete" {
  return matrixEditOperationForRecord(
    edit,
    cell === undefined
      ? null
      : {
          meta: {
            guid: cell.id,
            object: edit.object,
            schemaVersion: 1,
            revision: "",
            createdAt: "",
            createdBy: "",
            updatedAt: "",
            updatedBy: "",
            syncStatus: "local",
          },
          values: cell.values,
        },
    value,
  );
}

function matrixEditOperationForRecord(
  edit: ResolvedPresentationMatrixEdit,
  existing: StoredObjectRecord | null,
  value: JsonPrimitive | null | undefined,
): "create" | "update" | "delete" {
  if (edit.unsetAsAbsence && (value === null || value === edit.unsetValue)) {
    return "delete";
  }
  return existing === null ? "create" : "update";
}

function matrixEditPatch(
  edit: ResolvedPresentationMatrixEdit,
  rowKey: string,
  columnKey: string,
  value: JsonPrimitive | null | undefined,
): Record<string, JsonValue> {
  return {
    [edit.rowField]: rowKey,
    [edit.columnField]: columnKey,
    [edit.valueField]: value ?? null,
  };
}

/**
 * Row values plus the row's own record identity, for row-scoped `ACTION`
 * evaluation only.
 *
 * `BoundPresentationRow.values` carries projected field values (an object
 * row's `view.fields`, or a read model's declared `FIELD` projections). It
 * never carries the row's own storage id, because nothing declares a field
 * for it — there was no way for `ACTION ... INPUT ... FROM <expr>` to target
 * the exact record a row renders from, only fields already projected onto it
 * (see `learnings/implementation/ui-presentation-model.md`, "A row-scoped
 * presentation ACTION cannot target an existing record by id").
 *
 * {@link RECORD_ID_JOIN_FIELD} (`"id"`) is already the reserved name this
 * codebase uses for "this record's own id" inside a read model's `JOIN ON`
 * matching (`joinKeyForRecord` in `read-model-service.ts`). Reusing it here
 * keeps one token meaning one thing everywhere a resolved model can name a
 * record's own identity, so `INPUT NoteId FROM id` resolves the exact record
 * this row renders from, for both object- and read-model-backed rows.
 *
 * The primary source's `recordId` is used — `sources[0]`, not `row.id` —
 * because `row.id` is a synthetic display key (`"Object:guid"` for an object
 * row, `"readModel:source:guid|..."` for a read-model row) that no command
 * step's `ID INPUT` could ever resolve to a real record. `sources[0]` is
 * always the row's primary source (`objectRecordToPresentationRow` and
 * `readModelRowToPresentationRow` both put it first), matching the
 * documented "first source is primary" read-model rule.
 *
 * Placed after the row's own values so the reserved identity always wins if
 * a field is ever also (implausibly) named `id` — this token already carries
 * a fixed, system-wide meaning, so a same-named field could never have meant
 * anything else.
 */
/**
 * Pops `output`'s last entry if it is a `text` fragment consisting entirely
 * of whitespace. Called whenever a `field` or `icon` row fragment renders
 * nothing (no value, no fallback icon) — the literal separator a row
 * template places immediately before an optional fragment exists only to
 * separate it from its neighbor, so it should disappear along with it,
 * rather than leaving a visible gap (`evaluateFragments`). A literal that
 * carries real punctuation alongside whitespace (`" - "`) is left alone:
 * that punctuation is still meaningful once the value before it is gone,
 * only a *pure* separator (`" "`) is ever silently dropped.
 */
function dropTrailingWhitespaceOnlyFragment(output: RuntimePresentationFragment[]): void {
  const last = output[output.length - 1];
  if (last?.kind === "text" && last.text.trim() === "") {
    output.pop();
  }
}

function rowActionValues(row: BoundPresentationRow): Record<string, JsonValue> {
  const recordId = row.sources[0]?.recordId;
  return recordId === undefined
    ? { ...row.values }
    : { ...row.values, [RECORD_ID_JOIN_FIELD]: recordId };
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

/**
 * Exported for `edit-surface-runtime.ts`'s child-collection `summary`
 * formatting (Phase 87) — the one consumer of this formatter outside the
 * presentation runtime itself. A `CHILD_COLLECTION` summary is computed over
 * that collection's own already-assembled row set, not over a presentation
 * `LIST`, so it has no `RuntimePresentationDiagnostic` location of its own to
 * synthesize here; the caller supplies one.
 */
export function formatPresentationValue(
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
    case "duration":
      return formatDuration(value, format, diagnostics, location);
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

/**
 * Seconds -> pattern-driven text. Follows `applyTimePattern`'s small,
 * closed-token-vocabulary style rather than inventing a different
 * convention: today only `m:ss` (minutes, then seconds zero-padded to two
 * digits) is supported, which is the shape a song or set-list duration
 * actually needs ("47:20"). Negative or non-finite input is invalid, the
 * same posture `formatNumber` takes.
 */
function formatDuration(
  value: JsonValue | undefined,
  format: ResolvedPresentationFormat,
  diagnostics: RuntimePresentationDiagnostic[],
  location: DiagnosticLocation,
): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    diagnostics.push(
      invalidFormatValue(
        "Duration format requires a non-negative finite number of seconds.",
        location,
      ),
    );
    return "";
  }

  const pattern = format.pattern ?? "m:ss";
  if (pattern !== "m:ss") {
    diagnostics.push(unsupportedFormat(format, location));
    return String(value);
  }

  const totalSeconds = Math.round(value);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
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
