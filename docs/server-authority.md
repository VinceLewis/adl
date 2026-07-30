# Phase 39 Authority Server

The first authority slice is a TypeScript service that accepts operation intents,
not raw records. It creates `ApplicationRuntime` from the resolved model and
replays `create`, `update`, `delete`, `transition`, and `command` through that
runtime. SQL, routes, and authentication-provider configuration remain outside
the ADL model.

## Trust boundary

`OpaqueSessionAdapter` is the Phase 41 production adapter. It provisions a
stable identity from a trusted upstream account proof and issues random opaque
tokens that are stored only as SHA-256 verifiers in the authority database. It
validates expiry and identity status on every request and supports rotation,
sign-out, and user-wide revocation. The HTTP integration must carry the raw
token only in an HTTPS-only, Secure, HttpOnly, SameSite cookie (or an equivalent
server-managed credential); it must not put an ADL role or membership in a
token. `StaticSessionAdapter` remains development/test-only and must not be
wired into a production authority process.

The request cannot set a user id, global role, context role, audit actor,
accepted revision, or timestamp. Context roles are resolved from accepted
`BandMember` records through `RuntimeContextService` before the runtime applies
policy. A valid authentication session therefore proves identity only, not
business access.

Never put ADL business roles in a bearer token and never log a session token.

## PostgreSQL

Apply [`0001_authority_projection.sql`](../src/server/migrations/0001_authority_projection.sql)
to the authority database with a least-privilege migration role. The runtime
record projection, model metadata, membership projection, idempotent outcomes,
and audit projection use separate tables. `PostgresAuthorityOutcomeStore` uses
parameterised SQL and can accept a standard `pg` pool without exposing `pg` in
the language contract.

The application service must wrap accepted record projection, audit projection,
and outcome persistence in one PostgreSQL transaction. The current in-process
runtime backend is intentionally useful for tests; production wiring must supply
a PostgreSQL record backend before serving shared traffic.

## Outcome and replay rules

An operation id is idempotent: a retry returns the previously stored outcome.
Stale base revisions become `conflict` (or `manualResolution` for manual model
conflict policy). Runtime policy, validation, lifecycle, command preconditions,
scope and constraints determine `rejected`. Response records must be shaped for
the authenticated context; do not return raw audit, conflict, or protected data.

## Deferred work

Everything the Phase 39 slice left open is now either implemented in a later
phase or still explicitly outstanding:

- Remote bootstrap and browser reconciliation — Phase 40, below.
- Identity, invites and access lifecycle — Phase 41, below.
- HTTP edge, deployment configuration and operations — Phase 42, below.
- Reporting and administration — Phase 43, below.
- Transactional projection integrity — Phase 44, below.
- Audit scope and retention — Phase 45, below.
- A runnable process, a client transport and an identity boundary — Phase 46,
  below.

Still outstanding after Phase 46: a real upstream identity provider (the switch
exists, the bypass is the default and is disclosed), conflict and
manual-resolution recovery UI, sign-in and invite-claim UI, the PWA offline
shell, membership-projection scoping, retention scheduling and its
administration UI, TLS termination, secret management, CI/CD, and a hosting
provider decision.

## Remote bootstrap and browser reconciliation

Phase 40 adds `AuthorityService.bootstrap(...)`. It accepts only a verified
session and an optional selected business context. The service derives identity
and context roles server-side, excludes `localPrivate` objects, and passes every
accepted record through normal runtime context-scope and read-policy shaping
before it is returned. Denied rows and invalid context selection both produce
an empty result; they are not distinguishable to the caller. Cursors are opaque,
bounded, and advance only through records already visible to that caller.

`AuthoritySyncClient` continues to submit only `localFirst` queue entries.
The IndexedDB `syncState` database persists queue entries and operation-log
outcomes separately from object records, with a model-version startup guard.
Conflict outcomes carry only a deterministic recovery strategy from the resolved
object sync policy (`serverWins`, `clientWins`, `stateTransitionWins`, or
`manual`); protected authority records are never attached to a conflict.

The client applies accepted and bootstrap records through the runtime's trusted
sync-projection path. That path creates no new operation-log, audit, or queue
side effect and marks the local projection `synced`; user-facing reads still go
through normal `ApplicationRuntime` policy checks. A complete recovery UI
remains follow-up work.

## Identity, invites, and revocation

