# Phase 30 - List-First CRUD and Edit Containers

## Objective

Make the generic browser CRUD experience list-first by default, with edit/create
forms opened from explicit user actions instead of always occupying a permanent
side-by-side pane.

The current split list/form surface was useful as an implementation scaffold for
runtime validation, policy, and persistence. This phase turns it into one
presentation option rather than the default convention for application users.

## Scope

Refine the generic object-view browser renderer:

- Render normal list views as a primary list/table surface.
- Open create/edit forms from list actions, row selection, or explicit "new"
  controls.
- Add resolved-model/presentation support for inspectable edit container hints:
  modal, drawer, page, or split pane.
- Preserve the existing split-pane behavior as an explicit or fallback option
  for dense back-office workflows.
- Ensure composed views can continue to render independently from CRUD object
  views.
- Make mobile behavior sane: form containers should not require side-by-side
  space.

This phase should not implement parent-child editing, relationship pickers,
calendar grids, or new command semantics. It should only fix the generic CRUD
interaction shape and make the form container convention explicit.

## Design Constraints

- The runtime still consumes the resolved model, not parser AST nodes.
- Do not add app-specific Giggle branches to browser components.
- Do not make modal, drawer, page, or split-pane behavior depend on raw CSS
  selectors or framework component names in the model.
- Policy visibility and form editability must continue to come from runtime
  policy decisions.
- Split-pane remains available, but it must not be the implicit default for all
  applications.

## Expected Deliverables

- Updated browser CRUD renderer with list-first default behavior.
- Resolved-model or presentation metadata for edit container mode, with explicit
  defaults.
- Parser support only if needed for the chosen syntax; otherwise document the
  model-level capability as fixture-only until syntax is added.
- Tests proving row click, create action, save, cancel/close, and return-to-list
  behavior.
- Regression coverage proving split-pane remains available when explicitly
  selected.
- Documentation updates describing CRUD presentation conventions.
- Learning updates if the phase establishes reusable browser UI guidance.

## Acceptance Criteria

- A normal object list opens without a permanently visible form beside it.
- Clicking a row opens the edit form in the configured/default container.
- A create action opens a blank form in the configured/default container.
- Closing or saving the form returns the user to the originating list context.
- Split-pane behavior is still available through an explicit configuration path.
- Mobile viewport tests show the list and form container are usable without
  horizontal overflow.
- Existing policy, validation, lifecycle, storage, and composed-view tests still
  pass.
- `npm run typecheck`, full tests, `npm run format:check`, and `npm run build`
  pass.

## Suggested Codex Prompt

```text
Use ADL_Codex_Implementation_Brief_v2.md, docs/spec/ui-language-addendum.md, docs/phases/phase-29-ui-presentation-conformance-and-spec-hardening.md, learnings/implementation/browser-ui-runtime.md, learnings/implementation/ui-presentation-model.md, learnings/implementation/policy-engine.md, and docs/phases/phase-30-list-first-crud-and-edit-containers.md as the source of truth.

Execute Phase 30 only. Change the generic browser CRUD surface so list views are list-first by default, and create/edit forms open from explicit actions in an inspectable form container mode such as modal, drawer, page, or split pane. Preserve split-pane as an explicit option. Do not implement parent-child editing, relationship pickers, calendars, or new command semantics. Add tests, update docs and learnings as needed, run full verification, commit, and push.
```

## Tasks

1. Inventory current list/form browser rendering and tests.
2. Define the resolved-model/default representation for edit container mode.
3. Implement list-first rendering for normal CRUD views.
4. Add create/edit open, save, close, and return-to-list interactions.
5. Preserve split-pane behavior behind explicit configuration.
6. Add responsive tests or browser checks for mobile form containers.
7. Update UI docs to distinguish list-first default from split-pane mode.
8. Add or update learnings if reusable UI runtime guidance is produced.
9. Run typecheck, full tests, format check, and build.
10. Commit all repository changes for the phase and push the current branch.
