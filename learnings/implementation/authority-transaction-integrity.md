# Authority Projection Transactional Integrity

Read this before changing authority replay persistence, the accepted-record /
runtime-audit / outcome commit boundary, access-lifecycle audit atomicity, or
authority restore/integrity verification.

Phase 44 makes accepted replay atomic without moving any semantics into SQL.

- `PostgresAuthorityUnitOfWork` (in `authority-unit-of-work.ts`) owns one pinned
  client and the `begin`/`commit`/`rollback` boundary. `AuthorityTransaction`
  builds a transaction-scoped `ApplicationRuntime` over
  `PostgresObjectStorageBackend` in **ambient-transaction mode** so the backend's
  `commitTransaction` (multi-record commands) applies writes on the shared client
  without issuing a nested `begin`/`commit`. Record writes, the runtime audit
  projection, and the actor-bound outcome all commit or roll back together.
- The runtime audit table `adl_authority_audit_events` existed since Phase 39 but
  had **no writer**; Phase 44 populates it from `runtime.auditService.getEvents()`
  inside the same transaction. Durable audit ids are made globally unique per
  `(actorId, operationId, index)` because the runtime numbers audit ids per
  instance and would otherwise collide on the table's primary key.
- The outcome insert is the **concurrency/idempotency gate**: `putOutcome`
  returns false on `on conflict do nothing`, and the service throws
  `OutcomeConflictError` so a duplicate submission that raced past the pre-check
  rolls its record write back instead of committing a second accepted record.
- Failure classification matters. Deterministic runtime rejections and revision
  conflicts (`RuntimeError` / `RevisionConflictError`) are persisted durably in a
  short outcome-only transaction so retries stay idempotent. A non-deterministic
  infrastructure failure (a plain non-`RuntimeError`, e.g. a `pg` error) returns
  `null` from `classifyFailure`; the service rethrows it so it stays **retryable**
  rather than caching a false rejection. Note every runtime error class extends
  `RuntimeError`, so the discriminator is "is it a `RuntimeError`", not the code.
- `AuthorityService` takes an options object (`{ outcomes?, unitOfWork? }`). With
  a unit-of-work it uses the atomic path; without one it uses the in-process
  backend, which is test/development wiring only. `bootstrap` and model lookups
  still use the service-level runtime; only the replay write path uses the
  transaction runtime.
- Access lifecycle audit is atomic too: `AuthorityAccessStore.createInvite`,
  `revokeInvite`, and the new `revokeMembership` write their invite/record change
  and access-audit event in one store transaction. Membership revocation revokes
  sessions first so a failed tombstone leaves the fail-safe state (sessions gone,
  access still denied) rather than stale-valid sessions. `claimInvite` was
  already atomic since Phase 41.
- Report/export/administration audit stays a standalone metadata-only single
  insert: it mutates no accepted record, reads only committed projections, and
  therefore needs no shared transaction.
- `AuthorityProjectionIntegrity` is restore verification only: parameterised,
  metadata-only counts plus `consistent`, `acceptedOutcomeRecordsMissing`, and
  `orphanRecords`. It never prints accepted values, audit payloads, tokens, or
  outcome bodies, and backs the administration recovery view.

## Testing

`tests/authority-transaction-integrity.test.ts` uses an in-memory fake `pg`
pool/client (`FakePostgres`) that executes exactly the statements the projection
writers issue, models `begin`/`commit`/`rollback` via snapshot/restore, and
injects a failure at any statement. This exercises the real production SQL
sequencing and rollback, which no prior test covered. Prefer this fake over
mocking the stores, and drive the direct-statement stores (object storage,
access store) through the pool's single shared client so their transaction
snapshots coordinate. See [[authority-server]] for the surrounding boundary.
