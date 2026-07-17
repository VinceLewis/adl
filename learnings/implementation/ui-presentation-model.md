# UI Presentation Model And Runtime

Phase 24 added the resolved-model foundation for composed UI presentation.
Phase 26 added renderer-neutral runtime evaluation for composed views.

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
- Presentation runtime evaluation is exposed through
  `ApplicationRuntime.evaluatePresentationView(...)`. Browser renderers should
  use this public API rather than binding lists or read models themselves.
- Evaluation order is state defaults, caller state, local state updates, list
  binding, presentation filters, presentation ordering, row fragments, icon
  maps, formatting, and empty states.
- List binding preserves runtime boundaries: object-backed lists call
  policy-enforcing `search`, and read-model-backed lists call
  `executeReadModel`. Presentation filters run only after those reads have
  applied authorization, context scoping, and read-model shaping.
- Row-template evaluation is read-only and returns typed renderer-neutral text
  and icon fragments, not DOM or HTML.
- The deterministic formatter intentionally starts small: date tokens like
  `EEE d MMM`, time tokens like `h:mma`, UTC datetime combinations, `plain`,
  `integer`, `fixed:N`, and `0.00`-style number patterns. Unsupported formats
  produce structured runtime diagnostics and fall back to raw values where
  possible.

## Practical Guidance

- Parser work should compile UI syntax into the existing partial presentation
  types rather than adding parser-specific runtime structures.
- Browser renderer work should consume `ApplicationRuntime.evaluatePresentationView`
  output. It should not query storage or execute read models directly to render
  composed presentation lists.
- Keep read models responsible for data shape and authorization; keep
  presentation responsible for display composition such as row text, icons,
  formatting, empty states, and section layout.
