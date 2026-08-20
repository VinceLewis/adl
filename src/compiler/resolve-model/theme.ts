import { createBuiltInThemes, createDefaultTheme, getBuiltInTheme } from "../../model/defaults.js";
import type {
  PartialThemeModel,
  ResolvedTheme,
  ResolvedThemeTokens,
} from "../../model/resolved-model.js";

export function resolveThemes(input: PartialThemeModel[]): ResolvedTheme[] {
  const inputThemeNames = new Set(input.map((theme) => theme.name));
  const themes = [
    ...createBuiltInThemes().filter((theme) => !inputThemeNames.has(theme.name)),
    ...input,
  ];
  const themesByName = new Map<string, PartialThemeModel | ResolvedTheme>();

  for (const theme of themes) {
    if (!themesByName.has(theme.name)) {
      themesByName.set(theme.name, theme);
    }
  }

  return themes.map((theme) => resolveTheme(theme, themesByName, []));
}
function resolveTheme(
  input: PartialThemeModel | ResolvedTheme,
  themesByName: Map<string, PartialThemeModel | ResolvedTheme>,
  resolutionPath: string[],
): ResolvedTheme {
  const baseTokens = resolveThemeBaseTokens(input, themesByName, resolutionPath);

  return {
    name: input.name,
    ...(input.base === undefined ? {} : { base: input.base }),
    tokens: {
      ...baseTokens,
      ...(input.tokens ?? {}),
    },
  };
}
function resolveThemeBaseTokens(
  input: PartialThemeModel | ResolvedTheme,
  themesByName: Map<string, PartialThemeModel | ResolvedTheme>,
  resolutionPath: string[],
): ResolvedThemeTokens {
  const builtInTheme = getBuiltInTheme(input.name);
  const defaultTokens = builtInTheme?.tokens ?? createDefaultTheme().tokens;

  if (
    input.base === undefined ||
    input.base === input.name ||
    resolutionPath.includes(input.base)
  ) {
    return defaultTokens;
  }

  const baseTheme = themesByName.get(input.base);
  if (baseTheme === undefined) {
    return defaultTokens;
  }

  return resolveTheme(baseTheme, themesByName, [...resolutionPath, input.name]).tokens;
}
