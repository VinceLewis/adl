# Phase 31 - Shell Navigation Metadata and Mobile Context Controls

## Objective

Turn the browser shell convention into an inspectable model-backed contract for
navigation, shell actions, and business-context controls.

Phase 29 documented that the browser now has a generic hamburger drawer but ADL
`SHELL`, `TOP_BAR`, and `NAV_DRAWER` syntax are not yet implemented end to end.
This phase closes that gap for the practical shell behavior already proven by
the Giggle reference app.

## Scope

Add model-driven shell and navigation metadata:

- Nav labels, icons, grouping, ordering, and active-state metadata for views.
- Conditional nav/action visibility driven by policy or runtime context, not
  app-specific browser checks.
- Top-bar business context selector placement.
- Mobile context selector behavior that renders a compact label and selection
  modal/sheet rather than a raw cramped dropdown.
- Shell-level controls for supported runtime capabilities where present: theme
  switch, logout, PWA install prompt, and sync/offline status.
- Inspection/explain output for shell defaults and references.

This phase should not implement new business workflows. It should make shell
structure declarative and generic.

## Design Constraints

- Shell declarations must resolve into renderer-neutral model data.
- Browser shell rendering must not read ADL syntax or parser AST nodes directly.
- Auth-aware visibility is a runtime policy/context concern; hiding a nav item in
  the UI must not be treated as enforcement.
- Context selectors remain business-context controls, not arbitrary filter
  widgets.
- PWA/theme/logout controls should be optional runtime capabilities and should
  degrade cleanly when unavailable.

## Expected Deliverables

- Resolved shell/navigation metadata with explicit defaults.
- Parser support for the minimal shell/nav syntax if chosen for this phase.
- Browser drawer rendering from resolved shell/nav metadata.
- Mobile context selector modal/sheet behavior.
- Tests for nav labels, ordering, grouping, icons, active state, visibility, and
  mobile context selection.
- Inspect/spec updates for shell metadata.
- Learning updates for shell/navigation conventions.

## Acceptance Criteria

- The browser drawer renders from resolved shell/nav metadata rather than only
  object/view enumeration.
- View labels and icons can differ from raw view names.
- Nav items can be ordered and grouped.
- Runtime visibility can hide/show shell controls without weakening policy
  enforcement.
- Business context selectors use a mobile-friendly modal/sheet when viewport
  space is constrained.
- The Giggle reference app can express Home, Gigs, Availability, Songs, Set
  Lists, and Bands navigation labels without app-specific browser branches.
- `npm run typecheck`, full tests, `npm run format:check`, and `npm run build`
  pass.

## Suggested Codex Prompt

```text
Use ADL_Codex_Implementation_Brief_v2.md, docs/spec/ui-language-addendum.md, docs/phases/phase-29-ui-presentation-conformance-and-spec-hardening.md, learnings/implementation/context-ui-navigation.md, learnings/implementation/ui-presentation-model.md, learnings/implementation/browser-ui-runtime.md, and docs/phases/phase-31-shell-nav-metadata-and-mobile-context-controls.md as the source of truth.

Execute Phase 31 only. Add resolved shell/navigation metadata for labels, icons, grouping, ordering, active state, context controls, and optional shell controls such as theme/logout/PWA/sync status where the runtime supports them. Render the browser drawer and mobile context selector from the resolved contract. Do not add new business workflows. Add tests, update specs/learnings, run full verification, commit, and push.
```

## Tasks

1. Inventory existing shell, drawer, context selector, theme, and sync-state
   model/runtime support.
2. Design the minimal resolved shell/nav metadata contract.
3. Add parser support if source syntax is included in the phase.
4. Update model validation for invalid nav targets, duplicate orders, invalid
   icon references, and unsupported shell controls.
5. Render the browser drawer from shell/nav metadata.
6. Implement mobile-friendly context selector behavior.
7. Add tests for shell resolution, validation, rendering, and context selection.
8. Update `docs/spec/ui-language-addendum.md` and core specs where needed.
9. Update learnings if reusable shell guidance is produced.
10. Run typecheck, full tests, format check, and build.
11. Commit all repository changes for the phase and push the current branch.
