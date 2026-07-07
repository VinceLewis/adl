# Theme System Implementation

Read this before changing resolved theme tokens, theme resolution, browser CSS variables, or parser support for `THEME`.

## Key decisions from Phase 5

- Theme data remains part of the resolved model contract. Runtime/browser code consumes `ResolvedTheme` and `ResolvedThemeTokens`, not parser syntax or customer-specific components.
- Built-in base themes live in `src/model/defaults.ts`: `CorporateLight`, `CorporateDark`, and `MinimalLight`.
- `resolveApplicationModel` always includes the built-in themes unless an input theme with the same name is supplied. This preserves user duplicate-name diagnostics while still making the standard base themes available by default.
- Custom themes use `PartialThemeModel.base` plus token overrides. Resolution flattens inherited tokens into explicit `ResolvedTheme.tokens` while preserving the `base` name for inspection and validation.
- Invalid or cyclic base references are not thrown during resolution. The resolver still emits a complete token set using a deterministic fallback, and `validateApplicationModel` reports structured theme diagnostics.
- `src/ui/theme/default-theme.ts` is the browser adapter from resolved theme tokens to CSS custom properties and host data attributes. Components should rely on CSS variables rather than customer-specific branches or component forks.

## Practical guidance

- Add new theme tokens first to `ResolvedThemeTokens`, then to all built-in token definitions, the validator token checks, the UI CSS variable adapter, and focused tests.
- Keep token names stable and parser-friendly. Phase 6 parser work should compile textual `THEME` declarations into `PartialThemeModel` and let the existing resolver flatten inheritance.
- CSS should use `--adl-*` variables for colors, border, radius, and density. Hardcoded colors should only be generic fallbacks at the variable-definition layer.
