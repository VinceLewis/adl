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

## What Phase 51 changed

Phase 11's "future migrations" are no longer future. `model-versions-and-migrations.md`
is now the primary document for anything version- or migration-shaped; read it
first and treat the notes below as the history that led to it.

- Persisted application metadata now carries `modelFingerprint` alongside
  `modelVersion`. It is optional, because state written before fingerprints
  existed has none: a missing value is warned about and backfilled, a present
  value that disagrees at an unchanged version is a refusal.
- The guard migrates as well as checks, and does so **before** the per-record
  schema-version checks, which is what makes migration reachable at all.
- Migration is opt-in per caller (`{ applyMigrations: true }`), so asking whether
  state is readable never rewrites it.

## Practical guidance

- Migrations build on the startup guard rather than bypassing it in UI or storage
  backend code. Both the browser runtime and the authority entrypoint route
  through `runRuntimeStartupCompatibilityChecks`; there is no second versioning
  scheme and there must not be one.
- If future phases persist sync queues, audit events, or operation logs, add their compatibility checks as explicit runtime persistence concerns instead of folding protocol state into object records.
