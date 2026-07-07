# Phase 15 - Read Models and Dashboards

## Objective

Implement backend-neutral read models and composite dashboards for cross-object and cross-context views.

For the band-management reference app, this enables a home dashboard that combines upcoming gigs, rehearsals, availability, and invitations across all bands available to the user without requiring bespoke SQL or a calendar widget.

## Scope

Implement a small read-model/query runtime over the local storage abstraction and render results through generic list/dashboard components. The first target is an event-list style dashboard grouped or sorted by date.

Phase 14 added generic view navigation and active-view context resolution in the browser runtime. Read-model/dashboard rendering should reuse that context path: required-context dashboards use the selected context, while `context.mode: "all"` dashboards must resolve all available context roles and must not inherit `selectedContexts[contextName]`.

Do not implement arbitrary SQL, PostgreSQL materialised views, a production reporting engine, or specialised calendar/scheduler UI in this phase.

## Expected Deliverables

- Runtime query/read-model execution for the Phase 12 declaration shape
- Cross-context query support using Phase 13 context enforcement
- Generic dashboard/list rendering for read-model results
- Tests for query filtering, projection, sorting, and policy enforcement

## Acceptance Criteria

- A read model can project fields from one or more source objects.
- A read model can run within the current context or across all available contexts.
- Query results are filtered by runtime policy and context scope.
- A dashboard can render read-model results as a dense event list sorted by date/time.
- The implementation does not embed SQL in ADL source.
- Existing list/form views remain unaffected.

## Suggested Codex Prompt

```text
Use ADL_Codex_Implementation_Brief_v2.md, learnings/architecture/business-contexts-and-backends.md, docs/phases/phase-14-context-ui-and-navigation.md, and docs/phases/phase-15-read-models-and-dashboards.md as the source of truth.

Execute Phase 15 only. Add backend-neutral read-model execution and generic dashboard/list rendering for cross-object and cross-context views. Do not add SQL escape hatches, PostgreSQL-specific implementation, calendar widgets, server sync, or the full band app. Before the final review, update learnings/ if required. End by reviewing what happened and updating docs/phases/phase-16-context-aware-offline-datasets.md if required.
```

## Tasks

1. Review read-model declarations from Phase 12, context enforcement from Phase 13, UI context handling from Phase 14, and `learnings/implementation/context-ui-navigation.md`.
2. Define a minimal runtime query service that can execute declared read models over local object storage.
3. Support source filtering by:
   - current context
   - all available contexts
   - current user
4. Support projection, sorting, and simple derived labels only where the resolved model declares them.
5. Ensure read-model execution applies policy and field shaping consistently with object reads/searches.
6. Add a generic dashboard/list renderer for read-model rows.
7. Add tests for cross-context filtering and policy-shaped query output.
8. Add an event-list fixture that proves dated records render densely without a calendar grid.
9. Run typecheck, tests, and build.
10. Update `learnings/` if this phase produced reusable project knowledge, and update `learnings/index.md` with when future agents should read it.
11. Review what happened in this phase and update `docs/phases/phase-16-context-aware-offline-datasets.md` if actual results require changed scope, constraints, deliverables, or tasks.
12. Commit all repository changes for this phase and push the current branch.
