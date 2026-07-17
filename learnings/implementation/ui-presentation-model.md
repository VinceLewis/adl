# UI Presentation Model

Phase 24 added the resolved-model foundation for composed UI presentation.

## Decisions

- Presentation is optional and lives on `ResolvedView.presentation`, not in a
  separate top-level model collection. Composed screens remain ordinary views.
- The presentation contract is renderer-neutral. It uses layout, density,
  sections, controls, list bindings, row fragments, icon maps, formatting, empty
  states, and shell regions, but no DOM tags, CSS selectors, framework
  component names, SVG paths, or browser event handlers.
- Resolver defaults are explicit: `stack` layout, `comfortable` density,
  `readModel` list source kind, `table` list rendering, `inline` row layout,
  `plain` text/field fragments, memory-backed local state, and empty
  empty-state text.
- Local presentation state is view-local data. It can be referenced by
  presentation filters and controls, but it is not an object field or durable
  business state.
- Presentation filters and conditional row fragments reuse `ResolvedExpression`.
  Validation checks expressions against list row fields plus local state.
- Presentation validation belongs in the resolved-model validator. Invalid list
  sources, row fields, icon maps, state references, command/view/context
  references, shell controls, formats, and supported-value enums produce
  structured `ADL_PRESENTATION_*` diagnostics.

## Practical Guidance

- Future parser work should compile UI syntax into the existing partial
  presentation types rather than adding parser-specific runtime structures.
- Future renderer work should consume `ResolvedView.presentation` only after
  model validation has run.
- Keep read models responsible for data shape and authorization; keep
  presentation responsible for display composition such as row text, icons,
  formatting, empty states, and section layout.
