# Phase 26 - UI Presentation Runtime Evaluation

## Objective

Implement the runtime interpretation layer for composed presentation views:
local UI state, presentation filters, list data binding, row-template
evaluation, icon resolution, date/time formatting, and empty-state decisions.

This phase should produce renderer-ready view data from the resolved model. It
does not need to finish the browser DOM implementation, but it should give the
browser a clean generic API to render composed views.

## Scope

Build a presentation runtime service that can:

- Initialize local view state from resolved defaults.
- Apply view-local state updates.
- Bind composed list declarations to object searches or read-model results.
- Apply presentation `WHERE` filters over row values and local state.
- Apply list ordering where the list declaration owns presentation-level sort.
- Evaluate row templates into renderer-neutral fragments.
- Resolve icon maps from semantic values to icon names.
- Apply supported date, time, datetime, number, and text display formats.
- Determine empty-state output when a list has no visible rows.
- Return structured diagnostics for unsupported formats or missing data.

## Design Constraints

- The runtime must consume the resolved model, not ADL source or parser AST.
- Presentation filtering must not replace policy enforcement, context scoping,
  offline dataset rules, or read-model authorization.
- Formatting must be deterministic and cross-runtime-specifiable. Avoid locale
  behavior that cannot be described or tested.
- Row-template evaluation must be read-only. It must not mutate records or
  local state.
- Keep the output renderer-neutral. Avoid DOM nodes, HTML strings, CSS class
  names as semantics, or framework-specific component payloads.
- Preserve existing list/form behavior for non-composed views.

## Expected Deliverables

- A presentation runtime/evaluator module with typed renderer-ready output.
- Tests for local state initialization, toggle updates, list binding,
  presentation filters, row-template fragments, icon maps, formatting, ordering,
  and empty states.
- Integration tests using the Giggle Band resolved model from `ui.adl`.
- Runtime-semantics documentation for presentation evaluation order.
- Learning updates for presentation runtime behavior.

## Acceptance Criteria

- Given seeded Giggle Band event and invitation data, the presentation evaluator
  returns a home view with Welcome, Filters, Schedule, and Invitations sections.
- Toggling `showGigs`, `showRehearsals`, or `showUnavailable` changes visible
  Schedule rows without changing stored records.
- Schedule rows evaluate to fragment sequences equivalent to:
  date, separator, band name, separator, bold title, " at ", formatted time.
- Event type icon maps resolve to semantic icon names.
- Empty invitation data produces the configured empty text.
- Presentation filtering happens after runtime read authorization and read-model
  shaping.
- `npm run typecheck`, relevant runtime tests, `npm run format:check`, and
  `npm run build` pass.

## Suggested Codex Prompt

```text
Use ADL_Codex_Implementation_Brief_v2.md, docs/spec/ui-language-addendum.md, docs/phases/phase-24-ui-presentation-model-foundation.md, docs/phases/phase-25-ui-adl-parser-and-project-sources.md, learnings/implementation/browser-ui-runtime.md, learnings/implementation/read-model-runtime.md, learnings/implementation/expression-language.md, and docs/phases/phase-26-ui-presentation-runtime-evaluation.md as the source of truth.

Execute Phase 26 only. Implement a renderer-neutral presentation runtime/evaluator for composed views. It must initialize local view state, bind lists to objects or read models, apply presentation filters and ordering, evaluate row templates, resolve icon maps, apply supported date/time formats, and produce empty states. Do not build a browser-specific DOM renderer yet except for minor integration glue needed by tests. Add tests using the Giggle Band UI ADL resolved model, update runtime semantics docs and learnings, run verification, commit, and push.
```

## Tasks

1. Design renderer-ready output types for composed view sections, controls,
   lists, rows, fragments, icons, and empty states.
2. Implement local view state initialization and updates.
3. Bind presentation lists to object searches and read-model execution.
4. Evaluate presentation filters against row values and local state.
5. Evaluate row templates into typed fragments.
6. Implement icon-map resolution.
7. Implement the initial deterministic date/time formatting subset.
8. Add tests for the Giggle home view evaluator.
9. Update `docs/spec/runtime-semantics.md` and
   `docs/spec/ui-language-addendum.md`.
10. Update `learnings/` if the phase produces reusable project knowledge.
11. Run typecheck, relevant tests, format check, and build.
12. Commit all repository changes for the phase and push the current branch.
