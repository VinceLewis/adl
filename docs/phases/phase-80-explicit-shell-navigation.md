# Phase 80 — Explicit shell navigation

## Objective

Make shell navigation a deliberate application contract. A view declaration
must not become a user-facing drawer entry unless the application lists it, or
the application explicitly opts into generated entries for unlisted views.

## Decision

- The resolved navigation mode is `explicitOnly | includeUnlistedViews`.
- Omitting the mode resolves to `explicitOnly`.
- ADL authors opt into the legacy generated behavior with
  `NAV_MODE INCLUDE_UNLISTED_VIEWS`.
- `.adlj` authors express the same opt-in as
  `"mode": "includeUnlistedViews"` under `shell.nav`.
- Explicit items always retain their declared metadata. In opt-in mode, only
  views without an explicit item receive generated entries.
- An empty navigation drawer renders no drawer or menu button unless visible
  drawer controls still need that surface.

## Scope

1. Extend partial and resolved model types, ADL AST/parser/printer, `.adlj`
   schema, resolution, validation, and inspection.
2. Keep the generic browser demo on generated navigation through an explicit
   opt-in.
3. Let curated reference applications use the new default and verify that raw
   implementation views no longer leak into their drawer.
4. Document both default and opt-in behavior in the language, `.adlj`, and
   resolved-model specifications.
5. Add parser, compiler, resolver, validator, schema, runtime, and reference-app
   regression coverage.

## Acceptance criteria

- A shell with declared `NAV` items and no mode resolves to exactly those
  items.
- A shell with no `NAV` items and no mode resolves to an empty item list.
- `NAV_MODE INCLUDE_UNLISTED_VIEWS` restores generated navigation entries for
  every unlisted view.
- Explicit entries override generated metadata for the same view.
- ADL and `.adlj` round trips preserve an explicitly declared mode.
- Giggle Band shows only its curated navigation entries.
- A shell with neither visible navigation items nor visible drawer controls
  has no hamburger or empty drawer.
- Documentation contains working examples of both modes.

## Verification

- Compile-check all changed ADL/ADLJ examples.
- Run focused parser/compiler/resolver/validator/UI/reference-app tests.
- Run `npm run generate:adlj-schema` and verify the checked-in schema.
- Run `npm run verify:push` and inspect the generated desktop and mobile
  screenshots before commit.

## Execution note

This phase was requested directly after the generated Giggle Band drawer
entries exposed the old implicit-navigation default. There is no rolling next
phase handoff; further work remains user-directed.

## Completion review

- `npm run verify:push` passed: typecheck, formatting, 58 test files / 1,061
  tests, production build, and 44 Playwright desktop/mobile tests.
- The generated Giggle Band drawer screenshots were inspected. They contain
  only the 11 declared destinations; unlisted profile, member, invitation,
  event-form, child-list, projection, and preference views are absent, with no
  label/subtitle overlap or horizontal overflow.
- The documentation examples for default and opt-in navigation were
  compile-checked through `compileAdl` and `compileAdlj` in a throwaway Vitest
  file, which was removed before completion.
- No later phase document needed revision. The next phase remains
  user-directed.
