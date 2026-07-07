# Phase 11 - Model Versioning and Basic Migration Guard

## Objective

Prevent persisted local data from becoming ambiguous as object definitions evolve.

## Scope

Add basic model and schema version checks at runtime startup. Produce clear diagnostics for incompatible persisted records. Do not implement full migrations yet.

Phase 10 added an in-memory `SyncQueue` runtime service. Unless a later phase persists that queue, Phase 11 migration guards should focus on persisted object records and any explicit persisted application metadata, not transient sync queue entries.

## Expected Deliverables

- Runtime startup/version check logic
- Record schema version metadata support where needed
- Application model version handling
- Structured diagnostics for incompatible persisted data
- Tests for compatible and incompatible persisted records

## Acceptance Criteria

- Runtime stores or reads object `schemaVersion` with persisted records.
- Runtime stores or reads application `modelVersion`.
- Startup checks persisted records against the current model.
- Compatible records open normally.
- Incompatible records produce structured diagnostics.
- No full migration framework is introduced unless a minimal guard requires a small interface.

## Suggested Codex Prompt

```text
Use ADL_Codex_Implementation_Brief_v2.md and docs/phases/phase-11-model-versioning-and-migration-guard.md as the source of truth.

Execute Phase 11 only. Add basic model version and object schema version guards for persisted local data. Do not build a full migration framework. Before the final review, update learnings/ if required. End by reviewing what happened and updating docs/phases/phase-12-business-context-model.md if actual results show more work is required.
```

## Tasks

1. Review record metadata, storage implementation, resolved model version fields, validation diagnostics, and the Phase 10 sync queue persistence boundary.
2. Ensure persisted records carry object name and object schema version, or that equivalent metadata is reliably available.
3. Ensure persisted local storage records the application model version where needed.
4. Implement runtime startup checks that compare persisted metadata against the current `ResolvedApplicationModel`.
5. Return structured diagnostics for incompatible records or model versions.
6. Allow compatible records to open normally.
7. Avoid implementing full migrations; add only the smallest placeholder or interface if needed to keep diagnostics clean.
8. Add tests for compatible records, incompatible object schema version, and incompatible application model version.
9. Run typecheck, tests, and build.
10. Update `learnings/` if this phase produced reusable project knowledge, and update `learnings/index.md` with when future agents should read it.
11. Review what happened in this phase and update `docs/phases/phase-12-business-context-model.md` if the actual results require changed scope, constraints, deliverables, or tasks.
12. Commit all repository changes for this phase and push the current branch.
