# Phase 34 - Relationship Pickers and Multi-Select Linking

## Objective

Add generic relationship picker controls for selecting existing related records,
including multi-select, candidate filtering, exclusion of already-linked rows,
and deterministic append/link behavior.

This captures the Giggle set-list workflow where adding songs shows only songs
not already in the set list and lets the user select multiple songs at once.

## Scope

Implement relationship picker semantics:

- Single-select and multi-select related-record pickers.
- Candidate source declarations from object views or read models.
- Exclusion rules such as "not already linked to this parent".
- Search/filter/sort support for candidate lists.
- Batch link or append operations.
- Empty candidate states and duplicate-prevention diagnostics.
- Browser rendering suitable for modal/drawer parent-child flows.

This phase should not add calendar rendering, range availability editing, or
new offline write-queue behavior.

## Design Constraints

- Candidate filtering must run after policy and context scoping.
- Uniqueness must be enforced by model constraints/runtime services, not just by
  hiding candidates in the picker.
- Multi-select should produce a deterministic ordered result.
- Relationship pickers must not require app-specific browser code.
- Large candidate lists should have a path to search or lazy loading, even if
  the first implementation is in-memory for reference fixtures.

## Expected Deliverables

- Resolved model/presentation additions for relationship picker controls.
- Parser support for minimal picker syntax if included in this phase.
- Runtime evaluation of candidate lists with exclusion rules.
- Browser picker UI with multi-select and empty-state behavior.
- Tests for candidate filtering, already-linked exclusion, batch linking,
  duplicate rejection, ordering, and policy scoping.
- Documentation updates for relationship picker semantics.

## Acceptance Criteria

- A parent-child edit surface can show a picker of linkable child records.
- Multi-select can add several related rows in one action.
- Already-linked rows are excluded from the candidate list.
- Runtime constraints still reject duplicate links if a stale client attempts
  them.
- Candidate rows are sorted and rendered with a useful display label.
- Empty candidate state is clear and does not look like an error.
- `npm run typecheck`, full tests, `npm run format:check`, and `npm run build`
  pass.

## Suggested Codex Prompt

```text
Use ADL_Codex_Implementation_Brief_v2.md, docs/spec/ui-language-addendum.md, docs/phases/phase-33-parent-child-composed-edit-surfaces.md, learnings/implementation/ui-presentation-model.md, learnings/implementation/context-runtime.md, learnings/implementation/policy-engine.md, learnings/implementation/runtime-services.md, and docs/phases/phase-34-relationship-pickers-and-multi-select-linking.md as the source of truth.

Execute Phase 34 only. Add generic relationship picker controls with single-select, multi-select, policy-scoped candidate sources, exclusion of already-linked rows, and deterministic batch link/append behavior. Do not add calendar rendering, range availability editing, or offline write queues. Add tests, update docs/learnings, run full verification, commit, and push.
```

## Tasks

1. Inventory existing relationship, lookup, list, and command capabilities.
2. Design relationship picker declarations and resolved model shape.
3. Add validation for candidate sources, relationship targets, and exclusion
   references.
4. Implement runtime candidate evaluation after policy/context scoping.
5. Implement browser picker UI with multi-select.
6. Integrate picker output with parent-child edit surfaces.
7. Add tests for exclusion, duplicates, policy scoping, ordering, and empty
   candidates.
8. Update specs and learnings as needed.
9. Run typecheck, full tests, format check, and build.
10. Commit all repository changes for the phase and push the current branch.
