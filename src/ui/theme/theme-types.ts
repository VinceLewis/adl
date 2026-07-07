import type { ResolvedThemeTokens, ThemeDensity } from "../../model/resolved-model.js";

export type ThemeTokenCssVariable = `--adl-${string}`;

export const THEME_COLOR_CSS_VARIABLES = {
  colorPrimary: "--adl-color-primary",
  colorAccent: "--adl-color-accent",
  colorBackground: "--adl-color-background",
  colorSurface: "--adl-color-surface",
  colorSurfaceAlt: "--adl-color-surface-alt",
  colorText: "--adl-color-text",
  colorTextMuted: "--adl-color-text-muted",
  colorTextInverted: "--adl-color-text-inverted",
  colorBorder: "--adl-color-border",
  colorDanger: "--adl-color-danger",
  colorSuccess: "--adl-color-success",
  colorInfo: "--adl-color-info",
} as const satisfies Partial<Record<keyof ResolvedThemeTokens, ThemeTokenCssVariable>>;

export interface DensityCssTokens {
  controlHeight: string;
  spaceXs: string;
  spaceSm: string;
  spaceMd: string;
  spaceLg: string;
  tableCellY: string;
  tableCellX: string;
  formGap: string;
}

export const DENSITY_CSS_TOKENS = {
  compact: {
    controlHeight: "30px",
    spaceXs: "4px",
    spaceSm: "8px",
    spaceMd: "12px",
    spaceLg: "14px",
    tableCellY: "8px",
    tableCellX: "10px",
    formGap: "10px",
  },
  comfortable: {
    controlHeight: "34px",
    spaceXs: "6px",
    spaceSm: "8px",
    spaceMd: "12px",
    spaceLg: "16px",
    tableCellY: "10px",
    tableCellX: "12px",
    formGap: "12px",
  },
  spacious: {
    controlHeight: "40px",
    spaceXs: "8px",
    spaceSm: "12px",
    spaceMd: "16px",
    spaceLg: "20px",
    tableCellY: "12px",
    tableCellX: "14px",
    formGap: "16px",
  },
} as const satisfies Record<ThemeDensity, DensityCssTokens>;
