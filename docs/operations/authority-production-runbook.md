# Authority Production Operations

## Deployment

Terminate TLS at the authority process or a trusted proxy. The Node adapter
accepts requests only when the resulting request URL is HTTPS; a proxy must set
`x-forwarded-proto: https` only after it has validated TLS. Do not expose it
directly behind an untrusted proxy.

Set `ADL_ENV=production`, `ADL_DATABASE_URL`, `ADL_ALLOWED_ORIGINS` (comma
separated HTTPS origins), `ADL_COOKIE_SECURE=true`,
`ADL_UPSTREAM_IDENTITY_ISSUER`, and `ADL_UPSTREAM_IDENTITY_AUDIENCE`. Create
configuration with `loadAuthorityConfiguration` and use only
`OpaqueSessionAdapter` with PostgreSQL identity/session storage. The process
refuses `StaticSessionAdapter` in production. The upstream verifier must
validate signature, issuer, audience, expiry, and intended proof type before
returning a subject. Do not place a proof, session token, or role claim in a
browser-readable store.

Wire `createAuthorityHttpHandler` (or `createAuthorityNodeServer`) with a
database readiness function that performs a bounded `select 1`. `/healthz`
means process alive; `/readyz` must be 503 if migrations are incomplete or the
database/model projection is unavailable. Scrape `/metrics`; alert on readiness
failure, elevated 401/403/429 counts, replay rejection spikes, failed migration,
and membership-revocation failures.

## Database roles and migrations

Use a database owner only to create roles. Run
[`roles.sql`](../../src/server/migrations/roles.sql) once, then apply ordered
`0001_authority_projection.sql`, `0002_security_operations.sql`,
`0003_reporting_administration.sql`, and
`0004_authority_transaction_integrity.sql` as `adl_migrator`. Run the process as
`adl_authority`; it has DML only and cannot create schema objects or run
migrations. Use a pinned PostgreSQL client for any multi-statement transaction.

Wire the authority with a `PostgresAuthorityUnitOfWork` (constructed from a
connection pool that hands out pinned clients). Accepted replay then commits the
accepted record, its runtime audit projection, and the actor-bound outcome in
one transaction; an infrastructure failure at any stage rolls all three back and
surfaces as a retryable error rather than a durable rejection. The in-process
backend without a unit-of-work remains test/development wiring only.

Before release: backup, apply migration, run readiness and HTTP smoke tests,
then retain the previous application build until the restore point is verified.
Never run DDL through the traffic connection string.

## Backup, recovery, and retention

Take encrypted daily logical backups and point-in-time WAL backups. Include all
`adl_authority_*` tables: accepted records, model metadata, memberships,
session/invite verifiers, outcomes, runtime audit, and access audit. Retain 35
daily, 12 monthly, and the current legal/audit retention period; get legal
approval before deleting audit data. A daily job may remove expired/revoked
session and invite verifier rows only after 35 days. Do not delete accepted
records, outcomes, or audit projections through that job.

`adl_authority_audit_events` is now a populated transactional projection (Phase
39 defined it; Phase 44 writes it inside the accepted-replay transaction).
Restore it together with the accepted-record and outcome projections; a restore
that recovers outcomes but loses their referenced records is inconsistent.

Phase 43 adds the metadata-only `adl_authority_administration_audit_events`
projection. Include it in the same backup, restore-count, and legal retention
process. It records report/export and operational-review metadata, not report
rows, raw audit payloads, session/invite verifiers, or credentials. Report
pages are intentionally short-lived server state and are not recoverable data.

Quarterly restore drill:

1. Restore an encrypted backup into an isolated database and apply WAL to the
   chosen recovery point.
2. Apply migrations with `adl_migrator`; connect only with `adl_authority`.
3. Verify row counts for every `adl_authority_*` table and sample a record,
   membership, session verifier, invite verifier, outcome, audit, and
   access-audit event without printing protected JSON.
4. Run `AuthorityProjectionIntegrity.verify` against the restored database. It
   returns metadata-only counts plus `consistent`, `acceptedOutcomeRecordsMissing`,
   and `orphanRecords`, and must report `consistent: true`. A non-zero
   `acceptedOutcomeRecordsMissing` or `orphanRecords` means an incomplete restore
   set; do not switch traffic. `AuthorityProjectionIntegrity.recoveryStatus`
   backs the administration recovery view with the same result and prints no
   protected JSON.
5. Run `/readyz`, an authenticated bootstrap, an idempotent replay retry, an
   invite claim fixture, and a revoked-session rejection against the restored
   instance. Record backup id, recovery point, elapsed time, and results.
6. Destroy the isolated restore and rotate any credentials used for the drill.

## Incidents

**Suspected session compromise:** revoke the affected user's sessions, revoke
membership if access itself is suspect, rotate the session cookie on next login,
preserve redacted security/access events, and force a policy-shaped bootstrap.

**Invite misuse:** revoke the invite in its original context, inspect only its
access-audit id and metadata, revoke the claimed membership if needed, then
revoke that user's sessions.

**Database loss/corruption:** stop writes, select a recovery point, restore to
an isolated database, complete the drill checks above, switch traffic only once
readiness passes, then have clients bootstrap before replaying queued intents.

**Replay/conflict spike:** inspect aggregate metrics and redacted operation ids
only; confirm model/version deployment compatibility, pause affected client
release if necessary, and keep idempotent retries enabled. Never repair state
by accepting raw browser records or bypassing `AuthorityService`.

**Report/export concern:** use the context-bounded access-audit and
administration-audit summaries to identify the actor, report name, and time.
Do not query the database for a raw report payload: no report payload is kept.
If membership access is suspect, revoke that membership (which revokes sessions)
and have the user bootstrap again. A context manager may revoke sessions only
for a user with active membership in that same context.
