# Offline Dataset Runtime

Read this before changing context-aware offline dataset selection, dataset-limited local reads, or future remote sync planning.

## Key decisions from Phase 16

- Sync scopes now include context-aware values: `currentUser`, `currentContext`, and `allAvailableContexts`. Existing `assignedToUser`, `ownedByUser`, `all`, `recent`, and `custom` remain valid.
- `recent` sync scopes resolve to an inspectable default window of `_updatedAt` over 30 days when no explicit window is declared. Explicit windows can set `field`, `days`, and `limit`.
- `OfflineDatasetService` evaluates local dataset membership from active local records, object sync mode/scope, resolved context availability, and read-model source scopes. It returns record references and reasons, not raw readable records.
- Dataset membership is separate from authorization. `searchLocalDataset(...)` applies a dataset record filter through `ObjectStore.search(...)`, so search permission, row read permission, context scope checks, and field shaping still run in the normal runtime path.
- `onlineRequired` records are excluded from offline datasets, even if they exist in local storage. Normal runtime reads of such cached records may still succeed when policy allows them.
- `cacheReadonly` records may belong to the local dataset and be read locally, but local writes remain blocked by `SyncPolicyService`.
- `localPrivate` records are eligible for local datasets according to their declared sync scope, but they are still excluded from the sync queue by existing sync policy behavior.
- `allAvailableContexts` dataset evaluation resolves membership-derived context roles with the selected context removed for that business context. This lets cross-context read-model dependencies include all available context records without turning context roles into global roles.
- `currentContext` dataset evaluation uses the selected context only. If no relevant context is selected, context-scoped records do not match.
- `custom` sync scope has no runtime evaluator yet and contributes no records by default. A future phase should define a backend-neutral custom dataset expression before using it for real app behavior.

## Practical guidance

- Do not use dataset membership as proof that a user can read a record. Always route user-facing local reads through `ApplicationRuntime.searchLocalDataset(...)`, `ApplicationRuntime.read(...)`, `executeReadModel(...)`, or another policy-enforcing runtime service.
- When adding read-model behavior, remember that source scopes can expand the offline dataset beyond an object's own sync scope. This is deliberate when a dashboard declares cross-context inputs.
- Keep future remote authority responsibilities separate from `ObjectStorageBackend`. The local backend stores records; deciding what should be present locally belongs in runtime dataset/sync services.
