# Model Versioning Guard

Read this before changing runtime startup checks, object storage metadata, persisted record compatibility, or future migration handling.

## Key decisions from Phase 11

- `ApplicationRuntime` now has an async startup boundary exposed through `whenReady()`. Public runtime operations await it before CRUD, search, or lifecycle work.
- `ObjectStore` also receives the startup guard, so direct store calls through `runtime.objectStore` cannot bypass persisted-data compatibility checks.
- `ObjectStorageBackend` is still object-record persistence, but now also exposes the minimal metadata/enumeration surface needed by startup checks: list persisted records, read application metadata, and write application metadata.
- Persisted application metadata currently stores `modelVersion` only. The IndexedDB backend keeps this metadata in the existing object store under an internal metadata key instead of adding a migration framework or separate database schema.
- Startup diagnostics are runtime diagnostics, not resolved-model validation diagnostics. Model validation checks the current resolved model; startup compatibility checks persisted local data against that model.
- Explicit persisted `modelVersion` mismatches are blocking errors. Missing application metadata on otherwise compatible older records is a warning and is backfilled after compatibility checks pass.
- Persisted records are checked by stored object name, record metadata object name, and `meta.schemaVersion`. Schema mismatches, unknown object references, and object metadata mismatches block startup with `RuntimeStartupError`.

## Practical guidance

- Future migrations should build on the startup guard rather than bypassing it in UI or storage backend code.
- Keep full migration planning separate from this guard. Phase 11 intentionally added diagnostics and metadata checks only.
- If future phases persist sync queues, audit events, or operation logs, add their compatibility checks as explicit runtime persistence concerns instead of folding protocol state into object records.
