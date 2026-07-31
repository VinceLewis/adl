# Semantic Status Presentation

Read this before changing status maps, status precedence, legends, or
status-colored browser presentation.

## Decisions

- Presentation statuses are semantic model data, not CSS classes. The status
  name is the stable contract, and an application may declare any name it likes.
- **The reserved names are the platform's own, and only those**: `event`,
  `available`, `unavailable`, `busyElsewhere`, `conflict`, `unset`. They are
  reserved because ADL itself has those concepts — the calendar and
  resource-matrix presentations are built on scheduling, availability and
  conflict. Anything else is an application's word and resolves to `colorInfo`.
- A view declares statuses, status maps, and legends on
  `ResolvedView.presentation`. Lists opt in through status candidates. This
  keeps the shared layer usable by future grids, matrices, and calendars without
  implementing those renderers early.
- Status candidates may be direct status names or map references over row data.
  When multiple candidates produce statuses, the evaluator picks the highest
  numeric precedence. Equal precedence resolves by the order of status
  declarations in the view.
- Status labels, accessibility labels, theme tokens, and precedence all resolve
  to explicit defaults. Unknown/custom status names default to `colorInfo`.
- Legends are evaluated from model declarations and default to statuses present
  in evaluated rows. `include: "all"` keeps every declared legend status.
- Browser rendering consumes runtime status output and maps `themeToken` to
  `--adl-color-status-*` CSS variables. It must include accessible labels for
  indicators that convey status by color or icon.
- Validation owns author errors for duplicate statuses/maps/legends, invalid
  fields, unknown status names, invalid precedence, and unsupported theme tokens.
  Runtime diagnostics cover runtime misses such as missing fields or unmapped
  values.

## Practical Guidance

- Prefer read models for business-derived status facts. Presentation status maps
  should map those stable values to display statuses rather than recomputing
  domain logic in the renderer.
- Use an explicit `unset` status or status-map default when a missing/false fact
  is expected and should not produce diagnostics.
- Do not hard-code app colors in components. Add or reuse resolved theme tokens,
  then expose them through the theme CSS-variable adapter.
- **Never add an application's status name to the reserved set or to the theme
  token union.** `rehearsal` was in both for eleven phases: a band's word sat in
  `ResolvedThemeTokens`, in the parser's `THEME` vocabulary, in the CSS variable
  set and in a conformance case that pinned it as contractual. Every other domain
  had no equivalent slot. It is now `colorStatusAlternate`, a second categorical
  colour with no domain meaning, and a status named `rehearsal` is ordinary
  application data that declares the token it wants. If a reference app seems to
  need a new reserved name, that is the signal the slot should be neutral.