`AuthorityAccessLifecycleService` creates an invite only after the authenticated
caller passes the existing ADL `update` policy on the resolved membership
object in the target context. An invite contains a one-time hashed verifier,
target context, permitted role, optional recipient identity, and expiry. It is
claimed only online by a verified session. PostgreSQL locks the invite row and
in the same transaction inserts the membership record, marks the invite
claimed, and records an access audit event. Raw invite tokens never appear in
records, audit, sync state, outcomes, or logs.

Membership removal is likewise policy-gated, tombstones the server membership
record, emits access audit, and revokes the affected user's opaque sessions.
The next bootstrap or replay therefore fails authentication before returning or
accepting shared data. Existing cached browser records are not an access grant:
the client cannot claim or alter access offline, and the next authenticated
bootstrap remains policy-shaped and reconciles the permitted dataset.

## Production boundary and operations

Phase 42 adds the deployment-only HTTP/configuration edge under `src/server/`.
It requires HTTPS, exact configured origins, JSON size/content-type validation,
Secure HttpOnly SameSite=Strict `__Host-` session cookies, CSRF protection for
mutations, rate controls, and redacted structured security events. It never
adds routes, SQL, cookie settings, or identity providers to the ADL model.

Read the [production runbook](operations/authority-production-runbook.md) and
[threat model](security/phase-42-threat-model.md) before deploying. Production
uses `OpaqueSessionAdapter` and PostgreSQL only; `StaticSessionAdapter` is
rejected by configuration validation. Migration and traffic accounts are
separate, and recovery drills cover every authority projection.

## Authoritative reporting and administration

Phase 43 adds `AuthorityReportingService` and `AuthorityAdministrationService`.
Reports execute only a named resolved read model through `ApplicationRuntime`;
they do not accept SQL, arbitrary fields, filters, object names, or database
credentials. Runtime context scope, source `search`/`read` policy, field masks,
and read-model semantics shape every result before the service paginates it.
CSV export additionally requires the existing `export` policy for every source
record. Reports are limited to 500 rows, exports to 100 rows, and pages to 100
rows. Report and administration-list cursors are opaque, short-lived,
actor-bound server state.

The HTTP edge exposes POST-only, CSRF/origin/session/rate-protected endpoints
at `/v1/reports/execute`, `/v1/reports/export`, and narrowly scoped
`/v1/admin/*` review/response routes. Administration first requires existing
ADL membership-management (`update`) policy in one selected business context.
It returns status summaries only: no record JSON, audit before/after payload,
session verifier, invite verifier, outcome body, or raw access-audit event is
returned. Session revocation is limited to a target with active access in the
same managed context.

`0003_reporting_administration.sql` adds only a metadata-only administration
audit projection and context-review indexes. It does not expose SQL through
ADL, duplicate accepted records, or store credentials. Apply it with
`adl_migrator` before serving these endpoints.

## Transactional projection integrity

Phase 44 makes accepted replay atomic. `PostgresAuthorityUnitOfWork` owns one
pinned client and the `begin`/`commit`/`rollback` boundary; inside it a
transaction-scoped `ApplicationRuntime` (over `PostgresObjectStorageBackend` in
ambient-transaction mode) writes the accepted record, the runtime audit
projection is persisted into `adl_authority_audit_events`, and the actor-bound
outcome is inserted — all in the same transaction. The outcome insert is the
concurrency gate: a duplicate submission that races past the idempotency
pre-check finds the outcome already present and rolls its record write back
instead of committing a second accepted record. Multi-record commands keep their
existing all-or-nothing semantics through the same boundary.

A deterministic runtime rejection or revision conflict is persisted durably in a
short outcome-only transaction so a later retry stays idempotent. A
non-deterministic infrastructure failure rolls the whole transaction back and
surfaces (retryable) rather than being cached as a false verdict — the runtime
stays the semantic authority and SQL never reimplements policy, validation,
lifecycle, or command logic. Invite creation/revocation and membership
revocation likewise commit their invite or record change together with their
access-audit event.

`AuthorityProjectionIntegrity` provides restore verification: metadata-only
counts plus `consistent`, `acceptedOutcomeRecordsMissing`, `orphanRecords`, and
`auditScopeInconsistent`, computed with parameterised SQL and never printing
accepted values, audit payloads, tokens, or outcome bodies.
`0004_authority_transaction_integrity.sql` adds the runtime-audit review index;
apply it with `adl_migrator`.

## Audit scope and retention

