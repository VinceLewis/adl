/**
 * Calendar month views: source row binding, conflict overlays, and the
 * evaluation of each grid cell and the items inside it.
 *
 * One area of `presentation-runtime.ts`; see
 * `learnings/implementation/presentation-runtime-file-map.md` for the file map
 * and the rules that keep it working.
 */
import type {
  JsonValue,
  ResolvedPresentationCalendar,
  ResolvedView,
} from "../../model/resolved-model.js";
import { cloneJson } from "../runtime-types.js";
import type { RuntimeContext } from "../runtime-types.js";
import {
  buildCalendarCells,
  calendarWeekdays,
  chooseEffectiveStatus,
  countCalendarStatuses,
  groupCalendarRowsByDate,
  resolveCalendarMonth,
} from "./calendar-grid.js";
import { primitiveToText } from "./format.js";
import {
  objectRecordToPresentationRow,
  readModelRowToPresentationRow,
  sortPresentationRows,
} from "./row-binding.js";
import type {
  BoundPresentationRow,
  CalendarConflictOverlay,
  CalendarGridCell,
  DiagnosticLocation,
  RuntimePresentationCalendar,
  RuntimePresentationCalendarCell,
  RuntimePresentationCalendarItem,
  RuntimePresentationDiagnostic,
  RuntimePresentationStatus,
} from "./types.js";
import { RowRuntime } from "./row-runtime.js";

export class CalendarRuntime extends RowRuntime {
  protected async evaluateCalendar(
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
    // A resolved lookup label stands in for the stored id wherever a calendar
    // shows a projected field to a reader, exactly as it does in a list row.
    const titleValue =
      calendar.titleField === undefined
        ? row.id
        : (row.display?.[calendar.titleField] ?? row.values[calendar.titleField] ?? row.id);
    const title = primitiveToText(titleValue, diagnostics, {
      ...location,
      field: calendar.titleField,
    });
    const summary = calendar.summaryFields
      .map((field) => row.display?.[field] ?? row.values[field])
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
}
