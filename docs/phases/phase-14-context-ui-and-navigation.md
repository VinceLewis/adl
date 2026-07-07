# Phase 14 - Context UI and Navigation

## Objective

Add generic browser UI support for selecting and displaying the current business context, and for routing standard views through that context.

For the band-management reference app, this means a user with multiple bands can select the active band, band-scoped pages use that selection, and cross-band pages can deliberately opt out of it.

## Scope

Implement generic UI/runtime integration for context selection and context-aware view rendering. Keep this model-driven and reusable; do not hand-code a band-specific navigation shell.

Do not implement a specialised calendar view. Dated event workflows should use date/datetime field inputs and list/detail/dashboard views unless a later phase proves a richer generic view is necessary.

## Expected Deliverables

- Generic context selector component or equivalent UI integration
- Context-aware view loading
- Context persistence according to the resolved model declaration
- UI states for zero, one, and many available contexts
- Tests or browser verification for context selection behaviour

## Acceptance Criteria

- If no context is available and a view requires one, the UI shows a clear empty state.
- If exactly one context is available and the model allows auto-selection, the UI can select it.
- If multiple contexts are available, the UI lets the user choose.
- A stored/route-provided context that is no longer valid is rejected or cleared.
- Context-scoped list/form views pass the selected context to runtime calls.
- Cross-context views do not accidentally inherit the selected context when their model says they span all available contexts.
- Existing non-context demos still work.

## Suggested Codex Prompt

```text
Use ADL_Codex_Implementation_Brief_v2.md, learnings/architecture/business-contexts-and-backends.md, docs/phases/phase-13-context-runtime-and-policy.md, and docs/phases/phase-14-context-ui-and-navigation.md as the source of truth.

Execute Phase 14 only. Add generic context selection and context-aware view navigation to the browser runtime. Do not build a band-specific UI, calendar widget, server sync, or PostgreSQL backend. Before the final review, update learnings/ if required. End by reviewing what happened and updating docs/phases/phase-15-read-models-and-dashboards.md if required.
```

## Tasks

1. Review Phase 13 runtime context APIs, UI runtime components, policy presentation, sync presentation, and browser demo setup.
2. Add a generic context selector or context state service for the browser UI.
3. Honour context selection policy declarations such as no persistence, session persistence, local persistence, route source, and runtime source where implemented.
4. Add UI handling for zero, one, and many available contexts.
5. Ensure scoped views call runtime methods with the selected context.
6. Ensure all-available-context views call runtime methods with an explicit cross-context mode rather than leaking the selected context.
7. Add browser demo fixture data for a small context example.
8. Add tests where practical, and add browser verification notes if full UI automation is not yet available.
9. Run typecheck, tests, and build.
10. Update `learnings/` if this phase produced reusable project knowledge, and update `learnings/index.md` with when future agents should read it.
11. Review what happened in this phase and update `docs/phases/phase-15-read-models-and-dashboards.md` if actual results require changed scope, constraints, deliverables, or tasks.
12. Commit all repository changes for this phase and push the current branch.
