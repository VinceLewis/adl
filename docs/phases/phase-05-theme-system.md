# Phase 5 - Theme System

## Objective

Support customer branding through resolved theme tokens and CSS custom properties, without custom widget trees.

## Scope

Implement theme model support and runtime/browser application of theme tokens. Keep styling generic and business-app-focused.

Do not redesign the UI as a marketing page. Do not add per-customer component forks.

Phase 4 already added a Vite/Web Components browser demo and basic `adl-app` application of the resolved app theme tokens to CSS custom properties. Phase 5 should extend that path with explicit base themes, richer token coverage, and theme resolution tests rather than replacing the browser UI runtime.

## Expected Deliverables

- Theme interfaces refined in `src/model/resolved-model.ts` if needed
- Theme defaults in `src/model/defaults.ts` or a dedicated theme module
- `src/ui/theme/theme-types.ts`
- `src/ui/theme/default-theme.ts`
- CSS custom property application in UI runtime, extending the Phase 4 `adl-app` token application
- Tests for theme resolution where practical

## Acceptance Criteria

- At least three base themes exist: `CorporateLight`, `CorporateDark`, and `MinimalLight`.
- Application can switch theme by resolved model value.
- Components use CSS custom properties rather than hardcoded business-specific styling.
- Customer customization uses tokens, not custom components.
- Existing UI workflows still work after theme changes.

## Suggested Codex Prompt

```text
Use ADL_Codex_Implementation_Brief_v2.md and docs/phases/phase-05-theme-system.md as the source of truth.

Execute Phase 5 only. Implement resolved theme tokens and CSS custom property application for the existing browser UI. Keep the design framework-light and generic. Before the final review, update learnings/ if required. End by reviewing what happened and updating docs/phases/phase-06-adl-parser.md if required.
```

## Tasks

1. Review current theme-related model fields and the Phase 4 UI styling in `src/ui/styles.css`, `src/ui/components/adl-app.ts`, and `src/ui/demo-fixture.ts`.
2. Define or refine `ResolvedTheme` token coverage for:
   - primary color
   - accent color
   - surface and background colors
   - text colors
   - border color
   - radius
   - density
   - navigation preference if already modeled
3. Implement base themes:
   - `CorporateLight`
   - `CorporateDark`
   - `MinimalLight`
4. Add theme resolution so the app-level theme name maps to explicit theme tokens.
5. Extend the existing Phase 4 CSS custom property application in `adl-app` with tokens such as:

   ```css
   --adl-color-primary
   --adl-color-accent
   --adl-color-surface
   --adl-color-text
   --adl-radius
   ```

6. Remove hardcoded styling that should now be token-driven.
7. Add tests for theme lookup, default theme behavior, and invalid theme diagnostics if the validator supports them.
8. Verify the browser demo can switch themes by changing the resolved model.
9. Run typecheck, tests, and build.
10. Update `learnings/` if this phase produced reusable project knowledge, and update `learnings/index.md` with when future agents should read it.
11. Review what happened in this phase and update `docs/phases/phase-06-adl-parser.md` if the actual results require changed scope, constraints, deliverables, or tasks.
12. Commit all repository changes for this phase and push the current branch.
