import type {
  PartialPresentationControlModel,
  PartialPresentationEmptyStateModel,
  PartialPresentationIconMapModel,
  PartialPresentationLegendModel,
  PartialPresentationSectionModel,
  PartialPresentationStateModel,
  PartialPresentationStatusMapModel,
  PartialPresentationStatusModel,
  PartialViewModel,
  PresentationActionPlacement,
  PresentationStateType,
  ResolvedPresentationControl,
  ResolvedPresentationEmptyState,
  ResolvedPresentationIconMap,
  ResolvedPresentationLegend,
  ResolvedPresentationSection,
  ResolvedPresentationState,
  ResolvedPresentationStatus,
  ResolvedPresentationStatusCandidate,
  ResolvedPresentationStatusMap,
  ResolvedViewPresentation,
} from "../../model/resolved-model.js";
import { resolveExpression } from "./expression.js";
import { resolvePresentationList } from "./presentation-list.js";
import { resolvePresentationMatrix } from "./presentation-matrix.js";
import { resolvePresentationCalendar } from "./presentation-calendar.js";
import { resolvePresentationIconRef } from "./presentation-row-format.js";
import { normaliseIdentifier, titleCaseIdentifier } from "./read-model.js";

export function resolveViewPresentation(
  input: NonNullable<PartialViewModel["presentation"]>,
): ResolvedViewPresentation {
  return {
    layout: input.layout ?? "stack",
    density: input.density ?? "comfortable",
    state: (input.state ?? []).map(resolvePresentationState),
    iconMaps: (input.iconMaps ?? []).map(resolvePresentationIconMap),
    statuses: (input.statuses ?? []).map(resolvePresentationStatus),
    statusMaps: (input.statusMaps ?? []).map(resolvePresentationStatusMap),
    legends: (input.legends ?? []).map(resolvePresentationLegend),
    sections: (input.sections ?? []).map(resolvePresentationSection),
  };
}
function resolvePresentationState(input: PartialPresentationStateModel): ResolvedPresentationState {
  const type = input.type ?? "boolean";

  return {
    name: input.name,
    type,
    defaultValue: input.defaultValue ?? defaultPresentationStateValue(type),
    persistence: input.persistence ?? "memory",
  };
}
function defaultPresentationStateValue(
  type: PresentationStateType,
): ResolvedPresentationState["defaultValue"] {
  switch (type) {
    case "boolean":
      return false;
    case "number":
      return 0;
    case "text":
      return "";
    case "date":
    case "datetime":
    case "time":
      return null;
  }
}
function resolvePresentationIconMap(
  input: PartialPresentationIconMapModel,
): ResolvedPresentationIconMap {
  return {
    name: input.name,
    field: input.field,
    values: (input.values ?? []).map((value) => ({ value: value.value, icon: value.icon })),
    ...(input.defaultIcon === undefined ? {} : { defaultIcon: input.defaultIcon }),
  };
}
function resolvePresentationStatus(
  input: PartialPresentationStatusModel,
): ResolvedPresentationStatus {
  const label = input.label ?? titleCaseIdentifier(input.name);

  return {
    name: input.name,
    label,
    accessibleLabel: input.accessibleLabel ?? label,
    ...(input.icon === undefined ? {} : { icon: resolvePresentationIconRef(input.icon) }),
    themeToken: input.themeToken ?? defaultPresentationStatusThemeToken(input.name),
    precedence: input.precedence ?? 0,
  };
}
function resolvePresentationStatusMap(
  input: PartialPresentationStatusMapModel,
): ResolvedPresentationStatusMap {
  return {
    name: input.name,
    field: input.field,
    values: (input.values ?? []).map((value) => ({ value: value.value, status: value.status })),
    ...(input.defaultStatus === undefined ? {} : { defaultStatus: input.defaultStatus }),
  };
}
function resolvePresentationLegend(
  input: PartialPresentationLegendModel,
): ResolvedPresentationLegend {
  return {
    name: input.name,
    ...(input.title === undefined ? {} : { title: input.title }),
    statuses: [...(input.statuses ?? [])],
    include: input.include ?? "present",
  };
}
function resolvePresentationSection(
  input: PartialPresentationSectionModel,
): ResolvedPresentationSection {
  return {
    name: input.name,
    ...(input.heading === undefined ? {} : { heading: input.heading }),
    layout: input.layout ?? "stack",
    density: input.density ?? "comfortable",
    controls: (input.controls ?? []).map(resolvePresentationControl),
    lists: (input.lists ?? []).map(resolvePresentationList),
    matrices: (input.matrices ?? []).map(resolvePresentationMatrix),
    calendars: (input.calendars ?? []).map(resolvePresentationCalendar),
  };
}
function resolvePresentationControl(
  input: PartialPresentationControlModel,
): ResolvedPresentationControl {
  const base = {
    name: input.name,
    ...(input.label === undefined ? {} : { label: input.label }),
    ...(input.icon === undefined ? {} : { icon: resolvePresentationIconRef(input.icon) }),
  };

  if (input.kind === "toggle") {
    return {
      ...base,
      kind: "toggle",
      state: input.state,
    };
  }

  if (input.kind === "select") {
    return {
      ...base,
      kind: "select",
      state: input.state,
      options: (input.options ?? []).map((option) => ({
        value: option.value,
        label: option.label,
        ...(option.icon === undefined ? {} : { icon: resolvePresentationIconRef(option.icon) }),
      })),
    };
  }

  if (input.kind === "action") {
    return {
      ...base,
      kind: "action",
      placement: input.placement ?? "secondary",
      ...(input.command === undefined ? {} : { command: input.command }),
      ...(input.view === undefined ? {} : { view: input.view }),
      ...(input.create === undefined
        ? {}
        : {
            create: {
              ...(input.create.object === undefined ? {} : { object: input.create.object }),
              ...(input.create.view === undefined ? {} : { view: input.create.view }),
            },
          }),
      input:
        input.input === undefined
          ? {}
          : Object.fromEntries(
              Object.entries(input.input).map(([name, expression]) => [
                name,
                resolveExpression(expression),
              ]),
            ),
      ...(input.visibleWhen === undefined
        ? {}
        : { visibleWhen: resolveExpression(input.visibleWhen) }),
    };
  }

  return {
    ...base,
    kind: "contextSelector",
    ...(input.context === undefined ? {} : { context: input.context }),
  };
}
export function resolvePresentationStatusCandidate(
  input: ResolvedPresentationStatusCandidate,
): ResolvedPresentationStatusCandidate {
  if (input.kind === "status") {
    return { kind: "status", status: input.status };
  }

  return {
    kind: "map",
    map: input.map,
    ...(input.field === undefined ? {} : { field: input.field }),
    ...(input.value === undefined ? {} : { value: input.value }),
  };
}
/**
 * The platform's own status vocabulary, and only that. Every name here is a
 * concept ADL itself has — scheduling, availability and conflict are what the
 * calendar and resource-matrix presentations are built on — so a model that uses
 * one gets a sensible colour without declaring a theme token.
 *
 * An application's own status names must not be added here. `rehearsal` was, and
 * it made the platform know a word only one reference app uses: any other domain
 * had no equivalent slot, and the closed theme-token set carried a band's
 * vocabulary. A status this table does not know falls to `colorInfo`, and an
 * author who wants a distinct colour declares `THEME colorStatusAlternate`.
 */
function defaultPresentationStatusThemeToken(
  name: string,
): ResolvedPresentationStatus["themeToken"] {
  switch (normaliseIdentifier(name)) {
    case "event":
      return "colorStatusEvent";
    case "available":
      return "colorStatusAvailable";
    case "unavailable":
      return "colorStatusUnavailable";
    case "busyelsewhere":
      return "colorStatusBusyElsewhere";
    case "conflict":
      return "colorStatusConflict";
    case "unset":
      return "colorStatusUnset";
    default:
      return "colorInfo";
  }
}
export function resolvePresentationAction(
  input: Extract<PartialPresentationControlModel, { kind: "action" }>,
  placement: PresentationActionPlacement,
): Extract<ResolvedPresentationControl, { kind: "action" }> {
  const resolved = resolvePresentationControl({ ...input, placement });
  if (resolved.kind !== "action") {
    throw new Error("Expected presentation action control.");
  }
  return resolved;
}
export function resolvePresentationEmptyState(
  input: PartialPresentationEmptyStateModel | undefined,
): ResolvedPresentationEmptyState {
  return {
    text: input?.text ?? "",
    ...(input?.icon === undefined ? {} : { icon: resolvePresentationIconRef(input.icon) }),
  };
}
