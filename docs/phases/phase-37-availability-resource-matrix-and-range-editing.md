# Phase 37 - Availability Resource Matrix and Range Editing

## Objective

Add a generic resource/date matrix renderer and range-editing action pattern for
availability-style workflows.

The Giggle availability screen is not merely a calendar. It is a resource
planning matrix: rows are members, columns are dates, and cells combine persisted
availability with derived cross-context facts such as a member being busy because
they have a gig with another band.

## Scope

Implement a generic matrix presentation path:

- Row axis from people/resources/related records.
- Column axis from dates or other regular slots.
- Cell values from read-model fields or derived cell projections.
- Semantic status integration from Phase 36.
- Cell edit action for permitted users, including cycle behavior where declared.
- Range edit action for applying a status from date to date.
- Explicit handling for "blank/unset" as absence of a persisted row where the
  model declares that behavior.
- Cross-context derived status display with policy-shaped detail visibility.

This phase should not implement the calendar month renderer. It may share
date/slot utilities that a later calendar phase can reuse.

## Design Constraints

- Matrix cells must be backed by runtime/read-model data, not direct browser
  storage queries.
- Cross-context derived statuses must respect context-scoped roles and policies.
- A synthetic display status such as "busy elsewhere" must not be accidentally
  persisted as an enum value.
- Range editing must execute through runtime commands or validated object
  operations.
- Bulk changes must make offline/sync behavior explicit.

## Expected Deliverables

- Resolved presentation model support for matrix views.
- Runtime evaluation of row axis, column axis, and cells.
- Browser matrix renderer with status indicators, legends, and accessible labels.
- Cell cycle action support where declared.
- Range edit action and form/sheet for applying or clearing multiple dates.
- Tests for current-user editability, other-member read-only cells, derived
  cross-context statuses, unset-as-absence behavior, and range edits.
- Documentation updates for matrix and availability semantics.

## Acceptance Criteria

- A reference availability view can show all band members as rows and dates as
  columns.
- The current user's editable cells can cycle through declared states.
- Other users' cells are read-only unless policy grants broader rights.
- A member's commitment in another context can appear as a derived busy/conflict
  status without exposing forbidden details.
- A range action can set or clear availability over multiple dates.
- Blank/unset state is modeled as absence of a row when declared, not as a fake
  enum value.
- Status legend output comes from Phase 36 semantics.
- `npm run typecheck`, full tests, `npm run format:check`, and `npm run build`
  pass.

## Suggested Codex Prompt

```text
Use ADL_Codex_Implementation_Brief_v2.md, docs/spec/ui-language-addendum.md, docs/phases/phase-35-command-backed-multi-table-actions.md, docs/phases/phase-36-semantic-status-and-legends.md, learnings/implementation/context-runtime.md, learnings/implementation/read-model-runtime.md, learnings/implementation/offline-dataset-runtime.md, learnings/implementation/policy-engine.md, learnings/implementation/ui-presentation-model.md, and docs/phases/phase-37-availability-resource-matrix-and-range-editing.md as the source of truth.

Execute Phase 37 only. Add a generic resource/date matrix renderer and availability-style range editing. Support semantic statuses, current-user cell cycling where declared, unset-as-absence semantics, and policy-shaped cross-context derived statuses. Do not implement the calendar month renderer. Add tests, update docs/learnings, run full verification, commit, and push.
```

## Tasks

1. Inventory read-model, context, policy, sync, and presentation capabilities
   needed for matrix evaluation.
2. Design matrix declarations and resolved runtime output.
3. Add validation for axis sources, cell fields, status mappings, and edit
   actions.
4. Implement runtime matrix evaluation.
5. Implement browser matrix rendering with legends and accessible cell labels.
6. Implement declared cell cycling through runtime operations/commands.
7. Implement range edit action for setting and clearing multiple slots.
8. Add reference fixture data for multi-context busy/conflict cases.
9. Add conformance and browser tests.
10. Update docs and learnings as needed.
11. Run typecheck, full tests, format check, and build.
12. Commit all repository changes for the phase and push the current branch.
