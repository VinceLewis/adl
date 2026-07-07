# Phase 4 - Browser UI Runtime

## Objective

Render standard business UI from a resolved model using the runtime, without per-object hand-written UI.

## Scope

Build a minimal browser demo using Web Components or Lit, following the implementation stack in the brief. UI visibility and editability must use the same runtime policy engine that enforces operations.

Do not build the ADL parser, persistent storage upgrade, or full theme system in this phase. Theme tokens may be consumed if already available.

## Expected Deliverables

- Browser entry point and demo fixture model
- `src/ui/components/adl-app.ts`
- `src/ui/components/adl-list-view.ts`
- `src/ui/components/adl-form-view.ts`
- `src/ui/components/adl-field-renderer.ts`
- `src/ui/components/adl-action-bar.ts`
- `src/ui/components/adl-message-area.ts`
- Tests or browser verification notes for key workflows

## Acceptance Criteria

- A hardcoded resolved model renders a working `User` list and form.
- Search, select row, new, edit, save, delete, and lifecycle actions work through `ApplicationRuntime`.
- Field validation messages are visible.
- Field policy can make a field readonly, hidden, or masked.
- Lifecycle actions appear or disappear based on policy and state.
- Runtime still enforces policy when UI behavior is bypassed by tests.

## Suggested Codex Prompt

```text
Use ADL_Codex_Implementation_Brief_v2.md and docs/phases/phase-04-browser-ui-runtime.md as the source of truth.

Execute Phase 4 only. Build the minimal browser UI runtime over the existing resolved model and runtime services. Do not build the ADL parser or storage upgrade. Start the dev server if the app needs one, verify the UI. Before the final review, update learnings/ if required. End by reviewing what happened and updating docs/phases/phase-05-theme-system.md if required.
```

## Tasks

1. Review existing runtime APIs and adapt UI design to the runtime facade instead of bypassing services.
2. Choose Web Components or Lit based on current project dependencies and keep the runtime framework-light.
3. Create a browser demo that loads a hardcoded resolved model and seeded data.
4. Implement `adl-app` to coordinate model, runtime, selected view, selected record, messages, and commands.
5. Implement `adl-list-view` with search, rows, row selection, and new action.
6. Implement `adl-form-view` with generated fields, save, delete, cancel, validation display, and lifecycle action area.
7. Implement `adl-field-renderer` for text, number, date, datetime, time, boolean, lookup placeholder, and attachment placeholder if represented by the model.
8. Implement `adl-action-bar` for primary actions and lifecycle actions.
9. Implement `adl-message-area` for validation, policy, and runtime diagnostics.
10. Ensure UI asks policy engine for visibility, readonly, hidden, and masked behavior.
11. Add test coverage where practical and manually verify the demo in the browser.
12. Run typecheck, tests, and any build command.
13. Update `learnings/` if this phase produced reusable project knowledge, and update `learnings/index.md` with when future agents should read it.
14. Review what happened in this phase and update `docs/phases/phase-05-theme-system.md` if the actual results require changed scope, constraints, deliverables, or tasks.
15. Commit all repository changes for this phase and push the current branch.
