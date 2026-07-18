# Phase 32 - Action Placement and Command-Aware Controls

## Objective

Let views declare where important actions appear and bind those controls to
runtime commands or navigation targets.

This phase makes actions visible in the places users naturally expect them:
home/dashboard quick actions, list create actions, row actions, calendar-cell
actions later, and shell/global actions where appropriate.

## Scope

Add generic action placement support:

- View-level primary and secondary actions.
- Section-level actions for composed views.
- Row-level actions for list/feed/table rows.
- Navigation actions that open another view.
- Command actions that call existing runtime command paths.
- Policy-aware enabled/disabled/hidden states using runtime decisions.
- Presentation runtime output for action controls without DOM-specific payloads.

This phase should not implement parent-child edit surfaces, relationship
pickers, availability range editing, or calendar rendering. It prepares the
action system those later phases will use.

## Design Constraints

- A visible button is not authorization. The command service and server-side
  authority path must still enforce policy.
- Action placement is presentation metadata; command semantics remain runtime
  behavior.
- Renderer-neutral output must describe action intent, label, icon, state, and
  target. It must not contain JavaScript callbacks or HTML strings.
- Actions should work for normal CRUD views and composed views.
- Defaults must remain explicit and inspectable.

## Expected Deliverables

- Resolved presentation model additions for action controls and action placement.
- Parser support for the minimal action syntax if included in this phase.
- Runtime presentation evaluation for view, section, and row actions.
- Browser rendering for command/navigation actions.
- Tests for policy-shaped visibility/enabled states and action dispatch.
- Documentation updates for action placement and command binding.

## Acceptance Criteria

- A composed home dashboard can declare a primary "Add Event" style action
  without custom browser code.
- A normal list view can declare create/edit/delete or navigation actions in a
  list-first UI.
- Action visibility/enabled state is shaped by runtime policy decisions.
- Navigation actions can move to another view while preserving relevant context.
- Command actions use runtime services rather than direct storage mutation from
  UI components.
- Inspect/explain output shows action defaults and references.
- `npm run typecheck`, full tests, `npm run format:check`, and `npm run build`
  pass.

## Suggested Codex Prompt

```text
Use ADL_Codex_Implementation_Brief_v2.md, docs/spec/ui-language-addendum.md, docs/spec/runtime-semantics.md, docs/phases/phase-30-list-first-crud-and-edit-containers.md, docs/phases/phase-31-shell-nav-metadata-and-mobile-context-controls.md, learnings/implementation/runtime-services.md, learnings/implementation/policy-engine.md, learnings/implementation/ui-presentation-model.md, and docs/phases/phase-32-action-placement-and-command-aware-controls.md as the source of truth.

Execute Phase 32 only. Add model-driven action placement for view, section, and row actions, with renderer-neutral runtime output and browser controls bound to navigation or existing runtime commands. Keep policy enforcement in runtime services. Do not implement parent-child edit surfaces, relationship pickers, range availability, or calendar rendering. Add tests, update docs/learnings, run full verification, commit, and push.
```

## Tasks

1. Inventory existing command declarations and browser action handling.
2. Design action placement additions for the resolved presentation model.
3. Add parser support if this phase includes source syntax.
4. Extend validation for invalid command, view, context, and icon references.
5. Extend presentation evaluation to return action controls.
6. Render actions in browser list-first and composed-view surfaces.
7. Add tests for view, section, row, navigation, and command actions.
8. Update specs and inspect/explain output.
9. Update learnings if reusable action guidance is produced.
10. Run typecheck, full tests, format check, and build.
11. Commit all repository changes for the phase and push the current branch.
