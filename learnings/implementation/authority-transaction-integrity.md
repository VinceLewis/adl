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

## Testing — real PostgreSQL, not a fake

Backend behaviour here is proven by real integration tests in
`tests/integration/` (`npm run test:integration`), which provision a throwaway
`postgres:16-alpine` container, apply the real migrations, and run the
unit-of-work, concurrency gate (two genuinely concurrent connections),
integrity SQL, access-lifecycle atomicity, and the HTTP edge (real socket +
`fetch`) end to end. See [[testing-expectations]] and [[authority-server]].

A fake `pg` was tried first and is a cautionary tale: it masked a real defect —
`writeRuntimeAudit` built the durable `audit_id` with NUL-byte separators, which
a JS `Map` key tolerates but real PostgreSQL rejects
(`invalid byte sequence for encoding "UTF8": 0x00`), which would have rolled back
every accepted replay in production. The audit id now uses `:` separators. Do
not reintroduce a SQL-pattern-matching fake as the correctness proof for backend
behaviour; use the real integration suite, with a thin `faultyPool` decorator
(`tests/integration/pg-harness.ts`) only to inject a fault at a chosen write
stage while real begin/commit/rollback still executes.
