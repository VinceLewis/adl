import type { ResolvedTheme, ResolvedThemeTokens } from "../../model/resolved-model.js";
import { MODEL_VALIDATION_CODES } from "./codes.js";
import type { Diagnostic } from "./codes.js";
import { diagnostic } from "./shared.js";
import type { ModelIndexes } from "./shared.js";

const THEME_RADIUS_VALUES = new Set(["none", "small", "medium", "large"]);
const THEME_DENSITY_VALUES = new Set(["compact", "comfortable", "spacious"]);
const THEME_NAV_VALUES = new Set(["top", "side", "bottom"]);
const THEME_STRING_TOKENS = [
  "colorPrimary",
  "colorAccent",
  "colorBackground",
  "colorSurface",
  "colorSurfaceAlt",
  "colorText",
  "colorTextMuted",
  "colorTextInverted",
  "colorBorder",
  "colorDanger",
  "colorSuccess",
  "colorInfo",
  "colorStatusEvent",
  "colorStatusAlternate",
  "colorStatusAvailable",
  "colorStatusUnavailable",
  "colorStatusBusyElsewhere",
  "colorStatusConflict",
  "colorStatusUnset",
  "fontFamily",
  "logoUrl",
] as const satisfies readonly (keyof ResolvedThemeTokens)[];
export function validateTheme(
  theme: ResolvedTheme,
  themeIndex: number,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  const themePath = `themes[${themeIndex}]`;

  if (theme.base !== undefined) {
    if (theme.base === theme.name) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.THEME_BASE_SELF_REFERENCE,
          `Theme '${theme.name}' cannot use itself as its base theme.`,
          `${themePath}.base`,
        ),
      );
    } else if (!indexes.themesByName.has(theme.base)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.THEME_BASE_UNKNOWN,
          `Theme '${theme.name}' references unknown base theme '${theme.base}'.`,
          `${themePath}.base`,
        ),
      );
    }
  }

  const baseCycle = findThemeBaseCycle(theme, indexes);
  if (baseCycle !== undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.THEME_BASE_CYCLE,
        `Theme '${theme.name}' has a base theme cycle: ${baseCycle.join(" -> ")}.`,
        `${themePath}.base`,
      ),
    );
  }

  for (const tokenName of THEME_STRING_TOKENS) {
    const token = theme.tokens[tokenName];
    if (token !== undefined && (typeof token !== "string" || token.trim().length === 0)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.THEME_TOKEN_INVALID,
          `Theme '${theme.name}' has invalid ${tokenName} token '${String(token)}'.`,
          `${themePath}.tokens.${tokenName}`,
        ),
      );
    }
  }

  if (!THEME_RADIUS_VALUES.has(theme.tokens.radius)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.THEME_TOKEN_INVALID,
        `Theme '${theme.name}' has invalid radius token '${String(theme.tokens.radius)}'.`,
        `${themePath}.tokens.radius`,
      ),
    );
  }

  if (!THEME_DENSITY_VALUES.has(theme.tokens.density)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.THEME_TOKEN_INVALID,
        `Theme '${theme.name}' has invalid density token '${String(theme.tokens.density)}'.`,
        `${themePath}.tokens.density`,
      ),
    );
  }

  if (!THEME_NAV_VALUES.has(theme.tokens.nav)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.THEME_TOKEN_INVALID,
        `Theme '${theme.name}' has invalid navigation token '${String(theme.tokens.nav)}'.`,
        `${themePath}.tokens.nav`,
      ),
    );
  }
}
function findThemeBaseCycle(theme: ResolvedTheme, indexes: ModelIndexes): string[] | undefined {
  const seen = new Set<string>([theme.name]);
  const path = [theme.name];
  let current: ResolvedTheme | undefined = theme;

  while (current?.base !== undefined) {
    path.push(current.base);
    if (seen.has(current.base)) {
      return path;
    }

    seen.add(current.base);
    current = indexes.themesByName.get(current.base)?.item;
  }

  return undefined;
}
