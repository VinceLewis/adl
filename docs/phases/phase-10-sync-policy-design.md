# Phase 10 - Sync Policy Design

## Objective

Make offline-first a runtime capability but not a global behavior applied blindly to every object.

## Scope

Implement model and runtime behavior for object-level sync classifications. Defer full server sync until local runtime behavior is stable.

Do not build a production sync server, conflict-resolution protocol, or remote API in this phase.

## Expected Deliverables

- Sync policy model support for all required modes
- Runtime enforcement of local write behavior by sync mode
- UI indication of offline or read-only state where practical
- Tests for sync-mode behavior

## Acceptance Criteria

- Model supports `LOCAL_FIRST`, `CACHE_READONLY`, `ONLINE_REQUIRED`, and `LOCAL_PRIVATE`.
- Runtime refuses local writes for online-required objects when offline.
- Runtime blocks local writes for cache-readonly objects.
- Runtime records local-first operations in the operation log.
- Runtime does not add local-private operations to the sync queue.
- UI can show offline or read-only state.
- Full server sync remains deferred.

## Suggested Codex Prompt

```text
Use ADL_Codex_Implementation_Brief_v2.md and docs/phases/phase-10-sync-policy-design.md as the source of truth.

Execute Phase 10 only. Implement object-level sync policy model and runtime behavior without building full server sync. Before the final review, update learnings/ if required. End by reviewing what happened and updating docs/phases/phase-11-model-versioning-and-migration-guard.md if required.
```

## Tasks

1. Review current sync model fields, operation log behavior, storage metadata, and UI offline state.
2. Ensure the model supports:
   - `LOCAL_FIRST`
   - `CACHE_READONLY`
   - `ONLINE_REQUIRED`
   - `LOCAL_PRIVATE`
3. Implement runtime behavior:
   - `LOCAL_FIRST`: allow local writes and record operations
   - `CACHE_READONLY`: allow local reads and block local writes
   - `ONLINE_REQUIRED`: block local offline operations
   - `LOCAL_PRIVATE`: allow local writes and exclude from sync queue
4. Add context support for online/offline state if not already present.
5. Ensure policy enforcement still applies before sync-mode behavior permits writes.
6. Add tests for each sync mode.
7. Add UI indication for offline/read-only state where practical.
8. Run typecheck, tests, and build.
9. Update `learnings/` if this phase produced reusable project knowledge, and update `learnings/index.md` with when future agents should read it.
10. Review what happened in this phase and update `docs/phases/phase-11-model-versioning-and-migration-guard.md` if the actual results require changed scope, constraints, deliverables, or tasks.
11. Commit all repository changes for this phase and push the current branch.
