# Semantic Status Presentation

Read this before changing status maps, status precedence, legends, or
status-colored browser presentation.

**Where the code is (Phase 90).** Status and legend evaluation
(`evaluateStatusBinding`, `evaluateStatusCandidates`, `resolveStatus`,
`resolveStatusMapValue`, `evaluateLegends`) is
`src/runtime/presentation-runtime/status-runtime.ts`, and icon resolution
(`resolveIcon`, `resolveIconMapValue`) is its lower layer
`icon-runtime.ts` — not a single `presentation-runtime.ts` any more. Every
name below still exists with the same name and body — see
[[presentation-runtime-file-map]] for the full map.

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

## Key decisions from Phase 92: legend markup and the on-primary status ramp

- **A legend's `role="list"` must contain only `listitem` children.** The title
  used to be a bare `<div>` inside the same `role="list"` wrapper as the items,
  which is invalid ARIA *and* put the title in the same flex row as the
  swatches, so the title-to-first-item gap equalled the item-to-item gap.
  `renderLegends` now nests the items in their own
  `.adl-presentation-legend-items` list and leaves the title outside it.
  `tests/ui-runtime.test.ts` asserts the shape so it cannot silently revert.
- **Three gaps, deliberately distinct: 6 / 12 / 16.** Inside an item (swatch →
  icon → label), between items, and between the title and the first item. The
  trap on the way there: `.adl-presentation-status` carries
  `margin-right: var(--adl-space-xs)` for row use, which stacked on the legend
  item's own 6px gap and made swatch-to-label exactly as wide as
  item-to-item — so setting the item gap to 12px produced 12/12/16, which still
  reads ambiguously. The legend zeroes that margin.
- **A legend is not mandatory when the encoding is not colour-only.** Giggle
  Band's availability board dropped its legend rather than having it fixed:
  every status there carries a distinct colour *and* a distinct icon *and* an
  `ARIA_LABEL`, so the legend restated what each cell already said. A legend
  earns its place when colour alone distinguishes statuses.
- **A view-level `LEGEND` renders above the *first* section, always.** That is
  fine when the legend describes the first section's content and wrong when it
  describes a later one. `HomeDashboard` and both calendars are the former; the
  availability board was the latter, which is part of why removing it was right.
  If a future phase needs a section-scoped legend, that is a language addition,
  not a renderer tweak.
- **`--adl-color-status-*` is calibrated for the light content surface, not for
  the primary-coloured top bar.** Phase 92 added a small `--adl-color-on-primary-*`
  ramp (`ok`/`pending`/`alert`) for status dots that sit on the bar. Like the
  `--adl-color-status-*` ramp, these are stylesheet constants, **not** theme
  tokens: a declared `THEME` only ever sets the twelve colours in
  `THEME_COLOR_CSS_VARIABLES`, so anything else in `:root` is a constant a theme
  cannot reach.

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
