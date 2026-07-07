# Phase 9 - Storage Upgrade

## Objective

Replace or supplement the in-memory store with browser local persistence behind a storage abstraction.

## Scope

Keep runtime services independent of the storage backend. Tests should continue to use in-memory storage, while the browser demo can use persistent local storage.

Recommended path: IndexedDB first if quickest, SQLite WASM plus OPFS later only if the runtime shape is stable and the added complexity is justified.

Phase 8 made lifecycle transitions explicit in audit events and operation log entries with `lifecycleAction`, `fromState`, and `toState`. Storage work must preserve that transition metadata and must not collapse transitions into ordinary update records.

## Expected Deliverables

- Stable storage abstraction if not already present
- In-memory store retained for tests
- IndexedDB-backed store or another justified browser-local persistent store
- Browser demo persistence across reloads
- Tests for storage abstraction behavior

## Acceptance Criteria

- Storage is swappable without changing runtime service logic.
- Tests can use in-memory storage.
- Browser demo persists records across reloads.
- Indexed/search fields are honored to the extent supported by the current model.
- Tombstones are supported instead of physical deletion for shared objects.
- Transition-specific audit and operation-log metadata remains intact if persisted.

## Suggested Codex Prompt

```text
Use ADL_Codex_Implementation_Brief_v2.md and docs/phases/phase-09-storage-upgrade.md as the source of truth.

Execute Phase 9 only. Add browser local persistence behind the existing storage abstraction while preserving in-memory tests. Do not implement full server sync. Before the final review, update learnings/ if required. End by reviewing what happened and updating docs/phases/phase-10-sync-policy-design.md if required.
```

## Tasks

1. Review the existing object store API and runtime assumptions.
2. Define or refine a backend-agnostic storage interface:

   ```ts
   export interface ObjectStore {
     create(...): Promise<RecordId>;
     read(...): Promise<Record | null>;
     update(...): Promise<void>;
     delete(...): Promise<void>;
     search(...): Promise<Record[]>;
   }
   ```

3. Make runtime services depend only on the storage interface.
4. Keep the in-memory implementation for unit tests.
5. Implement browser local persistence, preferably IndexedDB unless there is a strong reason to choose another option.
6. Add tombstone support for delete operations on objects that may later sync.
7. Ensure record metadata includes object schema version where needed.
8. Update the browser demo to use persistent storage.
9. Add tests for the storage interface using in-memory storage.
10. Add browser verification notes or tests proving reload persistence.
11. Run typecheck, tests, and build.
12. Update `learnings/` if this phase produced reusable project knowledge, and update `learnings/index.md` with when future agents should read it.
13. Review what happened in this phase and update `docs/phases/phase-10-sync-policy-design.md` if the actual results require changed scope, constraints, deliverables, or tasks.
14. Commit all repository changes for this phase and push the current branch.
