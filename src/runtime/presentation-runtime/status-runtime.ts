/**
 * Semantic statuses: candidate evaluation, status-map lookups, precedence
 * between competing candidates, and legends.
 *
 * One area of `presentation-runtime.ts`; see
 * `learnings/implementation/presentation-runtime-file-map.md` for the file map
 * and the rules that keep it working.
 */
import type {
  JsonValue,
  ResolvedPresentationLegend,
  ResolvedPresentationList,
  ResolvedPresentationStatusCandidate,
  ResolvedPresentationStatusMap,
  ResolvedView,
} from "../../model/resolved-model.js";
import { cloneJson } from "../runtime-types.js";
import { isJsonPrimitive } from "./format.js";
import type {
  DiagnosticLocation,
  RuntimePresentationDiagnostic,
  RuntimePresentationLegend,
  RuntimePresentationSection,
  RuntimePresentationStatus,
  RuntimePresentationStatusSource,
} from "./types.js";
import { IconRuntime } from "./icon-runtime.js";

export class StatusRuntime extends IconRuntime {
  protected evaluateStatusBinding(
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

  protected evaluateStatusCandidates(
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

  protected resolveStatus(
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

  protected evaluateLegends(
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
}
