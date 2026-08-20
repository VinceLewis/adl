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
}
export interface PartialPresentationCalendarMonthModel {
  value?: string;
  state?: string;
  weekStart?: PresentationCalendarWeekStart;
  minDate?: string;
  maxDate?: string;
  labelFormat?: PartialPresentationFormatModel;
}
