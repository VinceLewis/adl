import type {
  PartialPresentationCalendarModel,
  PartialPresentationCalendarMonthModel,
  ResolvedPresentationCalendar,
  ResolvedPresentationCalendarMonth,
} from "../../model/resolved-model.js";
import { resolveSort } from "./view.js";
import {
  resolvePresentationAction,
  resolvePresentationEmptyState,
  resolvePresentationStatusCandidate,
} from "./presentation-core.js";
import { resolvePresentationFormat } from "./presentation-row-format.js";

export function resolvePresentationCalendar(
  input: PartialPresentationCalendarModel,
): ResolvedPresentationCalendar {
  return {
    name: input.name,
    density: input.density ?? "comfortable",
    sourceKind: input.sourceKind ?? "readModel",
    source: input.source,
    dateField: input.dateField,
    ...(input.titleField === undefined ? {} : { titleField: input.titleField }),
    summaryFields: [...(input.summaryFields ?? [])],
    fields: [...(input.fields ?? [])],
    sort: [...(input.sort ?? [])].map(resolveSort),
    month: resolvePresentationCalendarMonth(input.month),
    ...(input.status === undefined
      ? {}
      : {
          status: {
            candidates: (input.status.candidates ?? []).map(resolvePresentationStatusCandidate),
          },
        }),
    actions: (input.actions ?? []).map((action) =>
      resolvePresentationAction(action, action.placement ?? "secondary"),
    ),
    emptyState: resolvePresentationEmptyState(input.emptyState),
    ...(input.conflictOverlay === undefined
      ? {}
      : { conflictOverlay: { ...input.conflictOverlay } }),
  };
}
function resolvePresentationCalendarMonth(
  input: PartialPresentationCalendarMonthModel | undefined,
): ResolvedPresentationCalendarMonth {
  return {
    ...(input?.value === undefined ? {} : { value: input.value }),
    ...(input?.state === undefined ? {} : { state: input.state }),
    weekStart: input?.weekStart ?? "monday",
    ...(input?.minDate === undefined ? {} : { minDate: input.minDate }),
    ...(input?.maxDate === undefined ? {} : { maxDate: input.maxDate }),
    ...(input?.labelFormat === undefined
      ? {}
      : { labelFormat: resolvePresentationFormat(input.labelFormat) }),
  };
}
