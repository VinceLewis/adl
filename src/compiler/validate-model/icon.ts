import { ICON_NAMES, isIconName } from "../../model/resolved-model.js";
import { MODEL_VALIDATION_CODES } from "./codes.js";
import type { Diagnostic } from "./codes.js";
import { diagnostic } from "./shared.js";

/**
 * Reject an icon name no renderer knows how to draw.
 *
 * `ICON_NAMES` (`src/model/resolved-model/icon-vocabulary.ts`) is the one
 * vocabulary, shared by the compiler and by both renderers. This function is
 * the compiler's half of that contract and is deliberately the *only* place the
 * check is written, so every construct that names an icon — shell navigation,
 * shell controls, icon maps and their default, presentation statuses, controls,
 * select options, empty states and row icon fragments — reports the same code
 * with the same message.
 */
export function validateIconName(name: string, iconPath: string, diagnostics: Diagnostic[]): void {
  if (isIconName(name)) {
    return;
  }

  diagnostics.push(
    diagnostic(
      MODEL_VALIDATION_CODES.ICON_NAME_UNKNOWN,
      `Icon name '${name}' is not a supported icon. Supported icons: ${ICON_NAMES.join(", ")}.`,
      iconPath,
    ),
  );
}
