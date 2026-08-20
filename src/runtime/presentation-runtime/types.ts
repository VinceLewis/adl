/**
 * Every renderer-neutral shape the presentation runtime produces or consumes:
 * views, sections, controls, lists, matrices, calendars, rows, statuses,
 * icons, fragments, its diagnostics, and its data-source port.
 *
 * The module-private shapes at the end (`BoundPresentationRow`,
 * `CalendarConflictOverlay`, `PlannedMatrixCellWrite`, `CalendarGridCell`) are
 * exported so the sibling area files can reach them, and are deliberately not
 * re-exported by `index.ts` — they are not part of this module's public
 * surface.
 *
 * One area of `presentation-runtime.ts`; see
 * `learnings/implementation/presentation-runtime-file-map.md` for the file map
 * and the rules that keep it working.
 */
import type {
  JsonPrimitive,
  JsonValue,
  LocalOperationKind,
  PresentationCalendarWeekStart,
  PresentationDensity,
  PresentationFragmentStyle,
  PresentationLayout,
  PresentationRowLayout,
  ResolvedPresentationCalendar,
  ResolvedPresentationControl,
  ResolvedPresentationLegend,
  ResolvedPresentationList,
  ResolvedPresentationMatrix,
  ResolvedPresentationMatrixEdit,
  ResolvedPresentationSection,
  ResolvedPresentationStatus,
  ResolvedSort,
  StoredObjectRecord,
} from "../../model/resolved-model.js";
import type {
  PolicyDecision,
  RuntimeContext,
  RuntimeReadModelResult,
  RuntimeSearchInput,
} from "../runtime-types.js";
import type { SyncWriteDecision } from "../sync-policy-service.js";

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

export interface BoundPresentationRow {
  id: string;
  values: Record<string, JsonValue>;
  sources: RuntimePresentationRowSource[];
}

/** Resolved, ready-to-apply form of a calendar's `conflictOverlay`. */
export interface CalendarConflictOverlay {
  dates: Set<string>;
  status: RuntimePresentationStatus;
}

export interface PlannedMatrixCellWrite {
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

export interface CalendarGridCell {
  date: string;
  day: number;
  inMonth: boolean;
  withinRange: boolean;
  isToday: boolean;
}
