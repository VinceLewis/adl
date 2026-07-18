# Storage Backend Implementation

Read this before changing runtime persistence, object storage, browser demo seeding, sync replay storage, or tests that depend on persisted records.

## Key decisions from Phase 9

- `ObjectStore` remains the runtime service that enforces validation, policy, audit recording, operation-log recording, lifecycle commit semantics, and public read shaping.
- Raw persistence sits behind `ObjectStorageBackend` in `src/runtime/object-storage-backend.ts`. Backends store and return full `StoredObjectRecord` values, not masked public responses.
- `InMemoryObjectStorageBackend` is the default for `ApplicationRuntime` and unit tests.
- `IndexedDbObjectStorageBackend` is the browser-local persistent backend. It stores records in IndexedDB by object name and record guid, and filters search text over the runtime-provided search field list.
- Delete remains a tombstone write. Storage backends reject delete calls that do not include `meta.deletedAt`, and normal runtime reads/searches exclude tombstoned records unless `includeDeleted` is requested.
- Runtime-generated record ids use collision-resistant ids instead of per-runtime sequential ids so a new browser runtime does not overwrite records persisted before reload.
- Browser demo seeding uses `seedBrowserDemoRuntimeIfEmpty(...)`, checking for existing records including tombstones before inserting fixture data. This prevents duplicate fixture rows after reload.
- Phase 9 persisted object records only. Audit events and operation-log entries still live in their existing runtime services; transition metadata remains explicit when those services record lifecycle transitions.

## Key decisions from Phase 35

- `ObjectStorageBackend` can advertise transactional write support through `supportsTransactions` and `commitTransaction(...)`. This capability is required for multi-write runtime commands.
- `InMemoryObjectStorageBackend` applies transaction writes against cloned record maps and swaps only after all checks pass.
- `IndexedDbObjectStorageBackend` applies transaction writes through one IndexedDB `readwrite` transaction.
- Storage backends still persist only object records. Command intent, audit events, operation-log entries, sync queue behavior, policy, validation, and constraints remain runtime-service concerns above the backend.

## Practical guidance

- Keep future sync policy, replay, and migration checks above the backend unless they are pure persistence concerns. Policy enforcement should still happen before the backend write.
- Do not make browser UI components write to `ObjectStorageBackend` directly. UI workflows should continue to call `ApplicationRuntime`.
- If a future phase persists audit or operation-log data, preserve `operation: "transition"`, `lifecycleAction`, `fromState`, and `toState`; do not reclassify lifecycle transitions as ordinary updates.
