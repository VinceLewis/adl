# Phase 33 - Parent-Child Composed Edit Surfaces

## Objective

Support generic edit surfaces where a parent record and its related child
collections can be managed in one coherent workflow.

Giggle exposes this pattern repeatedly: event plus attached set lists, song plus
streaming links, set list plus songs, and band plus invitations/members. ADL
should provide a reusable model-driven shape rather than leaving each app to
hand-wire modals and child lists.

## Scope

Add parent-child edit composition:

- Parent form sections with embedded child collection sections.
- Child collection display inside modal, drawer, page, or split-pane edit
  containers from Phase 30.
- Child add, edit, remove, unlink, and reorder placeholders where supported by
  existing relationships and commands.
- Staged child changes for a new unsaved parent when immediate child writes are
  impossible.
- Renderer-neutral runtime output for composed edit surfaces.
- Browser rendering for at least one parent-child reference workflow.

This phase should not implement multi-select relationship pickers or atomic
multi-table commands unless a minimal hook is required for test fixtures. Those
are covered in later phases.

## Design Constraints

- Parent-child composition must be model-driven and relationship-aware.
- Do not encode Giggle-specific object names in renderer logic.
- The runtime must distinguish create-before-link, link-existing, create-child,
  and unlink/remove semantics.
- Staged child state must be explicit and inspectable; it must not silently write
  records before the parent save succeeds.
- Policy must be evaluated for both the parent action and each child operation.

## Expected Deliverables

- Resolved presentation model additions for composed edit sections.
- Runtime evaluation of parent-child edit surfaces.
- Browser rendering for embedded child collections in configured form
  containers.
- Tests for existing parent edit, new parent with staged children, child removal,
  policy-hidden child actions, and close/cancel behavior.
- Documentation explaining parent-child edit conventions and staged child
  semantics.

## Acceptance Criteria

- A parent form can include a related child collection without custom browser
  code.
- A new parent workflow can stage child links or child rows until the parent
  exists.
- Cancelling a new parent discards staged child changes.
- Saving a parent applies permitted staged child operations in deterministic
  order or reports a clear unsupported-command diagnostic.
- Existing parent records can show related child rows with policy-aware actions.
- The implementation does not bypass runtime validation, policy, audit, or sync
  gates.
- `npm run typecheck`, full tests, `npm run format:check`, and `npm run build`
  pass.

## Suggested Codex Prompt

```text
Use ADL_Codex_Implementation_Brief_v2.md, docs/spec/ui-language-addendum.md, docs/phases/phase-30-list-first-crud-and-edit-containers.md, docs/phases/phase-32-action-placement-and-command-aware-controls.md, learnings/implementation/ui-presentation-model.md, learnings/implementation/runtime-services.md, learnings/implementation/policy-engine.md, and docs/phases/phase-33-parent-child-composed-edit-surfaces.md as the source of truth.

Execute Phase 33 only. Add generic parent-child composed edit surfaces so a parent form can render and manage related child collections in the same form container. Support explicit staged child state for unsaved parents. Keep relationship picker multi-select and atomic multi-table command work out of scope except for minimal integration points. Add tests, update docs/learnings, run full verification, commit, and push.
```

## Tasks

1. Inventory existing relationship, command, constraint, and browser form
   support.
2. Design the resolved presentation structure for parent-child edit sections.
3. Add validation for invalid relationships, missing child views, and unsupported
   child operations.
4. Implement runtime evaluation for parent-child edit surfaces.
5. Implement browser rendering for embedded child collections.
6. Implement staged child state for unsaved parent records.
7. Add reference fixtures covering event/set-list or song/link style workflows
   without app-specific renderer branches.
8. Add focused runtime and browser tests.
9. Update docs and learnings if reusable guidance is produced.
10. Run typecheck, full tests, format check, and build.
11. Commit all repository changes for the phase and push the current branch.
