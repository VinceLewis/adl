import type {
  PresentationActionPlacement,
  PresentationDensity,
  PresentationFormatKind,
  PresentationFragmentStyle,
  PresentationLayout,
  PresentationRowLayout,
  ResolvedPresentationControl,
  ResolvedPresentationIconRef,
  ResolvedPresentationList,
  ResolvedPresentationRowFragment,
  ResolvedView,
  ResolvedViewPresentation,
} from "../../model/resolved-model.js";
import { MODEL_VALIDATION_CODES } from "./codes.js";
import type { Diagnostic, ModelValidationCode } from "./codes.js";
import { diagnostic } from "./shared.js";
import type { ExpressionFieldReference, ModelIndexes, NamedReference } from "./shared.js";
import { validateExpression } from "./expression.js";

const PRESENTATION_LAYOUTS = new Set<PresentationLayout>(["stack", "grid", "split", "sidebar"]);
const PRESENTATION_DENSITIES = new Set<PresentationDensity>(["compact", "comfortable", "spacious"]);
const PRESENTATION_ACTION_PLACEMENTS = new Set<PresentationActionPlacement>([
  "primary",
  "secondary",
  "row",
]);
const PRESENTATION_ROW_LAYOUTS = new Set<PresentationRowLayout>(["inline", "stack"]);
const PRESENTATION_FRAGMENT_STYLES = new Set<PresentationFragmentStyle>([
  "plain",
  "bold",
  "muted",
  "caption",
]);
const PRESENTATION_FORMAT_KINDS = new Set<PresentationFormatKind>([
  "text",
  "number",
  "date",
  "datetime",
  "time",
]);
export function validatePresentationActionControl(
  control: Extract<ResolvedPresentationControl, { kind: "action" }>,
  controlPath: string,
  expressionFieldsByName: Map<string, NamedReference<ExpressionFieldReference>>,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  if (!PRESENTATION_ACTION_PLACEMENTS.has(control.placement)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_CONTROL_PLACEMENT_INVALID,
        `Presentation action '${control.name}' has invalid placement '${String(control.placement)}'.`,
        `${controlPath}.placement`,
      ),
    );
  }

  if (control.command !== undefined && !indexes.commandsByName.has(control.command)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_CONTROL_COMMAND_UNKNOWN,
        `Presentation action '${control.name}' references unknown command '${control.command}'.`,
        `${controlPath}.command`,
      ),
    );
  }

  if (control.view !== undefined && !indexes.viewNames.has(control.view)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_CONTROL_VIEW_UNKNOWN,
        `Presentation action '${control.name}' references unknown view '${control.view}'.`,
        `${controlPath}.view`,
      ),
    );
  }

  if (control.create !== undefined) {
    if (control.create.object !== undefined && !indexes.objectsByName.has(control.create.object)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.PRESENTATION_CREATE_OBJECT_UNKNOWN,
          `Presentation action '${control.name}' creates unknown object '${control.create.object}'.`,
          `${controlPath}.create.object`,
        ),
      );
    }
    if (control.create.view !== undefined && !indexes.viewNames.has(control.create.view)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.PRESENTATION_CREATE_VIEW_UNKNOWN,
          `Presentation action '${control.name}' opens unknown create view '${control.create.view}'.`,
          `${controlPath}.create.view`,
        ),
      );
    }
  }

  for (const [inputName, expression] of Object.entries(control.input)) {
    validateExpression(
      expression,
      `${controlPath}.input.${inputName}`,
      expressionFieldsByName,
      {
        invalid: MODEL_VALIDATION_CODES.PRESENTATION_CONTROL_INPUT_INVALID,
        field: MODEL_VALIDATION_CODES.PRESENTATION_CONTROL_INPUT_FIELD_UNKNOWN,
        runtime: MODEL_VALIDATION_CODES.PRESENTATION_CONTROL_INPUT_RUNTIME_PROPERTY_INVALID,
        type: MODEL_VALIDATION_CODES.PRESENTATION_CONTROL_INPUT_INVALID,
      },
      diagnostics,
    );
  }

  if (control.visibleWhen !== undefined) {
    const visibilityType = validateExpression(
      control.visibleWhen,
      `${controlPath}.visibleWhen`,
      expressionFieldsByName,
      {
        invalid: MODEL_VALIDATION_CODES.PRESENTATION_CONTROL_VISIBILITY_INVALID,
        field: MODEL_VALIDATION_CODES.PRESENTATION_CONTROL_VISIBILITY_FIELD_UNKNOWN,
        runtime: MODEL_VALIDATION_CODES.PRESENTATION_CONTROL_VISIBILITY_RUNTIME_PROPERTY_INVALID,
        type: MODEL_VALIDATION_CODES.PRESENTATION_CONTROL_VISIBILITY_TYPE,
      },
      diagnostics,
    );
    if (visibilityType !== "boolean" && visibilityType !== "unknown") {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.PRESENTATION_CONTROL_VISIBILITY_TYPE,
          `Presentation action '${control.name}' visibility must resolve to boolean, not ${visibilityType}.`,
          `${controlPath}.visibleWhen`,
        ),
      );
    }
  }
}
export function validatePresentationRowTemplate(
  row: ResolvedPresentationList["row"],
  rowPath: string,
  view: ResolvedView,
  fieldsByName: Map<string, NamedReference<ExpressionFieldReference>>,
  expressionFieldsByName: Map<string, NamedReference<ExpressionFieldReference>>,
  iconMapByName: Map<string, NamedReference<{ name: string }>>,
  diagnostics: Diagnostic[],
): void {
  if (!PRESENTATION_ROW_LAYOUTS.has(row.layout)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_ROW_LAYOUT_INVALID,
        `Presentation row has invalid layout '${String(row.layout)}'.`,
        `${rowPath}.layout`,
      ),
    );
  }
  validatePresentationDensity(row.density, `${rowPath}.density`, diagnostics);

  for (let fragmentIndex = 0; fragmentIndex < row.fragments.length; fragmentIndex += 1) {
    const fragment = row.fragments[fragmentIndex];
    if (fragment === undefined) {
      continue;
    }
    validatePresentationRowFragment(
      fragment,
      `${rowPath}.fragments[${fragmentIndex}]`,
      view,
      fieldsByName,
      expressionFieldsByName,
      iconMapByName,
      diagnostics,
    );
  }
}
function validatePresentationRowFragment(
  fragment: ResolvedPresentationRowFragment,
  fragmentPath: string,
  view: ResolvedView,
  fieldsByName: Map<string, NamedReference<ExpressionFieldReference>>,
  expressionFieldsByName: Map<string, NamedReference<ExpressionFieldReference>>,
  iconMapByName: Map<string, NamedReference<{ name: string }>>,
  diagnostics: Diagnostic[],
): void {
  if (fragment.kind === "field") {
    if (!fieldsByName.has(fragment.field)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.PRESENTATION_ROW_FIELD_UNKNOWN,
          `Presentation row references unknown field '${fragment.field}'.`,
          `${fragmentPath}.field`,
        ),
      );
    }
    validatePresentationFragmentStyle(fragment.style, `${fragmentPath}.style`, diagnostics);
    validatePresentationFormat(fragment.format, `${fragmentPath}.format`, diagnostics);
    return;
  }

  if (fragment.kind === "text") {
    validatePresentationFragmentStyle(fragment.style, `${fragmentPath}.style`, diagnostics);
    return;
  }

  if (fragment.kind === "icon") {
    validatePresentationIconRef(
      fragment.icon,
      `${fragmentPath}.icon`,
      view,
      iconMapByName,
      fieldsByName,
      diagnostics,
    );
    return;
  }

  if (fragment.kind === "conditional") {
    const conditionType = validateExpression(
      fragment.when,
      `${fragmentPath}.when`,
      expressionFieldsByName,
      {
        invalid: MODEL_VALIDATION_CODES.PRESENTATION_ROW_CONDITION_INVALID,
        field: MODEL_VALIDATION_CODES.PRESENTATION_ROW_CONDITION_FIELD_UNKNOWN,
        runtime: MODEL_VALIDATION_CODES.PRESENTATION_ROW_CONDITION_RUNTIME_PROPERTY_INVALID,
        type: MODEL_VALIDATION_CODES.PRESENTATION_ROW_CONDITION_TYPE,
      },
      diagnostics,
    );
    if (conditionType !== "boolean" && conditionType !== "unknown") {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.PRESENTATION_ROW_CONDITION_TYPE,
          `Presentation conditional row fragment must resolve to boolean, not ${conditionType}.`,
          `${fragmentPath}.when`,
        ),
      );
    }
    validatePresentationRowTemplate(
      {
        layout: "inline",
        density: "comfortable",
        fragments: fragment.fragments,
      },
      fragmentPath,
      view,
      fieldsByName,
      expressionFieldsByName,
      iconMapByName,
      diagnostics,
    );
  }
}
export function validatePresentationIconRef(
  icon: ResolvedPresentationIconRef | undefined,
  iconPath: string,
  view: ResolvedView,
  iconMapByName: Map<string, NamedReference<{ name: string }>>,
  fieldsByName: Map<string, NamedReference<ExpressionFieldReference>> | undefined,
  diagnostics: Diagnostic[],
  unknownIconMapCode: ModelValidationCode = MODEL_VALIDATION_CODES.PRESENTATION_ICON_MAP_UNKNOWN,
): void {
  if (icon === undefined || icon.kind === "named") {
    return;
  }

  if (!iconMapByName.has(icon.map)) {
    diagnostics.push(
      diagnostic(
        unknownIconMapCode,
        `Presentation icon reference in view '${view.name}' uses unknown icon map '${icon.map}'.`,
        `${iconPath}.map`,
      ),
    );
  }

  if (icon.field !== undefined && fieldsByName !== undefined && !fieldsByName.has(icon.field)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_ROW_FIELD_UNKNOWN,
        `Presentation icon reference in view '${view.name}' uses unknown field '${icon.field}'.`,
        `${iconPath}.field`,
      ),
    );
  }
}
export function validatePresentationLayout(
  layout: ResolvedViewPresentation["layout"],
  layoutPath: string,
  diagnostics: Diagnostic[],
): void {
  if (!PRESENTATION_LAYOUTS.has(layout)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_LAYOUT_INVALID,
        `Presentation layout '${String(layout)}' is not supported.`,
        layoutPath,
      ),
    );
  }
}
export function validatePresentationDensity(
  density: ResolvedViewPresentation["density"],
  densityPath: string,
  diagnostics: Diagnostic[],
): void {
  if (!PRESENTATION_DENSITIES.has(density)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_DENSITY_INVALID,
        `Presentation density '${String(density)}' is not supported.`,
        densityPath,
      ),
    );
  }
}
function validatePresentationFragmentStyle(
  style: PresentationFragmentStyle,
  stylePath: string,
  diagnostics: Diagnostic[],
): void {
  if (!PRESENTATION_FRAGMENT_STYLES.has(style)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_ROW_FRAGMENT_STYLE_INVALID,
        `Presentation row fragment style '${String(style)}' is not supported.`,
        stylePath,
      ),
    );
  }
}
export function validatePresentationFormat(
  format: Extract<ResolvedPresentationRowFragment, { kind: "field" }>["format"],
  formatPath: string,
  diagnostics: Diagnostic[],
): void {
  if (format === undefined) {
    return;
  }

  if (!PRESENTATION_FORMAT_KINDS.has(format.kind)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_FORMAT_INVALID,
        `Presentation format '${String(format.kind)}' is not supported.`,
        `${formatPath}.kind`,
      ),
    );
  }

  if (format.pattern !== undefined && format.pattern.trim() === "") {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_FORMAT_INVALID,
        "Presentation format pattern must not be empty.",
        `${formatPath}.pattern`,
      ),
    );
  }
}
