/**
 * Calendar month arithmetic: the 42-cell month grid, weekday headers, month
 * navigation bounds and labels, per-date row grouping, and the status counting
 * and precedence a calendar cell summarises its items with.
 *
 * One area of `presentation-runtime.ts`; see
 * `learnings/implementation/presentation-runtime-file-map.md` for the file map
 * and the rules that keep it working.
 */
import type {
  JsonValue,
  PresentationCalendarWeekStart,
  ResolvedPresentationCalendar,
  ResolvedView,
} from "../../model/resolved-model.js";
import type { RuntimeContext } from "../runtime-types.js";
import { formatPresentationValue } from "./format.js";
import { addUtcDays, parseIsoDate } from "./iso-date.js";
import type {
  BoundPresentationRow,
  CalendarGridCell,
  RuntimePresentationCalendarItem,
  RuntimePresentationCalendarMonth,
  RuntimePresentationCalendarWeekday,
  RuntimePresentationDiagnostic,
  RuntimePresentationStatus,
} from "./types.js";

export const CALENDAR_WEEKDAYS: PresentationCalendarWeekStart[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

export const CALENDAR_MONTH_NAMES = [
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

export function resolveCalendarMonth(
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

export function buildCalendarCells(
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

export function groupCalendarRowsByDate(
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

export function calendarWeekdays(
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

export function countCalendarStatuses(
  items: RuntimePresentationCalendarItem[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    if (item.status !== undefined) {
      counts[item.status.name] = (counts[item.status.name] ?? 0) + 1;
    }
  }
  return counts;
}

export function chooseEffectiveStatus(
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

export function normaliseCalendarMonth(value: JsonValue | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  if (/^\d{4}-\d{2}$/.test(value) && parseIsoDate(`${value}-01`) !== undefined) {
    return value;
  }
  const date = normaliseCalendarDate(value);
  return date?.slice(0, 7);
}

export function normaliseCalendarDate(value: JsonValue | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const date = /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : value.slice(0, 10);
  return parseIsoDate(date) === undefined ? undefined : date;
}

export function shiftIsoMonth(month: string, delta: number): string {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1 + delta;
  const shifted = new Date(Date.UTC(year, monthIndex, 1));
  return shifted.toISOString().slice(0, 7);
}

export function defaultMonthLabel(month: string): string {
  const monthIndex = Number(month.slice(5, 7)) - 1;
  return `${CALENDAR_MONTH_NAMES[monthIndex] ?? month.slice(5, 7)} ${month.slice(0, 4)}`;
}

export function titleCaseWord(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
