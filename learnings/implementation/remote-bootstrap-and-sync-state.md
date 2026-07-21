# Remote Bootstrap and Sync State

Phase 40 separates browser sync protocol state from persisted object records.
`IndexedDbSyncStateStorage` uses a sibling database (`<object database>-sync-state`)
so it does not require a version upgrade or schema ownership change in the
object-record database. `ApplicationRuntime` restores queue and operation-log
state during `whenReady()` and blocks startup when that state was written for a
different resolved model version.

`AuthorityService.bootstrap` is a server-side read operation. It starts from
accepted-state records but never returns a raw row: it derives the session
identity, applies any selected context with `withSelectedContext`, and uses the
normal runtime `read` path for scope and field-policy shaping. Invalid contexts
and denied rows deliberately look like no records. `localPrivate` objects are
excluded before any read response or cursor calculation.

Conflict transport responses contain a model-declared recovery state, not a
server record or client heuristic. `manual` produces `manualResolution`; the
other conflict policies produce `conflict` with their declared strategy.

## Practical guidance

- Keep sync queues, operation outcomes, and manual-resolution metadata out of
  `ObjectStorageBackend`; they are protocol persistence, not business records.
- Do not use a cursor to signal the existence of rows that did not pass policy.
  Compute pagination only from already visible records.
- Browser reconciliation uses `reconcileRemoteRecord`, which writes no new
  operation-log/audit/queue side effect and continues to route user-facing reads
  through `ApplicationRuntime`.
