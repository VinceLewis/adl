import { createDefaultTheme } from "../../model/defaults.js";
import type {
  ResolvedApplicationModel,
  ResolvedTheme,
  ResolvedThemeTokens,
  ThemeRadius,
} from "../../model/resolved-model.js";
import { DENSITY_CSS_TOKENS, THEME_COLOR_CSS_VARIABLES } from "./theme-types.js";

export function findApplicationTheme(model: ResolvedApplicationModel): ResolvedTheme {
  return model.themes.find((theme) => theme.name === model.app.theme) ?? createDefaultTheme();
}

export function applyResolvedTheme(element: HTMLElement, theme: ResolvedTheme): void {
  element.dataset.adlTheme = theme.name;
  element.dataset.adlDensity = theme.tokens.density;
  element.dataset.adlNav = theme.tokens.nav;

  for (const [tokenName, propertyName] of Object.entries(THEME_COLOR_CSS_VARIABLES)) {
    const value = theme.tokens[tokenName as keyof typeof THEME_COLOR_CSS_VARIABLES];
    element.style.setProperty(propertyName, value);
  }

  if (theme.tokens.fontFamily !== undefined) {
    element.style.setProperty("--adl-font-family", theme.tokens.fontFamily);
  }

  element.style.setProperty("--adl-radius", radiusToCss(theme.tokens.radius));

  const density = DENSITY_CSS_TOKENS[theme.tokens.density];
  element.style.setProperty("--adl-control-height", density.controlHeight);
  element.style.setProperty("--adl-space-xs", density.spaceXs);
  element.style.setProperty("--adl-space-sm", density.spaceSm);
  element.style.setProperty("--adl-space-md", density.spaceMd);
  element.style.setProperty("--adl-space-lg", density.spaceLg);
  element.style.setProperty("--adl-table-cell-y", density.tableCellY);
  element.style.setProperty("--adl-table-cell-x", density.tableCellX);
  element.style.setProperty("--adl-form-gap", density.formGap);
}

export function themeTokensToCssVariables(tokens: ResolvedThemeTokens): Record<string, string> {
  const density = DENSITY_CSS_TOKENS[tokens.density];

  return {
    [THEME_COLOR_CSS_VARIABLES.colorPrimary]: tokens.colorPrimary,
    [THEME_COLOR_CSS_VARIABLES.colorAccent]: tokens.colorAccent,
    [THEME_COLOR_CSS_VARIABLES.colorBackground]: tokens.colorBackground,
    [THEME_COLOR_CSS_VARIABLES.colorSurface]: tokens.colorSurface,
    [THEME_COLOR_CSS_VARIABLES.colorSurfaceAlt]: tokens.colorSurfaceAlt,
    [THEME_COLOR_CSS_VARIABLES.colorText]: tokens.colorText,
    [THEME_COLOR_CSS_VARIABLES.colorTextMuted]: tokens.colorTextMuted,
    [THEME_COLOR_CSS_VARIABLES.colorTextInverted]: tokens.colorTextInverted,
    [THEME_COLOR_CSS_VARIABLES.colorBorder]: tokens.colorBorder,
    [THEME_COLOR_CSS_VARIABLES.colorDanger]: tokens.colorDanger,
    [THEME_COLOR_CSS_VARIABLES.colorSuccess]: tokens.colorSuccess,
    [THEME_COLOR_CSS_VARIABLES.colorInfo]: tokens.colorInfo,
    "--adl-radius": radiusToCss(tokens.radius),
    "--adl-control-height": density.controlHeight,
    "--adl-space-xs": density.spaceXs,
    "--adl-space-sm": density.spaceSm,
    "--adl-space-md": density.spaceMd,
    "--adl-space-lg": density.spaceLg,
    "--adl-table-cell-y": density.tableCellY,
    "--adl-table-cell-x": density.tableCellX,
    "--adl-form-gap": density.formGap,
    ...(tokens.fontFamily === undefined ? {} : { "--adl-font-family": tokens.fontFamily }),
  };
}

function radiusToCss(radius: ThemeRadius): string {
  switch (radius) {
    case "none":
      return "0";
    case "small":
      return "4px";
    case "medium":
      return "6px";
    case "large":
      return "8px";
  }
}
