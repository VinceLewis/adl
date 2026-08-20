import type { ResolvedSort } from "./view.js";
import type {
  PartialPresentationActionControlModel,
  PartialPresentationEmptyStateModel,
  PartialPresentationStatusBindingModel,
  PresentationDensity,
  ResolvedPresentationActionControl,
  ResolvedPresentationEmptyState,
  ResolvedPresentationStatusBinding,
} from "./presentation-core.js";
import type {
  PartialPresentationFormatModel,
  ResolvedPresentationFormat,
} from "./presentation-row-format.js";

export type PresentationCalendarSourceKind = "readModel" | "object";
export type PresentationCalendarWeekStart =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday";
export interface ResolvedPresentationCalendar {
  name: string;
  density: PresentationDensity;
  sourceKind: PresentationCalendarSourceKind;
  source: string;
  dateField: string;
  titleField?: string;
  summaryFields: string[];
  fields: string[];
  sort: ResolvedSort[];
  month: ResolvedPresentationCalendarMonth;
  status?: ResolvedPresentationStatusBinding;
  actions: ResolvedPresentationActionControl[];
  emptyState: ResolvedPresentationEmptyState;
  conflictOverlay?: ResolvedPresentationCalendarConflictOverlay;
}
/**
 * A calendar's own bound rows (`source`) can only ever come from one object or
 * read model, so they can show independent facts (an event, an availability
 * note) but never a fact correlated across two of them -- a `UNION` read model
 * cannot declare a `JOIN` (`ADL_READ_MODEL_JOIN_STRATEGY_INVALID`), and a
 * `JOIN`-strategy read model's inner-join semantics drop every row on the
 * primary side that has no match, which would silently remove the ordinary,
 * non-conflicting rows the calendar still needs to show correctly. A
 * conflict overlay is the escape hatch: a *second*, independently executed
 * read model -- built with a real `JOIN`, so its rows are naturally exactly
 * the correlated subset -- contributes one synthetic calendar item (using
 * `status`, a status already declared on the view) to every cell whose date
 * appears among its rows with `flagField` true, without altering what the
 * calendar's own `source` rows already show. See
 * `learnings/implementation/calendar-presentation-runtime.md` for the full
 * design rationale (the "layer a correlated signal onto an existing
 * union" problem this exists to solve).
 */
export interface ResolvedPresentationCalendarConflictOverlay {
  /** Name of a second, independently executed read model (not `source`). */
  readModel: string;
  /** That read model's own output field carrying each row's date. */
  dateField: string;
  /**
   * That read model's own boolean output field: a row only marks its date
   * as a conflict when this field is `true`, so a read model that also
   * projects non-conflicting correlated rows (e.g. a gig with someone
   * merely *available* that day) does not falsely flag them.
   */
  flagField: string;
  /** Name of a status already declared on the consuming view. */
  status: string;
}
export interface ResolvedPresentationCalendarMonth {
  value?: string;
  state?: string;
  weekStart: PresentationCalendarWeekStart;
  minDate?: string;
  maxDate?: string;
  labelFormat?: ResolvedPresentationFormat;
}
export interface PartialPresentationCalendarModel {
  name: string;
  density?: PresentationDensity;
  sourceKind?: PresentationCalendarSourceKind;
  source: string;
  dateField: string;
  titleField?: string;
  summaryFields?: string[];
  fields?: string[];
  sort?: ResolvedSort[];
  month?: PartialPresentationCalendarMonthModel;
  status?: PartialPresentationStatusBindingModel;
  actions?: PartialPresentationActionControlModel[];
  emptyState?: PartialPresentationEmptyStateModel;
  conflictOverlay?: ResolvedPresentationCalendarConflictOverlay;
}
export interface PartialPresentationCalendarMonthModel {
  value?: string;
  state?: string;
  weekStart?: PresentationCalendarWeekStart;
  minDate?: string;
  maxDate?: string;
  labelFormat?: PartialPresentationFormatModel;
}
