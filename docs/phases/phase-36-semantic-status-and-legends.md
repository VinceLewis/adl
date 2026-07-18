# Phase 36 - Semantic Status and Legends

## Objective

Introduce semantic status presentation for feeds, grids, matrices, and calendars,
including legends, accessible labels, icons, colors, and precedence rules.

Giggle currently relies heavily on red/green/orange/purple cell styling and
icons. ADL should model the meaning first, then let themes and renderers decide
the visual expression.

## Scope

Add status presentation support:

- Named semantic statuses such as event, rehearsal, available, unavailable,
  busy elsewhere, conflict, and unset in reference fixtures.
- Status maps from row/cell values or read-model fields.
- Status precedence rules when multiple facts affect one visible cell.
- Legend declarations and renderer output.
- Accessible labels/tooltips for status icons and color-coded cells.
- Theme token mapping for statuses without hard-coded app colors.

This phase should not implement the availability matrix or calendar month
renderer yet. It provides the shared semantic layer they will consume.

## Design Constraints

- Status semantics belong in model/presentation/runtime data, not CSS class names.
- Colors and icons are theme/rendering choices. The status name is the stable
  contract.
- Accessibility labels are required wherever status is conveyed by color or icon.
- Read models may compute business-facing derived statuses; presentation maps
  those statuses to display.
- Status precedence must be deterministic and inspectable.

## Expected Deliverables

- Resolved presentation model additions for status maps and legends.
- Runtime presentation evaluation for status-bearing rows/cells.
- Browser rendering for legends and accessible status indicators.
- Theme token support for common semantic statuses.
- Tests for mapping, precedence, legend output, accessibility labels, and theme
  fallback behavior.
- Documentation updates for status semantics.

## Acceptance Criteria

- A compact feed row can expose a semantic status independent of its icon/color.
- A future grid/matrix/calendar cell can receive one resolved effective status
  from multiple candidate facts.
- Legends render from model data and match the statuses present in a view.
- Status indicators include accessible text or labels.
- Unsupported status/icon/theme mappings fall back predictably and report useful
  diagnostics where appropriate.
- `npm run typecheck`, full tests, `npm run format:check`, and `npm run build`
  pass.

## Suggested Codex Prompt

```text
Use ADL_Codex_Implementation_Brief_v2.md, docs/spec/ui-language-addendum.md, docs/phases/phase-29-ui-presentation-conformance-and-spec-hardening.md, learnings/implementation/ui-presentation-model.md, learnings/implementation/theme-system.md, learnings/implementation/read-model-runtime.md, and docs/phases/phase-36-semantic-status-and-legends.md as the source of truth.

Execute Phase 36 only. Add semantic status presentation and legends for renderer-neutral UI output, including status maps, deterministic precedence, accessible labels, and theme token mapping. Do not implement availability matrix or calendar renderers in this phase. Add tests, update docs/learnings, run full verification, commit, and push.
```

## Tasks

1. Inventory existing icon maps, theme tokens, row fragments, and formatting
   diagnostics.
2. Design status map, status precedence, and legend resolved model structures.
3. Add parser support if source syntax is included in this phase.
4. Add validation for duplicate statuses, invalid fields, and missing mappings.
5. Extend runtime presentation evaluation with status output.
6. Render legends and accessible status indicators in the browser.
7. Add conformance and browser tests for status behavior.
8. Update UI/spec/theme documentation.
9. Update learnings if reusable status guidance is produced.
10. Run typecheck, full tests, format check, and build.
11. Commit all repository changes for the phase and push the current branch.
