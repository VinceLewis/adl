# Phase 16 - Context-Aware Offline Datasets

## Objective

Define and implement local offline dataset boundaries for context-scoped applications.

For the band-management reference app, this means the local runtime can distinguish user-level data, per-band data, and cross-band dashboard/read-model data without assuming every object is copied everywhere.

## Scope

Extend sync policy and local storage usage to understand context-aware dataset selection. Keep the implementation local-first and backend-neutral. Do not build a production sync server or require PostgreSQL.

This phase should clarify what would need to sync later, but it should not commit ADL to a specific remote transport or server database.

## Expected Deliverables

- Context-aware dataset/sync declaration shape
- Runtime helpers for determining which local records belong in a user's offline dataset
- Local storage tests for scoped dataset reads/writes
- Documentation of deferred remote-sync responsibilities

## Acceptance Criteria

- The model can express user-level data, current-context data, all-available-context data, and local-private data.
- Runtime dataset selection respects object sync mode and object scope.
- Local reads can be limited to records in the declared dataset.
- Local writes still pass policy, lifecycle, validation, and sync-mode gates.
- No PostgreSQL-specific schema or server sync protocol is introduced.
- The plan for future remote authority remains explicit and backend-neutral.

## Suggested Codex Prompt

```text
Use ADL_Codex_Implementation_Brief_v2.md, learnings/architecture/business-contexts-and-backends.md, learnings/implementation/sync-policy.md, docs/phases/phase-15-read-models-and-dashboards.md, and docs/phases/phase-16-context-aware-offline-datasets.md as the source of truth.

Execute Phase 16 only. Add context-aware local offline dataset selection while keeping sync backend-neutral. Do not build a production sync server, PostgreSQL backend, or band app. Before the final review, update learnings/ if required. End by reviewing what happened and updating docs/phases/phase-17-band-app-reference.md if required.
```

## Tasks

1. Review object sync modes, operation log, sync queue, storage backend, context model, and read-model behaviour.
2. Define dataset declarations or sync-scope extensions for:
   - current user
   - current context
   - all available contexts
   - recent/windowed records
   - local private records
3. Implement runtime helpers to evaluate dataset membership for local records.
4. Ensure dataset evaluation is separate from policy authorization.
5. Add tests for dataset selection across multiple contexts.
6. Add tests proving cache-readonly and online-required behaviour still applies.
7. Document what a future remote sync service must provide without selecting PostgreSQL as a requirement.
8. Run typecheck, tests, and build.
9. Update `learnings/` if this phase produced reusable project knowledge, and update `learnings/index.md` with when future agents should read it.
10. Review what happened in this phase and update `docs/phases/phase-17-band-app-reference.md` if actual results require changed scope, constraints, deliverables, or tasks.
11. Commit all repository changes for this phase and push the current branch.
