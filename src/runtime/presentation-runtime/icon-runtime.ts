/**
 * Icon references: named icons, and icon-map lookups by field value.
 *
 * One area of `presentation-runtime.ts`; see
 * `learnings/implementation/presentation-runtime-file-map.md` for the file map
 * and the rules that keep it working.
 */
import type {
  JsonValue,
  ResolvedPresentationIconMap,
  ResolvedPresentationIconRef,
  ResolvedView,
} from "../../model/resolved-model.js";
import { cloneJson } from "../runtime-types.js";
import { isJsonPrimitive } from "./format.js";
import type {
  DiagnosticLocation,
  RuntimePresentationDiagnostic,
  RuntimePresentationIcon,
} from "./types.js";
import { PresentationRuntimeBase } from "./base.js";

export class IconRuntime extends PresentationRuntimeBase {
  protected resolveIcon(
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