Phase 45 makes runtime-audit review context-scoped in the projection and gives
runtime audit and outcomes a bounded retention lifecycle.
`0005_authority_audit_scope_and_retention.sql` adds `context_name`/`context_id`
to `adl_authority_audit_events` and `application_id` to
`adl_authority_operation_outcomes`, plus the supporting indexes; apply it with
`adl_migrator`.

The unit-of-work stamps each audit row with the record's business context,
derived only from the model's declared object scope (`ResolvedObject.scope`) —
the context id is the record's scope-field value, not a reimplemented policy.
Unscoped (global) objects leave both columns null and never appear in a
per-context review. `PostgresAuthorityAdministrationStore.listRuntimeAudit` now
filters to one authorised context in SQL, so a bounded page is neither dominated
nor emptied by other contexts' events; `AuthorityAdministrationService`
`runtimeAudit` still applies the per-row runtime read as the final disclosure
boundary, and an inaccessible row is never an existence oracle.

`AuthorityRetentionService.prune` is the application-scoped retention path for
runtime audit and outcomes. It deletes only rows older than an effective cutoff
clamped to no later than `now - minimumRetentionMs`, so in-retention rows are
never removed; it refuses under `legalHold`, throws on a non-positive minimum
window, and never touches accepted records, sessions, invites, or identities.
Its result is metadata-only (counts and the effective cutoff). Operational
detail is in `docs/operations/authority-production-runbook.md`.

## First deployment slice

Phase 46 makes the authority a process that runs, gives it a switchable identity
boundary, and closes the browser-to-server loop.

**Identity switch.** `ADL_IDENTITY_VERIFICATION` selects the upstream verifier
and defaults to `bypass`. While it is `bypass`, no provider is contacted and the
supplied account proof is accepted as the identity subject; the proof is still
shape-checked, so a control character or an over-long value can never reach
identity storage. This is a deliberate, temporary development state pending a
real provider decision, and it is never silent: `selectUpstreamIdentityVerifier`
is disclosed in the `identity_verification_configured` startup security event and
in the `/readyz` body as `{ mode, verifier, bypassed }`. Setting the switch to
`upstream` without supplying a provider selects
`UnconfiguredUpstreamIdentityVerifier`, which rejects every proof with
`authentication_failed` — turning verification on never falls back to the
bypass. In production the bypass must additionally be acknowledged with
`ADL_IDENTITY_BYPASS_ACKNOWLEDGED=true`, so it cannot be reached by omission.

Bypassed verification widens nothing else. Sessions are still opaque tokens
stored as SHA-256 verifiers, the request still cannot set a user id, role, audit
actor, accepted revision or timestamp, and context roles are still resolved from
accepted membership records through the runtime on every call.

**Runnable process.** `createAuthorityProcess` composes deployment
configuration, a real `pg` pool, PostgreSQL identity/session, record, outcome,
access and administration stores, the Phase 44 unit-of-work and the Node HTTP
adapter, and registers the application's model metadata row. Migrations stay out
of band with the migration role. `npm run start:authority` builds the server
sources and runs it. The resolved model is compiled from `ADL_MODEL_PATH`, so
the process serves the same ADL project the browser runs.

**Client transport.** `HttpAuthorityTransport` is the browser implementation of
`AuthorityTransport`. It carries only the Phase 42 credentials: the `__Host-`
Secure HttpOnly SameSite=Strict session cookie the user agent attaches, and the
readable double-submit CSRF cookie mirrored into `x-adl-csrf-token`. The raw
session token is unreadable to client code by design, so the `sessionToken`
parameter is ignored on that path. A network failure or non-2xx response raises
`AuthorityTransportError` rather than a fabricated outcome, which keeps the
queued operation retryable instead of recording a false verdict.

`AuthoritySyncClient.bootstrap` now follows `nextCursor` to exhaustion. Applying
only page one silently dropped permitted records; the walk stops on an empty
page or a repeated cursor rather than trusting the server to terminate it.

`reconcile` now resolves queue entries through `ObjectStore.getRecordForSync`, a
trusted tombstone-inclusive lookup. It previously used the active-record read,
so a queued delete — which by definition has no active local row — was skipped,
left in the queue, and never reached the authority.

**Browser identity.** `/v1/session/issue` and `/v1/session/current` return the
server-derived `userId` for that session and nothing else, so the browser can set
`RuntimeContext.userId` without ever being trusted to supply it. Authority sync
is opt-in through `VITE_ADL_AUTHORITY_URL`; when it is unset the browser demo
stays entirely local, which keeps the visual verification suite meaningful.
